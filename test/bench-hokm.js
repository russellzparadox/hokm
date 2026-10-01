// Compare hokm choosers: same deals, heuristic play everywhere, hakem team's result.
// Usage: node test/bench-hokm.js <deals>
const H = require('../src/hokm-core.js');
const N = +(process.argv[2] || 200);
const settings = Object.assign({}, H.DEFAULTS);
const rng = H.makeRng(99);

function run(hands, hakem, hokm) {
  const st = H.newRoundState(hands, hokm, hakem);
  H.playout(st);
  const pts = H.roundPoints(st.winTeam, st.tricks, st.hakem, st.hokm, settings);
  return st.winTeam === H.teamOf(hakem) ? pts : -pts;
}
const res = { simple: 0, mc16: 0, mc120: 0 }, wins = { simple: 0, mc16: 0, mc120: 0 };
const modeCount = {};
let t16 = 0, t120 = 0;
for (let d = 0; d < N; d++) {
  const deck = H.shuffle(H.fullDeck(), rng);
  const hakem = d & 3;
  const hands = [[], [], [], []];
  let k = 0;
  for (const n of [5, 4, 4]) for (let i = 0; i < 4; i++) { const p = (hakem + i) & 3; for (let j = 0; j < n; j++) hands[p].push(deck[k++]); }
  const five = hands[hakem].slice(0, 5);
  const a = H.chooseHokmSimple(five, rng);
  let t0 = Date.now();
  const b = H.chooseHokmMC(five, hakem, settings, rng, 16, 120);
  t16 += Date.now() - t0; t0 = Date.now();
  const c = H.chooseHokmMC(five, hakem, settings, rng, 120, 600);
  t120 += Date.now() - t0;
  modeCount[c.mode] = (modeCount[c.mode] || 0) + 1;
  for (const [name, h] of [['simple', a], ['mc16', b], ['mc120', c]]) {
    // average over several playouts of the same deal to reduce noise
    let v = 0;
    v += run(hands, hakem, h);
    res[name] += v; if (v > 0) wins[name]++;
  }
}
for (const k of Object.keys(res)) console.log(`${k}: hakem team avg ${(res[k] / N).toFixed(3)} pts/round, wins ${(100 * wins[k] / N).toFixed(1)}%`);
console.log('mc120 picks:', modeCount, `time mc16 ${(t16 / N).toFixed(0)}ms mc120 ${(t120 / N).toFixed(0)}ms`);
