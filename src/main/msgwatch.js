'use strict';

// Messages waiting in WhatsApp, Discord or Telegram, noticed from the window title only ("(3) WhatsApp"): no contents are read until you ask.
// onNew({ app, count, title }) when a count goes up. Config: msgWatch (default on).

const apps = require('./apps');

const KNOWN = [['whatsapp', /whatsapp/i], ['discord', /discord/i], ['telegram', /telegram/i]];
const EVERY_MS = 20000;
const QUIET_MS = 2 * 60000;

function setup({ config, onNew, skip }) {
  if (process.platform !== 'win32') return;
  const last = new Map(); // app -> unread count at the last look
  const told = new Map(); // app -> when she last told you
  let busy = false;
  const look = async () => {
    if (busy || config.load().msgWatch === false || skip?.()) return; // (skip: the notifications of Windows are being read, which is better than a title)
    busy = true;
    try {
      const allowed = [].concat(config.load().msgApps || ['whatsapp', 'discord', 'telegram']).map((a) => String(a).toLowerCase());
      const rows = await apps.windows().catch(() => []);
      const now = new Map();
      for (const row of rows) {
        for (const [app, re] of KNOWN) {
          if (!re.test(row.title) || !allowed.includes(app)) continue;
          const n = /\((\d{1,3})\)/.exec(row.title)?.[1];
          const count = n ? Number(n) : 0; // (only a number: the dot Discord shows for any activity in a server is not counted)
          if (count > (now.get(app)?.count || 0) || !now.has(app)) now.set(app, { count, title: row.title });
        }
      }
      for (const [app, info] of now) {
        const before = last.get(app);
        if (before !== undefined && info.count > before && Date.now() - (told.get(app) || 0) > QUIET_MS) {
          told.set(app, Date.now());
          onNew({ app, count: info.count, title: info.title });
        }
        last.set(app, info.count);
      }
      for (const app of [...last.keys()]) if (!now.has(app)) last.delete(app); // (closed: the next time it shows is a new baseline)
    } finally {
      busy = false;
    }
  };
  setTimeout(look, 15000);
  setInterval(look, EVERY_MS);
}

module.exports = { setup };
