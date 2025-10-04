// renderer.js
const serverInput = document.getElementById('server');
const botMaxInput = document.getElementById('botMax');
const joinDelayInput = document.getElementById('joinDelay');
const btnStart = document.getElementById('btnStart');
const btnStop = document.getElementById('btnStop');

const proxyTypeSelect = document.getElementById('proxyType');
const proxyList = document.getElementById('proxyList');
const proxyTestStart = document.getElementById('proxyTestStart');
const proxyTestStop = document.getElementById('proxyTestStop');

const proxyLog = document.getElementById('proxyLog');
const botList = document.getElementById('botList');
const statsEl = document.getElementById('stats');
const proxyStatsEl = document.getElementById('proxyStats');

let tested = 0, good = 0;

// helpers
function addProxyLog(text, ok = null) {
  const li = document.createElement('li');
  li.textContent = text;
  if (ok === true) li.style.color = '#bbf7d0';
  else if (ok === false) li.style.color = '#fecaca';
  proxyLog.prepend(li);
}
function addBotRow(info) {
  // find by id
  const existing = document.querySelector(`#bot-${info.id}`);
  if (existing) {
    existing.querySelector('.status').textContent = info.status;
    existing.querySelector('.reason').textContent = info.reason || '';
    return;
  }
  const li = document.createElement('li');
  li.id = `bot-${info.id}`;
  li.innerHTML = `<strong>${info.nick}</strong> (${info.proxy || 'no-proxy'}) — <span class="status">${info.status}</span> <span class="reason" style="color:#9aa4b2"> ${info.reason||''}</span>`;
  botList.prepend(li);
}

// proxy test actions
proxyTestStart.addEventListener('click', async () => {
  const lines = proxyList.value.split('\n').map(l => l.trim()).filter(Boolean);
  if (!lines.length) {
    addProxyLog('Proxy list empty', false); return;
  }
  tested = 0; good = 0; proxyStatsEl.textContent = `Tested: ${tested}, Good: ${good}`;
  addProxyLog(`Starting test (${lines.length})`);
  // subscribe events
  window.api.onProxyTestResult((res) => {
    tested++;
    if (res.ok) { good++; addProxyLog(`${res.original} — OK [${res.type||'-'}]`, true); }
    else addProxyLog(`${res.original} — FAIL ${res.error||''}`, false);
    proxyStatsEl.textContent = `Tested: ${tested}, Good: ${good}`;
  });
  window.api.onProxyTestDone((d) => {
    addProxyLog(`Test done. total ${d.total}, good ${d.good.length}`);
    proxyStatsEl.textContent = `Tested: ${d.total}, Good: ${d.good.length}`;
  });
  window.api.onProxyTestReplace((arr) => {
    // auto replace list
    proxyList.value = arr.join('\n');
    addProxyLog('Proxy list auto-replaced with good proxies');
  });

  await window.api.startProxyTest({
    type: proxyTypeSelect.value,
    list: lines,
    testHost: serverInput.value.split(':')[0] || 'example.com',
    testPort: Number(serverInput.value.split(':')[1] || 25565),
    timeoutMs: 5000,
    concurrency: 20
  });
});

proxyTestStop.addEventListener('click', async () => {
  await window.api.stopProxyTest();
  addProxyLog('Stop requested for proxy test');
});

// bots start/stop
btnStart.addEventListener('click', async () => {
  const server = serverInput.value.split(':');
  const host = server[0];
  const port = Number(server[1] || 25565);
  const count = Number(botMaxInput.value) || 1;
  const delay = Number(joinDelayInput.value) || 1500;
  const proxies = proxyList.value.split('\n').map(l => l.trim()).filter(Boolean).map(line => ({ original: line, ok: true, type: proxyTypeSelect.value }));

  addProxyLog(`Starting ${count} bots to ${host}:${port} (proxies ${proxies.length})`);
  await window.api.startBots({
    host, port, count,
    joinDelayMs: delay,
    nickMode: 'random',
    proxies,
    botsPerProxy: 0
  });
});

btnStop.addEventListener('click', async () => {
  await window.api.stopBots();
  addProxyLog('Stop bots requested');
});

// incoming updates
window.api.onProxyTestResult((r) => {
  // handled above by start event subscription; keep here if called separately
});
window.api.onProxyTestDone((d) => {
  // handled above
});
window.api.onBotStatus((rec) => {
  addBotRow(rec);
});
window.api.onStats((s) => {
  statsEl.textContent = `Bots: ${s.started}/${s.total} | In server: ${s.inServer} | Crashed: ${s.crashed}`;
});
