// Dev/test copy of the LAN relay the Android app runs (same protocol as Relay.java).
//   POST /send?to=ID   body = text          -> appends to ID's mailbox
//   GET  /recv?id=ID&after=N                -> long-poll (<=15s): {next, msgs:[...]} for messages after N
//   GET  /ping                              -> "hokm-relay"
const http = require('http');
function start(port, host) {
  const boxes = {}; // id -> {base, msgs:[], waiters:[]}
  const box = (id) => boxes[id] || (boxes[id] = { base: 0, msgs: [], waiters: [] });
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Cache-Control': 'no-store' };
  function flush(b) {
    const w = b.waiters; b.waiters = [];
    w.forEach((f) => f());
  }
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
    if (u.pathname === '/ping') { res.writeHead(200, cors); return res.end('hokm-relay'); }
    if (u.pathname === '/send' && req.method === 'POST') {
      let body = '';
      req.on('data', (d) => { body += d; if (body.length > 1e6) req.destroy(); });
      req.on('end', () => {
        const b = box(u.searchParams.get('to') || '');
        b.msgs.push(body);
        flush(b);
        res.writeHead(200, cors); res.end('ok');
      });
      return;
    }
    if (u.pathname === '/recv') {
      const b = box(u.searchParams.get('id') || '');
      const after = parseInt(u.searchParams.get('after') || '0', 10) || 0;
      const drop = Math.max(0, Math.min(after - b.base, b.msgs.length));
      if (drop) { b.msgs.splice(0, drop); b.base += drop; }
      let done = false, t = null;
      const reply = () => {
        if (done) return; done = true; if (t) clearTimeout(t);
        const from = Math.max(0, after - b.base);
        res.writeHead(200, Object.assign({ 'Content-Type': 'application/json' }, cors));
        res.end(JSON.stringify({ next: b.base + b.msgs.length, msgs: b.msgs.slice(from) }));
      };
      if (after < b.base + b.msgs.length) return reply();
      t = setTimeout(reply, 15000);
      b.waiters.push(reply);
      req.on('close', () => { done = true; if (t) clearTimeout(t); });
      return;
    }
    res.writeHead(404, cors); res.end('no');
  });
  return new Promise((r) => srv.listen(port, host || '0.0.0.0', () => r(srv)));
}
module.exports = { start };
if (require.main === module) start(+process.argv[2] || 8765).then((s) => console.log('relay on', s.address().port));
