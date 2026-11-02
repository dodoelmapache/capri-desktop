// Her planner, by voice or typing, never through the model:
//   · project stopwatch: "empieza a contar el proyecto Totem", "para", "cuánto llevo", "cuánto he trabajado hoy"
//   · deadlines: "entrega del logo el viernes", "mis entregas", "borra la entrega del logo"
//   · voice notes: "anota comprar tinta", "lee mis notas" (a file on your Desktop)
//   · day summary: "buenos días", "resumen del día", "qué tengo hoy"
//   · "qué MCP tengo" (the programs Claude Code is connected to)
// Spanish first, English too. app.js gives her the host, the timers and the mission log.

const FROM = 'áéíóúüñÁÉÍÓÚÜÑ';
const TO = 'aeiouunaeiouun';
// lowercase, no accents, SAME LENGTH (so a position in this is a position in what you said)
const flat = (s) => String(s).replace(/[áéíóúüñÁÉÍÓÚÜÑ]/g, (c) => TO[FROM.indexOf(c)]).toLowerCase();
const clean = (s) => String(s).replace(/^[\s,.:;¿?¡!-]+|[\s,.:;¿?¡!-]+$/g, '').replace(/\s+/g, ' ');

const MONTHS = { enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5, julio: 6, agosto: 7, septiembre: 8, setiembre: 8, octubre: 9, noviembre: 10, diciembre: 11, january: 0, february: 1, march: 2, april: 3, may: 4, june: 5, july: 6, august: 7, september: 8, october: 9, november: 10, december: 11 };
const WEEK = { domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6, sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
const CAP = 10 * 3600e3; // a stopwatch left running overnight doesn't count more than this
const MONTH_RE = Object.keys(MONTHS).join('|');
const WEEK_RE = Object.keys(WEEK).join('|');

const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const midnight = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const daysBetween = (a, b) => Math.round((midnight(b) - midnight(a)) / 864e5);

// "viernes", "el 15 de noviembre", "30/11", "mañana", "en 3 días" → { date, rest } (rest keeps your own words)
function dateOf(text, now = new Date()) {
  const f = flat(text);
  const today = midnight(now);
  const cut = (m, date) => ({ date, rest: clean(`${text.slice(0, m.index)} ${text.slice(m.index + m[0].length)}`) });
  let m;
  if ((m = new RegExp(`(?:\\bel\\s+|\\bthe\\s+|\\bon\\s+)?\\b(\\d{1,2})(?:\\s+de|\\s+of)?\\s+(${MONTH_RE})(?:\\s+(?:de|of)\\s+(\\d{4}))?\\b`).exec(f))) {
    let d = new Date(m[3] ? +m[3] : today.getFullYear(), MONTHS[m[2]], +m[1]);
    if (!m[3] && d < today) d = new Date(d.getFullYear() + 1, d.getMonth(), d.getDate());
    return cut(m, d);
  }
  if ((m = new RegExp(`\\b(${MONTH_RE})\\s+(\\d{1,2})\\b`).exec(f))) {
    let d = new Date(today.getFullYear(), MONTHS[m[1]], +m[2]);
    if (d < today) d = new Date(d.getFullYear() + 1, d.getMonth(), d.getDate());
    return cut(m, d);
  }
  if ((m = /(?:\bel\s+)?\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/.exec(f))) {
    let y = m[3] ? +m[3] : today.getFullYear();
    if (y < 100) y += 2000;
    let d = new Date(y, +m[2] - 1, +m[1]);
    if (!m[3] && d < today) d = new Date(d.getFullYear() + 1, d.getMonth(), d.getDate());
    return cut(m, d);
  }
  if ((m = /\b(pasado manana|day after tomorrow)\b/.exec(f))) return cut(m, new Date(today.getTime() + 2 * 864e5));
  if ((m = /\b(manana|tomorrow)\b/.exec(f))) return cut(m, new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1));
  if ((m = /\b(hoy|today)\b/.exec(f))) return cut(m, today);
  if ((m = /\b(?:en|in)\s+(\d{1,3})\s+(?:dias?|days?)\b/.exec(f))) return cut(m, new Date(today.getFullYear(), today.getMonth(), today.getDate() + +m[1]));
  if ((m = /\b(?:en|in)\s+(?:una|1|one)\s+(?:semana|week)\b/.exec(f))) return cut(m, new Date(today.getFullYear(), today.getMonth(), today.getDate() + 7));
  if ((m = new RegExp(`(?:\\b(?:el|este|proximo|next|on|this)\\s+)?\\b(${WEEK_RE})\\b`).exec(f))) {
    const ahead = (WEEK[m[1]] - today.getDay() + 7) % 7 || 7;
    return cut(m, new Date(today.getFullYear(), today.getMonth(), today.getDate() + ahead));
  }
  if ((m = /\bel\s+(\d{1,2})\b/.exec(f)) && +m[1] >= 1 && +m[1] <= 31) {
    let d = new Date(today.getFullYear(), today.getMonth(), +m[1]);
    if (d < today) d = new Date(today.getFullYear(), today.getMonth() + 1, +m[1]);
    return cut(m, d);
  }
  return null;
}

