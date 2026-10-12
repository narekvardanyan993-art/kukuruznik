import sys
from playwright.sync_api import sync_playwright
with sync_playwright() as pw:
  for mode in [(0,0),(1,0),(2,0),(3,0),(2,1)]:
    b = pw.chromium.launch(args=sys.argv[1:] + ['--autoplay-policy=no-user-gesture-required'])
    p = b.new_page(); p.goto('http://localhost:8081/_bench/')
    print(mode, p.evaluate('([r,s]) => run(r,s)', list(mode)), flush=True); b.close()
