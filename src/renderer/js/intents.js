// What she understands from what you write, shared by her bubble and her conversation window.

// "genera una imagen de...", "hazme una ilustración de...", "dibuja...", "nano banana: ...": her image maker (your nano-banana, Gemini)
const IMG_VERB = '(?:genera|generar|crea|crear|haz|hazme|hacer|dise[ñn]a|dise[ñn]ame|dibuja|dib[uú]jame|pinta|imagina|imag[ií]name|make|generate|create|draw|paint|imagine)';
const IMG_NOUN = '(?:imagen|im[aá]genes|ilustraci[oó]n|foto|fotograf[ií]a|dibujo|p[oó]ster|afiche|portada|banner|logo|logotipo|sticker|[ií]cono|icono|wallpaper|picture|image|illustration|photo|drawing|poster|cover|icon|artwork)';
const IMG_A = new RegExp(`^[\\s¿¡]*(?:capri[\\s,]+)?${IMG_VERB}(?:me|nos)?\\s+(?:una?|an?|the|la|el)?\\s*${IMG_NOUN}\\s*(?:de|del|con|sobre|of|with|about|:|,|-)?\\s*(.{4,})$`, 'iu');
const IMG_B = /^[\s¿¡]*(?:capri[\s,]+)?(?:(?:dibuja|dib[uú]jame|pinta|draw|paint)(?:me)?\s+|nano\s*banana\s*[:,\-]\s*|imagina\s*[:,]\s*)(.{4,})$/iu;
const IMG_NOT = /\b(?:illustrator|figma|canva|blender|photoshop|affinity|archivo|carpeta|file|folder)\b/i; // in an app or on your files: that's a job for Claude

export function imageAsk(text) {
  const t = String(text || '').trim();
  if (IMG_NOT.test(t)) return null;
  return (IMG_A.exec(t) || IMG_B.exec(t))?.[1]?.trim() || null;
}

// Editing a picture (nano_banana.py --edit): "quítale el fondo", "ponle un sombrero", "hazla más oscura", "change the sky to orange"...
const EDIT_VERB = '(?:edita|ed[ií]tame|editar|modifica|mod[ií]ficame|retoca|ret[oó]came|cambia|c[aá]mbiale|c[aá]mbiame|quita|qu[ií]tale|qu[ií]tame|elimina|borra|b[oó]rrale|pon|ponle|agrega|agr[eé]gale|a[ñn]ade|a[ñn][aá]dele|recolorea|colorea|haz|hazla|hazlo|hazle|convierte|transforma|mejora|ilumina|oscurece|aclara|reemplaza|sustituye|remove|edit|change|add|make|turn|recolor|replace|enhance|brighten|darken|erase|retouch|put|give)';
const EDIT_A = new RegExp(`^[\\s¿¡]*(?:capri[\\s,]+)?(?:(?:y\\s+)?(?:ahora|pero|mejor|now|but)[\\s,]+)?(?:por\\s+favor[\\s,]+)?${EDIT_VERB}\\b(.{3,})$`, 'iu');
const IMG_REF = /\b(?:la|esta|esa|mi|tu)\s+(?:imagen|foto|ilustraci[oó]n|dibujo|logo|portada|banner|[uú]ltima)\b|\b(?:this|that|the|last)\s+(?:image|picture|photo|illustration|one)\b/i;
const FOLLOW = /^[\s¿¡]*(?:capri[\s,]+)?(?:y\s+)?(?:ahora|pero|mejor|ya\s+que|now|but)\b/i;

// with a picture attached: the order is to change THAT picture ("quítale el fondo")
export function imageEditAsk(text) {
  const t = String(text || '').trim();
  const m = EDIT_A.exec(t);
  return m && !IMG_NOT.test(t) ? t : null;
}

// no picture attached, but the last one she made is there: "ahora hazla azul", "cambia la imagen a blanco y negro"
export function imageEditFollow(text) {
  const t = String(text || '').trim();
  return EDIT_A.test(t) && (IMG_REF.test(t) || FOLLOW.test(t)) && !IMG_NOT.test(t) ? t : null;
}

