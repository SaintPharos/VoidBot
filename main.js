// main.js
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const mineflayer = require('mineflayer');
const proxyChecker = require('./js/proxy/proxycheck');
const proxyHandler = require('./js/proxy/proxyhandler');
const net = require('net');

let win = null;
let botRecords = []; // { id, nick, proxy, status, reason, bot }
let statsInterval = null;

// proxy test controller
let proxyTest = {
  running: false,
  cancel: false,
  tested: 0,
  good: []
};

function safeSend(channel, payload) {
  try {
    if (win && !win.isDestroyed() && win.webContents) {
      win.webContents.send(channel, payload);
    }
  } catch (e) {
    // ignore – window closed
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1000,
    height: 600,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true
    }
  });

  win.loadFile(path.join(__dirname, 'index.html'));

  win.on('closed', () => {
    win = null;
    // stop background loops
    proxyTest.cancel = true;
    if (statsInterval) {
      clearInterval(statsInterval);
      statsInterval = null;
    }
    // stop bots if any
    stopAllBots();
  });
}

app.whenReady().then(() => {
  createWindow();
  // stats heartbeat
  statsInterval = setInterval(() => {
    updateStats();
  }, 1000);
});

app.on('window-all-closed', () => {
  stopAllBots();
  app.quit();
});

/* ----------------- IPC: Proxy test ----------------- */
/*
start-proxy-test payload:
{
  type: 'socks5'|'socks4'|'http'|'https'|'auto',
  list: ['1.2.3.4:1080:user:pass', ...],
  testHost: 'server.domain',
  testPort: 25565,
  timeoutMs: 5000,
  concurrency: 30
}
*/
ipcMain.handle('start-proxy-test', async (evt, payload) => {
  if (proxyTest.running) return { status: 'already' };
  proxyTest.running = true;
  proxyTest.cancel = false;
  proxyTest.tested = 0;
  proxyTest.good = [];

  const type = (payload && payload.type) || 'auto';
  const list = (payload && payload.list && Array.isArray(payload.list)) ? payload.list.slice() : [];
  const testHost = (payload && payload.testHost) || 'example.com';
  const testPort = (payload && payload.testPort) || 80;
  const timeoutMs = (payload && payload.timeoutMs) || 5000;
  const concurrency = Math.max(1, (payload && payload.concurrency) || 20);

  let idx = 0;
  const running = [];

  function shouldStop() {
    return proxyTest.cancel;
  }

  function runNext() {
    if (shouldStop()) return null;
    if (idx >= list.length) return null;
    const line = list[idx++];
    const [host, port, username, password] = line.split(':');
    const p = (async () => {
      try {
        const res = await proxyChecker.checkProxy(type, host, port, username, password, testHost, testPort, timeoutMs);
        proxyTest.tested++;
        proxyTest.good.push({ original: line, type: res.type || type, ok: true });
        safeSend('proxy-test-result', { original: line, ok: true, type: res.type || type });
        return { original: line, ok: true };
      } catch (err) {
        proxyTest.tested++;
        safeSend('proxy-test-result', { original: line, ok: false, error: err && err.error ? err.error : (err && err.reason) || String(err) });
        return { original: line, ok: false, error: err };
      }
    })();

    running.push(p);
    p.finally(() => {
      const i = running.indexOf(p);
      if (i >= 0) running.splice(i, 1);
      if (!shouldStop()) runNext();
    });
    return p;
  }

  // start concurrency workers
  for (let i = 0; i < Math.min(concurrency, list.length); i++) runNext();

  // wait for completion or cancel
  await new Promise((resolve) => {
    const check = () => {
      if (proxyTest.cancel) resolve();
      else if (running.length === 0 && idx >= list.length) resolve();
      else setTimeout(check, 150);
    };
    check();
  });

  proxyTest.running = false;
  const good = proxyTest.good.slice();
  safeSend('proxy-test-done', { total: list.length, good });

  // auto-replace list in renderer if there are good proxies
  if (good.length > 0) safeSend('proxy-test-replace', good.map(g => `${g.original}`));

  return { status: 'done', total: list.length, goodCount: good.length };
});

ipcMain.handle('stop-proxy-test', () => {
  if (!proxyTest.running) return { status: 'not-running' };
  proxyTest.cancel = true;
  return { status: 'stopping' };
});

