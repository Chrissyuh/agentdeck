import path from 'node:path';
import { app, BrowserWindow, dialog, shell } from 'electron';
import {
  createAgentDeckServer,
  createAgentProvider,
  type RunningAgentDeckServer,
} from '@agentdeck/server';

let hostWindow: BrowserWindow | null = null;
let localServer: RunningAgentDeckServer | null = null;
let shuttingDown = false;

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function hostDocument(
  pairingUrl: string,
  qrCode: string,
  localAddress: string,
  pairingCode: string,
  providerName: string,
): string {
  const safeUrl = escapeHtml(pairingUrl);
  const safeAddress = escapeHtml(localAddress);
  const safeCode = escapeHtml(pairingCode);
  const safeProvider = escapeHtml(providerName);
  return `<!doctype html>
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline';" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>AgentDeck Host</title>
      <style>
        :root { color-scheme: dark; font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
        * { box-sizing: border-box; }
        body { min-height: 100vh; margin: 0; padding: 34px; overflow: hidden; background: radial-gradient(circle at 50% -10%, rgba(124,140,255,.17), transparent 45%), #090a0c; color: #f7f7f5; user-select: none; }
        main { display: flex; height: calc(100vh - 68px); flex-direction: column; align-items: center; }
        .brand { display: flex; align-items: center; gap: 11px; align-self: flex-start; font-size: 18px; font-weight: 700; letter-spacing: -.04em; }
        .mark { display: grid; width: 37px; height: 37px; grid-template-columns: repeat(3,1fr); align-items: end; gap: 3px; padding: 9px 7px; border: 1px solid rgba(255,255,255,.12); border-radius: 11px; background: #15171c; }
        .mark i { display: block; border-radius: 2px; background: #7c8cff; box-shadow: 0 0 10px rgba(124,140,255,.6); }
        .mark i:nth-child(1) { height: 45%; opacity: .7; } .mark i:nth-child(2) { height: 100%; } .mark i:nth-child(3) { height: 68%; opacity: .85; }
        .eyebrow { margin-top: 34px; color: #7c8cff; font-size: 10px; font-weight: 750; letter-spacing: .13em; text-transform: uppercase; }
        h1 { margin: 7px 0 6px; font-size: 27px; letter-spacing: -.055em; }
        .intro { margin: 0; color: #92949d; font-size: 12px; }
        .qr-shell { position: relative; display: grid; width: min(310px, 46vh); height: min(310px, 46vh); margin: 23px 0 17px; place-items: center; border: 1px solid rgba(255,255,255,.12); border-radius: 25px; background: linear-gradient(145deg, #f8f7f2, #e7e5df); box-shadow: 0 28px 70px rgba(0,0,0,.38), 0 0 60px rgba(124,140,255,.08); }
        .qr-shell::before, .qr-shell::after { position: absolute; width: 17px; height: 17px; border-color: #7c8cff; border-style: solid; content: ''; }
        .qr-shell::before { top: 12px; left: 12px; border-width: 2px 0 0 2px; border-radius: 4px 0 0; }
        .qr-shell::after { right: 12px; bottom: 12px; border-width: 0 2px 2px 0; border-radius: 0 0 4px; }
        .qr-shell img { width: calc(100% - 30px); height: calc(100% - 30px); }
        .network { display: flex; align-items: center; gap: 8px; color: #a9abb3; font-size: 11px; }
        .live { width: 8px; height: 8px; border-radius: 50%; background: #34d399; box-shadow: 0 0 12px rgba(52,211,153,.7); }
        .pairing-code { margin: 8px 0 0; color: #d7ff45; font: 800 24px 'SFMono-Regular', Consolas, monospace; letter-spacing: .18em; user-select: text; }
        .url { max-width: 100%; margin: 13px 0 0; overflow: hidden; color: #5f626b; font: 9px 'SFMono-Regular', Consolas, monospace; text-overflow: ellipsis; white-space: nowrap; user-select: text; }
        footer { display: flex; width: 100%; align-items: center; justify-content: space-between; margin-top: auto; padding-top: 16px; border-top: 1px solid rgba(255,255,255,.08); color: #666972; font-size: 9px; }
        footer span:last-child { color: #8e91a0; }
      </style>
    </head>
    <body>
      <main>
        <div class="brand"><span class="mark"><i></i><i></i><i></i></span>AgentDeck</div>
        <span class="eyebrow">Local control surface</span>
        <h1>Scan to take control</h1>
        <p class="intro">Open your camera on a device connected to the same Wi-Fi.</p>
        <div class="qr-shell"><img src="${qrCode}" alt="AgentDeck pairing QR code" /></div>
        <div class="network"><span class="live"></span> Host live at ${safeAddress}</div>
        <p class="pairing-code">${safeCode}</p>
        <p class="url">${safeUrl}</p>
        <footer><span>LAN-only controller · Code rotates on restart</span><span>${safeProvider} provider</span></footer>
      </main>
    </body>
  </html>`;
}

async function createHostWindow(): Promise<void> {
  const dashboardPath = app.isPackaged
    ? path.join(process.resourcesPath, 'dashboard')
    : path.resolve(app.getAppPath(), '../dashboard/dist');
  const provider = await createAgentProvider();
  localServer = await createAgentDeckServer({ dashboardPath, provider });

  const devOrigin = process.env.AGENTDECK_DEV_URL;
  const pairingUrl = localServer.getDashboardUrl(devOrigin);
  const qrCode = await localServer.getQrDataUrl(devOrigin);

  hostWindow = new BrowserWindow({
    width: 540,
    height: 720,
    minWidth: 480,
    minHeight: 650,
    show: false,
    autoHideMenuBar: true,
    title: 'AgentDeck Host',
    backgroundColor: '#090a0c',
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  hostWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  hostWindow.once('ready-to-show', () => hostWindow?.show());
  hostWindow.on('closed', () => {
    hostWindow = null;
  });

  const document = hostDocument(
    pairingUrl,
    qrCode,
    `${localServer.localAddress}:${localServer.port}`,
    localServer.token,
    provider.name,
  );
  await hostWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(document)}`);
}

const hasLock = app.requestSingleInstanceLock();
if (!hasLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (hostWindow) {
      if (hostWindow.isMinimized()) hostWindow.restore();
      hostWindow.focus();
    }
  });

  app
    .whenReady()
    .then(async () => {
      if (app.isPackaged) {
        app.setLoginItemSettings({ openAtLogin: true, path: process.execPath });
      }
      await createHostWindow();
    })
    .catch((error: unknown) => {
      console.error('AgentDeck failed to start', error);
      dialog.showErrorBox(
        'AgentDeck could not connect to Codex',
        `${error instanceof Error ? error.message : 'Unknown provider error'}\n\nInstall or update the Codex CLI, run codex login, then reopen AgentDeck. Set AGENTDECK_PROVIDER=mock only when you explicitly want the simulator.`,
      );
      app.quit();
    });

  app.on('activate', () => {
    if (!hostWindow) void createHostWindow();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', (event) => {
    if (shuttingDown || !localServer) return;
    event.preventDefault();
    shuttingDown = true;
    void localServer.stop().finally(() => {
      localServer = null;
      app.quit();
    });
  });
}