// "sácame la paleta", "colores de esta imagen", "palette": the colours of a picture, from its pixels
const PAL = /\b(?:paleta|palette|colou?res?\s+(?:dominantes?|principales?|de\s+(?:esta|esa|la|mi)\s+(?:imagen|foto|ilustraci[oó]n|dibujo|captura))|dominant\s+colou?rs?|colou?rs?\s+(?:of|in)\s+(?:this|the)\s+(?:image|picture|photo))\b/i;
export function paletteAsk(text) {
  const t = String(text || '').trim();
  return t.length < 90 && PAL.test(t) && !/\b(?:crea|genera|dise[ñn]a|haz|make|create|generate|design)\b/i.test(t);
}

// ---- an order about a file she cannot carry out herself ----
// "ok vuélvela más pequeña", "ponle fondo blanco", "bórralo": an action on something that already exists. Her own model has no hands: it must go
// to Claude, or she says so; it must never answer "listo, lo hice". (Compared without accents and in lower case.)
const plain = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const VERB_CLITIC = /\b(?:vuelv|haz|cambi|reduc|agrand|achic|recort|rot|conviert|renombr|muev|cop|borr|elimin|guard|export|comprim|orden|organiz|pon|quit|abr|edit|repit|ampli|sub|baj)(?:e|a|ele|ela|elo|elas|elos|ale|ala|alo|alas|alos)?(?:la|lo|las|los|le)\b/;
const REDO_CUE = /\b(?:otra vez|de nuevo|mas (?:pequen|grand|chic|oscur|clar|anch|angost|alt|baj|suav|fuert|corto|larg)[oa]s?)\b/;
const QUESTION_START = /^[\s¿¡]*(?:como|que|por que|cual|cuando|donde|quien|cuanto|sabes|puedes decirme)\b/;

export function followUpAction(text) {
  const t = plain(text).trim();
  return t.length > 0 && t.length <= 140 && !QUESTION_START.test(t) && (VERB_CLITIC.test(t) || REDO_CUE.test(t));
}

// the verbs that can ask for an action, with or without "la/lo"
const ACT_VERB = /\b(?:vuelv|haz|cambi|reduc|agrand|achic|recort|rot|conviert|renombr|muev|mov|cop|borr|elimin|guard|export|comprim|orden|organiz|pon|quit|abr|edit|crea|redimension|descarg|instal|ejecut)\w*/;
export const actAsk = (text) => ACT_VERB.test(plain(text)) && !QUESTION_START.test(plain(text).trim());

// "Redimensioné la imagen", "ya la guardé", "listo, lo cree": she claims to have done it (first person, past)
const CLAIM = /\b(?:redimension|guard|cre|edit|renombr|elimin|borr|convert|export|mov|copi|descarg|instal|ejecut|aplic|cambi|abr|organiz|comprim|recort|rot|reduj|agrand|achic)(?:e|i)\b/;
export const claimsDone = (answer) => CLAIM.test(plain(answer));

// "retoma lo de ayer", "dónde me quedé", "qué estaba haciendo", "mis últimos archivos": the files you opened last, to pick up where you were.
// (Narrow on purpose: "sigamos con el proyecto" is for Claude, not for this.)
const RESUME_A = /^(?:capri[ ,]+)?(?:por favor[ ,]+)?(?:retoma\w*|continuemos|sigamos|seguimos|resume)\s+(?:con\s+)?(?:lo\s+de\s+(?:ayer|antes|hoy|anoche)|donde\s+(?:me\s+)?(?:quede|dejamos|lo\s+deje|where i left)|mi\s+trabajo|lo\s+(?:ultimo|anterior)|where\s+i\s+left\s+off)/;
const RESUME_B = /^(?:capri[ ,]+)?(?:donde|en\s+que)\s+(?:me\s+)?(?:quede|estaba|andaba|iba)$|^(?:capri[ ,]+)?que\s+estaba\s+(?:haciendo|trabajando)$|^(?:capri[ ,]+)?(?:mis\s+)?(?:ultimos|recientes)\s+(?:archivos|proyectos|trabajos)$|^(?:capri[ ,]+)?archivos\s+recientes$|^(?:capri[ ,]+)?(?:recent\s+files|what\s+was\s+i\s+working\s+on)$/;
export function resumeAsk(text) {
  const t = plain(text).replace(/[¿?¡!.,]+/g, ' ').replace(/\s+/g, ' ').trim();
  return t.length > 0 && t.length <= 60 && (RESUME_A.test(t) || RESUME_B.test(t));
}

