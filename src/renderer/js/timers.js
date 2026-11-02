// Timers and pomodoro, by voice or typing. "Capri, 25 minutos", "temporizador de 10 minutos",
// "recuérdame sacar la pasta en 8 minutos", "pomodoro", "cuánto falta", "cancela el temporizador".
// They never go through the model: she answers at once, and rings when it's time (app.js decides how).
// Spanish and English; they survive a restart (the config keeps them).

import { pick } from './util.js';

const WORDS = {
  un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
  quince: 15, veinte: 20, veinticinco: 25, treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60,
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60,
};
const UNIT = { h: 3600e3, m: 60e3, s: 1e3 };
const NUM = `\\d+(?:[.,]\\d+)?|${Object.keys(WORDS).join('|')}`;
// (no \b: it counts á as a non-letter, and "mamá" would hold "a m")
const DURATION = new RegExp(`(?<![\\p{L}\\p{N}])(${NUM})\\s*(horas?|hrs?|h|minutos?|mins?|min|m|segundos?|segs?|s|hours?|minutes?|seconds?|secs?)(?![\\p{L}\\p{N}])(\\s+y media|\\s+and a half)?`, 'giu');
const HALF = /\b(media hora|half an? hour|un cuarto de hora)\b/;
const TIMER_WORD = /\b(recordatorio\w*|temporizador\w*|timer\w*|alarm\w*|cron[oó]metro|cuenta regresiva|countdown|av[ií]same|recu[eé]rdame|remind me|despi[eé]rtame|wake me)\b/i;
const REMIND = /\b(av[ií]same|recu[eé]rdame|remind me)\b/i;
const CANCEL = /\b(cancel\w*|det[eé]n\w*|detener|parar|p[aá]rate|pare|quit[ae]\w*|apag\w*|elimin\w*|borra\w*|stop|clear|kill)\b|^(capri[ ,]+)?para\b/i;
const POMODORO = /\b(pomodoros?|modo foco|focus mode|sesi[oó]n de (estudio|foco)|study session)\b/i;
const STATUS = /\b(cu[aá]nto|cu[aá]nta)\b.*\b(falta|queda|resta)\b|how (much|long)\b.*\b(left|remain\w*)\b|\b(qu[eé]|cu[aá]les) (temporizadores|timers)\b/i;

const MIN = 60e3;
const BREAKS = { work: 25, short: 5, long: 15, rounds: 4 };

// "1.5" or "1,5" or "dos" → number
const num = (s) => (/^\d/.test(s) ? parseFloat(s.replace(',', '.')) : WORDS[s.toLowerCase()]);

// the time in a message, in ms (0: none)
function duration(text) {
  let ms = 0;
  const half = HALF.exec(text)?.[1]?.toLowerCase();
  if (half) ms += /cuarto/.test(half) ? 15 * MIN : /y media|and a half/.test(half) ? 90 * MIN : 30 * MIN;
  let rest = half ? text.replace(HALF, ' ') : text;
  for (const m of rest.matchAll(DURATION)) {
    const n = num(m[1]);
    if (!(n > 0)) continue;
    const unit = m[2][0].toLowerCase();
    ms += n * (UNIT[unit] ?? MIN) + (m[3] && unit === 'h' ? 30 * MIN : 0); // "una hora y media"
  }
  return Math.round(ms);
}

