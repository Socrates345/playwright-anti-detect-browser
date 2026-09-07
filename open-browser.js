#!/usr/bin/env node
'use strict';

/**
 * Throwaway browser: opens a real, visible Chrome window with a brand-new
 * profile and wipes that profile the moment the window closes.
 *
 * Also runs the fingerprint evasions in stealth.js (navigator.webdriver,
 * window.chrome, plugins, permissions, WebGL vendor/renderer) on every page —
 * the same handful of checks tools like puppeteer-extra-plugin-stealth cover,
 * hand-rolled here instead of taken on as a dependency.
 *
 * This is still standard hardening, not a full anti-detect-browser
 * replacement — it does not add canvas/audio noise, spoof installed fonts,
 * rotate IPs, or fake TLS/HTTP2 fingerprints. Locale/timezone/color-scheme
 * aren't touched either; pass them straight to launchPersistentContext below
 * if you need something other than this machine's real values.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');
const applyStealth = require('./stealth');

async function main() {
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-throwaway-'));
  console.log(`Fresh profile: ${profileDir}`);

  const context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    viewport: null, // follow the real OS window size instead of a fixed automation-sized viewport
    args: [
      // '--start-maximized',
      '--disable-blink-features=AutomationControlled', // hides navigator.webdriver and related signals
    ],
    ignoreDefaultArgs: ['--enable-automation'], // drops the "Chrome is being controlled..." infobar
    // Handle Ctrl+C ourselves below instead of racing Playwright's own SIGINT handler.
    handleSIGINT: false,
    handleSIGTERM: false,
  });

  // Registered before the about:blank goto below (and before any other page
  // navigates) so every document — starting with the very first one — gets
  // the fingerprint evasions from stealth.js applied before its own scripts run.
  await context.addInitScript(applyStealth);

  // Memoized promise (not a boolean guard) so every caller — the SIGINT/SIGTERM
  // handlers and the main flow's own 'close' listener — awaits the *same*
  // in-flight cleanup instead of racing past it once it has merely started.
  let cleanupPromise = null;
  const cleanup = () => {
    if (!cleanupPromise) {
      cleanupPromise = (async () => {
        try {
          await context.close();
        } catch {
          // already closed (e.g. user closed the window by hand)
        }
        fs.rmSync(profileDir, { recursive: true, force: true });
        console.log('Closed — profile wiped, nothing kept.');
      })();
    }
    return cleanupPromise;
  };

  process.once('SIGINT', async () => {
    await cleanup();
    process.exit(0);
  });
  process.once('SIGTERM', async () => {
    await cleanup();
    process.exit(0);
  });

  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto('about:blank');

  // Keep the process alive until the window is closed by hand (Ctrl+C above is handled separately).
  await new Promise((resolve) => context.once('close', resolve));
  await cleanup();
  process.exit(0);
}

main().catch(async (err) => {
  console.error(err);
  process.exit(1);
});