const NAMES = {
  es: { days: ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'], months: ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'] },
  en: { days: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'], months: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] },
};

const T = {
  es: {
    dur: (ms) => {
      const min = Math.round(ms / 60e3);
      if (min < 1) return 'menos de un minuto';
      const h = Math.floor(min / 60);
      return h ? `${h} h${min % 60 ? ` ${min % 60} min` : ''}` : `${min} min`;
    },
    date: (d, n) => `${n.days[d.getDay()]} ${d.getDate()} de ${n.months[d.getMonth()]}`,
    when: (k) => (k < 0 ? `hace ${-k} ${k === -1 ? 'día' : 'días'}` : k === 0 ? 'hoy' : k === 1 ? 'mañana' : `en ${k} días`),
    started: (p) => `Va, cuento el tiempo de ${p}. Dime “para” cuando termines.`,
    switched: (p, q, ms) => `Cerré ${q} con ${ms}. Ahora cuento ${p}.`,
    already: (p) => `Ya estoy contando ${p}.`,
    stopped: (p, ms, total) => `Listo, ${p}: ${ms} esta vez, ${total} hoy.`,
    nothing: 'No estoy contando ningún proyecto. Dime “empieza a contar el proyecto…”.',
    running: (p, ms, total) => `Llevas ${ms} en ${p} esta vez, ${total} hoy.`,
    totalToday: (list) => (list.length ? `Hoy: ${list.join(', ')}.` : 'Hoy no has contado tiempo de ningún proyecto.'),
    totalWeek: (list) => (list.length ? `Esta semana: ${list.join(', ')}.` : 'Esta semana no hay tiempo contado.'),
    noName: '¿De qué proyecto? Dime “empieza a contar el proyecto Totem”.',
    dlAdded: (l, d, w) => `Anotada la entrega: ${l}, ${d} (${w}). Te aviso antes.`,
    dlNoDate: '¿Para cuándo es? Dime la fecha: “el viernes”, “el 15 de noviembre”, “mañana”.',
    dlNone: 'No tienes entregas anotadas.',
    dlList: (items) => `Tus entregas: ${items.join('; ')}.`,
    dlRemoved: (l) => `Borrada la entrega: ${l}.`,
    dlMissing: 'No encuentro esa entrega.',
    dlRemind: (l, k, d) => `Ojo con la entrega “${l}”: ${k < 0 ? `venció ${d}` : k === 0 ? 'es hoy' : k === 1 ? 'es mañana' : `es ${d}`}.`,
    sendOpened: 'Abierta la carpeta «Para enviar». Arrastra su contenido a Blip.',
    sendFail: (e) => `No pude abrir la carpeta: ${e}`,
    orgRunning: 'Voy, organizando tus archivos…',
    orgDone: (n) => (n ? `Listo, moví ${n} ${n === 1 ? 'archivo' : 'archivos'} a Organizacion Claude.` : 'Revisé tus carpetas: no había nada por organizar.'),
    orgFail: (e) => `No pude organizar: ${e}`,
    noteGone: (n) => `Borrada: ${n}.`,
    notesGone: (k) => `Listo, borré ${k} ${k === 1 ? 'nota' : 'notas'}.`,
    notesSure: (k) => `¿Seguro? Son ${k} ${k === 1 ? 'nota' : 'notas'}. Dime “sí, borra las notas” para confirmar.`,
    noteNoMatch: 'No encuentro esa nota.',
    noteSaved: 'Anotado.',
    noteSavedIn: (p) => `Anotado en ${p}.`,
    noteFail: 'No pude guardar la nota.',
    noNotes: 'No tienes notas todavía.',
    notes: (list) => `Tus últimas notas: ${list.join('; ')}.`,
    noteAsk: '¿Qué anoto? Dime “anota comprar tinta”.',
    mcpFail: 'No pude leer tus MCP (¿está claude en el PATH?).',
    mcpNone: 'Claude Code no tiene ningún MCP configurado.',
    mcpList: (ok, bad) => `Claude Code tiene ${ok.length + bad.length} MCP. Conectados: ${ok.join(', ') || 'ninguno'}.${bad.length ? ` Sin conexión: ${bad.join(', ')}.` : ''} Pídeme algo con “dile a Claude que… en Figma”.`,
    hello: ['Buenos días', 'Buen día'],
    hi: (name) => `${name ? `${name}, ` : ''}`,
    morning: (name) => `Buenos días${name ? `, ${name}` : ''}.`,
    evening: (name) => `Cerramos el día${name ? `, ${name}` : ''}.`,
    nothingToday: 'No tienes nada agendado.',
    nTimers: (n) => `${n} ${n === 1 ? 'aviso o alarma pendiente' : 'avisos o alarmas pendientes'}`,
    inDeadlines: (list) => `Entregas: ${list.join('; ')}.`,
    worked: (s) => `Llevas contado ${s}.`,
    workedYesterday: (s) => `Ayer contaste ${s}.`,
    missionDay: (d) => `Claude terminó ${d.missions} ${d.missions === 1 ? 'tarea' : 'tareas'} hoy.`,
  },
  en: {
    dur: (ms) => {
      const min = Math.round(ms / 60e3);
      if (min < 1) return 'under a minute';
      const h = Math.floor(min / 60);
      return h ? `${h} h${min % 60 ? ` ${min % 60} min` : ''}` : `${min} min`;
    },
    date: (d, n) => `${n.days[d.getDay()]}, ${n.months[d.getMonth()]} ${d.getDate()}`,
    when: (k) => (k < 0 ? `${-k} ${k === -1 ? 'day' : 'days'} ago` : k === 0 ? 'today' : k === 1 ? 'tomorrow' : `in ${k} days`),
    started: (p) => `On it, timing ${p}. Say “stop” when you're done.`,
    switched: (p, q, ms) => `Closed ${q} at ${ms}. Now timing ${p}.`,
    already: (p) => `Already timing ${p}.`,
    stopped: (p, ms, total) => `Done, ${p}: ${ms} this time, ${total} today.`,
    nothing: "I'm not timing any project. Say “start timing project…”.",
    running: (p, ms, total) => `${ms} on ${p} this time, ${total} today.`,
    totalToday: (list) => (list.length ? `Today: ${list.join(', ')}.` : 'No project time counted today.'),
    totalWeek: (list) => (list.length ? `This week: ${list.join(', ')}.` : 'No time counted this week.'),
    noName: 'Which project? Say “start timing project Totem”.',
    dlAdded: (l, d, w) => `Deadline saved: ${l}, ${d} (${w}). I'll warn you ahead.`,
    dlNoDate: 'Due when? Give me a date: “Friday”, “November 15th”, “tomorrow”.',
    dlNone: 'You have no deadlines saved.',
    dlList: (items) => `Your deadlines: ${items.join('; ')}.`,
    dlRemoved: (l) => `Deleted the deadline: ${l}.`,
    dlMissing: "I can't find that deadline.",
    dlRemind: (l, k, d) => `Heads up, “${l}”: ${k < 0 ? `was due ${d}` : k === 0 ? 'due today' : k === 1 ? 'due tomorrow' : `due ${d}`}.`,
    sendOpened: 'Opened the “Para enviar” folder. Drag its contents into Blip.',
    sendFail: (e) => `Couldn't open the folder: ${e}`,
    orgRunning: 'On it, organizing your files…',
    orgDone: (n) => (n ? `Done, moved ${n} ${n === 1 ? 'file' : 'files'} to Organizacion Claude.` : 'Checked your folders: nothing to organize.'),
    orgFail: (e) => `Couldn't organize: ${e}`,
    noteGone: (n) => `Deleted: ${n}.`,
    notesGone: (k) => `Done, deleted ${k} ${k === 1 ? 'note' : 'notes'}.`,
    notesSure: (k) => `Sure? That's ${k} ${k === 1 ? 'note' : 'notes'}. Say “yes, delete the notes” to confirm.`,
    noteNoMatch: "I can't find that note.",
    noteSaved: 'Noted.',
    noteSavedIn: (p) => `Noted under ${p}.`,
    noteFail: "Couldn't save the note.",
    noNotes: 'No notes yet.',
    notes: (list) => `Your latest notes: ${list.join('; ')}.`,
    noteAsk: 'What should I note? Say “note buy ink”.',
    mcpFail: "Couldn't read your MCP servers (is claude on the PATH?).",
    mcpNone: 'Claude Code has no MCP servers set up.',
    mcpList: (ok, bad) => `Claude Code has ${ok.length + bad.length} MCP servers. Connected: ${ok.join(', ') || 'none'}.${bad.length ? ` Offline: ${bad.join(', ')}.` : ''} Ask me with “tell Claude to … in Figma”.`,
    morning: (name) => `Good morning${name ? `, ${name}` : ''}.`,
    evening: (name) => `Wrapping up the day${name ? `, ${name}` : ''}.`,
    nothingToday: 'Nothing scheduled.',
    nTimers: (n) => `${n} pending ${n === 1 ? 'reminder or alarm' : 'reminders or alarms'}`,
    inDeadlines: (list) => `Deadlines: ${list.join('; ')}.`,
    worked: (s) => `Counted so far: ${s}.`,
    workedYesterday: (s) => `Yesterday you counted ${s}.`,
    missionDay: (d) => `Claude finished ${d.missions} ${d.missions === 1 ? 'task' : 'tasks'} today.`,
  },
};

