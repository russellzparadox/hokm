/* Hokm (حکم) core: rules, game controller and AI.
 * Works in the browser (window.HokmCore) and in Node (module.exports).
 *
 * Cards are integers 0..51: suit = floor(c / 13), rank = c % 13.
 * Suits: 0 ♠ پیک, 1 ♥ دل, 2 ♣ گشنیز, 3 ♦ خشت.
 * Ranks: 0 = "2" … 8 = "10", 9 = J, 10 = Q, 11 = K, 12 = A.
 * Seats: 0 = human (bottom), 1 = right, 2 = top (partner), 3 = left.
 * Play goes 0 → 1 → 2 → 3 (counter-clockwise). Teams: seats 0 & 2, seats 1 & 3.
 *
 * Hokm modes:
 *   suit      — a trump suit; normal ranking A > K > … > 2
 *   saras     — سرس: no trump, no ruffing; A > K > … > 2
 *   naras     — نرس: no trump; 2 > 3 > … > K > A
 *   taknaras  — تک‌نرس: no trump; A > 2 > 3 > … > K
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HokmCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SUIT_SYM = ['♠', '♥', '♣', '♦'];
  var SUIT_FA = ['پیک', 'دل', 'گشنیز', 'خشت'];
  var RANK_LABEL = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  var MODE_FA = { suit: 'حکم', saras: 'سرس', naras: 'نرس', taknaras: 'تک‌نرس' };
  var NT_MODES = ['saras', 'naras', 'taknaras'];

  var DEFAULTS = {
    difficulty: 'hard',   // easy | medium | hard
    saras: true,
    naras: true,
    taknaras: true,
    kotNT: false,          // count کوت in saras / naras / taknaras
    target: 7,             // match points
    thinkMs: 260           // time budget for the hard AI per card
  };

  function suitOf(c) { return (c / 13) | 0; }
  function rankOf(c) { return c % 13; }
  function teamOf(seat) { return seat & 1; }
  function partnerOf(seat) { return (seat + 2) & 3; }

  // Higher number = stronger card within its suit, for the given mode.
  function strength(c, mode) {
    var r = c % 13;
    if (mode === 'naras') return 12 - r;
    if (mode === 'taknaras') return r === 12 ? 12 : 11 - r;
    return r;
  }

  function cardLabel(c) { return RANK_LABEL[rankOf(c)] + SUIT_SYM[suitOf(c)]; }

  function hokmLabel(h) {
    if (!h) return '';
    if (h.mode === 'suit') return SUIT_FA[h.trump];
    return MODE_FA[h.mode];
  }

  function makeRng(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(arr, rng) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = (rng() * (i + 1)) | 0;
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  function fullDeck() { var d = []; for (var i = 0; i < 52; i++) d.push(i); return d; }

  var now = (typeof performance !== 'undefined' && performance.now)
    ? function () { return performance.now(); }
    : function () { return Date.now(); };

  /* ------------------------------------------------------------------ rules */

  // Does card a beat the current winning card b? (b is always led suit or trump.)
  function beats(a, b, hokm) {
    var sa = suitOf(a), sb = suitOf(b), t = hokm.trump;
    if (t >= 0) {
      if (sa === t && sb !== t) return true;
      if (sb === t && sa !== t) return false;
    }
    if (sa !== sb) return false;
    return strength(a, hokm.mode) > strength(b, hokm.mode);
  }

  function trickWinnerIndex(cards, hokm) {
    var best = 0;
    for (var i = 1; i < cards.length; i++) if (beats(cards[i], cards[best], hokm)) best = i;
    return best;
  }

  function legalMoves(hand, ledSuit) {
    if (ledSuit < 0) return hand.slice();
    var f = [];
    for (var i = 0; i < hand.length; i++) if (suitOf(hand[i]) === ledSuit) f.push(hand[i]);
    return f.length ? f : hand.slice();
  }

  function isNT(hokm) { return hokm.mode !== 'suit'; }

  // A discard counts as a call (خواستن) when the card is fairly high: 8 or above in normal order.
  function isSignalCard(card, mode) { return strength(card, mode) >= 6; }

  // Points for the round winner. کوت = 2, حاکم‌کوت (hakem's team gets nothing) = 3.
  function roundPoints(winTeam, tricks, hakem, hokm, settings) {
    var lose = 1 - winTeam;
    var kotAllowed = !isNT(hokm) || !!settings.kotNT;
    if (tricks[lose] === 0 && kotAllowed) return teamOf(hakem) === lose ? 3 : 2;
    return 1;
  }

  function newRoundState(hands, hokm, hakem) {
    return {
      hands: hands.map(function (h) { return h.slice(); }),
      hokm: hokm,
      hakem: hakem,
      leader: hakem,
      turn: hakem,
      trick: [],
      trickSeats: [],
      tricks: [0, 0],
      played: new Uint8Array(52),
      voids: [new Uint8Array(4), new Uint8Array(4), new Uint8Array(4), new Uint8Array(4)],
      calls: [-1, -1, -1, -1],   // suit each player asked for by discarding a high card (خواستن)
      leads: [-1, -1, -1, -1],   // first suit each player led
      // Highest strength a player can still hold in a suit, learned from failing to win a trick:
      capH: [[99, 99, 99, 99], [99, 99, 99, 99], [99, 99, 99, 99], [99, 99, 99, 99]],   // 4th hand: sure
      capS: [[99, 99, 99, 99], [99, 99, 99, 99], [99, 99, 99, 99], [99, 99, 99, 99]],   // 3rd hand: likely
      over: false,
      winTeam: -1,
      tricksPlayed: 0,
      lastTrick: null
    };
  }

  function cloneState(st) {
    return {
      hands: st.hands.map(function (h) { return h.slice(); }),
      hokm: st.hokm,
      hakem: st.hakem,
      leader: st.leader,
      turn: st.turn,
      trick: st.trick.slice(),
      trickSeats: st.trickSeats.slice(),
      tricks: st.tricks.slice(),
      played: st.played.slice(),
      voids: st.voids.map(function (v) { return v.slice(); }),
      calls: st.calls.slice(),
      leads: st.leads.slice(),
      capH: st.capH.map(function (a) { return a.slice(); }),
      capS: st.capS.map(function (a) { return a.slice(); }),
      over: st.over,
      winTeam: st.winTeam,
      tricksPlayed: st.tricksPlayed,
      lastTrick: null
    };
  }

  // Applies a card. Returns the trick winner seat when the trick completes, else -1.
  function applyMove(st, seat, card) {
    var h = st.hands[seat];
    var i = h.indexOf(card);
    h.splice(i, 1);
    var led = st.trick.length ? suitOf(st.trick[0]) : -1;
    if (led >= 0 && suitOf(card) !== led) {
      st.voids[seat][led] = 1;
      // Convention: discarding a high card (not ruffing) asks partner for that suit.
      var cs = suitOf(card);
      if (cs !== st.hokm.trump && st.calls[seat] < 0 && isSignalCard(card, st.hokm.mode)) st.calls[seat] = cs;
    }
    if (led < 0 && st.leads[seat] < 0) st.leads[seat] = suitOf(card);
    // Followed suit but did not take an opponent's trick: they hold nothing above the winning card.
    var pos0 = st.trick.length;   // card not pushed yet
    if (led >= 0 && suitOf(card) === led && (pos0 === 3 || pos0 === 2)) {
      var wi0 = trickWinnerIndex(st.trick, st.hokm), wc = st.trick[wi0];
      if (suitOf(wc) === led && teamOf(st.trickSeats[wi0]) !== teamOf(seat) && !beats(card, wc, st.hokm)) {
        var capArr = pos0 === 3 ? st.capH : st.capS, wv = strength(wc, st.hokm.mode);
        if (wv < capArr[seat][led]) capArr[seat][led] = wv;
      }
    }
    if (st.calls[seat] >= 0 && led === st.calls[seat] && suitOf(card) !== led) st.calls[seat] = -1; // void now
    st.trick.push(card);
    st.trickSeats.push(seat);
    st.played[card] = 1;
    if (st.trick.length === 4) {
      var wi = trickWinnerIndex(st.trick, st.hokm);
      var w = st.trickSeats[wi];
      st.tricks[teamOf(w)]++;
      st.lastTrick = { cards: st.trick, seats: st.trickSeats, winner: w };
      st.trick = [];
      st.trickSeats = [];
      st.leader = w;
      st.turn = w;
      st.tricksPlayed++;
      if (st.tricks[teamOf(w)] >= 7) { st.over = true; st.winTeam = teamOf(w); }
      return w;
    }
    st.turn = (seat + 1) & 3;
    return -1;
  }

  /* ------------------------------------------------------- heuristic player */

  // Human conventions the AI follows (switchable for testing).
  var CONV = { passLead: true, calls: true, holdCash: true, holdDuck: true, thirdHigh: true, returnLead: true, shorten: true };

  // A rule-based player that only uses public information plus its own hand.
  // Used directly by the easy/medium AI and as the playout policy of the hard AI.
  function heuristicMove(st, seat) {
    var hand = st.hands[seat];
    var hokm = st.hokm, mode = hokm.mode, t = hokm.trump;
    var pos = st.trick.length;
    var led = pos ? suitOf(st.trick[0]) : -1;
    var legal = legalMoves(hand, led);
    if (legal.length === 1) return legal[0];

    var mine = new Uint8Array(52);
    var i, c, s;
    for (i = 0; i < hand.length; i++) mine[hand[i]] = 1;
    var outStr = [[], [], [], []];
    var outCnt = [0, 0, 0, 0];
    for (c = 0; c < 52; c++) {
      if (!st.played[c] && !mine[c]) { s = suitOf(c); outStr[s].push(strength(c, mode)); outCnt[s]++; }
    }
    function higherOut(card) {
      var arr = outStr[suitOf(card)], v = strength(card, mode), n = 0;
      for (var k = 0; k < arr.length; k++) if (arr[k] > v) n++;
      return n;
    }
    var suitCount = [0, 0, 0, 0];
    for (i = 0; i < hand.length; i++) suitCount[suitOf(hand[i])]++;
    var partner = partnerOf(seat);
    var myTeam = teamOf(seat);
    var voids = st.voids;

    function str(card) { return strength(card, mode); }
    function lowest(cards) {
      var b = cards[0];
      for (var k = 1; k < cards.length; k++) if (str(cards[k]) < str(b)) b = cards[k];
      return b;
    }
    function highest(cards) {
      var b = cards[0];
      for (var k = 1; k < cards.length; k++) if (str(cards[k]) > str(b)) b = cards[k];
      return b;
    }
    function cheapest(cards) {
      var b = cards[0], bv = 1e9;
      for (var k = 0; k < cards.length; k++) {
        var v = (t >= 0 && suitOf(cards[k]) === t ? 100 : 0) + str(cards[k]);
        if (v < bv) { bv = v; b = cards[k]; }
      }
      return b;
    }
    var myCall = st.calls[seat];
    // The suit I'd ask partner for: I hold its top card and at least one more, and a high card to throw.
    function callCard(cards) {
      if (myCall >= 0 || !CONV.calls) return -1;
      var bestC = -1, bestV = -1;
      for (var su = 0; su < 4; su++) {
        if (su === t || suitCount[su] < 2 || outCnt[su] < 2) continue;
        var inSuit = cards.filter(function (x) { return suitOf(x) === su; });
        if (inSuit.length < 3) continue;
        var top = highest(inSuit);
        if (higherOut(top) !== 0) continue;
        var sig = inSuit.filter(function (x) { return x !== top && isSignalCard(x, mode); });
        if (!sig.length) continue;
        var v = outCnt[su] + inSuit.length * 2;
        if (v > bestV) { bestV = v; bestC = lowest(sig); }
      }
      return bestC;
    }
    function discard(cards) {
      var cc0 = callCard(cards);
      if (cc0 >= 0) return cc0;
      var b = cards[0], bv = 1e9;
      for (var k = 0; k < cards.length; k++) {
        var cc = cards[k], cs = suitOf(cc);
        var v = str(cc);
        if (t >= 0 && cs === t) v += 40;
        if (cs !== t && myCall < 0 && isSignalCard(cc, mode)) v += 14;   // don't send a false call
        if (cs === myCall) v += 12;                                      // keep the suit I asked for
        if (higherOut(cc) === 0 && outCnt[cs] > 0) v += 18;
        if (t >= 0 && cs !== t) v += suitCount[cs] * 0.7;
        if (t < 0) v += suitCount[cs] * 0.9;
        if (v < bv) { bv = v; b = cc; }
      }
      return b;
    }
    // Could an opponent among `after` beat `card` in this trick?
    function canBeBeaten(card, after, ledSuit) {
      var sc = suitOf(card);
      for (var k = 0; k < after.length; k++) {
        var p = after[k];
        if (teamOf(p) === myTeam) continue;
        var voidLed = voids[p][ledSuit] || outCnt[ledSuit] === 0;
        if (!voidLed) {
          if (sc === ledSuit && higherOut(card) > 0) return true;
          // short suit: an unknown void may still ruff
          if (t >= 0 && ledSuit !== t && sc !== t && outCnt[ledSuit] <= 1 && outCnt[t] > 0 && !voids[p][t]) return true;
        } else if (t >= 0 && ledSuit !== t && !voids[p][t] && outCnt[t] > 0) {
          if (sc !== t) return true;
          if (higherOut(card) > 0) return true;
        }
      }
      return false;
    }

    /* ---- leading ---- */
    if (pos === 0) {
      var bySuit = [[], [], [], []];
      for (i = 0; i < hand.length; i++) bySuit[suitOf(hand[i])].push(hand[i]);
      for (s = 0; s < 4; s++) bySuit[s].sort(function (a, b) { return str(b) - str(a); });
      var opps = [(seat + 1) & 3, (seat + 3) & 3];
      var topOutOf = function (su) { var m = -1; for (var q = 0; q < outStr[su].length; q++) if (outStr[su][q] > m) m = outStr[su][q]; return m; };
      // Can this player hold the top outstanding card of the suit?
      var mayHoldTop = function (p, su) {
        var tp = topOutOf(su);
        return !voids[p][su] && st.capH[p][su] >= tp && st.capS[p][su] >= tp;
      };
      var oppCanRuff = function (su) {
        if (t < 0 || su === t || outCnt[t] === 0) return false;
        for (var k = 0; k < 2; k++) {
          var p = opps[k];
          if ((voids[p][su] || outCnt[su] === 0) && !voids[p][t]) return true;
        }
        return false;
      };

      // Draw trumps when holding the top trump.
      if (t >= 0 && bySuit[t].length && outCnt[t] > 0) {
        var topT = bySuit[t][0];
        var hakemTeam = teamOf(st.hakem) === myTeam;
        if (higherOut(topT) === 0 && (hakemTeam || bySuit[t].length >= outCnt[t])) return topT;
      }
      // Cash sure winners in side suits (but hold side aces on the very first trick).
      var firstTrick = st.tricksPlayed === 0;
      var cash = null, cashScore = -1;
      for (s = 0; s < 4; s++) {
        if (s === t || !bySuit[s].length) continue;
        var top = bySuit[s][0];
        if (higherOut(top) !== 0 || oppCanRuff(s)) continue;
        if (CONV.holdCash && firstTrick && outCnt[s] >= 6) continue;
        var sc = outCnt[s] * 2 + bySuit[s].length;
        if (sc > cashScore) { cashScore = sc; cash = top; }
      }
      if (cash !== null) return cash;
      // Partner asked for a suit (خواستن): lead it now that my winners are cashed.
      var pc = st.calls[partner];
      if (CONV.calls && pc >= 0 && bySuit[pc].length && !voids[partner][pc] && !oppCanRuff(pc) &&
          (higherOut(bySuit[pc][0]) === 0 || mayHoldTop(partner, pc))) {
        var pcs = bySuit[pc];
        return higherOut(pcs[0]) === 0 ? pcs[0] : pcs[pcs.length - 1];
      }
      if (t >= 0 && outCnt[t] > 0 && !voids[partner][t]) {
        for (s = 0; s < 4; s++) {
          if (s === t || !bySuit[s].length) continue;
          if (voids[partner][s] && !voids[opps[0]][s] && !voids[opps[1]][s]) return bySuit[s][bySuit[s].length - 1];
        }
      }
      // Pass the lead: the opponents showed they can't hold the top card of a suit, so partner has it.
      if (CONV.passLead) {
        var passS = -1, passV = -1;
        for (s = 0; s < 4; s++) {
          if (s === t || !bySuit[s].length || outCnt[s] === 0 || oppCanRuff(s)) continue;
          if (higherOut(bySuit[s][0]) === 0) continue;                  // I hold the top: cashing covers it
          if (!mayHoldTop(partner, s) || mayHoldTop(opps[0], s) || mayHoldTop(opps[1], s)) continue;
          var pv = outCnt[s] - bySuit[s].length;
          if (pv > passV) { passV = pv; passS = s; }
        }
        if (passS >= 0) return bySuit[passS][bySuit[passS].length - 1];
      }
      // Return partner's suit.
      var pl = st.leads[partner];
      if (CONV.returnLead && pl >= 0 && pl !== t && bySuit[pl].length && !oppCanRuff(pl) && !voids[partner][pl] && st.calls[opps[0]] !== pl && st.calls[opps[1]] !== pl) {
        return bySuit[pl][bySuit[pl].length - 1];
      }
      // Otherwise lead low from the best long suit.
      var bestS = -1, bestScore = -1e9;
      for (s = 0; s < 4; s++) {
        if (!bySuit[s].length) continue;
        var score = bySuit[s].length * 2;
        if (st.calls[opps[0]] === s || st.calls[opps[1]] === s) score -= 6;  // opponents hold the top there
        if (s === myCall) score -= 2;                                         // let partner lead it to me
        if (CONV.shorten && t >= 0 && s !== t && bySuit[s].length === 1 && suitCount[t] >= 2 && higherOut(bySuit[s][0]) > 0) score += 3; // shorten for a ruff
        if (oppCanRuff(s)) score -= 12;
        if (s === t) score -= 6;
        if (t < 0 && voids[partner][s]) score -= 3;
        if (bySuit[s].length === 1 && higherOut(bySuit[s][0]) === 1) score -= 4; // don't lead a lone second-best
        if (score > bestScore) { bestScore = score; bestS = s; }
      }
      var arr = bySuit[bestS];
      return arr[arr.length - 1];
    }

    /* ---- following ---- */
    var curIdx = trickWinnerIndex(st.trick, hokm);
    var curBest = st.trick[curIdx];
    var curSeat = st.trickSeats[curIdx];
    var after = [];
    for (var k2 = pos + 1; k2 < 4; k2++) after.push((st.trickSeats[0] + k2) & 3);
    var following = suitOf(legal[0]) === led && legal.every(function (x) { return suitOf(x) === led; }) && suitCount[led] > 0;
    var winners = legal.filter(function (x) { return beats(x, curBest, hokm); });
    var dump = function () { return following ? lowest(legal) : discard(legal); };

    var followWinners = winners.filter(function (x) { return suitOf(x) === led; });
    if (teamOf(curSeat) === myTeam) {
      if (!after.length || !canBeBeaten(curBest, after, led)) return dump();
      // Third hand: partner may be beaten — play my highest card if it takes over.
      if (CONV.thirdHigh && pos === 2 && followWinners.length) return highest(followWinners);
      var safeP = winners.filter(function (x) { return !canBeBeaten(x, after, led); });
      if (safeP.length) return cheapest(safeP);
      return dump();
    }
    if (!winners.length) return dump();
    if (!after.length) return cheapest(winners);
    // Second hand on the first trick: keep the ace hidden and duck.
    if (CONV.holdDuck && pos === 1 && following && st.tricksPlayed === 0 && led !== t) return lowest(legal);
    // Third hand: if I can win, play my highest card.
    if (CONV.thirdHigh && pos === 2 && followWinners.length) return highest(followWinners);
    var safe = winners.filter(function (x) { return !canBeBeaten(x, after, led); });
    if (safe.length) return cheapest(safe);
    if (pos === 1) {
      if (following) return lowest(legal);   // second hand low
      return cheapest(winners);              // ruff
    }
    // third hand: play the winner hardest to beat
    var best = winners[0], bv = 1e9;
    for (i = 0; i < winners.length; i++) {
      var v = higherOut(winners[i]) * 30 + str(winners[i]) + (t >= 0 && suitOf(winners[i]) === t && led !== t ? 15 : 0);
      if (v < bv) { bv = v; best = winners[i]; }
    }
    return best;
  }

  /* ------------------------------------------------------------- hard AI */

  // Deal the unseen cards to the other players, respecting known voids.
  function sampleHands(st, seat, rng) {
    var mine = st.hands[seat];
    var known = new Uint8Array(52);
    var i;
    for (i = 0; i < mine.length; i++) known[mine[i]] = 1;
    var unknown = [];
    for (var c = 0; c < 52; c++) if (!st.played[c] && !known[c]) unknown.push(c);
    var others = [];
    for (i = 1; i < 4; i++) others.push((seat + i) & 3);

    for (var attempt = 0; attempt < 30; attempt++) {
      var relax = attempt >= 25;
      shuffle(unknown, rng);
      var elig = unknown.map(function (card) {
        var s = suitOf(card), v = strength(card, st.hokm.mode), e = [];
        for (var k = 0; k < 3; k++) {
          var p = others[k];
          if (relax || (!st.voids[p][s] && v <= st.capH[p][s])) e.push(p);
        }
        return e;
      });
      var order = unknown.map(function (_, idx) { return idx; });
      order.sort(function (a, b) { return elig[a].length - elig[b].length; });
      var cap = [0, 0, 0, 0];
      for (i = 0; i < 3; i++) cap[others[i]] = st.hands[others[i]].length;
      var hands = [[], [], [], []];
      hands[seat] = mine.slice();
      var ok = true;
      // The hakem picked the hokm from his first five cards: he is more likely
      // to hold trumps (or, in سرس/نرس/تک‌نرس, the strong cards of that mode).
      var hk = st.hakem, hm = st.hokm;
      var topOut = [-1, -1, -1, -1];
      unknown.forEach(function (cd) { var su = suitOf(cd), v = strength(cd, hm.mode); if (v > topOut[su]) topOut[su] = v; });
      var bias = function (p, card) {
        var su = suitOf(card);
        if (strength(card, hm.mode) > st.capS[p][su]) return 0.25;
        if (st.calls[p] === su) {
          var v = strength(card, hm.mode);
          if (v === topOut[su]) return 6;
          if (v >= topOut[su] - 2) return 2;
        }
        if (p !== hk || hk === seat) return 1;
        if (hm.mode === 'suit') return suitOf(card) === hm.trump ? 1.7 : 1;
        return strength(card, hm.mode) >= 10 ? 1.4 : 1;
      };
      for (var oi = 0; oi < order.length; oi++) {
        var idx = order[oi], e = elig[idx], tot = 0, card0 = unknown[idx];
        var w = [];
        for (i = 0; i < e.length; i++) { w.push(cap[e[i]] ? cap[e[i]] * bias(e[i], card0) : 0); tot += w[i]; }
        if (tot === 0) { ok = false; break; }
        var r = rng() * tot, pick = -1;
        for (i = 0; i < e.length; i++) { r -= w[i]; if (r < 0 && w[i] > 0) { pick = e[i]; break; } }
        if (pick < 0) for (i = e.length - 1; i >= 0; i--) if (w[i] > 0) { pick = e[i]; break; }
        hands[pick].push(unknown[idx]);
        cap[pick]--;
      }
      if (ok) return hands;
    }
    return null;
  }

  function playout(sim) {
    while (!sim.over) {
      var p = sim.turn;
      applyMove(sim, p, heuristicMove(sim, p));
    }
  }

  function evaluate(sim, team, ctx) {
    var pts = roundPoints(sim.winTeam, sim.tricks, sim.hakem, sim.hokm, ctx.settings);
    var win = sim.winTeam === team;
    var v;
    if (ctx.scores) {
      var need = win ? ctx.settings.target - ctx.scores[team] : ctx.settings.target - ctx.scores[1 - team];
      v = (win ? 1 : -1) * Math.min(pts, Math.max(1, need));
      if (need <= pts) v *= 1.5; // decides the match
    } else {
      v = win ? pts : -pts;
    }
    return v + 0.04 * (sim.tricks[team] - sim.tricks[1 - team]);
  }

  // Cards that are interchangeable (touching, nothing outstanding between) — keep one each.
  function distinctMoves(st, seat, legal) {
    var mode = st.hokm.mode;
    var mine = new Uint8Array(52);
    var hand = st.hands[seat];
    for (var i = 0; i < hand.length; i++) mine[hand[i]] = 1;
    var bySuit = [[], [], [], []];
    legal.forEach(function (c) { bySuit[suitOf(c)].push(c); });
    var res = [];
    for (var s = 0; s < 4; s++) {
      var arr = bySuit[s];
      if (!arr.length) continue;
      arr.sort(function (a, b) { return strength(a, mode) - strength(b, mode); });
      var outInSuit = [];
      for (var r = 0; r < 13; r++) {
        var c = s * 13 + r;
        if (!st.played[c] && !mine[c]) outInSuit.push(strength(c, mode));
      }
      res.push(arr[0]);
      for (var j = 1; j < arr.length; j++) {
        var lo = strength(arr[j - 1], mode), hi = strength(arr[j], mode);
        var gap = outInSuit.some(function (v) { return v > lo && v < hi; });
        if (gap) res.push(arr[j]);
      }
    }
    return res;
  }

  function pimcMove(st, seat, ctx) {
    var led = st.trick.length ? suitOf(st.trick[0]) : -1;
    var legal = legalMoves(st.hands[seat], led);
    if (legal.length === 1) return legal[0];
    var moves = distinctMoves(st, seat, legal);
    if (moves.length === 1) return moves[0];
    var rng = ctx.rng;
    var totals = new Float64Array(moves.length);
    var team = teamOf(seat);
    var budget = ctx.thinkMs, start = now(), n = 0;
    var minS = ctx.minSamples || 24, maxS = ctx.maxSamples || 400;
    while (n < maxS && (n < minS || now() - start < budget)) {
      var hands = sampleHands(st, seat, rng);
      if (!hands) break;
      for (var m = 0; m < moves.length; m++) {
        var sim = cloneState(st);
        sim.hands = hands.map(function (h) { return h.slice(); });
        applyMove(sim, seat, moves[m]);
        playout(sim);
        totals[m] += evaluate(sim, team, ctx);
      }
      n++;
    }
    var best = 0;
    for (var i = 1; i < moves.length; i++) if (totals[i] > totals[best] + 1e-9) best = i;
    // Prefer the heuristic's card when it is as good as the best (keeps play natural).
    var h = heuristicMove(st, seat);
    var hi = moves.indexOf(h);
    if (hi >= 0 && n > 0 && (totals[best] - totals[hi]) / n <= (ctx.margin === undefined ? 0.1 : ctx.margin)) return h;
    return moves[best];
  }

  /* ----------------------------------------------------------- hokm choice */

  function hokmOptions(settings) {
    var opts = [];
    for (var s = 0; s < 4; s++) opts.push({ mode: 'suit', trump: s });
    NT_MODES.forEach(function (m) { if (settings[m]) opts.push({ mode: m, trump: -1 }); });
    return opts;
  }

  function sameHokm(a, b) { return a && b && a.mode === b.mode && a.trump === b.trump; }

  function chooseHokmSimple(five, rng) {
    var cnt = [0, 0, 0, 0], hi = [0, 0, 0, 0];
    five.forEach(function (c) { var s = suitOf(c); cnt[s]++; hi[s] += rankOf(c); });
    var best = 0;
    for (var s = 1; s < 4; s++) {
      if (cnt[s] > cnt[best] || (cnt[s] === cnt[best] && (hi[s] > hi[best] || (hi[s] === hi[best] && rng() < 0.5)))) best = s;
    }
    return { mode: 'suit', trump: best };
  }

  // Monte-Carlo: try every allowed hokm on many random completions of the deal.
  function chooseHokmMC(five, hakem, settings, rng, samples, budgetMs, scores) {
    var opts = hokmOptions(settings);
    var totals = new Float64Array(opts.length);
    var known = new Uint8Array(52);
    five.forEach(function (c) { known[c] = 1; });
    var rest = [];
    for (var c = 0; c < 52; c++) if (!known[c]) rest.push(c);
    var team = teamOf(hakem);
    var ctx = { settings: settings, scores: scores };
    var start = now(), n = 0;
    while (n < samples && (n < 8 || now() - start < budgetMs)) {
      shuffle(rest, rng);
      var hands = [[], [], [], []];
      hands[hakem] = five.slice();
      var k = 0;
      for (var i = 0; i < 4; i++) {
        var p = (hakem + i) & 3;
        while (hands[p].length < 13) hands[p].push(rest[k++]);
      }
      for (var o = 0; o < opts.length; o++) {
        var sim = newRoundState(hands, opts[o], hakem);
        playout(sim);
        totals[o] += evaluate(sim, team, ctx);
      }
      n++;
    }
    var best = 0;
    for (var j = 1; j < opts.length; j++) if (totals[j] > totals[best]) best = j;
    return opts[best];
  }

  function chooseHokm(five, hakem, settings, rng, scores) {
    var d = settings.difficulty;
    if (d === 'easy') return chooseHokmSimple(five, rng);
    if (d === 'medium') return chooseHokmMC(five, hakem, settings, rng, 40, 150, scores);
    return chooseHokmMC(five, hakem, settings, rng, 120, Math.max(350, settings.thinkMs * 2), scores);
  }

  function chooseCard(st, seat, settings, rng, scores) {
    var d = settings.difficulty;
    var led = st.trick.length ? suitOf(st.trick[0]) : -1;
    var legal = legalMoves(st.hands[seat], led);
    if (legal.length === 1) return legal[0];
    if (d === 'easy') {
      if (rng() < 0.35) return legal[(rng() * legal.length) | 0];
      return heuristicMove(st, seat);
    }
    if (d === 'medium') return heuristicMove(st, seat);
    return pimcMove(st, seat, { settings: settings, rng: rng, thinkMs: settings.thinkMs, scores: scores });
  }

  /* --------------------------------------------------------- game controller */

  function HokmGame(settings, seed) {
    this.settings = Object.assign({}, DEFAULTS, settings || {});
    this.seed = (seed === undefined ? (Date.now() ^ ((Math.random() * 1e9) | 0)) : seed) >>> 0;
    this.rng = makeRng(this.seed);
    this.scores = [0, 0];
    this.hakem = -1;
    this.phase = 'idle';      // idle | chooseHokm | play | roundOver | matchOver
    this.roundNo = 0;
    this.hands = null;
    this.five = null;
    this.st = null;
    this.history = [];        // finished rounds
    this.tricks = [];         // finished tricks of the current round
  }

  HokmGame.prototype.startRound = function () {
    var ev = { hakemDraw: null };
    if (this.hakem < 0) {
      var deck = shuffle(fullDeck(), this.rng);
      var seat = (this.rng() * 4) | 0, seq = [];
      for (var i = 0; i < deck.length; i++) {
        seq.push({ seat: seat, card: deck[i] });
        if (rankOf(deck[i]) === 12) { this.hakem = seat; break; }
        seat = (seat + 1) & 3;
      }
      ev.hakemDraw = seq;
    }
    var d = shuffle(fullDeck(), this.rng);
    var hands = [[], [], [], []], k = 0, rounds = [5, 4, 4];
    for (var r = 0; r < 3; r++) {
      for (var p = 0; p < 4; p++) {
        var seat2 = (this.hakem + p) & 3;
        for (var j = 0; j < rounds[r]; j++) hands[seat2].push(d[k++]);
      }
    }
    this.hands = hands;
    this.five = hands[this.hakem].slice(0, 5);
    this.st = null;
    this.tricks = [];
    this.phase = 'chooseHokm';
    this.roundNo++;
    return ev;
  };

  HokmGame.prototype.options = function () { return hokmOptions(this.settings); };

  // خال وسط: the third card dealt to the hakem's partner decides the hokm.
  HokmGame.prototype.middleCard = function () { return this.hands[partnerOf(this.hakem)][2]; };

  HokmGame.prototype.aiHokm = function () {
    return chooseHokm(this.five, this.hakem, this.settings, this.rng, this.scores);
  };

  HokmGame.prototype.setHokm = function (h) {
    if (this.phase !== 'chooseHokm') throw new Error('not choosing hokm');
    var ok = this.options().some(function (o) { return sameHokm(o, h); });
    if (!ok) throw new Error('hokm not allowed');
    this.st = newRoundState(this.hands, { mode: h.mode, trump: h.mode === 'suit' ? h.trump : -1 }, this.hakem);
    this.phase = 'play';
  };

  HokmGame.prototype.turn = function () { return this.st ? this.st.turn : -1; };

  HokmGame.prototype.legal = function (seat) {
    var st = this.st;
    var led = st.trick.length ? suitOf(st.trick[0]) : -1;
    return legalMoves(st.hands[seat], led);
  };

  HokmGame.prototype.aiCard = function (seat) {
    return chooseCard(this.st, seat, this.settings, this.rng, this.scores);
  };

  HokmGame.prototype.play = function (seat, card) {
    var st = this.st;
    if (this.phase !== 'play') throw new Error('not in play');
    if (st.turn !== seat) throw new Error('not your turn');
    if (this.legal(seat).indexOf(card) < 0) throw new Error('illegal card');
    var w = applyMove(st, seat, card);
    var res = { winner: w, trickDone: w >= 0, roundOver: null, matchOver: false };
    if (w >= 0) this.tricks.push(st.lastTrick);
    if (st.over) {
      var pts = roundPoints(st.winTeam, st.tricks, st.hakem, st.hokm, this.settings);
      var kot = pts > 1;
      this.scores[st.winTeam] += pts;
      var info = {
        winTeam: st.winTeam, tricks: st.tricks.slice(), points: pts, kot: kot,
        hakemKot: pts === 3, hakem: st.hakem, hokm: st.hokm
      };
      if (st.winTeam !== teamOf(this.hakem)) this.hakem = (this.hakem + 1) & 3;
      info.nextHakem = this.hakem;
      this.history.push(info);
      res.roundOver = info;
      if (this.scores[st.winTeam] >= this.settings.target) {
        this.phase = 'matchOver';
        res.matchOver = true;
      } else {
        this.phase = 'roundOver';
      }
    }
    return res;
  };

  HokmGame.prototype.toJSON = function () {
    var st = this.st;
    return {
      v: 1,
      settings: this.settings,
      seed: this.seed,
      scores: this.scores,
      hakem: this.hakem,
      phase: this.phase,
      roundNo: this.roundNo,
      hands: this.hands,
      five: this.five,
      history: this.history,
      tricks: this.tricks,
      st: st ? {
        hands: st.hands, hokm: st.hokm, hakem: st.hakem, leader: st.leader, turn: st.turn,
        trick: st.trick, trickSeats: st.trickSeats, tricks: st.tricks,
        played: Array.prototype.slice.call(st.played),
        voids: st.voids.map(function (v) { return Array.prototype.slice.call(v); }),
        calls: st.calls, leads: st.leads, capH: st.capH, capS: st.capS,
        over: st.over, winTeam: st.winTeam, tricksPlayed: st.tricksPlayed
      } : null
    };
  };

  HokmGame.fromJSON = function (o) {
    var g = new HokmGame(o.settings, o.seed);
    g.rng = makeRng((o.seed ^ (o.roundNo * 7919) ^ Date.now()) >>> 0);
    g.scores = o.scores; g.hakem = o.hakem; g.phase = o.phase; g.roundNo = o.roundNo;
    g.hands = o.hands; g.five = o.five; g.history = o.history || []; g.tricks = o.tricks || [];
    if (o.st) {
      var s = o.st;
      g.st = {
        hands: s.hands, hokm: s.hokm, hakem: s.hakem, leader: s.leader, turn: s.turn,
        trick: s.trick, trickSeats: s.trickSeats, tricks: s.tricks,
        played: Uint8Array.from(s.played),
        voids: s.voids.map(function (v) { return Uint8Array.from(v); }),
        calls: s.calls || [-1, -1, -1, -1], leads: s.leads || [-1, -1, -1, -1],
        capH: s.capH || [[99, 99, 99, 99], [99, 99, 99, 99], [99, 99, 99, 99], [99, 99, 99, 99]], capS: s.capS || [[99, 99, 99, 99], [99, 99, 99, 99], [99, 99, 99, 99], [99, 99, 99, 99]],
        over: s.over, winTeam: s.winTeam, tricksPlayed: s.tricksPlayed, lastTrick: null
      };
    }
    return g;
  };

  return {
    SUIT_SYM: SUIT_SYM, SUIT_FA: SUIT_FA, RANK_LABEL: RANK_LABEL, MODE_FA: MODE_FA, DEFAULTS: DEFAULTS,
    suitOf: suitOf, rankOf: rankOf, teamOf: teamOf, partnerOf: partnerOf, strength: strength,
    cardLabel: cardLabel, hokmLabel: hokmLabel, makeRng: makeRng, shuffle: shuffle, fullDeck: fullDeck,
    beats: beats, trickWinnerIndex: trickWinnerIndex, legalMoves: legalMoves, roundPoints: roundPoints,
    newRoundState: newRoundState, cloneState: cloneState, applyMove: applyMove,
    heuristicMove: heuristicMove, pimcMove: pimcMove, sampleHands: sampleHands, playout: playout,
    hokmOptions: hokmOptions, sameHokm: sameHokm, chooseHokm: chooseHokm, chooseHokmMC: chooseHokmMC,
    chooseHokmSimple: chooseHokmSimple, chooseCard: chooseCard, distinctMoves: distinctMoves,
    HokmGame: HokmGame, CONV: CONV
  };
});