// "quítale el fondo", "sin fondo", "remove the background": rembg on this PC (no Claude, no Nano Banana)
const BG = /\b(?:(?:quita|quitale|quitame|elimina|eliminale|borra|borrale|saca|sacale|remueve|recorta|remove|delete|erase|cut\s*out)\w*\s+(?:el\s+|la\s+|the\s+)?(?:fondo|background)|(?:sin|without|no)\s+(?:el\s+)?(?:fondo|background)|fondo\s+transparente|transparent\s+background)\b/;
export function bgAsk(text) {
  const t = plain(text).trim();
  return t.length > 0 && t.length <= 120 && BG.test(t) && !/\b(?:ventana|pantalla|escritorio|wallpaper|window|desktop)\b/.test(t);
}

// "pásala a webp", "convierte a jpg", "achica la imagen", "reduce el peso", "ponla a 1200 px": the picture tools (imgtools.js)
const IMG_CONVERT = /\b(?:convierte|convertir|convertila|conviertela|pasa|pasala|pasalo|exporta|exportala|guarda|guardala|guardalo|cambia|cambiala|transforma|transformala|save|convert|export|turn)\w*\b.*\b(png|webp|jpe?g|jpg)\b/;
const IMG_SHRINK = /\b(?:achica|achicala|achicalo|reduce|reducela|reducelo|comprime|comprimela|comprimelo|aligera|aligerala|aligeralo|baja(?:le)?|disminuye|shrink|compress|resize|reduzca)\w*\b.*\b(?:peso|tamano|imagen|foto|pixeles|px|kb|mb|pesa|ligera|liviana|pequena|mas\s+chica|resolucion|calidad|size)\b|\b(?:que\s+pese\s+menos|mas\s+liger[ao]|mas\s+pequen[ao])\b/;
export function imgAsk(text) {
  const t = plain(text).trim();
  if (!t || t.length > 120 || /\b(?:ventana|pantalla|escritorio|window|desktop|video|audio)\b/.test(t)) return null;
  const px = /\b(\d{3,5})\s*(?:px|pixeles|pixels)\b/.exec(t);
  const fmt = IMG_CONVERT.exec(t);
  if (fmt) return { kind: 'convert', fmt: fmt[1].replace('jpeg', 'jpg'), maxSide: px ? Number(px[1]) : 0 };
  if (IMG_SHRINK.test(t) || (px && /\b(?:ponla|ponlo|dejala|dejalo|a)\b/.test(t))) return { kind: 'shrink', fmt: '', maxSide: px ? Number(px[1]) : 0 };
  return null;
}

