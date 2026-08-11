// Loads the addon in a real (transparent) Electron window and attaches the
// layer, exactly as the app will. Proves the addon end to end without touching
// the app's own main process.
const { app, BrowserWindow } = require('electron');
const path = require('path');
const native = require(path.join(__dirname, 'build/Release/surface_layer.node'));

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 900, height: 560, transparent: true, frame: false, hasShadow: false,
    webPreferences: { offscreen: false },
  });
  // Transparent + a page that paints nothing, so the layer behind is visible.
  win.loadURL('data:text/html,<body style="margin:0;background:transparent">'
    + '<div style="color:#fff;font:14px system-ui;padding:10px">chrome on top</div></body>');

  const handle = win.getNativeWindowHandle();
  const ok = native.start(handle, process.env.UNCLAW_SURFACE_SERVICE
    || 'com.fotonlabs.unclaw.surface');
  console.log('[smoke] start ->', ok, 'handle bytes:', handle.length);

  let n = 0;
  const t = setInterval(() => {
    const s = native.stats();
    console.log('[smoke]', JSON.stringify(s));
    if (++n >= 6) { clearInterval(t); native.stop(); app.quit(); }
  }, 1500);
});
app.on('window-all-closed', () => app.quit());
