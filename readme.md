```
python -m venv .venv
.venv\Scripts\activate
npm init playwright@latest (npx playwright install)
npx playwright test
```

## Throwaway browser

`npm run open` (or `node open-browser.js`) pops open a visible Chrome window
with a brand-new profile, a few automation tells switched off, and the common
fingerprint checks (`navigator.webdriver`, `window.chrome`, plugins, WebGL
vendor/renderer, permissions) patched via `stealth.js` — see the comment at
the top of `open-browser.js` for exactly what is and isn't covered. Close the
window (or Ctrl+C the script) and the profile is deleted immediately —
cookies, history, cache, everything.