// what you say, in the shapes she understands
const START = /^(?:capri[\s,]+)?(?:(?:empieza|empiezo|inicia|arranca|comienza|comenzar|start)\s+(?:a\s+)?(?:contar|cronometrar|medir|tracking|timing|track|time)(?:\s+(?:el\s+)?tiempo)?\s+(?:del?\s+|en\s+|on\s+|of\s+)?(?:(?:el|mi|the|my)\s+)?(?:proyecto\s+|project\s+)?|(?:voy\s+a\s+)?(?:trabajar|trabajo|empezar|empiezo|arrancar)\s+(?:en|con)\s+(?:(?:el|mi|la)\s+)?(?:proyecto\s+)?|cuenta\s+(?:el\s+)?tiempo\s+(?:del?\s+)?(?:(?:el|mi)\s+)?(?:proyecto\s+)?)(.+)$/i;
const STOP = /^(?:capri[\s,]+)?(?:(?:para|det[eé]n|detener|termina|terminar|cierra|stop|pausa|pause)\s+(?:de\s+|el\s+|la\s+|the\s+)?(?:contar|conteo|cron[oó]metro|proyecto|tiempo|tracking|timing|timer|time)|ya\s+termin[eé]|termin[eé]\s+(?:con|el)\s+(?:el\s+)?proyecto|para\s+de\s+contar|stop(?:\s+(?:the\s+)?(?:project|tracking|timing))?|para)\b.*$/i;
const HOW_LONG = /\b(?:cu[aá]nto\s+(?:tiempo\s+)?llevo|cu[aá]nto\s+he\s+(?:trabajado|llevado)|how\s+long\s+(?:have\s+i|has\s+it)|how\s+much\s+(?:time|have\s+i\s+worked))\b/i;
const DEADLINE_ADD = /^(?:capri[\s,]+)?(?:(?:tengo\s+)?(?:una\s+|un\s+)?(?:entrega|deadline|fecha\s+l[ií]mite|due\s+date)\s*(?:de(?:l)?\s+|para\s+|is\s+|:\s*)?|(?:an[oó]tame|agenda|apunta|a[nñ]ade|agrega|add|save)\s+(?:la\s+|una\s+|a\s+)?(?:entrega|deadline)\s*(?:de(?:l)?\s+|para\s+)?|(?:tengo\s+que\s+entregar|debo\s+entregar|hay\s+que\s+entregar|i\s+(?:have|need)\s+to\s+(?:deliver|submit))\s+)(.+)$/i;
const DEADLINE_LIST = /\b(?:mis\s+entregas|qu[eé]\s+entregas\s+tengo|cu[aá]les\s+(?:son\s+)?(?:mis\s+)?entregas|lista\s+de\s+entregas|my\s+deadlines|what\s+deadlines|list\s+(?:my\s+)?deadlines)\b/i;
const DEADLINE_DEL = /^(?:capri[\s,]+)?(?:borra|elimina|quita|cancela|ya\s+entregu[eé]|delete|remove)\s+(?:la\s+)?(?:entrega|deadline)\s*(?:de(?:l)?\s+)?(.*)$/i;
const NOTE = /^(?:capri[\s,]+)?(?:(?:an[oó]ta(?:me)?|apunta(?:me)?|toma\s+nota|guarda\s+(?:esta\s+|una\s+)?nota|nota\s+de\s+voz|nota|note|take\s+a\s+note)\s*(?:que\s+|de\s+|to\s+|that\s+)?[:,]?\s*)(.*)$/i;
const OPEN_SEND = /^(?:capri[\s,]+)?(?:abre|abrir|open|muestra)\s+(?:la\s+|my\s+|the\s+)?carpeta\s+(?:de\s+|para\s+)?(?:env[ií]o|enviar|blip)|^(?:capri[\s,]+)?open\s+(?:the\s+)?(?:send|blip)\s+folder/i;
// "organiza mis archivos" in the ways it gets said (typed or by voice): with a small run-up ("oye capri, puedes...") and a small tail ("por favor"),
// but short: inside a longer sentence ("cómo organizo mis archivos en carpetas") it is a question, not an order, and files are not moved
const ORGANIZE = /^(?:(?:oye|hey|ok|vale|dale|capri|por\s+favor|please|can\s+you|could\s+you|puedes|podr[ií]as|me\s+puedes|me\s+podr[ií]as|quiero\s+que|necesito\s+que|ahora|ya)[\s,]+)*(?:organiza(?:r|me)?|ord[eé]na(?:me|r)?|limpia(?:r|me)?|organize|clean\s*up|tidy(?:\s+up)?)\s+(?:(?:todos\s+)?(?:mis?|los|las|el|la|my|all\s+my|the)\s+)?(?:archivos|files|escritorio|desktop|descargas|downloads|carpetas|folders)\b[\s\S]{0,30}$/i;
const NOTE_DEL_ALL = /^(?:capri[\s,]+)?(?:borra|elimina|vac[ií]a|limpia|delete|clear)\s+(?:todas\s+)?(?:mis\s+|las\s+|all\s+(?:my\s+)?|my\s+)?notas?\b(?!\s+de\b)|^(?:capri[\s,]+)?(?:delete|clear)\s+(?:all\s+)?(?:my\s+)?notes\b/i;
const NOTE_DEL_LAST = /^(?:capri[\s,]+)?(?:borra|elimina|quita|delete|remove)\s+(?:la\s+)?(?:[uú]ltima|last)\s+nota\b|^(?:capri[\s,]+)?(?:delete|remove)\s+(?:the\s+)?last\s+note\b/i;
const NOTE_DEL_ONE = /^(?:capri[\s,]+)?(?:borra|elimina|quita|delete|remove)\s+(?:la\s+)?(?:nota|note)\s+(?:de(?:l)?\s+|sobre\s+|about\s+|with\s+)?(.+)$/i;
const YES_DEL = /^(?:capri[\s,]+)?(?:s[ií]|dale|confirmo|yes|ok)\b.*\bnotas?\b|^(?:capri[\s,]+)?(?:yes|s[ií])[\s,]+(?:delete|borra)/i;
const NOTES_READ = /\b(?:l[eé]eme\s+mis\s+notas|lee\s+mis\s+notas|mis\s+notas|qu[eé]\s+(?:notas\s+)?(?:anot[eé]|tengo\s+anotado)|read\s+my\s+notes|my\s+notes)\b/i;
const BRIEF = /^(?:capri[\s,]+)?(?:buenos\s+d[ií]as|buen\s+d[ií]a|good\s+morning)\b|\b(?:resumen\s+del\s+d[ií]a|resumen\s+de\s+hoy|qu[eé]\s+tengo\s+(?:hoy|para\s+hoy|pendiente)|c[oó]mo\s+va\s+(?:mi\s+)?(?:el\s+)?d[ií]a|daily\s+summary|what(?:'s| is)\s+(?:on\s+)?(?:for\s+)?today|what\s+do\s+i\s+have\s+today)\b/i;
const WRAP = /\b(?:cierre\s+del\s+d[ií]a|resumen\s+de\s+la\s+noche|buenas\s+noches|cerramos\s+el\s+d[ií]a|wrap\s+up\s+(?:the\s+)?day|end\s+of\s+day)\b/i;
const MCP = /\b(?:qu[eé]\s+mcp|cu[aá]les\s+(?:son\s+)?(?:mis\s+)?mcp|mis\s+mcp|a\s+qu[eé]\s+(?:programas|apps|aplicaciones)\s+(?:te\s+)?(?:conectas|puedes\s+conectar|tienes\s+acceso)|con\s+qu[eé]\s+(?:programas|apps)\s+(?:puedes\s+)?(?:trabajar|conectar)|what\s+mcp|which\s+mcp|list\s+(?:my\s+)?mcp)/i;
const TOTAL = /\b(?:cu[aá]nto\s+(?:he\s+)?trabajado|cu[aá]nto\s+tiempo\s+(?:llevo|he\s+(?:trabajado|llevado))\s+(?:hoy|esta\s+semana)|tiempo\s+(?:de\s+)?(?:hoy|de\s+la\s+semana)|how\s+much\s+(?:have\s+i\s+)?worked)\b/i;

export class Planner {
  constructor({ host, timers = null, mission = null, lang = 'es', name = '' } = {}) {
    this.host = host;
    this.timers = timers;
    this.mission = mission;
    this.lang = lang;
    this.name = name;
    this.state = { active: null, totals: {}, deadlines: [], briefed: {} }; // totals: { project: { 'YYYY-MM-DD': ms } }
    this.onRemind = null; // (line) the app says it out loud
  }

  get t() {
    return T[this.lang === 'en' ? 'en' : 'es'];
  }
  get names() {
    return NAMES[this.lang === 'en' ? 'en' : 'es'];
  }

  restore(saved) {
    if (!saved || typeof saved !== 'object') return;
    this.state = { active: saved.active || null, totals: saved.totals || {}, deadlines: saved.deadlines || [], briefed: saved.briefed || {} };
  }
  save() {
    this.host.setConfig({ planner: this.state });
  }

  // ---- stopwatch --------------------------------------------------------------------------------
  add(project, from, to) {
    // time is kept on the day it started; a session that crosses midnight is cut there
    let a = from;
    while (a < to) {
      const end = Math.min(to, midnight(new Date(a)).getTime() + 864e5);
      const k = dayKey(new Date(a));
      const row = (this.state.totals[project] ||= {});
      row[k] = (row[k] || 0) + (end - a);
      a = end;
    }
  }
  spent(project, day) {
    return this.state.totals[project]?.[day] || 0;
  }
  closeActive(now = Date.now()) {
    const a = this.state.active;
    if (!a) return null;
    const to = Math.min(now, a.since + CAP);
    this.add(a.name, a.since, to);
    this.state.active = null;
    return { name: a.name, ms: to - a.since, total: this.spent(a.name, dayKey(new Date(now))) };
  }
  // today's (or this week's) time for every project, biggest first, as "Totem 2 h 10 min"
  summary(span, now = new Date()) {
    const keys = new Set();
    const n = span === 'week' ? 7 : 1;
    for (let i = 0; i < n; i++) keys.add(dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)));
    const rows = Object.entries(this.state.totals).map(([name, days]) => {
      let ms = [...keys].reduce((s, k) => s + (days[k] || 0), 0);
      if (this.state.active?.name === name) ms += Math.max(0, Math.min(now.getTime(), this.state.active.since + CAP) - Math.max(this.state.active.since, midnight(new Date(now.getTime() - (n - 1) * 864e5)).getTime()));
      return { name, ms };
    });
    if (this.state.active && !this.state.totals[this.state.active.name]) rows.push({ name: this.state.active.name, ms: Math.min(now.getTime(), this.state.active.since + CAP) - this.state.active.since });
    return rows.filter((r) => r.ms >= 60e3).sort((a, b) => b.ms - a.ms).map((r) => `${r.name} ${this.t.dur(r.ms)}`);
  }
  totalNow(project, now = Date.now()) {
    const a = this.state.active;
    return this.spent(project, dayKey(new Date(now))) + (a?.name === project ? Math.max(0, Math.min(now, a.since + CAP) - Math.max(a.since, midnight(new Date(now)).getTime())) : 0);
  }
  // the project name you said, matched to one you already use ("totem" → "Totem")
  nameOf(raw) {
    const name = clean(raw).replace(/\b(?:por\s+favor|please)\b/gi, '').trim();
    const known = [...Object.keys(this.state.totals), ...(this.state.active ? [this.state.active.name] : [])];
    return known.find((k) => flat(k) === flat(name)) || name;
  }

  // ---- deadlines --------------------------------------------------------------------------------
  sortedDeadlines(now = new Date()) {
    return [...this.state.deadlines].sort((a, b) => a.date.localeCompare(b.date)).map((d) => ({ ...d, left: daysBetween(now, new Date(`${d.date}T00:00:00`)) }));
  }
  deadlineLine(d) {
    return `${d.label} ${this.t.when(d.left)}`;
  }

  // ---- the answer -------------------------------------------------------------------------------
  // → { line, face } or null (it isn't for her planner: on to the timers and the model)
  async handle(raw, now = new Date()) {
    const text = clean(raw);
    if (!text) return null;
    const t = this.t;
    let m;

    if (MCP.test(text)) return this.mcp();
    if (OPEN_SEND.test(text)) {
      const res = await this.host.openSendDir?.();
      return res?.ok ? { line: t.sendOpened, face: 'smug' } : { line: t.sendFail(res?.error || '?'), face: 'aside' };
    }
    if (ORGANIZE.test(text)) {
      const res = await this.host.organizeRun?.();
      return res?.ok ? { line: t.orgDone(res.moved), face: 'smug' } : { line: t.orgFail(res?.error || '?'), face: 'aside' };
    }

    // stopwatch
    if ((m = START.exec(text))) {
      const name = this.nameOf(m[1]);
      if (!name) return { line: t.noName, face: 'aside' };
      if (this.state.active && flat(this.state.active.name) === flat(name)) return { line: t.already(name), face: 'smug' };
      const prev = this.closeActive(now.getTime());
      this.state.active = { name, since: now.getTime() };
      this.save();
      return { line: prev ? t.switched(name, prev.name, t.dur(prev.ms)) : t.started(name), face: 'smug' };
    }
    if (STOP.test(text) && (this.state.active || /\b(contar|conteo|cronometro|cronómetro|proyecto|tiempo|tracking|timing)\b/i.test(text) || /^(?:capri[\s,]+)?(?:para|stop)$/i.test(text))) {
      if (!this.state.active) return /^(?:capri[\s,]+)?(?:para|stop)$/i.test(text) ? null : { line: t.nothing, face: 'aside' };
      const done = this.closeActive(now.getTime());
      this.save();
      return { line: t.stopped(done.name, t.dur(done.ms), t.dur(done.total)), face: 'laugh' };
    }
    if (TOTAL.test(text)) {
      const week = /semana|week/i.test(text);
      const list = this.summary(week ? 'week' : 'day', now);
      return { line: week ? t.totalWeek(list) : t.totalToday(list), face: 'smug' };
    }
    if (HOW_LONG.test(text)) {
      const a = this.state.active;
      if (!a) return { line: t.nothing, face: 'aside' };
      return { line: t.running(a.name, t.dur(Math.min(now.getTime(), a.since + CAP) - a.since), t.dur(this.totalNow(a.name, now.getTime()))), face: 'smug' };
    }

    // deadlines
    if ((m = DEADLINE_DEL.exec(text))) {
      const want = flat(clean(m[1]));
      const hit = this.state.deadlines.find((d) => !want || flat(d.label).includes(want) || want.includes(flat(d.label)));
      if (!hit) return { line: t.dlMissing, face: 'aside' };
      this.state.deadlines = this.state.deadlines.filter((d) => d !== hit);
      this.save();
      return { line: t.dlRemoved(hit.label), face: 'smug' };
    }
    if (DEADLINE_LIST.test(text)) {
      const list = this.sortedDeadlines(now);
      return { line: list.length ? t.dlList(list.map((d) => this.deadlineLine(d))) : t.dlNone, face: 'smug' };
    }
    if ((m = DEADLINE_ADD.exec(text))) {
      const found = dateOf(m[1], now);
      if (!found) return { line: t.dlNoDate, face: 'aside' };
      const label = clean(found.rest.replace(/^(?:para|de(?:l)?|el|la|is|due|by|:)\s+|\s+(?:para|de(?:l)?|el|la|is|due|by|on)$/gi, ''));
      if (!label) return { line: t.dlNoDate, face: 'aside' };
      const date = dayKey(found.date);
      this.state.deadlines.push({ label, date, reminded: '' });
      this.save();
      return { line: t.dlAdded(label, t.date(found.date, this.names), t.when(daysBetween(now, found.date))), face: 'smug' };
    }

    // deleting notes: the newest, one by its words, or all (asks first)
    if (this.confirmNotes && Date.now() - this.confirmNotes < 60e3 && YES_DEL.test(text)) {
      this.confirmNotes = 0;
      const res = await this.host.noteDelete?.('all');
      return res?.ok ? { line: t.notesGone(res.removed.length), face: 'smug' } : { line: t.noteFail, face: 'aside' };
    }
    if (NOTE_DEL_LAST.test(text)) {
      const res = await this.host.noteDelete?.('last');
      if (!res?.ok) return { line: t.noteFail, face: 'aside' };
      return res.removed.length ? { line: t.noteGone(res.removed[0].replace(/^\[[^\]]*\]\s*(?:\([^)]*\)\s*)?/, '')), face: 'smug' } : { line: t.noNotes, face: 'aside' };
    }
    if ((m = NOTE_DEL_ONE.exec(text)) && !NOTE_DEL_ALL.test(text)) {
      const res = await this.host.noteDelete?.('match', clean(m[1]));
      if (!res?.ok) return { line: t.noteFail, face: 'aside' };
      return res.removed.length ? { line: t.noteGone(res.removed[0].replace(/^\[[^\]]*\]\s*(?:\([^)]*\)\s*)?/, '')), face: 'smug' } : { line: t.noteNoMatch, face: 'aside' };
    }
    if (NOTE_DEL_ALL.test(text)) {
      const notes = (await this.host.notesRead?.()) || [];
      if (!notes.length) return { line: t.noNotes, face: 'aside' };
      this.confirmNotes = Date.now();
      return { line: t.notesSure(notes.length), face: 'aside' };
    }

    // notes
    if (NOTES_READ.test(text) && !NOTE.test(text)) {
      const notes = await this.host.notesRead?.();
      if (!notes?.length) return { line: t.noNotes, face: 'aside' };
      return { line: t.notes(notes.slice(-4).map((n) => n.replace(/^\[[^\]]*\]\s*(?:\([^)]*\)\s*)?/, ''))), face: 'smug' };
    }
    if ((m = NOTE.exec(text)) && (m[1] || /^(?:capri[\s,]+)?(?:anota|apunta|nota|note)\b/i.test(text))) {
      const body = clean(m[1]);
      if (body.length < 2) return { line: t.noteAsk, face: 'aside' };
      const project = this.state.active?.name || '';
      const res = await this.host.noteAdd?.(body, project);
      if (!res?.ok) return { line: t.noteFail, face: 'aside' };
      return { line: project ? t.noteSavedIn(project) : t.noteSaved, face: 'smug' };
    }

    // day summary
    if (WRAP.test(text)) return { line: this.briefing('evening', now), face: 'smug' };
    if (BRIEF.test(text)) return { line: this.briefing(/good\s+morning|buenos\s+d|buen\s+d/i.test(text) ? 'morning' : 'now', now), face: 'smug' };
    return null;
  }

  async mcp() {
    const t = this.t;
    const res = await this.host.claudeMcp?.().catch(() => null);
    if (!res?.ok) return { line: t.mcpFail, face: 'aside' };
    if (!res.list.length) return { line: t.mcpNone, face: 'aside' };
    return {
      line: t.mcpList(res.list.filter((s) => s.ok).map((s) => s.name), res.list.filter((s) => !s.ok).map((s) => s.name)),
      face: 'smug',
    };
  }

  // kind: 'morning' | 'evening' | 'now'
  briefing(kind, now = new Date()) {
    const t = this.t;
    const parts = [kind === 'morning' ? t.morning(this.name) : kind === 'evening' ? t.evening(this.name) : ''];
    const pending = this.timers?.items?.filter((i) => i.kind === 'timer' || i.kind === 'action').length || 0;
    const soon = this.sortedDeadlines(now).filter((d) => d.left <= 7);
    if (kind !== 'evening') {
      if (pending) parts.push(`${t.nTimers(pending)}.`);
      if (soon.length) parts.push(t.inDeadlines(soon.slice(0, 4).map((d) => this.deadlineLine(d))));
      const yesterday = this.summaryDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
      if (kind === 'morning' && yesterday.length) parts.push(t.workedYesterday(yesterday.join(', ')));
    }
    const today = this.summary('day', now);
    if (kind !== 'morning' && today.length) parts.push(t.worked(today.join(', ')));
    const day = this.mission?.day;
    if (kind !== 'morning' && day?.missions) parts.push(t.missionDay(day));
    if (kind === 'evening') {
      const next = this.sortedDeadlines(now).filter((d) => d.left >= 0 && d.left <= 3);
      if (next.length) parts.push(t.inDeadlines(next.slice(0, 3).map((d) => this.deadlineLine(d))));
    }
    const body = parts.filter(Boolean);
    if (body.length === (kind === 'now' ? 0 : 1)) body.push(t.nothingToday);
    return body.join(' ');
  }
  summaryDay(day) {
    const k = dayKey(day);
    return Object.entries(this.state.totals).map(([name, days]) => ({ name, ms: days[k] || 0 })).filter((r) => r.ms >= 60e3).sort((a, b) => b.ms - a.ms).map((r) => `${r.name} ${this.t.dur(r.ms)}`);
  }

  // ---- on her own: called every few minutes by app.js -------------------------------------------
  // deadlines getting close (once a day each), the morning summary and the evening wrap-up (once a day each)
  tick(now = new Date(), { morning = true, evening = true, busy = false } = {}) {
    if (busy) return;
    const today = dayKey(now);
    const hour = now.getHours();
    for (const d of this.sortedDeadlines(now)) {
      if (d.left > 3 || d.left < -1) continue;
      const mine = this.state.deadlines.find((x) => x.label === d.label && x.date === d.date);
      if (!mine || mine.reminded === today || hour < 8 || hour >= 22) continue;
      mine.reminded = today;
      this.save();
      this.onRemind?.(this.t.dlRemind(d.label, d.left, this.t.date(new Date(`${d.date}T00:00:00`), this.names)));
      return; // one thing at a time
    }
    if (morning && hour >= 7 && hour < 12 && this.state.briefed.morning !== today) {
      this.state.briefed.morning = today;
      this.save();
      this.onRemind?.(this.briefing('morning', now));
      return;
    }
    if (evening && hour >= 19 && hour < 23 && this.state.briefed.evening !== today) {
      this.state.briefed.evening = today;
      this.save();
      this.onRemind?.(this.briefing('evening', now));
    }
  }
}

export { dateOf, flat };
