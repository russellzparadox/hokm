# UI smoke test: plays through rounds as the human with a headless browser.
import asyncio, json, os, sys
os.environ.setdefault('PLAYWRIGHT_BROWSERS_PATH', '/opt/pw-browsers')
from playwright.async_api import async_playwright

URL = 'file:///home/claude/hokm/android/app/src/main/assets/index.html'
OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/shots'
W, Hh = (int(sys.argv[2]), int(sys.argv[3])) if len(sys.argv) > 3 else (390, 780)
os.makedirs(OUT, exist_ok=True)

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page(viewport={'width': W, 'height': Hh}, device_scale_factor=2)
        errors = []
        pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
        await pg.goto(URL)
        await pg.evaluate("""() => localStorage.setItem('hokm.settings.v1', JSON.stringify({speed:'fast', difficulty:'hard'}))""")
        await pg.reload()
        await pg.wait_for_timeout(600)
        await pg.screenshot(path=f'{OUT}/1-home.png')
        await pg.click('#btnNew')
        shots = {'hokm': False, 'table': False, 'result': False}
        rounds = 0
        for step in range(3000):
            await pg.wait_for_timeout(120)
            state = await pg.evaluate("""() => ({
              hokm: !document.getElementById('hokmOverlay').hidden,
              result: !document.getElementById('resultOverlay').hidden,
              active: document.getElementById('hand').classList.contains('active'),
              legal: document.querySelectorAll('#hand .card.legal').length,
              msg: document.getElementById('boardMsg').textContent,
              home: !document.getElementById('home').hidden,
              board: document.querySelectorAll('#boardInner .slot .card').length
            })""")
            if state['home']:
                break
            if state['hokm']:
                if not shots['hokm']:
                    await pg.click('#ntGrid button[data-mode="naras"]')
                    await pg.wait_for_timeout(250)
                    await pg.screenshot(path=f'{OUT}/2-hokm.png'); shots['hokm'] = True
                    await pg.click('#suitGrid button[data-suit="1"]')
                else:
                    await pg.click('#suitGrid button')
                await pg.click('#hokmConfirm')
                continue
            if state['result']:
                rounds += 1
                if not shots['result']:
                    await pg.wait_for_timeout(400)
                    await pg.screenshot(path=f'{OUT}/4-result.png'); shots['result'] = True
                if rounds >= 3:
                    break
                await pg.click('#resNext')
                continue
            if state['active'] and state['legal']:
                if not shots['table'] and state['board'] >= 2:
                    await pg.screenshot(path=f'{OUT}/3-table.png'); shots['table'] = True
                await pg.evaluate("() => { const c = document.querySelectorAll('#hand .card.legal'); c[c.length - 1].click(); }")
        save = await pg.evaluate("() => JSON.parse(localStorage.getItem('hokm.save.v1') || 'null')")
        print(json.dumps({'rounds': rounds, 'scores': save and save['scores'], 'phase': save and save['phase'], 'errors': errors[:5]}, ensure_ascii=False))
        await b.close()

asyncio.run(main())
