// js/proxy/proxyhandler.js
const { SocksClient } = require('socks');
const net = require('net');

/**
 * connection(proxyType, proxyHost, proxyPort, proxyUsername, proxyPassword, dHost, dPort, timeoutMs)
 * returns Promise<net.Socket>
 */
function connection(
  proxyType,
  proxyHost,
  proxyPort,
  proxyUsername,
  proxyPassword,
  dHost,
  dPort,
  timeoutMs = 7000
) {
  return new Promise((resolve, reject) => {
    if (!dHost || !dPort) return reject(new Error('invalid destination'));
    // timeout guard
    let finished = false;
    const to = setTimeout(() => {
      if (finished) return;
      finished = true;
      reject(new Error('timeout'));
    }, timeoutMs);

    if (proxyType === 'socks5' || proxyType === 'socks4') {
      const type = proxyType === 'socks5' ? 5 : 4;
      const opts = {
        proxy: {
          host: proxyHost,
          port: Number(proxyPort),
          type,
          userId: proxyUsername || undefined,
          password: proxyPassword || undefined
        },
        command: 'connect',
        destination: {
          host: dHost,
          port: Number(dPort)
        },
        timeout: timeoutMs
      };
      const p = SocksClient.createConnection(opts);
      if (p && typeof p.then === 'function') {
        p.then(info => {
          if (finished) { try { info.socket.destroy(); } catch(e){}; return; }
          finished = true; clearTimeout(to);
          resolve(info.socket);
        }).catch(err => {
          if (finished) return;
          finished = true; clearTimeout(to);
          reject(err);
        });
      } else {
        // fallback (shouldn't get here)
        finished = true; clearTimeout(to);
        reject(new Error('socks createConnection unsupported'));
      }
      return;
    }

    if (proxyType === 'http' || proxyType === 'https') {
      const s = new net.Socket();
      s.setTimeout(timeoutMs);
      s.once('error', (err) => {
        if (finished) return;
        finished = true; clearTimeout(to);
        try { s.destroy(); } catch (e) {}
        reject(err);
      });
      s.once('timeout', () => {
        if (finished) return;
        finished = true; clearTimeout(to);
        try { s.destroy(); } catch (e) {}
        reject(new Error('timeout'));
      });
      s.connect(Number(proxyPort), proxyHost, () => {
        // send CONNECT
        let headers = `CONNECT ${dHost}:${dPort} HTTP/1.1\r\nHost: ${dHost}:${dPort}\r\n`;
        if (proxyUsername) {
          const auth = Buffer.from(`${proxyUsername}:${proxyPassword || ''}`).toString('base64');
          headers += `Proxy-Authorization: Basic ${auth}\r\n`;
        }
        headers += '\r\n';
        s.write(headers);
        let acc = Buffer.alloc(0);
        const onData = (chunk) => {
          acc = Buffer.concat([acc, chunk]);
          const str = acc.toString('utf8');
          if (str.indexOf('\r\n\r\n') !== -1) {
            s.removeListener('data', onData);
            const statusLine = str.split('\r\n')[0] || '';
            const m = statusLine.match(/HTTP\/\d+\.\d+\s+(\d+)/);
            if (!m) {
              if (finished) return;
              finished = true; clearTimeout(to);
              try { s.destroy(); } catch (e) {}
              return reject(new Error('invalid proxy response'));
            }
            const code = Number(m[1]);
            if (code >= 200 && code < 300) {
              if (finished) return;
              finished = true; clearTimeout(to);
              // s is now a tunnel to destination
              s.setTimeout(0);
              resolve(s);
            } else {
              if (finished) return;
              finished = true; clearTimeout(to);
              try { s.destroy(); } catch (e) {}
              reject(new Error('proxy returned ' + code));
            }
          }
        };
        s.on('data', onData);
      });
      return;
    }

    // direct
    const s = new net.Socket();
    s.setTimeout(timeoutMs);
    s.once('error', (err) => {
      if (finished) return;
      finished = true; clearTimeout(to);
      try { s.destroy(); } catch (e) {}
      reject(err);
    });
    s.once('timeout', () => {
      if (finished) return;
      finished = true; clearTimeout(to);
      try { s.destroy(); } catch (e) {}
      reject(new Error('timeout'));
    });
    s.connect(Number(dPort), dHost, () => {
      if (finished) return;
      finished = true; clearTimeout(to);
      s.setTimeout(0);
      resolve(s);
    });
  });
}

module.exports = { connection };
