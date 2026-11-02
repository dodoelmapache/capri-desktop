// The usage of her Claude jobs (usage.js), as a sentence: for her bubble, her answer and her window.

const money = (n) => `$${n < 10 ? n.toFixed(2) : n.toFixed(1)}`;
const kilo = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));
const NAME = { haiku: 'Haiku', sonnet: 'Sonnet', opus: 'Opus', other: 'otro' };

export function usageLine(s, lang = 'es') {
  const en = lang === 'en';
  const t = s?.today;
  if (!s || !s.month.jobs) return en ? 'You have not used Claude from Capri yet.' : 'Todavía no has usado Claude desde Capri.';
  const models = Object.entries(t.byModel).filter(([, v]) => v.n).map(([k, v]) => `${en && k === 'other' ? 'other' : NAME[k]} ${v.n}`).join(' · ');
  const today = t.jobs
    ? (en ? `Claude today: ${t.jobs} ${t.jobs === 1 ? 'job' : 'jobs'} (${models}) · about ${money(t.cost)} at API prices · ${kilo(t.tokens)} tokens.`
      : `Claude hoy: ${t.jobs} ${t.jobs === 1 ? 'trabajo' : 'trabajos'} (${models}) · unos ${money(t.cost)} a precio de API · ${kilo(t.tokens)} tokens.`)
    : (en ? 'No Claude from Capri today.' : 'Hoy no has usado Claude desde Capri.');
  const more = en ? ` This week: ${s.week.jobs} jobs, about ${money(s.week.cost)}. This month: ${s.month.jobs} jobs, about ${money(s.month.cost)}.`
    : ` Esta semana: ${s.week.jobs} trabajos, unos ${money(s.week.cost)}. Este mes: ${s.month.jobs} trabajos, unos ${money(s.month.cost)}.`;
  return today + more;
}

// the short one, for a corner of her window: "Claude hoy: 7 · ≈ $0.31"
export function usageShort(s, lang = 'es') {
  if (!s) return '';
  const t = s.today;
  return lang === 'en' ? `Claude today: ${t.jobs} · about ${money(t.cost)}` : `Claude hoy: ${t.jobs} · ≈ ${money(t.cost)}`;
}

export const USAGE_NOTE = {
  es: 'Es el costo equivalente a precio de API, no tu factura (con suscripción no se cobra así). Solo cuenta lo que Capri lanza, no lo que haces tú en Claude Code.',
  en: 'This is the cost at API prices, not your bill (a subscription is not charged this way). It counts only what Capri launches, not what you do in Claude Code yourself.',
};

// "1 h 20 min": how long until a limit resets
function untilReset(ms, en = false) {
  const m = Math.max(1, Math.round(ms / 60000));
  if (m >= 1440) return `${Math.floor(m / 1440)} ${en ? 'd' : 'd'} ${Math.floor((m % 1440) / 60)} h`;
  if (m >= 60) return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
  return `${m} min`;
}

// What she says when you are close to running out of Claude (a: { type, level, pct, resetsAt, now })
export function limitLine(a, lang = 'es') {
  const en = lang === 'en';
  const week = a.type === 'seven_day';
  const what = en ? (week ? 'your weekly Claude limit' : 'your 5-hour Claude session') : (week ? 'tu límite semanal de Claude' : 'tu sesión de 5 h de Claude');
  const reset = a.resetsAt && a.resetsAt > (a.now || Date.now()) ? (en ? ` It resets in ${untilReset(a.resetsAt - (a.now || Date.now()), true)}.` : ` Se reinicia en ${untilReset(a.resetsAt - (a.now || Date.now()))}.`) : '';
  const back = a.resetsAt && a.resetsAt > (a.now || Date.now()) ? untilReset(a.resetsAt - (a.now || Date.now()), en) : null;
  if (a.level >= 100) return en ? `You hit ${what}. ${back ? `Claude is back in ${back}.` : 'Claude is paused until it resets.'}` : `Llegaste al tope de ${what}. ${back ? `Claude vuelve en ${back}.` : 'Claude queda en pausa hasta el reinicio.'}`;
  if (a.level >= 95) return en ? `Careful: ${a.pct != null ? `${a.pct}% of ` : 'almost all of '}${what} is used.${reset}` : `Ojo, casi se acaba: llevas ${a.pct != null ? `${a.pct} % de` : 'casi todo'} ${what}.${reset}`;
  return en ? `Heads up: ${a.pct != null ? `${a.pct}% of ` : 'you are getting close to '}${what}${a.pct != null ? ' is used' : ''}.${reset}` : `Aviso: ${a.pct != null ? `llevas ${a.pct} % de` : 'te estás acercando a'} ${what}.${reset}`;
}
