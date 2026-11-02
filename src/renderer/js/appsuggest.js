// As you type to her, the apps you have that match what you've typed so far ("f": Figma, Fusion 360, Firefox...), to press and open.
// Only while it looks like you are naming an app: one word ("fig"), or an opening verb and one or two ("abre fus"): never in a sentence.

const plain = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const OPEN_VERB = /^(?:capri[\s,]+)?(?:abre|abrir|abr[eé]me|lanza|inicia|ejecuta|open|launch|start|run)\s+/;
const ARTICLE = /^(?:mi|el|la|my|the|el\s+programa|la\s+app)\s+/;

// what is being named, or null when this is not (yet) an app's name
export function suggestToken(text) {
  let t = plain(text).trim();
  if (!t || t.length > 40) return null;
  const verb = OPEN_VERB.test(t);
  t = t.replace(OPEN_VERB, '').replace(ARTICLE, '').trim();
  const words = t.split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  if (!verb && words.length > 1) return null; // a sentence: not naming an app
  if (words.length > 2) return null;
  const token = words.join('').replace(/[^a-z0-9]/g, '');
  return token || null;
}

// catalog: [{ name, kind, id }] (what her wheel can add: your installed apps and games)
export function matchApps(catalog, token, limit = 6) {
  if (!token) return [];
  const scored = [];
  for (const item of catalog || []) {
    const name = plain(item.name).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!name) continue;
    const words = name.split(' ');
    const compact = words.join('');
    let score = 0;
    if (compact.startsWith(token)) score = 100;
    else {
      const w = words.findIndex((x) => x.startsWith(token));
      if (w >= 0) score = 80 - w;
      else if (token.length >= 4 && compact.includes(token)) score = 50; // (inside a name only from 4 letters: "fig" is not "Configuración")
    }
    if (score) scored.push({ item, score, len: name.length });
  }
  return scored.sort((a, b) => b.score - a.score || a.len - b.len || a.item.name.localeCompare(b.item.name)).slice(0, limit).map((s) => s.item);
}
