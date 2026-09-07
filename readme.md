```
python -m venv .venv
.venv\Scripts\activate
npm init playwright@latest (npx playwright install)
npx playwright test
```

## Throwaway browser

`npm run open` (or `node open-browser.js`) pops open a visible Chrome window
with a brand-new profile and a few automation tells switched off. Close the
window (or Ctrl+C the script) and the profile is deleted immediately —
cookies, history, cache, everything.