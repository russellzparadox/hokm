// Rule tests + random-game invariants + AI strength checks.
// Run: node test/test-core.js
const assert = require('assert');
const H = require('../src/hokm-core.js');
const { strength, beats, trickWinnerIndex, legalMoves, roundPoints } = H;

const C = (label) => { // e.g. "A♠", "10♥"
  const sym = label.slice(-1), r = label.slice(0, -1);
  return H.SUIT_SYM.indexOf(sym) * 13 + H.RANK_LABEL.indexOf(r);
};
let pass = 0;
function t(name, fn) { fn(); pass++; }

/* ---------- ranking per mode ---------- */
t('saras ranking A > K > … > 2', () => {
  const order = ['A♠', 'K♠', 'Q♠', 'J♠', '10♠', '9♠', '8♠', '7♠', '6♠', '5♠', '4♠', '3♠', '2♠'].map(C);
  for (let i = 1; i < order.length; i++) assert(strength(order[i - 1], 'saras') > strength(order[i], 'saras'));
});
t('naras ranking 2 > 3 > … > K > A', () => {
  const order = ['2♥', '3♥', '4♥', '5♥', '6♥', '7♥', '8♥', '9♥', '10♥', 'J♥', 'Q♥', 'K♥', 'A♥'].map(C);
  for (let i = 1; i < order.length; i++) assert(strength(order[i - 1], 'naras') > strength(order[i], 'naras'));
});
t('taknaras ranking A > 2 > 3 > … > K', () => {
  const order = ['A♦', '2♦', '3♦', '4♦', '5♦', '6♦', '7♦', '8♦', '9♦', '10♦', 'J♦', 'Q♦', 'K♦'].map(C);
  for (let i = 1; i < order.length; i++) assert(strength(order[i - 1], 'taknaras') > strength(order[i], 'taknaras'));
});

/* ---------- trick winners ---------- */
const hearts = { mode: 'suit', trump: 1 };
t('highest of led suit wins without trump', () => {
  assert.strictEqual(trickWinnerIndex(['10♠', 'K♠', '3♠', 'A♣'].map(C), hearts), 1);
});
t('any trump beats led suit', () => {
  assert.strictEqual(trickWinnerIndex(['A♠', 'K♠', '2♥', 'Q♠'].map(C), hearts), 2);
});
t('higher trump wins over-ruff', () => {
  assert.strictEqual(trickWinnerIndex(['A♠', '3♥', '9♥', 'K♠'].map(C), hearts), 2);
});
t('off-suit discard never wins', () => {
  assert.strictEqual(trickWinnerIndex(['2♠', 'A♦', 'A♣', '3♠'].map(C), hearts), 3);
});
t('saras: no ruffing, ace wins', () => {
  const h = { mode: 'saras', trump: -1 };
  assert.strictEqual(trickWinnerIndex(['5♣', 'A♥', 'A♣', 'K♣'].map(C), h), 2);
});
t('naras: lowest wins, other-suit 2 does not', () => {
  const h = { mode: 'naras', trump: -1 };
  assert.strictEqual(trickWinnerIndex(['8♠', '2♥', '3♠', 'A♠'].map(C), h), 2);
});
t('taknaras: ace beats 2', () => {
  const h = { mode: 'taknaras', trump: -1 };
  assert.strictEqual(trickWinnerIndex(['5♦', '2♦', 'A♦', 'K♦'].map(C), h), 2);
  assert.strictEqual(trickWinnerIndex(['5♦', '2♦', 'K♦', '3♦'].map(C), h), 1);
});

/* ---------- legal moves ---------- */
t('must follow suit', () => {
  const hand = ['A♥', '3♠', 'K♠', '2♣'].map(C);
  assert.deepStrictEqual(legalMoves(hand, 0).sort(), ['3♠', 'K♠'].map(C).sort());
});
t('void: any card', () => {
  const hand = ['A♥', '2♣'].map(C);
  assert.strictEqual(legalMoves(hand, 0).length, 2);
});