// Other ways to say the same order. "arranca figma", "mata spotify", "párale a la música", "bájale", "pasa la canción": the first words are
// turned into the verb her parsers already know ("abre", "cierra", "pausa", "siguiente"...). Only short sentences, and only the start of them.
const LEAD = String.raw`^(\s*(?:(?:oye|hey|ok|vale|bueno|capri|por favor|porfa|pls|puedes|podrias|me puedes|me ayudas a|quiero que|necesito que|dale|ya)[\s,]+)*)`;
const CANON = [
  // music first: they have a noun that settles what they are
  [/^(?:parale|para|detente|deten|frena)(?:\s+(?:a\s+)?(?:la\s+|el\s+|esa\s+|esta\s+|eso\s+)?(?:musica|cancion|tema|video|reproduccion|youtube|spotify|yt(?:\s*music)?|youtube\s*music|todo|eso))?$/, 'pausa'],
  [/^(?:pasa|pasale|salta|saltale|cambia|cambiale|avanza|adelanta)\s+(?:a\s+)?(?:la\s+|el\s+|esa\s+|esta\s+|de\s+|otra\s+)?(?:siguiente\s+)?(?:cancion|tema|musica|pista|rola)?$/, 'siguiente'],
  [/^(?:otra\s+(?:cancion|rola|pista)|la\s+que\s+sigue|que\s+siga)$/, 'siguiente'],
  [/^(?:devuelve(?:te)?|regresa(?:te)?|retrocede|vuelve|atras)\s+(?:a\s+)?(?:la\s+|el\s+|esa\s+|de\s+)?(?:anterior\s+|cancion\s+anterior\s+|de\s+antes\s+)?(?:cancion|tema|musica|pista|rola|anterior)?$/, 'anterior'],
  [/^(?:la\s+(?:de\s+antes|anterior)|cancion\s+anterior)$/, 'anterior'],
  [/^(?:quita\s+la\s+pausa|despausa|ponla|ponlo|ponle\s+play|continua\s+con\s+la\s+(?:musica|cancion)|sigue\s+con\s+la\s+(?:musica|cancion))$/, 'reanuda'],
  [/^(?:subele|sube|aumenta|mas\s+fuerte|mas\s+alto|mas\s+volumen)(?:\s+(?:a|al|el|la)\s+(?:volumen|musica|sonido|cancion))?$/, 'sube el volumen'],
  [/^(?:bajale|baja|reduce|mas\s+bajo|menos\s+volumen|mas\s+suave|mas\s+quedito)(?:\s+(?:a|al|el|la)\s+(?:volumen|musica|sonido|cancion))?$/, 'baja el volumen'],
  [/^(?:mutea(?:lo|la)?|quita\s+el\s+sonido|sin\s+sonido|apaga\s+el\s+sonido)$/, 'silencia'],
  // apps
  [/^(?:arranca(?:me)?|lanza(?:me)?|prende(?:me)?|enciende(?:me)?|levanta(?:me)?|carga(?:me)?|entra\s+a|ve\s+a|vete\s+a|llevame\s+a|muestrame|ponme\s+en)\s+(\S.*)$/, 'abre $1'],
  [/^(?:mata(?:me)?|termina(?:me)?|finaliza(?:me)?|salte\s+de|sal\s+de|cierrale\s+a)\s+(\S.*)$/, 'cierra $1'],
  [/^apaga(?:me)?\s+(?:la\s+|el\s+|mi\s+)?(?!(?:pc|computador\w*|compu|equipo|pantalla|luz|sonido|musica|volumen|todo)\b)(\S.*)$/, 'cierra $1'], // ("apaga figma": an app; "apaga el pc" is something else)
];
// How you say an app (or how Whisper writes it) -> the name she looks for. Yours go in config.appAliases ("cuando diga ilus abre Illustrator").
// Only applied to a short order that starts with a verb like abre / cierra: a word of a normal sentence is never changed.
export const ALIAS_DEFAULTS = {
  'yt music': 'YouTube Music', ytmusic: 'YouTube Music', ytm: 'YouTube Music', 'youtube musica': 'YouTube Music', 'you tube music': 'YouTube Music',
  yutub: 'YouTube', youtub: 'YouTube', iutub: 'YouTube', 'you tube': 'YouTube',
  wasap: 'WhatsApp', guasap: 'WhatsApp', wassap: 'WhatsApp', whasap: 'WhatsApp', uatsap: 'WhatsApp', whats: 'WhatsApp', 'wats app': 'WhatsApp', watsap: 'WhatsApp',
  ilustrador: 'Illustrator', ilustrator: 'Illustrator', ilustreitor: 'Illustrator', illustrador: 'Illustrator',
  fiusion: 'Fusion 360', fusion: 'Fusion 360', 'fusion 360': 'Fusion 360', 'fusion trescientos sesenta': 'Fusion 360',
  figuma: 'Figma', figmaa: 'Figma', fichma: 'Figma',
  afinity: 'Affinity', afiniti: 'Affinity', afinidad: 'Affinity',
  fotoshop: 'Photoshop', 'foto shop': 'Photoshop',
  kanva: 'Canva', discor: 'Discord', dicord: 'Discord', telegran: 'Telegram',
  olama: 'Ollama', 'liga de leyendas': 'League of Legends',
};
const ORDER_START = /^\s*(?:(?:oye|hey|ok|vale|bueno|capri|por favor|porfa)[\s,]+)*(?:abre(?:me)?|abrir|inicia|iniciar|lanza|arranca|ejecuta|pon(?:me)?|cierra(?:me)?|cerrar|apaga|reproduce|busca|prende|enciende)\b/i;
export function applyAliases(text, map) {
  const raw = String(text || '');
  if (raw.length > 120 || !ORDER_START.test(plain(raw))) return raw;
  const base = plain(raw); // (same length: accents drop)
  const keys = Object.keys(map || {}).filter((k) => k && plain(k).length >= 2).sort((a, b) => b.length - a.length);
  let out = '';
  let i = 0;
  while (i < raw.length) {
    let hit = null;
    if (i === 0 || /[\s,.]/.test(base[i - 1])) {
      for (const k of keys) {
        const pk = plain(k);
        if (base.startsWith(pk, i) && (i + pk.length >= base.length || /[\s,.!?]/.test(base[i + pk.length])) && base.slice(0, i).trim().length > 0) { hit = { len: pk.length, to: map[k] }; break; }
      }
    }
    if (hit) { out += hit.to; i += hit.len; } else { out += raw[i]; i += 1; }
  }
  return out;
}

