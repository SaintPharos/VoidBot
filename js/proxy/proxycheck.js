// js/proxy/proxycheck.js
const mc = require('minecraft-protocol');
const { connection } = require('./proxyhandler');
const { salt } = require('../misc/utils');

/**
 * checkProxy(proxyType, proxyHost, proxyPort, proxyUsername, proxyPassword, dHost, dPort, timeout)
 * Resolves { reason: 'success', proxy: 'host:port[:user][:pass]', type }
 * Rejects { reason: 'bad'|'timeout', error, proxy }
 */
function checkProxy(
  proxyType,
  proxyHost,
  proxyPort,
  proxyUsername,
  proxyPassword,
  dHost,
  dPort,
  timeout = 5000
) {
  return new Promise((resolve, reject) => {
    if (!dHost || !dPort) return reject({ reason: 'bad', error: 'invalid dest', proxy: `${proxyHost}:${proxyPort}` });

    const bot = mc.createClient({
      host: dHost,
      port: parseInt(dPort),
      username: salt(10),
      auth: 'offline',
      connect: async (client) => {
        try {
          const sock = await connection(
            proxyType,
            proxyHost,
            proxyPort,
            proxyUsername,
            proxyPassword,
            dHost,
            dPort,
            timeout
          );
          client.setSocket(sock);
          client.emit('connect');
        } catch (error) {
          const info = {
            reason: 'bad',
            error: error && error.message ? error.message : String(error),
            proxy: proxyHost + ':' + proxyPort
          };
          return reject(info);
        }
      }
    });

    const to = setTimeout(() => {
      try { bot.end(); } catch (e) {}
      return reject({ reason: 'timeout', proxy: proxyHost + ':' + proxyPort });
    }, timeout);

    bot.on('connect', () => {
      clearTimeout(to);
      try { bot.end(); } catch (e) {}
      const info = {
        reason: 'success',
        proxy: `${proxyHost}:${proxyPort}${proxyUsername ? `:${proxyUsername}` : ''}${proxyPassword ? `:${proxyPassword}` : ''}`,
        type: proxyType
      };
      return resolve(info);
    });

    bot.on('error', (error) => {
      clearTimeout(to);
      try { bot.end(); } catch (e) {}
      const info = {
        reason: 'bad',
        error: error && error.message ? error.message : String(error),
        proxy: proxyHost + ':' + proxyPort
      };
      return reject(info);
    });
  });
}

module.exports = { checkProxy };
