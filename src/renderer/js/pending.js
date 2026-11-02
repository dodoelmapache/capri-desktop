// Chats (WhatsApp, Discord, Telegram) whose messages she showed you and that you have not answered yet. A card goes away after a few seconds,
// but what was in it stays here until you answer (from her), say "ya los vi", or a day passes. In memory only: it starts empty when she wakes.
// Where it shows: the "Pendientes" button of her chat bar, "mensajes pendientes" said or typed, and one gentle reminder from app.js.

const TTL_MS = 24 * 60 * 60 * 1000;
const NAMES = { whatsapp: 'WhatsApp', discord: 'Discord', telegram: 'Telegram' };
const items = new Map(); // 'app|chat' -> { app, title, texts, first, last, reminded }
const listeners = new Set();
const changed = () => listeners.forEach((fn) => { try { fn(); } catch { /* a listener never breaks the list */ } });
const keyOf = (app, title) => `${app}|${String(title || '').trim().toLowerCase()}`;
const clip = (t, n) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

export const pending = {
  add(list) {
    const now = Date.now();
    for (const it of list || []) {
      if (!it?.app || !it?.title) continue;
      const key = keyOf(it.app, it.title);
      const v = items.get(key) || { app: it.app, title: String(it.title), texts: [], first: now, last: now, reminded: 0 };
      if (it.body) {
        const body = String(it.body);
        const prev = v.texts[v.texts.length - 1];
        if (prev && (prev === body || prev.replace(/ ×\d+$/, '') === body)) v.texts[v.texts.length - 1] = `${body} ×${(Number(/ ×(\d+)$/.exec(prev)?.[1]) || 1) + 1}`;
        else v.texts.push(body);
      }
      v.texts = v.texts.slice(-8);
      v.last = now;
      v.reminded = 0; // (something new came in: it counts as news again)
      items.set(key, v);
    }
    changed();
  },
  list() {
    const now = Date.now();
    for (const [k, v] of items) if (now - v.last > TTL_MS) items.delete(k);
    return [...items.values()].sort((a, b) => b.last - a.last);
  },
  count() { return this.list().length; },
  // you answered "Mamá": the chat titled "Mamá ❤️" is the same one
  removeLike(app, name) {
    const want = String(name || '').trim().toLowerCase();
    let any = false;
    for (const [k, v] of items) {
      const t = v.title.toLowerCase();
      if (v.app === app && (!want || t === want || (want.length >= 3 && (t.includes(want) || want.includes(t))))) { items.delete(k); any = true; }
    }
    if (any) changed();
  },
  clear() { if (items.size) { items.clear(); changed(); } },
  onChange(fn) { listeners.add(fn); },
};

const ago = (t, es) => {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return es ? 'ahora' : 'now';
  if (m < 60) return es ? `hace ${m} min` : `${m} min ago`;
  const h = Math.round(m / 60);
  return es ? `hace ${h} h` : `${h} h ago`;
};

// { head, body }: how many chats wait, and for each one who, since when, and what they said
export function describe(list, es) {
  const apps = [...new Set(list.map((p) => p.app))];
  const where = apps.length === 1 ? ` ${es ? 'en' : 'in'} ${NAMES[apps[0]] || apps[0]}` : '';
  const head = es ? `${list.length} ${list.length === 1 ? 'chat sin responder' : 'chats sin responder'}${where}` : `${list.length} ${list.length === 1 ? 'chat' : 'chats'} waiting for an answer${where}`;
  const body = list.map((p) => `${apps.length > 1 ? `[${NAMES[p.app] || p.app}] ` : ''}${p.title} · ${ago(p.last, es)}\n${p.texts.length ? p.texts.slice(-5).map((t) => `  · ${clip(t, 300)}`).join('\n') : '  ·'}`).join('\n\n');
  return { head, body };
}

// the buttons: one per chat (the latest three), "ya los vi" and close
export function buttons(list, es) {
  return [
    ...list.slice(0, 3).map((p, i) => ({ id: `reply:${i}`, label: `${es ? 'Resp.' : 'Re:'} ${clip(p.title, 14)}`, primary: i === 0 })),
    { id: 'seen', label: es ? 'Ya los vi' : 'Seen them' },
    { id: 'close', label: es ? 'Cerrar' : 'Close' },
  ];
}

// what a button does. inChat: her chat is open (the card cannot be hidden: the bar stays)
export async function act(id, list, { es, chat, panel, inChat = false }) {
  if (id === 'close') { if (inChat) panel.setActions([]); else panel.hide(); return; }
  if (id === 'seen') {
    pending.clear();
    if (inChat) { panel.setActions([]); chat.notify?.(es ? 'Listo, los limpié.' : 'Done, cleared.', 'smug'); } else panel.hide();
    return;
  }
  if (!id.startsWith('reply:')) return;
  const p = list.slice(0, 3)[Number(id.split(':')[1]) || 0];
  if (!p) return;
  const who = p.app === 'whatsapp' && p.title.length <= 40 && !/[:,]/.test(p.title) ? ` ${es ? 'a' : 'to'} ${p.title}` : '';
  if (!chat.open) await chat.start();
  const box = panel.chatInput;
  if (box) { box.value = es ? `responde en ${NAMES[p.app] || p.app}${who}: ` : `reply in ${NAMES[p.app] || p.app}${who}: `; box.focus(); }
}

// her small card with all of it (when her chat is closed)
export function showCard({ panel, chat, es }) {
  const list = pending.list();
  if (!list.length) return false;
  const d = describe(list, es);
  return panel.say({
    kind: 'info', face: 'smug', tag: es ? 'PENDIENTES' : 'PENDING', line: d.head, reply: d.body, pile: true, hold: 40000,
    actions: buttons(list, es),
    onAction: (id) => act(id, list, { es, chat, panel }),
  });
}