/* ---------- scoring ---------- */
const S = { kotNT: false };
t('normal win = 1', () => assert.strictEqual(roundPoints(0, [7, 3], 0, hearts, S), 1));
t('kot = 2 (hakem team kots)', () => assert.strictEqual(roundPoints(0, [7, 0], 0, hearts, S), 2));
t('hakem kot = 3', () => assert.strictEqual(roundPoints(1, [0, 7], 2, hearts, S), 3));
t('no kot in NT by default', () => assert.strictEqual(roundPoints(0, [7, 0], 0, { mode: 'naras', trump: -1 }, S), 1));
t('kot in NT when enabled', () => assert.strictEqual(roundPoints(1, [0, 7], 0, { mode: 'naras', trump: -1 }, { kotNT: true }), 3));

/* ---------- controller: random full matches ---------- */
t('random matches keep every invariant', () => {
  const rng = H.makeRng(12345);
  for (let m = 0; m < 300; m++) {
    const g = new H.HokmGame({ difficulty: 'easy' }, 1000 + m);
    let guard = 0;
    while (g.phase !== 'matchOver' && guard++ < 200) {
      const ev = g.startRound();
      if (g.roundNo === 1) {
        assert(ev.hakemDraw && H.rankOf(ev.hakemDraw[ev.hakemDraw.length - 1].card) === 12, 'hakem by first ace');
        assert.strictEqual(ev.hakemDraw[ev.hakemDraw.length - 1].seat, g.hakem);
      }
      const all = [].concat(...g.hands);
      assert.strictEqual(new Set(all).size, 52);
      g.hands.forEach((h) => assert.strictEqual(h.length, 13));
      const opts = g.options();
      const h = opts[(rng() * opts.length) | 0];
      g.setHokm(h);
      const hakem = g.hakem;
      assert.strictEqual(g.turn(), hakem, 'hakem leads first');
      let res, plays = 0;
      do {
        const p = g.turn();
        const legal = g.legal(p);
        const card = legal[(rng() * legal.length) | 0];
        res = g.play(p, card);
        plays++;
      } while (!res.roundOver);
      const r = res.roundOver;
      assert.strictEqual(r.tricks[r.winTeam], 7);
      assert(r.tricks[1 - r.winTeam] < 7);
      assert.strictEqual(plays, (r.tricks[0] + r.tricks[1]) * 4);
      if (r.winTeam !== H.teamOf(hakem)) assert.strictEqual(g.hakem, (hakem + 1) & 3, 'hakem passes on');
      else assert.strictEqual(g.hakem, hakem, 'hakem stays');
    }
    assert(Math.max(...g.scores) >= 7);
  }
});

t('illegal play is rejected', () => {
  const g = new H.HokmGame({}, 7);
  g.startRound();
  g.setHokm({ mode: 'suit', trump: 0 });
  const p = g.turn();
  const other = (p + 1) & 3;
  assert.throws(() => g.play(other, g.st.hands[other][0]));
  const lead = g.st.hands[p][0];
  g.play(p, lead);
  const q = g.turn();
  const hand = g.st.hands[q];
  const ledSuit = H.suitOf(lead);
  const bad = hand.find((c) => H.suitOf(c) !== ledSuit);
  if (hand.some((c) => H.suitOf(c) === ledSuit) && bad !== undefined) assert.throws(() => g.play(q, bad));
});

t('disabled NT modes are refused', () => {
  const g = new H.HokmGame({ naras: false }, 9);
  g.startRound();
  assert.throws(() => g.setHokm({ mode: 'naras', trump: -1 }));
  assert.strictEqual(g.options().length, 6);
});

t('save / load round-trip mid-round', () => {
  const g = new H.HokmGame({ difficulty: 'medium' }, 77);
  g.startRound();
  g.setHokm(g.aiHokm());
  for (let i = 0; i < 9; i++) g.play(g.turn(), g.aiCard(g.turn()));
  const g2 = H.HokmGame.fromJSON(JSON.parse(JSON.stringify(g)));
  assert.deepStrictEqual(g2.st.hands, g.st.hands);
  assert.deepStrictEqual(g2.st.trick, g.st.trick);
  assert.strictEqual(g2.turn(), g.turn());
  let res;
  do { res = g2.play(g2.turn(), g2.aiCard(g2.turn())); } while (!res.roundOver);
});