/* ----------------- IPC: Bots ----------------- */
/*
start-bots payload:
{
  host, port, count, nickMode, customNicks:[], joinDelayMs, proxies: [{ original,type,ok }], botsPerProxy, version
}
*/
ipcMain.handle('start-bots', async (evt, cfg) => {
  const config = cfg || {};
  const host = config.host || '127.0.0.1';
  const port = config.port || 25565;
  const count = Math.max(1, config.count || 1);
  const joinDelayMs = Math.max(0, config.joinDelayMs || 1000);
  const nickMode = config.nickMode || 'random';
  const customNicks = Array.isArray(config.customNicks) ? config.customNicks : [];
  const version = config.version || undefined;
  const proxies = Array.isArray(config.proxies) ? config.proxies.filter(p => p && p.ok) : [];
  const botsPerProxy = Math.max(0, config.botsPerProxy || 0);

  // build expanded proxy list
  let expanded = [];
  if (proxies.length > 0 && botsPerProxy > 0) {
    proxies.forEach(p => { for (let i=0;i<botsPerProxy;i++) expanded.push(p); });
  } else if (proxies.length > 0) expanded = proxies.slice();

  // spawn bots sequentially with delay
  for (let i = 0; i < count; i++) {
    const id = `${Date.now()}_${i}_${Math.random().toString(36).slice(2,6)}`;
    let nick;
    if (nickMode === 'random') nick = makeRandomNick(4,10);
    else if (nickMode === 'custom') nick = customNicks[i % customNicks.length] || makeRandomNick(4,10);
    else nick = makeRandomNick(4,10);

    const proxyAssigned = expanded.length > 0 ? expanded[i % expanded.length] : null;
    const record = { id, nick, proxy: proxyAssigned ? proxyAssigned.original : null, type: proxyAssigned ? proxyAssigned.type : null, status: 'queued', reason: '' };
    botRecords.push(record);
    safeSend('bot-status', record);
    // spawn
    (async (rec) => {
      try {
        rec.status = 'connecting'; safeSend('bot-status', rec);
        let socket;
        if (rec.proxy) {
          // use proxy handler: expects (type, host, port, username, password, destHost, destPort)
          const parts = rec.proxy.split(':');
          const phost = parts[0], pport = parts[1], puser = parts[2], ppass = parts[3];
          socket = await proxyHandler.connection(rec.type || 'socks5', phost, pport, puser, ppass, host, port, 10000);
        } else {
          socket = await plainConnect(host, port, 7000);
        }
        if (!socket) {
          rec.status = 'error'; rec.reason = 'no socket'; safeSend('bot-status', rec); return;
        }
        socket.setNoDelay(true);
        const bot = mineflayer.createBot({ username: rec.nick, socket, version: version || false });
        rec.bot = bot;
        rec.status = 'started'; rec.reason = ''; safeSend('bot-status', rec);

        // attach handlers
        bot.once('login', () => {
          rec.status = 'logged_in'; rec.reason = ''; safeSend('bot-status', rec);
        });
        bot.once('spawn', () => {
          rec.status = 'in_server'; safeSend('bot-status', rec);
        });
        bot.on('kicked', (reason) => {
          rec.status = 'kicked'; rec.reason = reason; safeSend('bot-status', rec);
        });
        bot.on('end', (reason) => {
          rec.status = 'disconnected'; rec.reason = reason; safeSend('bot-status', rec);
        });
        bot.on('error', (err) => {
          rec.status = 'error'; rec.reason = (err && err.message) ? err.message : String(err); safeSend('bot-status', rec);
        });
      } catch (err) {
        rec.status = 'error'; rec.reason = (err && err.message) ? err.message : String(err); safeSend('bot-status', rec);
      }
    })(record);

    await sleep(joinDelayMs);
  }

  return { status: 'started', attempted: count };
});

ipcMain.handle('stop-bots', async () => {
  stopAllBots();
  return { status: 'stopped' };
});

/* ----------------- Helpers ----------------- */
function stopAllBots() {
  for (const r of botRecords) {
    try {
      if (r.bot) {
        if (typeof r.bot.quit === 'function') r.bot.quit();
        else if (r.bot._client && typeof r.bot._client.end === 'function') r.bot._client.end();
      }
      r.status = 'stopped';
      r.reason = '';
      safeSend('bot-status', r);
    } catch (e) {
      // ignore
    }
  }
  botRecords = [];
  updateStats();
}

function updateStats() {
  // guard window presence
  if (!win || win.isDestroyed()) return;
  const total = botRecords.length;
  const started = botRecords.filter(r => ['started','logged_in','in_server'].includes(r.status)).length;
  const inServer = botRecords.filter(r => r.status === 'in_server').length;
  const crashed = botRecords.filter(r => ['error','kicked','disconnected'].includes(r.status)).length;
  safeSend('stats', { total, started, inServer, crashed });
}

function plainConnect(host, port, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const s = new net.Socket();
    let done = false;
    s.setTimeout(timeoutMs);
    s.once('error', (err) => { if (done) return; done = true; try { s.destroy(); } catch(e){}; reject(err); });
    s.once('timeout', () => { if (done) return; done = true; try { s.destroy(); } catch(e){}; reject(new Error('timeout')); });
    s.connect(Number(port), host, () => { if (done) return; done = true; s.setTimeout(0); resolve(s); });
  });
}

function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

function makeRandomNick(min = 4, max = 10) {
  const chars = 'abcdefghijklmnopqrstuvwxyz';
  const len = Math.floor(Math.random() * (max - min + 1)) + min;
  let s = '';
  for (let i=0;i<len;i++) s += chars[Math.floor(Math.random()*chars.length)];
  return s.charAt(0).toUpperCase() + s.slice(1);
}