// what to remind about: what's left of "recuérdame sacar la pasta en 8 minutos"
function reminder(text) {
  return text
    .replace(HALF, ' ')
    .replace(DURATION, ' ')
    .replace(/\b(capri|av[ií]same|recu[eé]rdame|remind me|dentro de|en|in|de|que|para|to|about|of|me|por favor|please)\b/gi, ' ')
    .replace(/[¿?¡!.,;:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export const left = (ms, lang = 'es') => {
  const es = lang === 'es';
  const total = Math.max(0, Math.round(ms / 1000));
  if (total < 60) return es ? `${total} segundo${total === 1 ? '' : 's'}` : `${total} second${total === 1 ? '' : 's'}`;
  const min = Math.ceil(total / 60);
  if (total < 120) return es ? `${total} segundos` : `${total} seconds`;
  if (min < 60) return es ? `${min} minuto${min === 1 ? '' : 's'}` : `${min} minute${min === 1 ? '' : 's'}`;
  const h = Math.floor(min / 60);
  const rest = min % 60;
  const hours = es ? `${h} hora${h === 1 ? '' : 's'}` : `${h} hour${h === 1 ? '' : 's'}`;
  return rest ? `${hours} ${es ? 'y' : 'and'} ${rest} min` : hours;
};

const LINES = {
  es: {
    started: (d) => pick([`Listo, choom. Te aviso en ${d}.`, `Va. ${d} en marcha, yo vigilo.`, `Anotado: ${d}. Ni te acuerdes, yo grito.`]),
    startedFor: (d, what) => `Listo. En ${d} te recuerdo: ${what}.`,
    pomodoro: (n) => `Pomodoro en marcha: ${n} minutos de foco puro. Sin distracciones, ¿eh?`,
    startedAt: (when, what) => `Listo. ${when[0].toUpperCase()}${when.slice(1)} te aviso${what ? `: ${what}` : ''}.`,
    action: (when, what) => `Va. ${when[0].toUpperCase()}${when.slice(1)} ${what}.`,
    actionOpen: (name) => `abro ${name}`,
    actionMusic: (song) => `pongo ${song}`,
    notFound: (name) => `Ojo: no encontré «${name}» en este PC. Lo quité.`,
    past: 'Esa hora ya pasó hoy, choom. Dime otra o dime “mañana”.',
    fireAlarm: (what) => (what ? `¡Hora de ${what}!` : pick(['¡Es la hora!', '¡Ya es la hora que me pediste!'])),
    repeatNeedsTime: '¿A qué hora? Dímelo con la hora, por ejemplo “todos los días a las 8”.',
    none: 'No tienes ninguno activo, choom.',
    cancelled: (n) => (n > 1 ? 'Listo, borré todos los temporizadores.' : 'Listo, lo borré.'),
    status: (items) => { const out = items.map((i) => `${i.name}: ${i.time}`).join('; '); return out.endsWith('.') ? out : `${out}.`; },
    nameAlarm: 'Alarma', nameAction: (a) => (a.type === 'open' ? `Abrir ${a.value}` : `Poner ${a.value}`),
    nameTimer: 'Temporizador', nameWork: 'Pomodoro', nameBreak: 'Descanso',
    fire: (what) => (what ? `¡Hora de ${what}!` : pick(['¡Se acabó el tiempo!', '¡Tiempo! Ya sonó.', 'Eh, ya pasó el tiempo.'])),
    fireWork: (min, long) => `¡Pomodoro listo! Descansa ${min} minutos${long ? ', ahora sí te lo ganaste' : ''}.`,
    fireBreak: (min) => `Se acabó el descanso. Volvemos al ruedo: ${min} minutos.`,
  },
  en: {
    started: (d) => pick([`Done, choom. I'll yell in ${d}.`, `On it. ${d} on the clock.`, `Noted: ${d}. Don't sweat it, I'll shout.`]),
    startedFor: (d, what) => `Sure. In ${d} I'll remind you: ${what}.`,
    pomodoro: (n) => `Pomodoro running: ${n} minutes of pure focus. No distractions, okay?`,
    startedAt: (when, what) => `Done. ${when[0].toUpperCase()}${when.slice(1)} I'll tell you${what ? `: ${what}` : ''}.`,
    action: (when, what) => `On it. ${when[0].toUpperCase()}${when.slice(1)} ${what}.`,
    actionOpen: (name) => `I'll open ${name}`,
    actionMusic: (song) => `I'll play ${song}`,
    notFound: (name) => `Heads up: I couldn't find "${name}" on this PC. Removed it.`,
    past: 'That time already passed today, choom. Give me another, or say “tomorrow”.',
    fireAlarm: (what) => (what ? `Time to ${what}!` : pick(['It’s time!', 'That’s the time you asked for!'])),
    repeatNeedsTime: 'At what time? Say it with the time, like “every day at 8”.',
    none: 'You have none running, choom.',
    cancelled: (n) => (n > 1 ? 'Done, all timers cleared.' : 'Done, cleared it.'),
    status: (items) => { const out = items.map((i) => `${i.name}: ${i.time}`).join('; '); return out.endsWith('.') ? out : `${out}.`; },
    nameAlarm: 'Alarm', nameAction: (a) => (a.type === 'open' ? `Open ${a.value}` : `Play ${a.value}`),
    nameTimer: 'Timer', nameWork: 'Pomodoro', nameBreak: 'Break',
    fire: (what) => (what ? `Time to ${what}!` : pick(['Time’s up!', 'Ring ring: time’s up.', 'Hey, time’s up.'])),
    fireWork: (min, long) => `Pomodoro done! Rest ${min} minutes${long ? ', you really earned it' : ''}.`,
    fireBreak: (min) => `Break’s over. Back to it: ${min} minutes.`,
  },
};
const linesFor = (lang) => LINES[lang] || LINES.en;

// ---- a time of day: "a las 6:30", "a las 7 de la tarde", "mañana a las 7", "6 pm", "a mediodía" ------
// (matched on a copy without accents, the same length, so the spans cut from your words line up)
const fold = (s) => String(s).toLowerCase().replace(/[áàäâ]/g, 'a').replace(/[éèëê]/g, 'e').replace(/[íìïî]/g, 'i').replace(/[óòöô]/g, 'o').replace(/[úùüû]/g, 'u').replace(/ñ/g, 'n');
const MERIDIEM = '(?:a\\.\\s?m\\.?|p\\.\\s?m\\.?|am|pm)(?![a-z])';
const AT_HOUR = new RegExp(`\\b(?:a la|a las|at|para las|para la)\\s+(\\d{1,2})(?:[:.h](\\d{2}))?\\s*(y media|y cuarto|menos cuarto)?\\s*(?:(${MERIDIEM})|de la (manana|tarde|noche|madrugada)|(morning|afternoon|evening|night))?(?!\\s*(?:minutos?|horas?|segundos?|min\\b|hours?|minutes?|seconds?))`);
const COLON_HOUR = new RegExp(`\\b(\\d{1,2})[:.](\\d{2})\\s*(${MERIDIEM})?`);
const AMPM_HOUR = new RegExp(`\\b(\\d{1,2})\\s*(${MERIDIEM})`);
const NOON = /\b(?:a\s+(?:el\s+)?)?(mediodia|medianoche|noon|midnight)\b/;
const DAY = /(?<![a-z])(pasado manana|manana|tomorrow|hoy|today|esta noche|tonight)(?![a-z])/;

// { at: Date, rest: your words without the time, past: true if that time already went today }, or null
function clock(text, now = new Date()) {
  const f = fold(text);
  let h; let m = 0; let mer = null; let span;
  let hit = AT_HOUR.exec(f);
  if (hit) {
    h = +hit[1]; m = hit[2] ? +hit[2] : 0;
    if (hit[3]) { if (/media/.test(hit[3])) m = 30; else if (/menos/.test(hit[3])) { m = 45; h -= 1; } else m = 15; }
    mer = hit[4] ? (/^p/.test(hit[4]) ? 'pm' : 'am') : hit[5] ? (hit[5] === 'manana' || hit[5] === 'madrugada' ? 'am' : 'pm') : hit[6] ? (hit[6] === 'morning' ? 'am' : 'pm') : null;
  } else if ((hit = COLON_HOUR.exec(f))) {
    h = +hit[1]; m = +hit[2]; mer = hit[3] ? (/^p/.test(hit[3]) ? 'pm' : 'am') : null;
  } else if ((hit = AMPM_HOUR.exec(f))) {
    h = +hit[1]; mer = /^p/.test(hit[2]) ? 'pm' : 'am';
  } else if ((hit = NOON.exec(f))) {
    const noon = /^(mediodia|noon)$/.test(hit[1]);
    h = noon ? 12 : 0; mer = noon ? 'pm' : 'am';
  } else {
    return null;
  }
  span = [hit.index, hit.index + hit[0].length];
  const blanked = f.slice(0, span[0]) + ' '.repeat(span[1] - span[0]) + f.slice(span[1]);
  const dayHit = DAY.exec(blanked);
  const day = dayHit ? ({ 'pasado manana': 'after', manana: 'tomorrow', tomorrow: 'tomorrow', 'esta noche': 'today', tonight: 'today' }[dayHit[1]] || 'today') : null;
  if (dayHit && /noche|tonight/.test(dayHit[1]) && !mer) mer = 'pm';
  if (h > 23 || h < 0 || m > 59) return null;
  const spans = [span, ...(dayHit ? [[dayHit.index, dayHit.index + dayHit[0].length]] : [])].sort((a, b) => b[0] - a[0]);
  let rest = String(text);
  for (const [a, z] of spans) rest = `${rest.slice(0, a)} ${rest.slice(z)}`;
  rest = rest.replace(/\s+/g, ' ').trim();

  const add = day === 'tomorrow' ? 1 : day === 'after' ? 2 : 0;
  const at = (hours, plus = add) => { const d = new Date(now); d.setHours(hours, m, 0, 0); d.setDate(d.getDate() + plus); return d; };
  let hours;
  if (mer === 'pm') hours = h < 12 ? h + 12 : h;
  else if (mer === 'am') hours = h === 12 ? 0 : h;
  else if (h >= 13 || h === 0) hours = h;
  else if (add) hours = h === 12 ? 12 : h <= 4 ? h + 12 : h; // "mañana a las 7": the morning; "a las 3": the afternoon
  else hours = [h % 12, (h % 12) + 12].find((x) => at(x) > now) ?? (h === 12 ? 0 : h <= 4 ? h + 12 : h); // the next one that comes (else tomorrow's: a 3 is the afternoon, a 7 the morning)
  let when = at(hours);
  if (when <= now) {
    if (day === 'today') return { at: when, rest, past: true };
    when = at(hours, add + 1);
  }
  return { at: when, rest, past: false };
}

// "7 p. m.", "7:30 a. m.", with "mañana" when it's tomorrow: how she says a time
function clockText(at, lang, now = new Date(), noDay = false) {
  const es = lang === 'es';
  const h = at.getHours();
  const h12 = h % 12 || 12;
  const mm = at.getMinutes();
  const time = !mm && h === 0 ? (es ? 'medianoche' : 'midnight') : !mm && h === 12 ? (es ? 'mediodía' : 'noon')
    : `${h12}${mm ? `:${String(mm).padStart(2, '0')}` : ''} ${es ? (h < 12 ? 'a. m.' : 'p. m.') : (h < 12 ? 'AM' : 'PM')}`;
  const special = !mm && (h === 0 || h === 12);
  const days = Math.round((new Date(at).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / 864e5);
  const day = noDay ? '' : days === 1 ? (es ? 'mañana ' : 'tomorrow ') : days > 1 ? (es ? 'pasado mañana ' : 'the day after tomorrow ') : '';
  if (special) return es ? `${day}a ${time}` : `${day}at ${time}`;
  return es ? `${day}a la${h12 === 1 ? '' : 's'} ${time}` : `${day}at ${time}`;
}

// ---- something to do then: "abre Spotify", "pon Bad Bunny", "open Figma" -------------------------------
// { type: 'open', value: 'Spotify' } or { type: 'music', value: 'Bad Bunny' } (null: it's not that)
const OPEN_VERB = /^(?:(?:quiero|necesito|puedes|podrias|por favor|que|haz que|can you|i want you to|please|to)\s+)*(?:abr(?:e|as|ir|a)|inici(?:a|es|ar)|ejecut(?:a|es|ar)|lanz(?:a|ar)|lances|open|launch|start|run)\s+(.+)$/;
const PLAY_VERB = /^(?:(?:quiero|necesito|puedes|podrias|por favor|que|haz que|can you|i want you to|please|to)\s+)*(?:pon(?:gas|er|ga)?|toca(?:r|s)?|toques|reproduc(?:e|ir)|reproduzcas|play)\s+(.+)$/;
function actionOf(rest) {
  if (/[a-z0-9-]+\.[a-z]{2,}\b/i.test(rest)) return null; // a website is for her chat, behind a button
  const f = fold(rest.replace(/[¿?¡!.,;:]+/g, ' ').replace(/\b(?:alarm\w*|temporizador\w*|recordatorio\w*|timer\w*)\b/gi, ' ').replace(/\s+/g, ' ').trim()).replace(/^(?:capri\s+)+/, '').replace(/^(?:(?:en|dentro de|in|y|luego|then|entonces)\s+)+/, '');
  const clean = (v) => v.replace(/^(?:la |el |los |las |una |un |the |a |app de |aplicaci[oó]n de |app |programa |juego |m[uú]sica de |m[uú]sica |canci[oó]n |song |some )+/i, '').replace(/\s+(?:en|on)\s+spotify$/i, '').trim();
  const open = OPEN_VERB.exec(f)?.[1];
  const play = !open && PLAY_VERB.exec(f)?.[1];
  const raw = open || play;
  if (!raw) return null;
  // the name as you said it (with accents and capitals), cut by the same words
  const original = rest.replace(/[¿?¡!.,;:]+/g, ' ').replace(/\b(?:alarm\w*|temporizador\w*|recordatorio\w*|timer\w*)\b/gi, ' ').replace(/\s+/g, ' ').trim().replace(/^(?:capri\s+)+/i, '').replace(/^(?:(?:en|dentro de|in|y|luego|then|entonces)\s+)+/i, '');
  // just the first thing: "… y luego …" isn't scheduled
  const value = clean(original.slice(original.length - raw.length)).split(/\s+(?:y luego|y despu[eé]s|luego|despu[eé]s|and then|then)\s+/i)[0].trim();
  if (!value) return null;
  return { type: open ? 'open' : 'music', value };
}

// ---- repeating: "todos los días", "de lunes a viernes", "los lunes y miércoles" --------------------
const DAYS = { domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6, sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
const DAY_NAMES = '(?:domingo|lunes|martes|miercoles|jueves|viernes|sabado|sunday|monday|tuesday|wednesday|thursday|friday|saturday)s?';
const EVERY_DAY = /\b(?:todos los dias|cada dia|diariamente|diario|every ?day|daily)\b/;
const WEEKDAYS = /\b(?:de lunes a viernes|entre semana|dias de semana|dias laborales|dias habiles|weekdays|monday to friday|monday through friday)\b/;
const WEEKENDS = /\b(?:(?:los )?fines de semana|weekends?|sabados y domingos)\b/;
const SOME_DAYS = new RegExp(`\\b(?:(?:todos )?los|cada|every|on)\\s+${DAY_NAMES}(?:\\s*(?:,|y|and)\\s*(?:los\\s+)?${DAY_NAMES})*\\b`);
const ALL = [0, 1, 2, 3, 4, 5, 6];

// { days: [0..6], rest } when the message repeats (days: 0 is Sunday), else null
function repeatOf(text) {
  const f = fold(text);
  let days = null;
  let hit = null;
  if ((hit = EVERY_DAY.exec(f))) days = ALL;
  else if ((hit = WEEKDAYS.exec(f))) days = [1, 2, 3, 4, 5];
  else if ((hit = WEEKENDS.exec(f))) days = [0, 6];
  else if ((hit = SOME_DAYS.exec(f))) {
    days = [...new Set([...hit[0].matchAll(new RegExp(DAY_NAMES, 'g'))].map((m) => (DAYS[m[0]] ?? DAYS[m[0].replace(/s$/, '')])))].filter((d) => d !== undefined);
    if (!days.length) return null;
  } else {
    return null;
  }
  const rest = `${text.slice(0, hit.index)} ${text.slice(hit.index + hit[0].length)}`.replace(/\s+/g, ' ').trim();
  return { days: [...days].sort(), rest };
}

// the first day on the list at or after this moment
function onDays(at, days, now) {
  const d = new Date(at);
  for (let i = 0; i < 8 && (!days.includes(d.getDay()) || d <= now); i++) d.setDate(d.getDate() + 1);
  return d;
}

// "todos los días", "de lunes a viernes", "los lunes y miércoles"
function repeatText(days, lang) {
  const es = lang === 'es';
  if (days.length === 7) return es ? 'todos los días' : 'every day';
  if (days.join() === '1,2,3,4,5') return es ? 'de lunes a viernes' : 'on weekdays';
  if (days.join() === '0,6') return es ? 'los fines de semana' : 'on weekends';
  const names = es ? ['domingos', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábados'] : ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];
  const list = days.map((d) => names[d]);
  const last = list.pop();
  return `${es ? 'los ' : 'on '}${list.length ? `${list.join(', ')} ${es ? 'y' : 'and'} ` : ''}${last}`;
}

export class Timers {
  // onFire(item, text, next): item = what rang, text = what she says, next = what starts after it (pomodoro)
  constructor({ lang = 'es', onFire, onChange }) {
    this.lang = lang;
    this.onFire = onFire;
    this.onChange = onChange;
    this.items = [];
    this.seq = 0;
    this.timer = setInterval(() => this.check(), 1000);
  }

  get t() {
    return linesFor(this.lang);
  }

  // timers saved by the last run: the ones still to come
  restore(saved) {
    const now = Date.now();
    this.missed = []; // what should have rung while she was closed (the app tells you)
    for (const item of Array.isArray(saved) ? saved : []) {
      if (!item || !['timer', 'work', 'break', 'action'].includes(item.kind)) continue;
      if (item.end > now) {
        this.items.push({ ...item, id: ++this.seq });
        continue;
      }
      if (item.kind === 'work' || item.kind === 'break') continue; // a pomodoro that ended is stale
      if (now - item.end < 36 * 3600e3) this.missed.push({ label: item.label, kind: item.kind, at: item.at, end: item.end });
      if (item.repeat?.length) { // it comes back on its next day
        const at = new Date(item.end);
        at.setDate(at.getDate() + 1);
        this.items.push({ ...item, id: ++this.seq, end: onDays(at, item.repeat, new Date()).getTime() });
      }
    }
    if (this.missed.length || saved?.length) this.onChange?.(this.items);
  }

  add(item) {
    const made = { id: ++this.seq, ...item, end: item.end ?? Date.now() + item.ms };
    this.items.push(made);
    this.onChange?.(this.items);
    return made;
  }

  remove(item) {
    this.items = this.items.filter((i) => i.id !== item.id);
    this.onChange?.(this.items);
  }

  clear() {
    const n = this.items.length;
    this.items = [];
    this.onChange?.(this.items);
    return n;
  }

  check() {
    const now = Date.now();
    const due = this.items.filter((i) => i.end <= now);
    if (!due.length) return;
    this.items = this.items.filter((i) => i.end > now);
    for (const item of due) this.ring(item);
    this.onChange?.(this.items);
  }

  // it rang; a pomodoro goes on by itself: focus, break (a long one every fourth), focus…
  ring(item) {
    const t = this.t;
    let next = null;
    let text;
    if (item.kind === 'work') {
      const long = item.cycle % BREAKS.rounds === 0;
      const min = long ? BREAKS.long : BREAKS.short;
      next = this.add({ kind: 'break', ms: min * MIN, cycle: item.cycle, work: item.work });
      text = t.fireWork(min, long);
    } else if (item.kind === 'break') {
      next = this.add({ kind: 'work', ms: item.work * MIN, cycle: item.cycle + 1, work: item.work });
      text = t.fireBreak(item.work);
    } else if (item.kind === 'action') {
      text = t.fireAlarm(item.label);
    } else {
      text = item.at ? t.fireAlarm(item.label) : t.fire(item.label);
    }
    if (item.repeat?.length && (item.kind === 'timer' || item.kind === 'action')) { // comes back on its next day
      const { id, ...again } = item;
      const at = new Date(item.end);
      at.setDate(at.getDate() + 1);
      this.add({ ...again, end: onDays(at, item.repeat, new Date()).getTime() });
    }
    this.onFire?.(item, text, next);
  }

  // What the message asks for, if it's about timers: { line, face } (null: not about them, ask the model)
  handle(raw, now = new Date()) {
    const text = String(raw || '').replace(/\s+/g, ' ').trim();
    if (!text) return null;
    const t = this.t;
    const words = text.split(' ').length;
    const hasTimerWord = TIMER_WORD.test(text) || POMODORO.test(text);

    const asksLeft = STATUS.test(text) && (hasTimerWord || words <= 3);
    if (CANCEL.test(text) && !asksLeft && (hasTimerWord || (this.items.length && /\btodo\b|\ball\b|\bthem\b/i.test(text)))) {
      const n = this.clear();
      return { line: n ? t.cancelled(n) : t.none, face: 'smug' };
    }
    if (asksLeft && (hasTimerWord || this.items.length)) {
      if (!this.items.length) return { line: t.none, face: 'aside' };
      const now = Date.now();
      return {
        line: t.status(this.items.map((i) => ({
          name: i.kind === 'work' ? t.nameWork : i.kind === 'break' ? t.nameBreak : i.kind === 'action' ? t.nameAction(i.action) : i.label || (i.at ? t.nameAlarm : t.nameTimer),
          time: i.at ? clockText(new Date(i.end), this.lang, new Date(now)) : left(i.end - now, this.lang),
        }))),
        face: 'look',
      };
    }
    if (POMODORO.test(text)) {
      const work = Math.round((duration(text) / MIN) || BREAKS.work);
      this.clear();
      this.add({ kind: 'work', ms: work * MIN, cycle: 1, work });
      return { line: t.pomodoro(work), face: 'grin' };
    }
    // when: a time of day, or a stretch of time from now ("todos los días a las 8" repeats)
    const again = repeatOf(text);
    if (again && !clock(again.rest, now)) return { line: t.repeatNeedsTime, face: 'aside' };
    const day = again ? clock(again.rest, now) : clock(text, now);
    if (again && day) day.at = onDays(day.at, again.days, now);
    if (again && day) day.past = false;
    if (day?.past) return { line: t.past, face: 'aside' };
    const ms = day ? 0 : duration(text);
    if (!day && (!ms || ms < 1000 || ms > 24 * 3600e3)) return null;
    const rest = day ? day.rest : text.replace(HALF, ' ').replace(DURATION, ' ');
    const repeat = again?.days;
    const end = day ? day.at.getTime() : now.getTime() + ms;
    const when = repeat ? `${repeatText(repeat, this.lang)} ${clockText(day.at, this.lang, now, true)}` : day ? clockText(day.at, this.lang, now) : (this.lang === 'es' ? 'en ' : 'in ') + left(ms, this.lang);

    // "a las 8 abre Spotify", "en 10 minutos pon Bad Bunny": something for her to do then
    const action = actionOf(rest);
    if (action) {
      const what = action.type === 'open' ? t.actionOpen(action.value) : t.actionMusic(action.value);
      const label = action.type === 'open' ? action.value : action.value;
      const item = this.add({ kind: 'action', end, label, action, at: Boolean(day), ...(repeat && { repeat }) });
      const check = this.verify ? this.verify(action) : null; // is there such an app?
      return { line: t.action(when, what), face: 'smug', item, check, missing: t.notFound(action.value) };
    }

    // "alarma a las 7", "recuérdame llamar a mi mamá a las 5 pm", "temporizador de 10 minutos", or just "25 minutos"
    const plain = text.replace(/[¿?¡!.,;:]+/g, ' ').replace(/^\s*capri\s+/i, '').replace(/\s+/g, ' ').trim();
    const bare = !day && words <= 5 && /^(en |por |de |dentro de |in |for )?[\d\w.,]+ [a-zñ]+( y media)?$/i.test(plain);
    if (!hasTimerWord && !bare) return null;
    const label = REMIND.test(text) ? reminder(rest) : '';
    this.add({ kind: 'timer', end, label, at: Boolean(day), ...(repeat && { repeat }) });
    if (day) return { line: t.startedAt(when, label), face: 'laugh' };
    const d = left(ms, this.lang);
    return { line: label ? t.startedFor(d, label) : t.started(d), face: 'laugh' };
  }
}
