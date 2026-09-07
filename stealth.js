'use strict';

/**
 * Hand-rolled fingerprint evasions, handed to context.addInitScript() in
 * open-browser.js so every page/frame gets them before its own scripts run.
 *
 * Playwright grabs this function with Function.prototype.toString() and runs
 * the source *inside the browser page*, not in Node. That means the body
 * below must be entirely self-contained: no Node globals (require, process,
 * __dirname, ...), no closures over anything outside the function itself,
 * just plain JS talking to standard browser APIs. Only the module.exports
 * line at the very bottom runs in Node, and it's outside the function, so
 * none of this applies to it.
 *
 * Ports the handful of highest-value checks from puppeteer-extra-plugin-stealth
 * (github.com/berstend/puppeteer-extra/tree/master/packages/puppeteer-extra-plugin-stealth)
 * by hand instead of taking on the dependency. Recurring pattern below: patch
 * the *prototype* method/getter, never the instance, and always fall back to
 * the original for cases we don't specifically care about — that keeps the
 * property looking like a real, un-tampered browser (right own-vs-inherited
 * shape, descriptor flags, etc.), not just returning the right value.
 */
function applyStealth() {
  // 1. navigator.webdriver — spec'd to be `false` on a real, non-automated
  // browser; automated Chrome reports `true`. Patch to `undefined` rather
  // than `false`: some detection scripts specifically flag a
  // `typeof navigator.webdriver === 'boolean'` patched-looking value.
  Object.defineProperty(Navigator.prototype, 'webdriver', {
    get: () => undefined,
    enumerable: true,
    configurable: true,
  });

  // 2. window.chrome — a real, extension-capable Chrome window always has a
  // populated `window.chrome` namespace; headless/CDP-only Chrome can come up
  // with it missing or empty, which is itself a cheap, common check. Stub the
  // handful of members detection scripts actually poke at.
  window.chrome = window.chrome || {};
  window.chrome.runtime = window.chrome.runtime || {};
  window.chrome.app = window.chrome.app || {
    isInstalled: false,
    InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
    RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
  };
  window.chrome.csi = window.chrome.csi || function csi() {
    return { onloadT: Date.now(), pageT: Date.now(), startE: Date.now(), tran: 15 };
  };
  window.chrome.loadTimes = window.chrome.loadTimes || function loadTimes() {
    const now = Date.now() / 1000;
    return {
      commitLoadTime: now,
      connectionInfo: 'h2',
      finishDocumentLoadTime: now,
      finishLoadTime: now,
      firstPaintAfterLoadTime: 0,
      firstPaintTime: now,
      navigationType: 'Other',
      npnNegotiatedProtocol: 'h2',
      requestTime: now,
      startLoadTime: now,
      wasAlternateProtocolAvailable: false,
      wasFetchedViaSpdy: true,
      wasNpnNegotiated: true,
    };
  };

  // 3. navigator.plugins / navigator.mimeTypes — real desktop Chrome always
  // registers its built-in PDF viewer here; an empty PluginArray is one of
  // the single most-checked headless tells because it's a one-line check.
  const fakePlugins = [
    { name: 'PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
    { name: 'Chrome PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
    { name: 'Chromium PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
    { name: 'Microsoft Edge PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
    { name: 'WebKit built-in PDF', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
  ];
  Object.defineProperty(Navigator.prototype, 'plugins', {
    get: () => fakePlugins,
    enumerable: true,
    configurable: true,
  });
  Object.defineProperty(Navigator.prototype, 'mimeTypes', {
    get: () => [
      { type: 'application/pdf', suffixes: 'pdf', description: 'Portable Document Format' },
      { type: 'text/pdf', suffixes: 'pdf', description: 'Portable Document Format' },
    ],
    enumerable: true,
    configurable: true,
  });

  // 4. navigator.permissions.query('notifications') — headless Chrome has a
  // long-standing quirk where this always resolves to `denied` even when
  // Notification.permission is `default`/`granted`; real Chrome keeps the
  // two in sync. Reconcile just that one case, delegate everything else.
  if (window.Permissions && window.Permissions.prototype.query && window.Notification) {
    const originalQuery = window.Permissions.prototype.query;
    window.Permissions.prototype.query = function query(parameters) {
      if (parameters && parameters.name === 'notifications') {
        return Promise.resolve({ state: Notification.permission, onchange: null });
      }
      return originalQuery.call(this, parameters);
    };
  }

  // 5. WebGL vendor/renderer — headless/VM/software-rendered Chrome reports
  // back SwiftShader/"Google Inc." through the UNMASKED_* debug params (from
  // the WEBGL_debug_renderer_info extension), one of the most heavily
  // checked fingerprint signals. Report a common, real GPU string instead,
  // for both WebGL and WebGL2.
  const UNMASKED_VENDOR_WEBGL = 0x9245; // 37445
  const UNMASKED_RENDERER_WEBGL = 0x9246; // 37446
  const GPU_VENDOR = 'Google Inc. (Intel)';
  const GPU_RENDERER = 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x9A49) Direct3D11 vs_5_0 ps_5_0, D3D11)';
  [window.WebGLRenderingContext, window.WebGL2RenderingContext].forEach((ctor) => {
    if (!ctor) return;
    const originalGetParameter = ctor.prototype.getParameter;
    ctor.prototype.getParameter = function getParameter(parameter) {
      if (parameter === UNMASKED_VENDOR_WEBGL) return GPU_VENDOR;
      if (parameter === UNMASKED_RENDERER_WEBGL) return GPU_RENDERER;
      return originalGetParameter.call(this, parameter);
    };
  });

  // 6. iframe.contentWindow.navigator.webdriver — belt-and-suspenders for (1).
  // Playwright's addInitScript already re-runs this whole function in every
  // child frame it sees attached or navigated, but some detectors read a
  // freshly created, same-origin iframe's contentWindow synchronously,
  // before that has necessarily happened. Patch the getter itself so it
  // re-applies (1)'s fix to whatever window comes back.
  try {
    const contentWindowDescriptor = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow');
    Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
      ...contentWindowDescriptor,
      get() {
        const win = contentWindowDescriptor.get.call(this);
        try {
          if (win && win.navigator) {
            Object.defineProperty(win.navigator, 'webdriver', { get: () => undefined, enumerable: true, configurable: true });
          }
        } catch {
          // cross-origin contentWindow, or a non-configurable property already
          // there — nothing safe we can do, so leave it alone
        }
        return win;
      },
    });
  } catch {
    // best effort only; skip silently if this engine won't allow redefining it
  }
}

module.exports = applyStealth;