export function canon(text) {
  const raw = String(text || '');
  if (raw.length > 90 || /[?¿]/.test(raw)) return raw;
  const lead = new RegExp(LEAD, 'i').exec(plain(raw));
  if (!lead) return raw;
  const rest = plain(raw).slice(lead[0].length).replace(/[\s.!¡,]+$/g, '').replace(/\s+(?:por favor|porfa|pls)$/, '');
  if (!rest || rest.split(/\s+/).length > 7) return raw;
  for (const [re, out] of CANON) {
    const m = re.exec(rest);
    if (m) return out.replace('$1', m[1] || '').trim();
  }
  return raw;
}


// Messages in chat apps. "lee mis mensajes de whatsapp", "qué me escribieron en discord", "quién me escribió", "tengo algo nuevo en wasap",
// "responde en whatsapp: ya voy", "respóndele: dame 5 minutos".
// { kind: 'read', app } | { kind: 'reply', app, text } (app may be '' = the one she last told you about), or null.
const APP_ALIAS = [
  [/\b(?:what'?s\s?app|whats\s?app|wats\s?app|whatsap|watsap|watsapp|wasap|wasapp|guasap|guasapp|whasap|uatsap|wsp|wpp|whats)\b/gi, 'whatsapp'],
  [/\b(?:disc[o0]rd|dis\s?cord|discor|dicord|discorb)\b/gi, 'discord'],
  [/\b(?:telegran|telegam|telegrma|tele\s?gram)\b/gi, 'telegram'],
];
const aliased = (text) => APP_ALIAS.reduce((t, [re, to]) => t.replace(re, to), String(text || ''));
const APP_RE = '(whatsapp|discord|telegram)';
const HAS_APP = /\b(whatsapp|discord|telegram)\b/;
const HAS_MSG = /\b(?:mensajes?|messages?|texts?|chats?|conversacion(?:es)?|dms?|notificaciones?)\b/;
const NOT_MSG = /\b(?:archivos?|correos?|mails?|emails?|pdf|carpetas?|documentos?|imagenes?|fotos?|videos?|canciones?|musica)\b/;
const READ_VERB = /\b(?:lee|leeme|leer|lea|leelos|leelas|revisa|revisame|revisalos|mira|miralos|checa|checame|chequea|chequeame|muestra|muestrame|ensename|dime|cuentame|dictame|read|show|check|tell|echale\s+un\s+ojo)\b/;
const READ_Q = [
  /\bque\s+(?:me\s+)?(?:escribieron|escribio|dijeron|dijo|mandaron|mando|dicen|dice|hay|paso|llego)\b/,
  /\b(?:quien|quienes)\s+me\s+(?:escribio|escribieron|hablo|hablaron|mando|mandaron|dijo|dijeron|busco|buscaron)\b/,
  /\balguien\s+me\s+(?:escribio|hablo|mando|dijo|busco)\b|\bme\s+(?:escribio|hablo|busco)\s+alguien\b/,
  /\b(?:tengo|hay)\s+(?:algo|mensajes?|nada|alguna\s+cosa)\b.*\b(?:nuevo|nuevos|nueva|pendiente|pendientes|whatsapp|discord|telegram)\b/,
  /\bmensajes?\s+(?:nuevos?|pendientes?|sin\s+leer)\b/,
  /\bme\s+(?:escribieron|escribio|llegaron|llego)\s+(?:algo|mensajes?)\b/,
];
const TO = String.raw`(?:\s+(?:a|para|to|for)\s+([^:,]{1,40}?)\s*[:,])?`;
const REPLY_A = new RegExp(String.raw`^\s*(?:capri[\s,]+)?(?:por favor[\s,]+)?(?:responde|contesta|respondele|contestale|escribe|escribele|manda|mandale|envia|enviale|dile|avisale|mensajea|mensajeale|reply|respond|answer|text|message|msg|dm|write|send|tell)\w*\s+(?:un\s+mensaje\s+|a\s+message\s+)?(?:en|por|a|via|con|al|in|on|through|to|by)\s+${APP_RE}${TO}\s*[:,\-]?\s*(?:que\s+)?(.{2,})$`, 'id');
const REPLY_B = new RegExp(String.raw`^\s*(?:capri[\s,]+)?(?:por favor[\s,]+)?(?:(?:respondele|contestale|avisale|reply|respond|answer)(?=[\s:,\-])${TO}\s*[:,\-]?|(?:responde|contesta|reply|respond|answer)\s*[:,])\s*(?:que\s+)?(.{2,})$`, 'id');
const REPLY_C = new RegExp(String.raw`^\s*(?:capri[\s,]+)?(?:please[\s,]+)?(?:reply|respond|answer|text|message|msg|dm|tell)\w*\s+(?:to\s+)?([^:,]{1,40}?)\s+(?:on|in|via|through)\s+${APP_RE}\s*[:,\-]\s*(?:that\s+)?(.{2,})$`, 'id');
const REPLY_EMPTY = new RegExp(String.raw`^\s*(?:capri[\s,]+)?(?:por favor[\s,]+)?(?:responde|contesta|respondele|contestale|reply|respond|answer)(?:\s+(?:en|por|a|in|on|to)\s+${APP_RE})?\s*[.!]*$`, 'i');
export function msgAsk(raw) {
  const text = aliased(raw);
  const pl = plain(text); // (same length as the text: the letters only lose their accents)
  const t = pl.trim().replace(/[\s,;.!¡¿?]+$/g, '');
  if (!t || t.length > 600) return null;
  const tail = (m) => String(text).slice(m[0].length - m[m.length - 1].length).trim();
  const grab = (m, n) => (m.indices?.[n] ? String(text).slice(m.indices[n][0], m.indices[n][1]).trim() : '');
  const a = REPLY_A.exec(pl);
  if (a) return { kind: 'reply', app: a[1].toLowerCase(), to: grab(a, 2), text: tail(a) };
  const c = REPLY_C.exec(pl); // "reply to Mom on WhatsApp: on my way"
  if (c) return { kind: 'reply', app: c[2].toLowerCase(), to: grab(c, 1), text: tail(c) };
  const e = REPLY_EMPTY.exec(pl);
  if (e) return { kind: 'reply', app: (e[1] || '').toLowerCase(), to: '', text: '' };
  const b = REPLY_B.exec(pl);
  if (b) return { kind: 'reply', app: '', to: grab(b, 1), text: tail(b) };
  if (t.split(/\s+/).length > 14 || NOT_MSG.test(t)) return null;
  const app = HAS_APP.exec(t)?.[1] || '';
  const read = (READ_VERB.test(t) && (HAS_MSG.test(t) || app))
    || (app && HAS_MSG.test(t) && !/\b(?:enviar|manda|envia|escribe|responde|contesta)\w*\b/.test(t)) // ("mensajes de whatsapp" with any verb, even a mistyped one)
    || (/\babre(?:me)?\b/.test(t) && HAS_MSG.test(t))
    || (READ_Q.some((re) => re.test(t)) && (HAS_MSG.test(t) || app || /\b(?:escribieron|escribio|hablo|hablaron|busco|buscaron)\b/.test(t)))
    || (/\bque\s+(?:dice|dicen)\b/.test(t) && app);
  return read ? { kind: 'read', app } : null;
}


// Her eyes on the PC: "qué tengo abierto", "qué ventanas tengo", "lee la ventana de Illustrator", "qué dice esta ventana", "qué hay en mi pantalla".
// { kind: 'list' } | { kind: 'read', target } (target '' = the window in front of hers), or null.
const WIN_LIST = /^(?:capri[\s,]+)?(?:por favor[\s,]+)?(?:(?:que|cuales|cuantas?)\s+(?:cosas\s+|apps\s+|aplicaciones\s+|programas\s+|ventanas\s+)?(?:tengo\s+)?(?:abiert[oa]s?|ventanas|programas|apps|aplicaciones)(?:\s+(?:tengo|hay))?|(?:lista|listame|muestrame|dime)\s+(?:las\s+|mis\s+|los\s+)?(?:ventanas|programas|apps|aplicaciones)(?:\s+abiert[oa]s)?|que\s+(?:estoy\s+usando|tengo\s+en\s+(?:la\s+)?pantalla|esta\s+abierto))[\s.!?]*$/i;
const WIN_READ = /^(?:capri[\s,]+)?(?:por favor[\s,]+)?(?:(?:lee|leeme|leer|revisa|mira|muestrame|dime)\s+(?:lo\s+que\s+(?:dice|hay\s+en)\s+)?(?:la\s+|esta\s+|esa\s+|mi\s+)?(?:ventana|pantalla)(?:\s+(?:de|del|activa|actual|abierta)\s*(.*))?|que\s+(?:dice|hay\s+en)\s+(?:la\s+|esta\s+|esa\s+|mi\s+)?(?:ventana|pantalla)(?:\s+(?:de|del|activa|actual|abierta)\s*(.*))?)[\s.!?]*$/i;
export function winAsk(text) {
  const t = plain(aliased(text)).trim();
  if (!t || t.length > 120) return null;
  if (WIN_LIST.test(t)) return { kind: 'list' };
  const m = WIN_READ.exec(t);
  if (m) {
    const target = String(m[1] || m[2] || '').replace(/^(?:la\s+|el\s+|los\s+|las\s+)/, '').trim();
    return { kind: 'read', target: /^(?:activa|actual|abierta|frente|enfrente)$/.test(target) ? '' : target };
  }
  return null;
}


// Cleaning and speed, said in many ways (she does not always hear every word, so it is the words that count, not the sentence):
// "limpia el caché", "libera espacio", "borra los temporales", "mi disco está lleno" / "optimiza el pc", "mi compu va lenta", "qué gasta memoria", "cierra lo que no uso".
const bag = (t, words) => words.some((w) => w.test(t));
export function cleanAsk(text) {
  const t = plain(aliased(text)).trim();
  if (!t || t.length > 140 || t.split(/\s+/).length > 16) return null;
  const clean = bag(t, [/\b(?:limpi\w*|limpieza|libera\w*|vacia\w*|borra\w*|elimina\w*|quita\w*|deshaz\w*|saca\w*)\b/]);
  const junk = bag(t, [/\b(?:cache\w*|temporal\w*|temporales|basura|residuos|espacio|disco|archivos?\s+(?:basura|inutiles))\b/]);
  const full = /\b(?:disco|almacenamiento|espacio)\b.*\b(?:lleno|poco|acabando|se\s+acab|sin\s+espacio|agotad\w*)\b|\b(?:me\s+quedo|queda\w*)\s+sin\s+espacio\b|\bcuanto\s+(?:espacio|cache)\b|\bque\s+(?:puedo|se\s+puede)\s+(?:borrar|limpiar|liberar)\b/.test(t);
  if (full || (clean && junk)) return { kind: 'scan' };
  return null;
}
export function perfAsk(text) {
  const t = plain(aliased(text)).trim();
  if (!t || t.length > 140 || t.split(/\s+/).length > 16) return null;
  const pc = /\b(?:pc|compu\w*|computador\w*|ordenador|equipo|sistema|maquina|laptop|portatil)\b/.test(t);
  const speed = /\b(?:lent[oa]\w*|rendimiento|optimiz\w*|acelera\w*|traba\w*|arrastra\w*|pesad[oa]|va\s+mal|se\s+demora)\b/.test(t);
  const mem = /\b(?:memoria|ram)\b/.test(t) && /\b(?:libera\w*|limpi\w*|gasta\w*|consum\w*|usa\w*|ocupa\w*|llena\w*)\b/.test(t);
  const procs = /\b(?:procesos?|programas?|apps?|cosas|tareas)\b.*\b(?:sobran|sobra|innecesari\w*|no\s+(?:uso|necesito|estoy\s+usando|hacen\s+falta)|segundo\s+plano|de\s+fondo)\b|\bcierra\w*\s+(?:todo\s+)?lo\s+(?:que\s+)?(?:no\s+(?:uso|necesito|estoy\s+usando|hace\s+falta)|innecesario|que\s+sobra)\b|\bque\s+(?:esta\s+)?(?:gastando|consumiendo|usando)\s+(?:la\s+)?(?:memoria|ram)\b/.test(t);
  if (mem || procs || (speed && pc) || /\b(?:optimiza\w*|acelera\w*)\s+(?:mi\s+|el\s+|la\s+)?(?:pc|compu\w*|equipo|sistema)\b/.test(t)) return { kind: 'scan' };
  return null;
}