t('sampled hands respect voids and counts', () => {
  const g = new H.HokmGame({}, 31);
  g.startRound(); g.setHokm({ mode: 'suit', trump: 2 });
  for (let i = 0; i < 22; i++) g.play(g.turn(), g.aiCard(g.turn()));
  const st = g.st, seat = st.turn, rng = H.makeRng(5);
  for (let k = 0; k < 200; k++) {
    const hs = H.sampleHands(st, seat, rng);
    for (let p = 0; p < 4; p++) {
      assert.strictEqual(hs[p].length, st.hands[p].length);
      if (p !== seat) hs[p].forEach((c) => assert(!st.voids[p][H.suitOf(c)], 'void respected'));
    }
    const all = [].concat(...hs);
    assert.strictEqual(new Set(all).size, all.length);
    all.forEach((c) => assert(!st.played[c]));
  }
});


/* ---------- conventions ---------- */
function scenario(handsLbl, hokm, opts) {
  const hands = handsLbl.map((h) => h.map(C));
  const used = new Set([].concat(...hands));
  const st = H.newRoundState(hands, hokm, opts.hakem || 0);
  Object.assign(st, { leader: opts.leader, turn: opts.turn, tricksPlayed: opts.tricksPlayed || 0 });
  (opts.played || []).map(C).forEach((c) => { st.played[c] = 1; });
  (opts.trick || []).forEach(([seat, lbl]) => { st.trick.push(C(lbl)); st.trickSeats.push(seat); st.played[C(lbl)] = 1; });
  if (opts.calls) st.calls = opts.calls;
  return st;
}
const heartsT = { mode: 'suit', trump: 1 };
t('partner leads the suit you asked for', () => {
  const st = scenario([['2♠'], ['3♠'], ['5♦', '8♦', '4♣', '9♣', '3♠'.replace('3', '4')], ['6♠']], heartsT,
    { leader: 2, turn: 2, tricksPlayed: 3, calls: [3, -1, -1, -1] });
  assert.strictEqual(H.heuristicMove(st, 2), C('5♦'));
});
t('discarding a high card sets a call, a low one does not', () => {
  const st = scenario([['K♠', '2♣'], ['A♦', 'Q♦', '5♦', '4♣', '9♣'], ['3♠'], ['4♠']], heartsT,
    { leader: 0, turn: 0, tricksPlayed: 2 });
  H.applyMove(st, 0, C('K♠'));
  const c = H.heuristicMove(st, 1);
  assert.strictEqual(c, C('Q♦'), 'asks for diamonds by throwing the queen');
  H.applyMove(st, 1, c);
  assert.strictEqual(st.calls[1], 3);
  const st2 = scenario([['K♠'], ['5♦', '4♣'], ['3♠'], ['4♠']], heartsT, { leader: 0, turn: 0, tricksPlayed: 2 });
  H.applyMove(st2, 0, C('K♠')); H.applyMove(st2, 1, C('4♣'));
  assert.strictEqual(st2.calls[1], -1);
});
t('third hand plays its highest winning card', () => {
  const st = scenario([['2♦'], ['3♦'], ['K♣', 'Q♣', '10♣', '2♠'], ['4♦']], heartsT,
    { leader: 0, turn: 2, tricksPlayed: 4, trick: [[0, '5♣'], [1, '9♣']] });
  assert.strictEqual(H.heuristicMove(st, 2), C('K♣'));
});
t('second hand keeps the ace hidden on the first trick', () => {
  const st = scenario([['2♦'], ['A♣', '4♣', '9♦'], ['3♦'], ['4♦']], heartsT,
    { leader: 0, turn: 1, tricksPlayed: 0, trick: [[0, '7♣']] });
  assert.strictEqual(H.heuristicMove(st, 1), C('4♣'));
});
t('leader does not cash a side ace on the first trick', () => {
  const st = scenario([['A♣', '5♣', '9♣', '3♦', '8♦'], ['2♠'], ['3♠'], ['4♠']], heartsT, { leader: 0, turn: 0, tricksPlayed: 0 });
  assert.notStrictEqual(H.heuristicMove(st, 0), C('A♣'));
});

console.log(`rules: ${pass} tests passed`);
