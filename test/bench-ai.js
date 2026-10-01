// Duplicate-format AI benchmark: each deal is played twice with the teams swapped.
// Usage: node test/bench-ai.js <A> <B> <deals> [thinkMs]
//   strategies: random | heuristic | pimc
const H = require('../src/hokm-core.js');
const [, , A = 'heuristic', B = 'random', DEALS = '200', THINK = '60'] = process.argv;
const settings = Object.assign({}, H.DEFAULTS, { thinkMs: +THINK });

function pick(strat, st, seat, rng) {
  const led = st.trick.length ? H.suitOf(st.trick[0]) : -1;
  const legal = H.legalMoves(st.hands[seat], led);
  if (strat === 'random') return legal[(rng() * legal.length) | 0];
  if (strat === 'heuristic') return H.heuristicMove(st, seat);
  return H.pimcMove(st, seat, { settings, rng, thinkMs: settings.thinkMs, minSamples: 16 });
}

function playDeal(hands, hokm, hakem, stratOfTeam, rng, timing) {
  const st = H.newRoundState(hands, hokm, hakem);
  while (!st.over) {
    const p = st.turn, s = stratOfTeam[H.teamOf(p)];
    const t0 = Date.now();
    const c = pick(s, st, p, rng);
    if (s === 'pimc') { timing.n++; timing.ms += Date.now() - t0; timing.max = Math.max(timing.max, Date.now() - t0); }
    H.applyMove(st, p, c);
  }
  return { win: st.winTeam, pts: H.roundPoints(st.winTeam, st.tricks, st.hakem, st.hokm, settings), tricks: st.tricks };
}

const rng = H.makeRng(2026);
const timing = { n: 0, ms: 0, max: 0 };
let aWins = 0, aPts = 0, bPts = 0, games = 0;
for (let d = 0; d < +DEALS; d++) {
  const deck = H.shuffle(H.fullDeck(), rng);
  const hands = [0, 1, 2, 3].map((p) => deck.slice(p * 13, p * 13 + 13));
  const hakem = d & 3;
  const hokm = (d % 5 === 4)
    ? { mode: ['saras', 'naras', 'taknaras'][d % 3], trump: -1 }
    : H.chooseHokmSimple(hands[hakem].slice(0, 5), rng);
  for (const swap of [false, true]) {
    const strat = swap ? [B, A] : [A, B];
    const r = playDeal(hands, hokm, hakem, strat, rng, timing);
    const aTeam = swap ? 1 : 0;
    games++;
    if (r.win === aTeam) { aWins++; aPts += r.pts; } else bPts += r.pts;
  }
}
console.log(`${A} vs ${B}: ${games} rounds, ${A} won ${(100 * aWins / games).toFixed(1)}%  points ${aPts}:${bPts}`);
if (timing.n) console.log(`pimc: ${timing.n} decisions, avg ${(timing.ms / timing.n).toFixed(1)} ms, max ${timing.max} ms`);
