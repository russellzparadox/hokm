# End-to-end LAN test: a host page and 1..2 guest pages talk through the Node relay and play full rounds.
import asyncio, os, subprocess, sys, time
os.environ.setdefault('PLAYWRIGHT_BROWSERS_PATH', '/opt/pw-browsers')
from playwright.async_api import async_playwright

URL = 'file:///home/claude/hokm/android/app/src/main/assets/index.html'
PORT = 8791
GUESTS = int(sys.argv[1]) if len(sys.argv) > 1 else 1
ROUNDS = int(sys.argv[2]) if len(sys.argv) > 2 else 3
OUT = '/tmp/claude-0/th'

STATE = """() => ({
  hokm: !document.getElementById('hokmOverlay').hidden,
  result: !document.getElementById('resultOverlay').hidden,
  legal: document.querySelectorAll('#hand .card.legal').length,
  game: !document.getElementById('game').hidden,
  home: !document.getElementById('home').hidden,
  tr: document.getElementById('trUs').textContent + '/' + document.getElementById('trThem').textContent,
  pt: document.getElementById('ptUs').textContent + '/' + document.getElementById('ptThem').textContent,
  msg: document.getElementById('boardMsg').textContent,
})"""

async def main():
    relay = subprocess.Popen(['node', '/home/claude/hokm/test/relay.js', str(PORT)])
    time.sleep(0.7)
    errors = []
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pages = []
        for i in range(GUESTS + 1):
            ctx = await b.new_context(viewport={'width': 390, 'height': 780})
            pg = await ctx.new_page()
            pg.on('pageerror', lambda e, i=i: errors.append(f'p{i}: {e}'))
            pg.on('console', lambda m, i=i: errors.append(f'p{i}: {m.text}') if m.type == 'error' else None)
            if i == 0:
                await pg.add_init_script(f"window.__relayBase='http://127.0.0.1:{PORT}';window.__relayIps=['127.0.0.1:{PORT}'];")
            await pg.goto(URL)
            await pg.evaluate("n=>localStorage.setItem('hokm.settings.v1',JSON.stringify({speed:'fast',net1:n>=2?'human':'ai',net2:'human',net3:'ai'}))", GUESTS)
            await pg.reload()
            pages.append(pg)
        host = pages[0]
        await host.click('#btnNet'); await host.fill('#netName', 'میزبان'); await host.click('#btnHostMode'); await host.click('#btnCreate')
        await host.wait_for_selector('#netRoom:not([hidden])')
        code = await host.inner_text('#roomCode')
        for i, g in enumerate(pages[1:]):
            await g.click('#btnNet'); await g.fill('#netName', f'مهمان{i+1}'); await g.click('#btnJoinMode')
            await g.fill('#joinIp', f'127.0.0.1:{PORT}'); await g.fill('#joinCode', code); await g.click('#btnJoin')
            await g.wait_for_function("()=>document.getElementById('waitText').textContent.includes('وصل شدید')", timeout=8000)
        await host.wait_for_function("()=>!document.getElementById('btnStartNet').disabled", timeout=8000)
        await pages[1].screenshot(path=f'{OUT}/net-lobby-guest.png')
        await host.screenshot(path=f'{OUT}/net-lobby-host.png')
        await host.click('#btnStartNet')
        results = 0
        t0 = time.time()
        shot = False
        while results < ROUNDS and time.time() - t0 < 240:
            await asyncio.sleep(0.25)
            for i, pg in enumerate(pages):
                st = await pg.evaluate(STATE)
                if st['hokm']:
                    await pg.click('#suitGrid button'); await pg.click('#hokmConfirm')
                elif st['legal']:
                    await pg.evaluate("()=>document.querySelector('#hand .card.legal').click()")
                elif st['result']:
                    if i == 0:
                        await asyncio.sleep(0.8)
                        sts = [await q.evaluate(STATE) for q in pages]
                        print('result  host', sts[0]['tr'], sts[0]['pt'], '| guest', sts[1]['tr'], sts[1]['pt'])
                        if not shot:
                            await pages[1].screenshot(path=f'{OUT}/net-result-guest.png'); shot = True
                        results += 1
                        await pg.click('#resNext')
                elif st['tr'] != '۰/۰' and not shot and st['legal'] == 0 and i == 1:
                    pass
        await pages[1].screenshot(path=f'{OUT}/net-table-guest.png')
        print('rounds finished:', results, 'errors:', errors)
        await b.close()
    relay.terminate()
    sys.exit(1 if errors or results < ROUNDS else 0)
asyncio.run(main())
