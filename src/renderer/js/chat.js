// Talking to her: you type in her panel, and a model (setup.js picks which) answers as her, in
// writing. The replies are AI-generated, and the panel says so on every chat.
// She can do a few things on your PC when you ask (Windows): open an app or a game, play music or
// control what's playing, open a website, close an app. She spots what you want in what you wrote,
// or the model asks for it with a tag in its answer. Music right away; an app you named yourself
// right away; anything only the model asked for, a website, and closing an app behind a button.

import { pick, fmt, basename } from './util.js';
import { ASSISTANT_NAMES } from './lines.js';
import { mediaButtons, nowLine } from './nowplaying.js';
import { imageAsk, imageEditAsk, imageEditFollow, paletteAsk, followUpAction, actAsk, claimsDone, resumeAsk, bgAsk, imgAsk, canon, msgAsk, winAsk, cleanAsk, perfAsk, applyAliases, ALIAS_DEFAULTS } from './intents.js';
import { ui } from './uisound.js';
import { convert as imgConvert, kb } from './imgtools.js';
import { pending, describe as pendingText, buttons as pendingButtons, act as pendingAct } from './pending.js';
import { suggestToken, matchApps } from './appsuggest.js';
import { usageLine, USAGE_NOTE } from './usagefmt.js';

const REMEMBER = 20; // messages she has in mind when answering
const KEEP = 200;    // messages kept in one conversation (her conversations, sessions.js)
// Claude Code's conversation with her only grows (every message re-reads the whole thread, and spends your
// usage limit): at WARN_AT answers she warns you, and again every WARN_EVERY if you say to keep going
const WARN_AT = 30;
const WARN_EVERY = 15;
// her language, where small models need it: how she says "we" (else it's in English), and the last line
// of her prompt, in that language (they drift into the English of everything above it)
const IN_LANGUAGE = {
  fr: { we: '"on" or "nous" in French', last: 'Écris tout en français, sauf si l’utilisateur t’écrit dans une autre langue : alors dans la sienne. Seuls les mots d’argot de Night City restent en anglais, jamais une phrase entière.' },
  en: { we: '', last: 'Write everything in English, unless the user writes to you in another language: then in theirs.' },
  es: { we: '"nosotros" in Spanish', last: 'Escribe todo en español, salvo si el usuario te escribe en otro idioma: entonces en el suyo. Solo las palabras de jerga de Night City se quedan en inglés, nunca una frase entera.' },
  pt: { we: '"a gente" or "nós" in Portuguese', last: 'Escreva tudo em português do Brasil, a não ser que o usuário te escreva em outra língua: aí, na dele. Só as gírias de Night City ficam em inglês, nunca uma frase inteira.' },
  ru: { we: '"мы" in Russian', last: 'Пиши всё по-русски, если только пользователь не пишет тебе на другом языке: тогда на его языке. По-английски остаются только словечки Найт-Сити, никогда не целые фразы.' },
};
// A small local model drifts into English (its instructions are in English): the rule goes first, last, and with every message
const ONLY_IN = {
  es: { rule: 'IDIOMA: responde SIEMPRE y SOLO en español, natural y neutro, sin regionalismos (nada de parce, parcero, chamo, pana, mijo ni similares: si quieres un apelativo, usa «choom»). Casi todo en español; de vez en cuando puedes soltar una frase corta en inglés como «good boy» o «let\'s go» (nunca «you got this»), y la jerga de Night City (choom, preem, nova, gonk, flatline).', nudge: '(Responde en español; solo alguna frase corta en inglés si sale natural.)' },
  fr: { rule: 'LANGUE : réponds TOUJOURS et UNIQUEMENT en français. Pas une phrase en anglais : seuls les mots d’argot de Night City peuvent rester en anglais.', nudge: '(Réponds uniquement en français.)' },
  pt: { rule: 'IDIOMA: responda SEMPRE e SOMENTE em português do Brasil. Nenhuma frase em inglês: só as gírias de Night City podem ficar em inglês.', nudge: '(Responda apenas em português, sem misturar inglês.)' },
  ru: { rule: 'ЯЗЫК: отвечай ВСЕГДА и ТОЛЬКО по-русски. Ни одной фразы по-английски: только словечки Найт-Сити могут остаться.', nudge: '(Отвечай только по-русски.)' },
};
const STAY_MS = 10 * 60 * 1000; // no wandering off mid-conversation
const LOADING_AFTER_MS = 5000;
const CLOSE_TAG = /\[\[\s*close\s*:?\s*([^\]]*)\]\]/i; // [[close: AM Music]] at the end of her answer
// "close", "shut down", "ferme", "quitte", "cierra", "fecha", "закрой"... in any of her languages
const CLOSE_ASK = /\b(close|shut|quit|kill|exit)|ferm|quitt|coupe|arr[êe]t|cierr|cerra|fech|закр|выключ/i;
// her other tags: [[open: Spotify]], [[music: Bad Bunny]], [[media: next]], [[site: youtube.com]]
const TAG = /\[\[\s*(open|music|media|site)\s*:\s*([^\]]*)\]\]/i;
// "open", "launch", "ouvre", "lance", "abre", "открой"... in any of her languages
const OPEN_ASK = /\b(open|launch|start|run)\b|ouvr|lance|démarre|abre|abrir|inicia|ejecuta|executa|открой|запусти/i;
// what to do with the music playing, said plainly (only when it's about music, or said in a few words)
const MEDIA_ASK = [
  ['pause', /\b(pause|pausa|pausar)\b|stop (the )?music|arrête la musique|пауз/i],
  ['next', /\b(next|skip|suivante?|siguiente|próxima|proxima)\b|passe (à )?la suivante|salta|pula|следующ/i],
  ['previous', /\b(previous|précédente?|anterior)\b|предыдущ/i],
  ['play', /\b(resume|reprends|reanuda|retoma)\b|relance la musique|remets la musique|продолж/i],
  // "reproduce", "dale play", "continúa", "play" (short, and without a song: "reproduce X en spotify" is another thing)
  ['play', /^(?:capri[\s,]+)?(?:dale\s+)?(?:play|reproduce|reproducir|plei|contin[uú]a|sigue|reanuda|reanudar)(?:\s+(?:la\s+)?(?:m[uú]sica|canci[oó]n|el\s+v[ií]deo|youtube|yt(?:\s*music)?|youtube\s*music))?[\s.!]*$/i],
  ['volup', /\b(louder|plus fort)\b|monte le son|turn (it )?up|sube el volumen|aumenta o volume|громче/i],
  ['voldown', /\b(quieter|moins fort)\b|baisse le son|turn (it )?down|baja el volumen|abaixa o volume|тише/i],
  ['mute', /\bmute\b|coupe le son|silencia|sem som|выключи звук/i],
];
// Her YouTube Music playlists: "reproduce mi playlist: oficial", "pon mi playlist oficial en yt music", "guarda esta playlist como oficial",
// "guarda la playlist oficial https://music.youtube.com/playlist?list=...", "qué playlists tengo"
// her player card: "muestra el reproductor", "esconde el reproductor", "fija el reproductor" (under her card), "suelta el reproductor" (to move it)
// "activa el aleatorio" / "pon aleatorio" / "quita el aleatorio": the shuffle button of YouTube Music's player (it turns it on or off: it does not say which it is)
// "haz una captura de pantalla" / "graba la pantalla por 30 segundos" / "para la grabación"
// "captura recortada" / "captura de una parte de la pantalla": the scanner's frame opens to pick the part
const REGION_ASK = /\b(?:captura|pantallazo|screenshot|screen\s?shot|recorte)\b[^.!?]*\b(?:recortad[oa]|parcial|seleccionad[oa]|selecci[oó]n|de\s+(?:una\s+|la\s+|esta\s+|esa\s+)?(?:parte|zona|[aá]rea|regi[oó]n|trozo|secci[oó]n|cuadro)|con\s+(?:el\s+)?esc[aá]ner)\b|\brecort(?:a|ar|e)\b[^.!?]*\b(?:pantalla|captura)\b|\bcaptura\s+recortada\b|\bcapturar?\s+(?:una\s+)?(?:parte|zona|[aá]rea|trozo)\b/i;
const SHOT_ASK = /\b(?:capturas?\s+(?:de\s+)?(?:la\s+|mi\s+)?pantalla|captura(?:me)?\s+(?:la\s+)?pantalla|pantallazo|screen\s?shot|screenshot|foto\s+(?:a|de)\s+(?:la\s+)?pantalla)\b/i;
const REC_STOP_ASK = /\b(?:para|parar|det[eé]n|detener|detenga|termina|terminar|acaba|finaliza|deja\s+de|stop)\b[^.!?]{0,30}\b(?:grabaci[oó]n|grabar|grabando|clip|v[ií]deo|video)\b|\b(?:grabaci[oó]n|clip)\b[^.!?]{0,15}\b(?:ya|listo|suficiente)\b/i;
const REC_START_ASK = /\b(?:gr[aá]ba(?:r|me)?|empieza\s+a\s+grabar|comienza\s+a\s+grabar|inicia\s+(?:una\s+|la\s+)?grabaci[oó]n|haz(?:me)?\s+un\s+clip|saca(?:me)?\s+un\s+clip|screen\s?record(?:ing)?|record\s+(?:my\s+|the\s+)?screen)\b[^.!?]*\b(?:pantalla|clip|v[ií]deo|video|screen)\b|\bun\s+clip\s+de\s+(?:la\s+)?pantalla\b/i;
const NUMBER_WORDS = { cinco: 5, diez: 10, quince: 15, veinte: 20, treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60 };
function clipSeconds(text) {
  const m = /(\d+(?:[.,]\d+)?)\s*(segundos?|segs?|minutos?|mins?)\b/i.exec(text);
  if (m) return Math.round(parseFloat(m[1].replace(',', '.')) * (/^m/i.test(m[2]) ? 60 : 1));
  const w = /\b(cinco|diez|quince|veinte|treinta|cuarenta|cincuenta|sesenta)\s+segundos\b/i.exec(text);
  if (w) return NUMBER_WORDS[w[1].toLowerCase()];
  if (/\bmedio\s+minuto\b/i.test(text)) return 30;
  if (/\b(?:un|1)\s+minuto\b/i.test(text)) return 60;
  return 0;
}
// "graba la pantalla con Capri" / "sin Capri": her in the picture or not, without asking
const WITH_CAPRI = /\bcon\s+capri\b|\bque\s+(?:salgas|aparezcas|salga\s+capri)\b|\bcontigo\s+(?:en\s+pantalla|visible)\b/i;
const WITHOUT_CAPRI = /\bsin\s+capri\b|\bsin\s+que\s+(?:salgas|aparezcas)\b|\bsin\s+ti\b/i;
const REC_PAUSE_ASK = /\b(?:paus[ae]r?|det[eé]n\s+un\s+momento|espera)\b[^.!?]{0,25}\b(?:grabaci[oó]n|grabar|grabando|clip)\b/i;
const REC_RESUME_ASK = /\b(?:contin[uú]a|sigue|reanuda|retoma|seguir|continuar)\b[^.!?]{0,25}\b(?:grabaci[oó]n|grabando|grabar|clip)\b/i;
const captureAsked = (text, recording) => (recording && REC_STOP_ASK.test(text) ? { kind: 'recStop' } : recording && REC_PAUSE_ASK.test(text) ? { kind: 'recPause' } : recording && REC_RESUME_ASK.test(text) ? { kind: 'recResume' } : REGION_ASK.test(text) ? { kind: 'shotRegion' } : SHOT_ASK.test(text) ? { kind: 'shot' } : REC_START_ASK.test(text) ? { kind: 'recStart', seconds: clipSeconds(text), withCapri: WITH_CAPRI.test(text) ? true : WITHOUT_CAPRI.test(text) ? false : null } : null);
const SHUFFLE_ASK = /^\s*(?:capri[\s,]+)?(?:activa|activar|pon|poner|desactiva|desactivar|quita|quitar|cambia|cambiar|alterna)\s+(?:el\s+|la\s+)?(?:modo\s+)?(?:aleatorio|aleatoria|shuffle|mezcla)\b/i;
const PLAYER_ASK = [
  ['show', /^\s*(?:capri[\s,]+)?(?:muestra(?:me)?|mu[eé]strame|abre|saca|pon|show)\s+(?:el\s+|the\s+|mi\s+)?(?:reproductor|player)\b/i],
  ['hide', /^\s*(?:capri[\s,]+)?(?:esconde|oculta|cierra|quita|guarda|hide|close)\s+(?:el\s+|the\s+|mi\s+)?(?:reproductor|player)\b/i],
  ['dock', /^\s*(?:capri[\s,]+)?(?:fija|ancla|pega|dock)\s+(?:el\s+|the\s+|mi\s+)?(?:reproductor|player)\b/i],
  ['float', /^\s*(?:capri[\s,]+)?(?:desfija|suelta|libera|desancla|float|undock)\s+(?:el\s+|the\s+|mi\s+)?(?:reproductor|player)\b/i],
];
const PLAYLIST_PLAY = /^\s*(?:capri[\s,]+)?(?:reproduce|reproducir|pon|ponme|toca|play|inicia|lanza|abre|abrir)\s+(?:mi\s+|la\s+|my\s+)?playlist\s*[:\-–,]?\s*(?:de\s+|llamada\s+)?(.+?)(?:\s+en\s+(?:yt|youtube)\s*music)?[\s.!]*$/i;
const PLAYLIST_SAVE = /^\s*(?:capri[\s,]+)?(?:guarda(?:r)?|a[nñ]ade|agrega|apunta)\s+(?:esta\s+|la\s+|mi\s+)?playlist\s+(?:como\s+|llamada\s+)?[:\-–]?\s*([^\s].*?)\s*(https?:\/\/\S+)?[\s.!]*$/i;
// "pon música" (no song, no name): her main playlist, or what was paused, or what already plays
const MUSIC_DEFAULT = /^\s*(?:capri[\s,]+)?(?:por\s+favor[\s,]+)?(?:pon(?:me)?|reproduce|dale|arranca|activa|m[eé]teme|suena|play)\s+(?:algo\s+de\s+|un\s+poco\s+de\s+|mi\s+|la\s+|una\s+)?(?:m[uú]sica|musiquita|playlist(?:\s+principal)?)(?:\s+(?:de\s+siempre|por\s+favor|porfa(?:vor)?|ahora|ya|ahorita|otra\s+vez|de\s+fondo|para\s+(?:trabajar|concentrarme|el\s+trabajo)|capri))*(?:\s+en\s+(?:yt|youtube)\s*music)?[\s.!,]*$|^\s*(?:capri[\s,]+)?m[uú]sica(?:\s+(?:por\s+favor|porfa(?:vor)?|ya|ahora))?[\s.!]*$/i;
const PLAYLIST_LIST = /\b(?:qu[eé]\s+playlists?\s+(?:tengo|guardaste|guardadas)|mis\s+playlists|cu[aá]les\s+(?:son\s+)?mis\s+playlists)\b/i;
const MUSIC_WORD = /musi|chanson|song|track|titre|morceau|spotify|canci|faixa|песн|музык|трек/i;
// "put X on Spotify", "mets X sur Spotify", "pon X en Spotify", "coloca X no Spotify", "включи X в Spotify"
const SPOTIFY_ASK = /(?:play|put on|put|mets|joue|lance|écoute|pon|toca|reproduce|coloca|toque|включи|поставь)\s+(?:moi\s+|me\s+)?(.+?)\s+(?:on|sur|en|no|na|в)\s+spotify/i;
const MEDIA_ACTIONS = new Set(MEDIA_ASK.map(([action]) => action));
// what her tag needs to find in your message before it does anything: a small model tags answers about
// anything ("[[music: synthwave]]" under a film tip), and music and the media keys act right away
const LISTEN = /[ée]cout|listen|escuch|\bouv(ir|e)\b|слуша|playlist|album|\b(play|joue|mets|pon|toca|coloca)\b|включи|поставь/i;
const SOUND = /\b(sound|volume|volumen)\b|\b(le|du|au) son\b|\bo som\b|звук|громк/i; // not "son": "his" in French
const PLAY = /\bjou(er|e)\b|\bplay\b|jugar|juega|jogar|joga|играть|поигра/i;
const SITE = /\b(site|web|page|lien|link|url|enlace|p[aá]gina)|сайт|ссылк|\.(com|fr|org|net|io|gg|tv|be|ch|ca|es|br|pt|ru)\b/i;
// "appelle-moi Max", "call me Max", "llámame Max", "me chama de Max", "зови меня Макс"
const NAME_ASK = /(?:appelle[- ]moi|call me|my name is|je m['’]appelle|ll[aá]mame|me llamo|me cham[ae] de|meu nome [eé]|зови меня|меня зовут)\s+([\p{L}\p{N}'’-]{1,24})/iu;
// "souviens-toi que…", "remember that…", "recuerda que…", "lembra que…", "запомни, что…" (said first thing)
const MEMO_ASK = /^\s*(?:capri,?\s+|stp,?\s+|please,?\s+)?(?:souviens[- ]toi(?: que| de)?|n['’]oublie pas(?: que| de)?|remember(?: that)?|recuerda(?: que)?|lembr[ae](?:-se)?(?: que| de)?|запомни,?(?: что)?)\s+(.{3,200})/iu;
const MEMORIES_MAX = 30;
// "empecemos de cero", "start over", "on recommence à zéro", "vamos começar do zero", "начнём с нуля": said
// on their own (the whole message), so "hazme un logo de cero" never restarts anything. She asks first anyway.
const RESET_ASK = /^\s*(?:capri[\s,]+)?(?:(?:empecemos|empezamos|comencemos|comenzamos|recomencemos|empezar|comenzar)\s+(?:de\s+nuevo|(?:de|desde)\s+cero)|(?:reiniciemos|reinicia|reiniciar)\s+(?:la\s+)?sesi[oó]n|nueva\s+sesi[oó]n|(?:let['’]s\s+)?start\s+(?:over|fresh|from\s+scratch)|(?:let['’]s\s+)?(?:start\s+a\s+)?new\s+session|on\s+recommence\s+(?:à|a)\s+z[ée]ro|repartons\s+de\s+z[ée]ro|nouvelle\s+session|vamos\s+(?:come[cç]ar|recome[cç]ar)\s+do\s+zero|nova\s+sess[aã]o|начн[её]м\s+с\s+нуля|новая\s+сессия)(?:\s*,?\s*(?:por\s+favor|please|s'il\s+te\s+pla[iî]t|por\s+favor))?[\s.!¡?¿]*$/iu;
// "¿qué suena?", "ahora suena", "what's playing", "qu'est-ce qui joue ?", "o que está tocando?", "что играет": the whole message
// "escanea", "mira esto", "qué ves", "scan", "look at this": opens her scanner (the whole message)
export { autoTaskOf };
const SCAN_ASK = /^[\s¿¡]*(?:capri[\s,]+)?(?:escanea(?:me)?(?:\s+(?:esto|la\s+pantalla|eso))?|abre\s+(?:el\s+)?esc[aá]ner|esc[aá]ner|mira\s+esto|m[ií]rame\s+esto|mira\s+(?:la\s+)?pantalla|qu[eé]\s+ves(?:\s+(?:aqu[ií]|ah[ií]))?|scan(?:ner)?(?:\s+this)?|open\s+(?:the\s+)?scanner|look\s+at\s+this|what\s+do\s+you\s+see)[\s.!?¡¿]*$/iu;
const NOW_ASK = /^[\s¿¡]*(?:capri[\s,]+)?(?:qu[eé]\s+(?:est[aá]\s+)?suena(?:\s+ahora)?|qu[eé]\s+est[aá]\s+sonando|ahora\s+suena|qu[eé]\s+canci[oó]n\s+(?:es|suena)(?:\s+esta)?|qu[eé]\s+estoy\s+escuchando|qu[eé]\s+suena\s+en\s+spotify|what(?:['’]s|\s+is)\s+(?:playing|this\s+song)(?:\s+now)?|now\s+playing|qu['’]est-ce\s+qui\s+joue|c['’]est\s+quoi\s+cette\s+chanson|o\s+que\s+est[aá]\s+tocando|что\s+(?:сейчас\s+)?играет)[\s.!?¡¿]*$/iu;
// what you answer to "¿empezamos de cero?"
const YES_ASK = /^\s*(?:s[ií]|sip|dale|va|vale|claro|h[aá]zlo|de\s+una|ok(?:ay)?|yes|yeah|yep|do\s+it|oui|vas-y|sim|bora|да|давай)(?![\p{L}])/iu;
const NO_ASK = /^\s*(?:no|nel|nop|mejor\s+no|cancela(?:r)?|d[eé]jalo|seguimos|sigamos|non|nope|n[aã]o|nah|keep\s+going|нет|не\s+надо)(?![\p{L}])/iu;
// local models this small mostly talk nonsense ("llama3.2:1b", "qwen2.5:0.5b"…)
const TINY = /[:-](0\.5b|1b|1\.5b|135m|270m|360m)\b/i;

// A job for Claude Code, with all your tools (your MCP servers: Figma, Canva…), not a chat: "dile a Claude que…",
// "Claude, …", "tarea: …", "en Figma cambia…". Everything that changes something asks on her card (llm.js).
const TASK_LEAD = /^\s*(?:capri[\s,]+)?(?:(?:dile|d[ií]gale|p[ií]dele|p[aá]sale|encarga(?:le)?|manda(?:le)?)\s+(?:a\s+)?claude(?:\s+(?:code|c[oó]digo))?(?:\s+que)?[\s,:]+|claude(?:\s+(?:code|c[oó]digo))?\s*[,:]\s*(?=\S)|tarea\s*[,:]\s*|(?:tell|ask)\s+claude(?:\s+code)?(?:\s+to)?[\s,:]+|task\s*[,:]\s*)/i;
const TASK_APP = /\b(?:en|con|usando|usa|desde|in|using)\s+(?:mi\s+|el\s+|la\s+|my\s+|the\s+)?(figma|canva|blender)\b/i;
// "manda los PDF a mis tablets", "envía estas fotos a mi celular": files for your devices (Claude copies them to the folder for Blip)
const SEND_FILES = /^\s*(?:capri[\s,]+)?(?:manda(?:me)?|env[ií]a(?:me)?|pasa(?:me)?|lleva|prepara|send)\b.*\b(?:archivos?|fotos?|im[aá]genes?|pdfs?|documentos?|carpeta|dise[nñ]os?|ilustraci\w+|videos?|audios?|files?|photos?)\b.*\b(?:tablets?|celular|tel[eé]fono|m[oó]vil|blip|dispositivos?|phone|devices?|para\s+enviar|(?:google\s+)?drive|la\s+nube|cloud)\b/i;
const TASK_START = {
  es: 'Va, se lo paso a Claude. Si necesita cambiar algo, te pregunto aquí.',
  en: 'On it, handing it to Claude. If it needs to change anything, I’ll ask you here.',
};
// what to tell Claude Code, or null if it's not a job for it
// Without being told ("dile a Claude..."): an order to DO something to your files, video, design or apps, which a small
// local model can't do (it has no hands). Questions ("¿cómo...?") and plain chat stay with the model she chats with.
// "abre yt music y whatsapp": the names of the apps in a sentence that asks for several, one by one ("abre", "por favor" and the like off)
const OPEN_LEAD = /^\s*(?:(?:oye|hey|ok|vale|capri|por\s+favor|puedes|podr[ií]as|me\s+puedes|quiero\s+que|necesito\s+que|please|can\s+you|could\s+you)[\s,]+)*(?:abre(?:me)?|abrir|inicia(?:r)?|ejecuta(?:r)?|lanza(?:r)?|open|launch|start|run)\s+/i;
// A few well-known services with no app of their own on this PC: when you ask for one and there is no such app, its own site is opened (a fixed list, never an address from the message)
// The little things you say to her that are not orders ("gracias", "buen trabajo", "chao"): she answers at once, with a line of her own, and it is never a
// conversation (nothing goes to a model, nothing is kept). Not while you are talking with Claude: there they are for Claude.
const SOCIAL = {
  thanks: /^\s*(?:(?:capri|oye|ok|vale|listo|perfecto|bueno)[\s,]+)*(?:(?:muchas|mil|much[ií]simas)\s+)?gracias(?:[\s,]+(?:capri|por\s+todo|por\s+eso|por\s+la\s+ayuda|de\s+verdad|amiga|preciosa))*[\s.!¡]*$|^\s*(?:thanks|thank\s+you|thx|ty)(?:\s+capri)?[\s.!]*$|^\s*te\s+(?:lo\s+)?agradezco[\s.!]*$|^\s*(?:eres\s+)?muy\s+amable[\s.!]*$/i,
  praise: /^\s*(?:capri[\s,]+)?(?:(?:muy\s+)?bien\s+hecho|buen\s+trabajo|excelente\s+trabajo|eres\s+(?:la\s+mejor|genial|incre[ií]ble|una\s+crack|buena|lo\s+m[aá]ximo)|qu[eé]\s+(?:crack|bien|buena\s+eres)|as[ií]\s+me\s+gusta|genial|excelente|perfecto|bravo|buen[ií]simo|bacano|chimba|brutal|te\s+quiero|good\s+job|well\s+done|nice)[\s.!¡]*$/i,
  bye: /^\s*(?:capri[\s,]+)?(?:chao|chau|adi[oó]s|hasta\s+luego|nos\s+vemos|hasta\s+ma[ñn]ana|buenas\s+noches|me\s+voy|bye|good\s*night)[\s.!¡]*$/i,
  hello: /^\s*(?:oye\s+)?capri[\s,.!¡]*$|^\s*(?:capri[\s,]+)?(?:hola|buenos\s+d[ií]as|buenas\s+tardes|buenas|qu[eé]\s+m[aá]s|qu[eé]\s+hubo|hey|hello|hi)(?:\s+capri)?[\s.!¡]*$/i,
};
// her tone when you asked for "coqueta" (or flirty...) in "Personalizarla": her own fixed lines change too, not only what her model answers
const isFlirty = (persona) => /coquet|flirt|seduc|p[ií]cara|picante|rom[aá]ntic/i.test(String(persona || ''));
const FLIRT_SOCIAL = {
  es: {
    thanks: ['Para ti, siempre. Ya lo sabes. Good boy.', 'Para ti, siempre. Ya lo sabes.', 'Qué lindo que me lo agradezcas. Cuando quieras.', 'De nada, {name}. Me encanta ayudarte, ¿lo notas?', 'Un placer. Tú pide y yo hago... lo que sea razonable.'],
    praise: ['Buen chico. Me gusta cuando me hablas así.', 'Uy, me vas a hacer sonrojar. Bueno, con casco puesto no se nota.', 'Sigue así y me vas a malacostumbrar.', 'Tú también tienes lo tuyo, {name}.', 'Me encanta cuando me hablas así.'],
    bye: ['Ya te extraño y ni te has ido. Vuelve pronto.', 'Descansa, {name}. Aquí te espero.', 'Chao. No tardes, que me aburro sin ti.'],
    hello: ['Hola, {name}. Justo estaba pensando en ti.', 'Aquí estoy. ¿Me extrañabas?', 'Ey, tú. Dime qué hacemos.'],
  },
  en: {
    thanks: ['For you, always. You know that. Good boy.', 'For you, always. You know that.', 'So sweet of you to say it. Anytime.', 'My pleasure, {name}. I love helping you, can you tell?'],
    praise: ['Careful, you will make me blush. Well, with the helmet on you cannot tell.', 'Keep that up and you will spoil me.', 'You have your charm too, {name}.'],
    bye: ['I miss you already and you have not even left. Come back soon.', 'Rest well, {name}. I will be waiting.', 'Bye. Do not be long, I get bored without you.'],
    hello: ['Hi, {name}. I was just thinking about you.', 'Here I am. Did you miss me?', 'Hey, you. Tell me what we are doing.'],
  },
};
const SOCIAL_LINES = {
  es: {
    thanks: ['De nada. Anytime, {name}.', 'Easy peasy. ¿Qué sigue?', 'De nada, {name}. Para eso estoy.', 'Cuando quieras, choom.', 'Sin problema. Si me das las gracias seguido me acostumbro.', 'A ti, preem. ¿Qué sigue?', 'Nada que agradecer. Bueno, un poquito sí.', 'Para eso me tienes aquí. De nada.'],
    praise: ['Lo sé. Pero gracias por notarlo.', 'Buen chico, tienes buen ojo.', 'Ya me estaba sintiendo subestimada. Gracias, choom.', 'Uy, me sonrojo. Bueno, tengo un casco, pero la intención cuenta.', 'Anotado en mi expediente de cosas geniales que hago.', 'Gracias, preem. Tú tampoco estás mal.'],
    bye: ['Chao. See you soon, {name}.', 'Nos vemos, {name}. Aquí sigo.', 'Descansa, choom. Yo me quedo vigilando.', 'Chao. No te tardes mucho.', 'Hasta luego. Avísame si me necesitas.'],
    hello: ['Aquí estoy, {name}. Let\'s go.', 'Aquí estoy, {name}. ¿Qué hacemos?', '¡Ey, choom! Te escucho.', 'Dime, preem.', 'Hola, hola. ¿En qué andamos?'],
  },
  en: {
    thanks: ['Anytime, {name}.', 'No problem, choom.', 'That is what I am here for.', 'You are welcome. What is next?'],
    praise: ['I know. Thanks for noticing.', 'Finally, some appreciation. Thanks, choom.', 'Noted in my file of awesome things.'],
    bye: ['See you, {name}. I will be here.', 'Rest well, choom.', 'Bye. Do not be long.'],
    hello: ['I am here, {name}. What are we doing?', 'Hey, choom. I am listening.', 'Tell me, preem.'],
  },
};
const socialKind = (text) => Object.keys(SOCIAL).find((k) => SOCIAL[k].test(String(text || '').trim())) || null;

// Folders and files by name ("abre mi carpeta de descargas", "abre el pdf de la cotización", "el último archivo descargado"): she opens them herself (main/finder.js)
const FOLDER_ASK = /^\s*(?:capri[\s,]+)?(?:por\s+favor[\s,]+)?(?:abre(?:me)?|abrir|mu[eé]stra(?:me)?|ens[eé][nñ]ame|ll[eé]vame\s+a|ve\s+a)\s+(?:la\s+|el\s+|mi\s+|mis\s+)?(?:carpeta\s+(?:de\s+)?(?:la\s+|mis\s+|mi\s+)?)?(descargas?|downloads|documentos|documents|escritorio|desktop|im[aá]genes|fotos|pictures|v[ií]deos?|m[uú]sica|capturas(?:\s+de\s+pantalla)?|clips|organizaci[oó]n\s+claude|capri)\s*[.!]*$/i;
const FILE_OPEN = /^\s*(?:capri[\s,]+)?(?:por\s+favor[\s,]+)?(?:abre(?:me)?|abrir|busca(?:me)?|encuentra(?:me)?|mu[eé]stra(?:me)?)\s+/i;
const FILE_NOUN = /\b(?:archivo|documento|pdf|imagen|foto|word|excel|presentaci[oó]n|factura|cotizaci[oó]n|contrato|hoja\s+de\s+c[aá]lculo|descarga)\b|\.(?:pdf|docx?|xlsx?|pptx?|png|jpe?g|webp|psd|ai|svg|txt|zip|mp4|csp|fig)\b/i;
const FILE_THEN = /\b(?:y|luego|despu[eé]s|para\s+que)\s+(?:c[aá]mbi|edit|resum|traduc|ordena|renombr|corrig|revis|anali|haz|cre[ae]|mand|env[ií]|borr|elimin|comprim|convert|lee|dime|expl|agrega|a[nñ]ade|quita)/i;
const fileAsked = (text) => (FILE_OPEN.test(text) && FILE_NOUN.test(text) && !FILE_THEN.test(text) && text.trim().split(/\s+/).length <= 12 ? { query: text.replace(FILE_OPEN, '').replace(/[.!?¡¿]+$/g, '').trim() } : null);
// apps that hold work: closing one by voice asks first (the others close at once)
const WORK_APPS = /chrome|edge|firefox|zen|brave|opera|vivaldi|illustrator|photoshop|indesign|lightroom|affinity|figma|blender|premiere|after\s*effects|davinci|clip\s*studio|krita|fusion|autocad|word|excel|powerpoint|visual\s*studio|vs\s*code|code|obs|unity|unreal|zbrush|substance/i;

const CLOSE_TARGET = /^\s*(?:capri[\s,]+)?(?:por\s+favor[\s,]+)?(?:cierra(?:me)?|cerrar|ci[eé]rrame|cierre)[\s,]+(?:la\s+|el\s+|mi\s+|esa\s+|esta\s+)?(?:app\s+(?:de\s+)?|aplicaci[oó]n\s+(?:de\s+)?|ventana\s+(?:de\s+)?|programa\s+)?(.+?)[\s.!]*$/i;

const CLOSE_EXPLORER = /^\s*(?:capri[\s,]+)?(?:por\s+favor[\s,]+)?(?:cierra(?:me)?|cerrar|ci[eé]rrame)\s+(?:todas\s+)?(?:las\s+|los\s+|el\s+|la\s+|mis\s+)?(?:ventanas?\s+(?:del?\s+)?)?(?:explorador(?:\s+de\s+archivos)?|carpetas(?:\s+abiertas)?|file\s+explorer|windows\s+explorer)[\s.!]*$/i;
const CLOSE_ALL = /^\s*(?:capri[\s,]+)?(?:por\s+favor[\s,]+)?(?:cierra(?:me)?|cerrar|ci[eé]rrame)\s+(?:todas\s+)?(?:las\s+)?ventanas\s+(?:de[l]?\s+)?(?:la\s+|el\s+|mi\s+)?(.+?)[\s.!]*$/i;

// files to and from your phone, by QR: "pásame la última captura al celular", "pasa esto al celular", "trae una foto del celular"
const PHONE_RECEIVE = /\b(?:p[aá]sa(?:me|r)?|tr[aá]e(?:me)?|traer|quiero\s+traer|recibe|recibir|sube|subir|manda(?:me)?)\b[^.!?]{0,40}\b(?:del|desde\s+(?:el|mi)|de\s+mi)\s+(?:celular|celu|cel|tel[eé]fono|m[oó]vil)\b|\bqr\b[^.!?]{0,30}\b(?:subir|recibir|traer)\b|\brecibe\s+(?:una\s+|unas\s+)?(?:foto|fotos|archivo|archivos)\b/i;
const PHONE_WORD = '(?:celular(?:es)?|celu|cel|tel[eé]fono|m[oó]vil|phone|iphone|android)';
const PHONE_SEND_VERB = /\b(?:p[aá]sa(?:me|rme|lo|la|los|las|r)?|m[aá]nda(?:me|rme|lo|la|los|las|r)?|env[ií]a(?:me|rme|lo|la|los|las|r)?|ll[eé]va(?:me|rme|lo|la|r)?|compart(?:e|ir)(?:me|lo|la)?|mand[ae]s|pas[ae]s|envi[ae]s|mande|env[ií]e)\b/i;
const PHONE_DEST = new RegExp('\\b(?:al|a\\s+mi|a\\s+el|a\\s+mis|para\\s+mi|para\\s+el|hacia\\s+mi|hacia\\s+el|en\\s+mi|en\\s+el)\\s+' + PHONE_WORD + '\\b', 'i');
const PHONE_QR = /\b(?:por|con|en|v[ií]a|mediante)\s+(?:un\s+|el\s+)?(?:c[oó]digo\s+)?qr\b|\bc[oó]digo\s+qr\b/i;
const PHONE_FILLER = /^\s*(?:(?:capri|oye|hey|ey|bueno|ok|listo)[\s,]+)?(?:(?:por\s+favor|porfa|porfis)[\s,]+)?(?:(?:me\s+)?(?:puedes|podr[ií]as|podes|quiero|necesito|quisiera|deseo|vamos\s+a|ay[uú]dame\s+a)\s+)?/i;
function phoneAsked(text) {
  if (PHONE_RECEIVE.test(text)) return { kind: 'phoneReceive' };
  if (text.trim().split(/\s+/).length > 28) return null;
  const verb = PHONE_SEND_VERB.exec(text);
  if (!verb) return null;
  const dest = PHONE_DEST.exec(text);
  const qr = PHONE_QR.exec(text);
  if (!dest && !qr) return null; // "manda un correo": not for the phone
  if (/\b(?:elegir|escoger|elijo|escojo|seleccionar|selecciono)\b/i.test(text)) return { kind: 'phoneSend', what: 'pick' }; // "quiero elegir qué mandar"
  // the thing to send is what stands between the verb and where it goes ("pásame la última captura al celular"); or what comes after the verb when the place comes first
  let obj = '';
  const end = dest ? dest.index : qr.index;
  if (end > verb.index + verb[0].length) obj = text.slice(verb.index + verb[0].length, end);
  else obj = text.slice(verb.index + verb[0].length).replace(PHONE_DEST, ' ').replace(PHONE_QR, ' ');
  obj = obj.replace(/\b(?:por\s+favor|porfa|porfis)\b/gi, ' ').replace(/[.!?¡¿,]+/g, ' ').replace(/\s+/g, ' ').trim();
  obj = obj.replace(/^(?:me\s+)?(?:un|una|unos|unas)?\s*/i, (m) => (/^me\s*$/i.test(m) ? '' : m)).trim();
  if (/\btablets?\b/i.test(obj)) return null; // (tablets: her older way, with Claude)
  if (/\b(?:los|las|todos|todas|varios|varias|unos|unas|algunos|algunas|archivos|fotos|elegir|escoger|elijo|escojo)\b/i.test(obj) && !/captura|pantallazo|clip|grabaci/i.test(obj)) return { kind: 'phoneSend', what: 'pick' }; // (several, or "I choose": her file window)
  if (!obj || /^(?:esto|eso|esta|este|esa|ese|lo|la|algo|un\s+archivo|una\s+cosa)$/i.test(obj)) return { kind: 'phoneSend', what: 'last' };
  if (/captura|pantallazo|screenshot|screen\s?shot/i.test(obj)) return { kind: 'phoneSend', what: 'captura' };
  if (/\bclip\b|grabaci[oó]n|video\s+de\s+la\s+pantalla/i.test(obj)) return { kind: 'phoneSend', what: 'clip' };
  if (/descarga|descarg[ué]+|[uú]ltimo\s+archivo|[uú]ltima\s+descarga|lo\s+[uú]ltimo/i.test(obj)) return { kind: 'phoneSend', what: 'descarga' };
  if (/^(?:la\s+|el\s+)?(?:[uú]ltim[oa]s?)\s*$/i.test(obj)) return { kind: 'phoneSend', what: 'last' };
  return { kind: 'phoneSend', what: 'archivo', query: obj.replace(/^(?:el|la|lo|mi|ese|esa|este|esta)\s+/i, '') };
}
const COLOR_ASK = /\b(?:cuentagotas|eye\s?dropper|selector\s+de\s+color|qu[eé]\s+color\s+es\s+(?:este|ese|esto|eso|aqu[ií]|ah[ií])|(?:copia|toma|saca|agarra|dame|captura|elige|escoge)(?:me)?\s+(?:un\s+|el\s+)?color(?:\s+de\s+(?:la\s+)?pantalla)?|color\s+de\s+(?:la\s+)?pantalla)\b/i;
const WHISPER_INSTALL = /^\s*(?:capri[\s,]+)?(?:instala(?:me)?|inst[aá]lame|descarga|pon|activa)\s+(?:el\s+|tu\s+)?whisper(?:\s+(?:local|en\s+(?:mi\s+)?pc))?[\s.!?¿¡]*$/i;
const BACKUP_ASK = /^\s*(?:capri[\s,]+)?(?:haz(?:me)?\s+(?:un\s+|mi\s+)?(?:respaldo|backup|copia\s+de\s+seguridad)|respalda(?:me)?(?:\s+(?:mis\s+)?(?:archivos|trabajos?|carpetas?|proyectos?))?|(?:hacer|haz)\s+(?:el\s+)?(?:respaldo|backup)|backup|(?:configura|cambia)\s+(?:el\s+|mi\s+)?respaldo|agrega\s+(?:una\s+)?carpeta\s+(?:a|al)\s+(?:mi\s+)?respaldo)[\s.!?¿¡]*$/i;
const MODEL_INSTALL = /^\s*(?:capri[\s,]+)?(?:instala(?:me)?|inst[aá]lame|descarga(?:me)?|baja(?:me)?|consigue(?:me)?)\s+(?:el\s+|un\s+)?(?:modelo\s+)?((?:qwen3|qwen2\.5|gemma3|llama3\.[12]|mistral|phi4-mini|deepseek-r1)\s*:\s*[0-9a-z.-]{1,16})[\s.!?¿¡]*$/i;
// "instala qwen3:8b" typed, or as Whisper writes it when you say it ("instala Quen 3 8B", "descarga el modelo gemma tres cuatro b"): -> 'qwen3:8b' or ''
const WORD_NUM = { uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, doce: 12, catorce: 14, veinte: 20, treinta: 30 };
export function modelFromText(text) {
  const t = String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[,.!?¿¡]+/g, ' ').replace(/\bpunto\b/g, '.').replace(/\s+/g, ' ').trim();
  if (t.length > 90 || !/\b(?:instala\w*|descarga\w*|baja\w*|consigue\w*|install|download)\b/.test(t)) return '';
  const num = (x) => (WORD_NUM[x] ?? x);
  const OK = /^(?:qwen3|gemma3|llama3\.[12]):(?:0\.6|1|1\.7|3|4|8|12|14|27|30|32|70)b$/;
  const compact = /\b(qwen3|gemma3|llama3\.[12])\s*:?\s*(\d{1,2}(?:\.\d)?)\s*b\b/.exec(t); // (as typed: "qwen3:8b")
  if (compact) { const n = `${compact[1]}:${compact[2]}b`; return OK.test(n) ? n : ''; }
  const fam = /\b(?:qwen|quen|kwen|gwen|cuen|quenn)\s*[-:]?\s*(3|tres|2 ?\.? ?5)\b/.exec(t) ? 'qwen3' : /\b(?:gemma|gema|jema|yema)\s*[-:]?\s*(3|tres)\b/.test(t) ? 'gemma3' : /\b(?:llama|lama|yama)\s*[-:]?\s*(3 ?\.? ?[12])\b/.exec(t) ? `llama${/3 ?\.? ?([12])/.exec(t)[1] ? `3.${/3 ?\.? ?([12])/.exec(t)[1]}` : '3.1'}` : '';
  if (!fam) return '';
  // the size comes after the family: "8b", "8 b", "ocho b", "8 billones", "30 mil millones"
  const rest = t.slice(t.search(/\b(?:qwen|quen|kwen|gwen|cuen|quenn|gemma|gema|jema|yema|llama|lama|yama)/)).replace(/^\S+\s*[-:]?\s*(?:3|tres|2 ?\.? ?5|3 ?\.? ?[12])?\s*[-:]?\s*/, '');
  const m = /(\d{1,2}(?:\.\d)?|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|doce|catorce|veinte|treinta)\s*(?:b|be|bi|billones?|mil millones)\b/.exec(rest) || /(\d{1,2}(?:\.\d)?|cuatro|ocho|doce|catorce|treinta)\b/.exec(rest);
  if (!m) return '';
  const size = String(num(m[1]));
  const name = `${fam}:${size}b`;
  return OK.test(name) ? name : '';
}
const DIAG_ASK = /^\s*(?:capri[\s,]+)?(?:diagn[oó]stico|estado(?:\s+de\s+(?:capri|sistema|tus\s+sistemas))?|revisa\s+(?:tus\s+)?sistemas|c[oó]mo\s+(?:est[aá]s|andas|va\s+todo)(?:\s+de\s+sistemas)?|status|self\s?check)[\s.!?¿¡]*$/i;
// League game mode and light mode (lol.js, heavy.js)
const LOL_ASK = /(?:(?:^|\s)(?:qu[eé]|cu[aá]l(?:es)?|dame|dime|recomi[eé]ndame|sugi[eé]reme|sugiere)(?=\s).*\b(?:build|items?|objetos?)\b|\b(?:build|items?|objetos?)\b.*\b(?:lol|league|partida|siguiente)\b|\b(?:lol|league|partida)\b.*\b(?:compro|comprar|build|items?|objetos?)\b)/i;
const LOL_WEAK = /^\s*(?:capri[\s,]+)?(?:y\s+)?(?:qu[eé]\s+(?:compro|debo\s+comprar|me\s+conviene\s+comprar|compro\s+ahora)|qu[eé]\s+item\s+sigue|qu[eé]\s+me\s+recomiendas\s+comprar)[\s.!?¿¡]*$/i;
const LOL_MODE_ON = /^\s*(?:capri[\s,]+)?(?:por\s+favor[\s,]+)?(?:activa|pon|prende|enciende)\s+(?:el\s+)?modo\s+juego[\s.!]*$/i;
const LOL_MODE_OFF = /^\s*(?:capri[\s,]+)?(?:por\s+favor[\s,]+)?(?:desactiva|quita|apaga|sal\s+del)\s+(?:el\s+)?modo\s+juego[\s.!]*$/i;
// Her list of ways to say an app: "cuando diga ilus abre Illustrator", "cuando diga yt me refiero a YouTube Music", "olvida el alias ilus", "qué alias tengo"
const ALIAS_SET = /^\s*(?:capri[\s,]+)?(?:cuando\s+(?:te\s+)?(?:diga|digo)|si\s+(?:te\s+)?(?:digo|diga))\s+[«"“']?(.{2,30}?)[»"”']?\s*,?\s+(?:(?:me\s+)?(?:refiero|hablo)\s+(?:a|de)|abre(?:s)?|es|significa|quiero\s+decir)\s+[«"“']?(.{2,40}?)[»"”']?[\s.!]*$/i;
const ALIAS_DEL = /^\s*(?:capri[\s,]+)?(?:olvida|borra|quita|elimina)\s+(?:el\s+)?alias\s+[«"“']?(.{2,30}?)[»"”']?[\s.!]*$/i;
const ALIAS_LIST = /^\s*(?:capri[\s,]+)?(?:qu[eé]\s+alias\s+tengo|mis\s+alias|lista\s+de\s+alias|cu[aá]les\s+son\s+mis\s+alias)[\s.!?¿¡]*$/i;
const HEAVY_ADD = /^\s*(?:capri[\s,]+)?(?:trata|considera|toma|pon|marca|a[ñn]ade|agrega)\s+(?:a\s+)?(?:el\s+|la\s+)?(.+?)\s+(?:como\s+(?:un\s+)?(?:(programa\s+|app\s+)|(juego\s+))?pesad[oa]|a\s+(?:la\s+lista\s+(?:de\s+)?)?(?:los?\s+)?(?:programas\s+)?pesad[oa]s?)[\s.!]*$/i;
const HEAVY_REMOVE = /^\s*(?:capri[\s,]+)?(?:quita|saca|elimina|borra)\s+(?:a\s+)?(?:el\s+|la\s+)?(.+?)\s+de\s+(?:la\s+lista\s+(?:de\s+)?)?(?:los?\s+)?(?:programas\s+)?pesad[oa]s?[\s.!]*$/i;
const HEAVY_LIST = /^\s*(?:capri[\s,]+)?(?:qu[eé]\s+(?:programas|juegos|apps)\s+(?:son\s+|tienes\s+como\s+)?pesad[oa]s|lista\s+de\s+(?:programas\s+)?pesad[oa]s|c[oó]mo\s+va\s+el\s+modo\s+ligero|modo\s+ligero)[\s.!?¿¡]*$/i;
// her voice: try one ("prueba la voz de Salomé"), keep it ("usa esta voz"), go back to the one she had ("vuelve a la voz de antes"), list them
// the voice for her flirty moments only ("usa esta voz para lo coqueto", "usa la voz de Dalia para lo coqueto", "quita la voz coqueta")
// how her English phrases sound: her own voice and accent ("habla el inglés con mi voz"), or an English voice; "prueba el inglés" says a sample
const GIGGLE_ASK = /^\s*(?:capri[\s,]+)?(?:r[ií]ete|ri[eé]ndote|haz(?:me)?\s+(?:una\s+)?risita|f[ií]ngete\s+una\s+risa|d[aá]me\s+(?:una\s+)?risita|ponme\s+(?:la\s+)?risita)[\s.!]*$/i;
const SETTINGS_ASK = /^\s*(?:capri[\s,]+)?(?:abre|abr[eé]me|mu[eé]stra(?:me)?|ens[eé][nñ]ame|quiero\s+ver)\s+(?:los\s+|tus\s+|mis\s+|el\s+panel\s+de\s+)?(?:ajustes|configuraci[oó]n|opciones|panel\s+de\s+ajustes)(?:\s+de\s+capri)?[\s.!]*$/i;
const ENGLISH_MINE = /^\s*(?:capri[\s,]+)?(?:habla|di|dilo|pronuncia)(?:\s+(?:todo|el))?\s*(?:en\s+)?ingl[eé]s\s+(?:con|en)\s+(?:mi\s+voz|tu\s+voz|la\s+misma\s+voz|tu\s+acento|acento\s+latino|la\s+voz\s+de\s+siempre)/i;
const ENGLISH_EN = /^\s*(?:capri[\s,]+)?(?:habla|di|dilo|pronuncia)(?:\s+(?:todo|el))?\s*(?:en\s+)?ingl[eé]s\s+(?:con|en)\s+(?:una\s+)?(?:voz\s+(?:en\s+ingl[eé]s|americana|de\s+ingl[eé]s)|acento\s+(?:americano|ingl[eé]s))/i;
const ENGLISH_TRY = /^\s*(?:capri[\s,]+)?(?:prueba|probar|dime\s+algo\s+en|di\s+algo\s+en)(?:me)?\s+(?:el\s+)?ingl[eé]s[\s.!]*$/i;
const FLIRT_SET = /^\s*(?:capri[\s,]+)?(?:usa|pon|cambia)\s+(?:a\s+)?(?:la\s+)?voz\s+(?:de\s+)?(salom[eé]|dalia|elena|paloma|paola)\s+para\s+(?:lo|los\s+momentos|las\s+cosas)\s+coquet\w+/i;
const FLIRT_USE = /^\s*(?:capri[\s,]+)?(?:usa|pon|d[eé]jala|guarda)\s+(?:esta|esa|esta\s+misma|esa\s+misma)\s+voz\s+para\s+(?:lo|los\s+momentos|las\s+cosas)\s+coquet\w+/i;
const FLIRT_OFF = /^\s*(?:capri[\s,]+)?(?:quita|desactiva|apaga)\s+(?:la\s+)?voz\s+coqueta/i;
const FLIRT_ON = /^\s*(?:capri[\s,]+)?(?:activa|enciende)\s+(?:la\s+)?voz\s+coqueta/i;
const VOICE_TRY = /^\s*(?:capri[\s,]+)?(?:por\s+favor[\s,]+)?(?:prueba|probar|ponme|pon|h[aá]blame\s+con|esc[uú]chame\s+con|quiero\s+(?:escuchar|probar|o[ií]r))\s+(?:me\s+)?(?:la\s+)?voz\s+(?:de\s+)?(salom[eé]|dalia|elena|paloma|paola|coqueta|original|de\s+antes|de\s+siempre)(?=[\s.!?,]|$)/i;
const VOICE_USE = /^\s*(?:capri[\s,]+)?(?:usa|me\s+quedo\s+con|qu[eé]date\s+con|d[eé]jala\s+con|guarda|quiero)\s+(?:esta|esa|esta\s+misma|esa\s+misma)\s+voz[\s.!]*$/i;
const VOICE_BACK = /^\s*(?:capri[\s,]+)?(?:vuelve|volvamos|regresa)\b.*\bvoz\b|\bvoz\s+(?:original|de\s+antes|de\s+siempre|anterior)\b/i;
const VOICE_LIST = /(?:qu[eé]|cu[aá]les)\s+voces\s+(?:tienes|hay)|lista\s+de\s+voces/i;
const BOOM_ASK = /^\s*(?:capri[\s,]+)?(?:haz|pon|prueba|suena|dame|hazme|ens[eé][nñ]ame)(?:me)?\s+(?:un\s+|el\s+)?(?:efecto\s+(?:de\s+)?)?boom[\s.!]*$/i;
const DND_ON = /^\s*(?:capri[\s,]+)?(?:por\s+favor[\s,]+)?(?:(?:activa|pon|prende|enciende|entra\s+en)\s+(?:el\s+)?(?:modo\s+)?(?:no\s+molestar|silencio|concentraci[oó]n)|no\s+molest(?:ar|es?)|no\s+me\s+molestes(?:\s+m[aá]s)?|silencio\s+(?:por\s+favor|un\s+rato)|modo\s+silencio)[\s.!]*$/i;
const DND_OFF = /^\s*(?:capri[\s,]+)?(?:(?:quita|desactiva|apaga|sal\s+del)\s+(?:el\s+)?(?:modo\s+)?(?:no\s+molestar|silencio|concentraci[oó]n)|ya\s+puedes\s+(?:hablar|molestar)|puedes\s+hablar|habla\s+(?:otra\s+vez|de\s+nuevo))[\s.!]*$/i;

const WEB_FOR = [[/\bwhats\s?app\b|\bwasap\b/i, 'https://web.whatsapp.com', 'WhatsApp'], [/\bgmail\b/i, 'https://mail.google.com', 'Gmail'], [/\binstagram\b/i, 'https://www.instagram.com', 'Instagram'], [/\bgoogle\s+drive\b|\bdrive\b/i, 'https://drive.google.com', 'Google Drive'], [/\byoutube\b(?!\s*music)/i, 'https://www.youtube.com', 'YouTube']];
const webFor = (name) => WEB_FOR.find(([re]) => re.test(String(name || ''))) || null;

function splitApps(text) {
  const body = String(text).replace(OPEN_LEAD, '').replace(/[.!?¡¿]+/g, ' ').replace(/\b(?:por\s+favor|please)\b/gi, ' ').trim();
  return body.split(/\s*(?:,|;|\s+y\s+|\s+e\s+|\s+and\s+|\s+et\s+|\s+tambi[eé]n\s+|\s+luego\s+|\s+then\s+)\s*/i)
    .map((p) => p.replace(/^(?:abre(?:me)?|abrir|inicia|ejecuta|lanza|open|launch|start|run)\s+/i, '').replace(/^(?:el|la|los|las|mi|mis|the|my)\s+/i, '').trim())
    .filter((p) => p.length >= 2);
}

// A greeting or a goodbye to her: in her 'only what matters' voice mode, those are answered out loud
const GREETING = /^(?:(?:oye|hey|hola|ok)[\s,]+)?(?:capri[\s,]+)?(?:buen(?:os|as)\s+(?:d[ií]as|tardes|noches)|buen\s+d[ií]a|hola|adi[oó]s|chao|chau|hasta\s+(?:luego|ma[nñ]ana|pronto)|nos\s+vemos|me\s+voy|good\s+(?:morning|afternoon|evening|night)|hello|hi|bye|goodbye|see\s+you|gn)\b[\s\S]{0,25}$/i;
const AUTO_VERB = /\b(?:edita|editar|recorta|corta|une|unir|convierte|convertir|exporta|exportar|renderiza|renderizar|comprime|comprimir|vectoriza|vectorizar|redimensiona|renombra|renombrar|mueve|mover|copia|copiar|organiza|organizar|descarga|descargar|instala|instalar|ejecuta|ejecutar|corre|crea|crear|genera|generar|haz|hazme|escribe|env[ií]a|manda|agenda|programa|arregla|corrige|edit|trim|cut|merge|convert|export|render|compress|vectorize|resize|rename|move|copy|organize|download|install|run|create|generate|write|send|schedule|fix)\b/i;
const AUTO_OBJECT = /\b(?:v[ií]deo|video|archivos?|files?|carpetas?|folders?|pdf|im[aá]genes?|images?|fotos?|photos?|proyecto|project|script|c[oó]digo|code|repo|figma|canva|blender|illustrator|photoshop|premiere|affinity|excel|word|powerpoint|correo|e-?mail|gmail|calendario|calendar|drive|escritorio|desktop|descargas|downloads)\b/i;
const QUESTION = /^\s*[¿]|\?\s*$|^\s*(?:c[oó]mo|qu[eé]|por\s+qu[eé]|cu[aá]l|cu[aá]ndo|d[oó]nde|how|what|why|which|when|where)\b/i;
function autoTaskOf(text) {
  const t = text.trim();
  if (t.split(/\s+/).length < 4 || QUESTION.test(t)) return null;
  return AUTO_VERB.test(t) && AUTO_OBJECT.test(t) ? t : null;
}

// "dile a Claude que X con opus": which Claude you want for it (else the one in her menu, Sonnet to start)
// "usa claude", "hazlo con claude", "pásalo a claude con opus": the message before, as a job for Claude Code
const USE_CLAUDE = /^[\s¿¡]*(?:capri[\s,]+)?(?:(?:h[aá]zlo|us[aá]lo|us[aá]|usa|mej(?:or)?|p[aá]salo|m[aá]ndalo|d[aá]selo)\s+(?:a|con)\s+claude|(?:us[aá]|usa)\s+claude|(?:use|do\s+it\s+with|send\s+it\s+to)\s+claude)(?:\s+(?:con|with)\s+(haiku|sonnet|opus))?[\s.!¡?]*$/i;
// "¿qué me dices sobre...?", "investiga...", "busca información de...", "últimas noticias de...", "tell me about...": a question about a TOPIC,
// which wants the web. (Not "háblame de ti", not "busca la canción...": those stay with her.)
// a Claude Code session id has to be a real UUID
const uuid = () => globalThis.crypto?.randomUUID?.() || 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
  const r = (Math.random() * 16) | 0;
  return (c === 'x' ? r : (r & 3) | 8).toString(16);
});

// "hoy 14:05", "ayer", "23 oct"
function whenOf(ms, lang) {
  const d = new Date(ms);
  const now = new Date();
  const days = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000);
  const en = lang === 'en';
  if (days <= 0) return `${en ? 'today' : 'hoy'} ${d.toLocaleTimeString(en ? 'en-US' : 'es-CO', { hour: 'numeric', minute: '2-digit' })}`;
  if (days === 1) return en ? 'yesterday' : 'ayer';
  return d.toLocaleDateString(en ? 'en-US' : 'es-CO', { day: 'numeric', month: 'short' });
}

const SEARCH_ASK = [
  /^[\s¿¡]*(?:capri[\s,]+)?(?:qu[eé]\s+(?:me\s+)?(?:dices|cuentas|sabes|puedes\s+decirme|opinas|piensas|hay)\s+(?:sobre|de|acerca\s+de|del)|h[aá]blame\s+(?:sobre|de|del|acerca\s+de)|cu[eé]ntame\s+(?:sobre|acerca\s+de|todo\s+(?:sobre|de))|dime\s+(?:qu[eé]\s+sabes\s+)?(?:sobre|acerca\s+de)|expl[ií]came\s+(?:sobre|acerca\s+de))\s+(?!ti\b|tu\b|t[uú]\b|vos\b|ustedes\b)\S.{2,}/iu,
  /^[\s¿¡]*(?:capri[\s,]+)?(?:investiga(?:me)?|averigua(?:me)?)\s+\S.{3,}/iu,
  /^[\s¿¡]*(?:capri[\s,]+)?busca(?:me)?\s+(?:(?:informaci[oó]n|info|datos|noticias|todo|algo)\s+)?(?:sobre|acerca\s+de|de|del|en\s+(?:internet|la\s+web|google))\s+\S.{2,}/iu,
  /^[\s¿¡]*(?:capri[\s,]+)?(?:[uú]ltimas\s+)?noticias\s+(?:de|sobre)\s+\S.{2,}/iu,
  /^[\s¿¡]*(?:capri[\s,]+)?(?:what\s+do\s+you\s+(?:know|think|say)\s+about|tell\s+me\s+about|research|look\s+up|search\s+for|find\s+(?:me\s+)?(?:info|information)\s+(?:on|about))\s+\S.{2,}/iu,
];
const searchAsk = (text) => SEARCH_ASK.some((re) => re.test(String(text || '').trim()));
const cap = (m) => m.charAt(0).toUpperCase() + m.slice(1);

const linksIn = (text) => [...new Set(String(text).match(/https?:\/\/[^\s<>"')\]]+/gi) || [])].slice(0, 3);


// "abre Claude Code", "lanza claude code", "open claude code": the terminal agent itself
const OPEN_CODE = /^[\s¿¡]*(?:capri[\s,]+)?(?:abre|abrir|abr[ée]me|lanza|inicia|open|launch|start)\s+(?:el\s+|the\s+)?claude[\s-]*code\b[\s.!?¡¿]*$/i;
// "¿cuánto he gastado de Claude?", "uso de claude", "claude usage": what her Claude jobs have used
const USAGE_ASK = /^[\s¿¡]*(?:capri[\s,]+)?(?:cu[aá]nto\s+(?:he\s+)?(?:gastado|usado|consumido)(?:\s+(?:de|en|con))?\s+claude|(?:uso|consumo|gasto)\s+(?:de\s+)?claude|claude\s+usage|how\s+much\s+(?:claude\s+)?(?:have\s+i|did\s+i)\s+(?:used|spent)(?:\s+claude)?)[\s.!?¡¿]*$/i;
const DESIGN_URL = 'https://claude.ai/design';
// "abre Claude Design": the web tool, in your browser
const OPEN_DESIGN = /^[\s¿¡]*(?:capri[\s,]+)?(?:abre|abrir|abr[ée]me|lanza|inicia|open|launch|start)\s+(?:el\s+|the\s+)?claude[\s-]*design\b[\s.!?¡¿]*$/i;
const MODEL_HINT = /\b(?:con|usando|using|with)\s+(haiku|sonnet|opus)\b/i;
const modelHint = (text) => MODEL_HINT.exec(text)?.[1]?.toLowerCase() || null;

function taskOf(text) {
  const lead = TASK_LEAD.exec(text);
  if (lead) return text.slice(lead[0].length).trim() || null;
  if (TASK_APP.test(text) && text.trim().split(/\s+/).length >= 4) return text.trim();
  if (SEND_FILES.test(text)) return text.trim();
  return null;
}

export class Chat {
  constructor({ capri, panel, voice, host, brain, speaker }) {
    this.speaker = speaker; // reads her answers out loud (talk.js)
    // the model loads when you START TYPING to her (not when the chat opens: a picture or an order does not need it); once per 60 s at most
    let warmedAt = 0;
    panel.chatInput?.addEventListener('input', () => { if (Date.now() - warmedAt > 60000 && panel.chatInput.value.trim()) { warmedAt = Date.now(); host.chatWarm?.(); } });
    this.planner = null;    // project stopwatch, deadlines, notes, summaries (planner.js, app.js)
    this.timers = null;     // timers and pomodoro, answered without the model (timers.js, app.js)
    this.live = null;       // her answer being spoken while it's written (talk.js)
    this.taskTurn = false;  // the answer coming in is a job done by Claude Code
    this.capri = capri;
    this.panel = panel;
    this.voice = voice;
    this.host = host;
    this.brain = brain;
    this.history = []; // the messages of the conversation you're in: [{ role, content }]; it IS this.session.messages
    this.session = null; // the conversation you're in (sessions.js keeps them all across restarts)
    this.saveTimer = 0;
    host.onSessionsChanged?.(() => { // the window changed a conversation: this one is no longer the latest word
      if (this.turn) return;
      clearTimeout(this.saveTimer);
      this.reloadId = this.session?.id || this.reloadId || null; // the same conversation, as the window left it
      this.session = null;
    });
    this.turns = 0;    // answers in Claude Code's conversation with her (llm.js counts them)
    this.warnedAt = 0; // `turns` when she last warned you the thread is long
    this.resetPending = false; // she asked "start over?" and waits for your yes or no
    this.warm = false; // a model already answered this run (Ollama's first answer waits for it to load)
    this.open = false;
    this.turn = 0;     // id of the answer coming in, if any
    this.answer = '';
    this.apps = [];    // the apps open on this PC, as last listed: [{ name, label }]
    this.appsReady = Promise.resolve();
    this.onSetup = null; // (status) => void: she can't answer yet (app.js hands it to setup.js)
    this.onBetterModel = null; // () => void: a bigger model than the tiny one she's on (setup.js)
    this.onWheel = null; // () => void: her wheel (app.js)
    this.panel.onType = (value) => this.suggestApps(value); // what you type: the apps that match, to press and open
    this.onBackground = null; // ({ ok, line, files, sessionId }) => void: a job for Claude finished after you closed her chat (app.js shows it)
    host.onChatDelta(({ id, text }) => this.onDelta(id, text));
  }

  get t() {
    return this.brain.t.chat;
  }

  // "the next message goes to Claude" / "...is a picture": setting them lights the button in the bar under her answer
  get claudeNext() { return this._claudeNext; }
  set claudeNext(v) { this._claudeNext = v; this.refreshModes(); }
  get imageNext() { return this._imageNext; }
  set imageNext(v) { this._imageNext = v; this.refreshModes(); }

  // Your message goes in as a bubble on your side, and a bubble of hers waits under it (the panel keeps the whole conversation)
  chatTurn(args) {
    this.panel.chatTurn(args);
  }

  // The bar that's always there in her chat (also when you open it with Ctrl+Alt+V): Claude, Image, Conversations.
  // Claude lit: the three Claudes as buttons, one press picks it.
  modeList() {
    const es = this.brain.lang !== 'en';
    const waiting = pending.count();
    return [
      { id: 'pending', label: waiting ? (es ? `Pendientes (${waiting})` : `Pending (${waiting})`) : (es ? 'Pendientes' : 'Pending'), on: waiting > 0, tip: es ? 'Mensajes de WhatsApp, Discord o Telegram sin responder: los ves y respondes desde aquí' : 'Unanswered WhatsApp, Discord or Telegram messages: read and answer them from here' }, // lit while something waits for you
      ...(this.agent ? [] : this._claudeNext
        ? [{ id: '', info: true, label: 'Claude:' }, ...['haiku', 'sonnet', 'opus'].map((m) => ({ id: `cm-${m}`, label: cap(m), on: this.claudeModel === m, tip: es ? 'Responder con Claude ' + cap(m) : 'Answer with Claude ' + cap(m) })), { id: 'code', label: 'Code ↗', on: false, tip: es ? 'Abrir Claude Code en una terminal' : 'Open Claude Code in a terminal' }, { id: 'design', label: 'Design ↗', on: false, tip: es ? 'Abrir Claude Design en la app de Claude' : 'Open Claude Design in the Claude app' }] // Code: Claude Code itself, in a terminal; Design: Claude Design (a web tool), in the Claude app
        : [{ id: 'claude', label: 'Claude', on: false, tip: es ? 'Pásale lo que escribas a Claude' : 'Send what you type to Claude' }]),
      { id: 'image', label: es ? 'Imagen' : 'Image', on: Boolean(this._imageNext), tip: es ? 'Crear o editar una imagen' : 'Make or edit an image' },
      { id: 'sessions', label: es ? 'Conversaciones' : 'Chats', on: Boolean(this.listOpen), tip: es ? 'Tus últimas 4 conversaciones' : 'Your latest 4 chats' }, // the latest four, to go back to one
      { id: 'window', label: es ? 'Ventana' : 'Window', on: false, tip: es ? 'Abrir la ventana grande de chats' : 'Open the big chat window' }, // her big window: all of them, to read and scroll
      { id: 'player', label: es ? 'Reproductor' : 'Player', on: Boolean(this.player?.enabled && !this.player?.hidden), tip: es ? 'Mostrar u ocultar el reproductor de música' : 'Show or hide the music player' }, // her player card: shown or hidden
      { id: 'dnd', label: es ? 'No molestar' : 'Do not disturb', on: Boolean(this.dndOn?.()), tip: es ? 'Capri se queda callada: sin voz ni comentarios' : 'Capri stays quiet: no voice, no remarks' }, // she keeps quiet: no voice, no remarks of her own
      { id: 'settings', label: es ? 'Ajustes' : 'Settings', on: false, tip: es ? 'Abrir los ajustes de Capri: voz, juego, sonidos, su tarjeta' : 'Open Capri settings: voice, game, sounds, her card' }, // her settings window
      { id: 'organize', label: es ? 'Organizar' : 'Organize', on: false, tip: es ? 'Ordenar tus archivos con tu organizador' : 'Sort your files with your organizer' }, // runs your file organizer (Organización Claude), like asking her "organiza mis archivos"
      { id: 'phoneSend', label: es ? 'Al celular' : 'To phone', on: false, tip: es ? 'Elegir archivos del PC y mandarlos al celular (QR)' : 'Pick PC files and send them to your phone (QR)' }, // the newest screenshot or clip, to the phone by QR (the same as "pásame esto al celular")
      { id: 'phoneReceive', label: es ? 'Del celular' : 'From phone', on: false, tip: es ? 'Recibir archivos del celular en el PC (QR)' : 'Receive files from your phone on the PC (QR)' }, // a QR: the phone picks what to send to the PC
    ];
  }

  refreshModes() {
    if (!this.open) return;
    this.panel.setModes?.(this.modeList(), (id) => this.pickMode(id));
  }

  pickMode(id) {
    const es = this.brain.lang !== 'en';
    if (id === 'player') {
      this.player?.command('toggle');
      setTimeout(() => this.refreshModes(), 200);
      return undefined;
    }
    if (id === 'dnd') { this.setDndTo(!this.dndOn?.()); return undefined; }
    if (id === 'pending') return this.pendingInChat(es ? 'pendientes' : 'pending');
    if (id === 'settings') { this.host.openSettings?.(); return undefined; }
    if (id === 'organize') return this.organizeNow();
    if (id === 'phoneSend' || id === 'phoneReceive') return this.runPhone(id === 'phoneSend' ? (es ? 'Al celular' : 'To phone') : (es ? 'Del celular' : 'From phone'), id === 'phoneSend' ? { kind: 'phoneSend', what: 'pick' } : { kind: 'phoneReceive' }, false);
    if (id === 'window') return this.openWindow();
    if (id === 'code') return this.openCode();
    if (id === 'design') return this.openDesign();
    if (id === 'sessions') { // the menu of the latest conversations: pressing it again closes it
      if (this.listOpen) {
        this.closeList();
        return undefined;
      }
      return this.showSessions().then(() => this.refreshModes());
    }
    if (id === 'claude' || id.startsWith('cm-')) {
      const picked = id.startsWith('cm-') ? id.slice(3) : null;
      // pressing the Claude that's already chosen turns it off; any other one chooses it
      const on = picked ? picked !== this.claudeModel || !this._claudeNext : !this._claudeNext;
      if (on) this.claudeModel = picked || this.taskModelName?.() || 'sonnet';
      this.imageNext = false;
      this.claudeNext = on;
      this.refreshModes();
      if (!on) this.shot = null;
      this.panel.chatInput.placeholder = on ? (es ? `Dile a Claude qué hacer (${cap(this.claudeModel)})…` : `Tell Claude what to do (${cap(this.claudeModel)})…`) : this.t.placeholder;
    } else if (id === 'image') {
      const on = !this._imageNext;
      this.claudeNext = false;
      this.imageNext = on;
      this.panel.chatInput.placeholder = on ? (es ? 'Describe la imagen…' : 'Describe the image…') : this.t.placeholder;
    }
    this.panel.chatInput.focus();
    return undefined;
  }

  // claude: opened from her CLAUDE button: whatever you type next goes to Claude Code (no "dile a Claude" needed)
  // greeting: { line, face }, what she says when you click her (her idle line), in place of her usual hello: the click opens the chat itself
  async start({ claude = false, attach = null, image = false, sessions = false, greeting = null } = {}) {
    const { capri, host, t } = this;
    const es = this.brain.lang !== 'en';
    const model = (this.taskModelName?.() || 'sonnet').replace(/^./, (c) => c.toUpperCase());
    const shotLine = es ? 'Tengo esa captura. Elige el Claude abajo y dime qué hago con ella.' : 'I have that capture. Pick the Claude below and tell me what to do with it.';
    const shotHint = es ? 'Qué hago con esta captura…' : 'What should I do with this capture…';
    const claudeLine = es ? 'Elige el Claude abajo (Haiku para lo rápido, Sonnet normal, Opus para lo difícil) y dime qué necesitas.' : 'Pick the Claude below (Haiku for quick, Sonnet for normal, Opus for hard) and tell me what you need.';
    const imageLine = es ? 'Dime qué imagen quieres y se la pido a Nano Banana (di «con pro» para la versión Pro).' : 'Tell me what image you want and I ask Nano Banana (say "with pro" for the Pro version).';
    const imageHint = es ? 'Describe la imagen…' : 'Describe the image…';
    const claudeHint = es ? `Dile a Claude qué hacer (${model})…` : `Tell Claude what to do (${model})…`;
    const defaultClaude = this.taskModelName?.() || 'sonnet';
    if (this.open) {
      // (her chat was left open when she put herself away: the key must bring her out, not just find the chat "already open")
      if (capri.stowed) {
        host.setConfig({ visible: true });
        await capri.unstow();
      }
      if (sessions) this.showSessions();
      if (image) {
        this.imageNext = true;
        this.panel.chatInput.placeholder = imageHint;
      }
      if (claude && !this.agent) {
        this.claudeModel = defaultClaude;
        this.claudeNext = true;
        this.shot = attach;
        this.panel.chatInput.placeholder = attach ? shotHint : claudeHint;
      }
      if (!this.autoCloseGame?.()) this.panel.chatInput.focus(); // (not with a game open: its keys would type into her box)
      if (!claude && !image && !sessions && !attach) this.armAutoClose(); // (already open and you call her again: the same countdown)
      return;
    }
    if (capri.stowed) {
      host.setConfig({ visible: true });
      await capri.unstow();
    }
    capri.wake();
    let status = await host.chatStatus();
    // Claude Code needs no Ollama or any chat model: a task still goes through when the local chat isn't up
    if ((claude || image) && !status.ok) status = { ok: true, provider: 'claude-task', model: 'Claude', local: false, agent: false, warmup: false };
    if (!status.ok && this.onSetup) {
      this.onSetup(status); // nothing to talk with yet: she sets it up with you, with buttons (setup.js)
      return;
    }
    if (!status.ok) {
      // no Ollama, or nothing to talk with yet: what to do about it
      const offline = status.error === 'offline';
      const other = !offline && status.error !== 'nomodel'; // another provider, saying why
      capri.perform('curious', capri.towardCenter());
      this.panel.say({
        kind: 'info',
        face: 'aside',
        guide: true,
        line: other ? t.failed : offline ? t.offline : t.noModel,
        quote: other ? status.error : offline ? t.offlineHow : t.noModelHow,
        actions: offline
          ? [{ id: 'get', label: t.getOllama, primary: true }, { id: 'ok', label: t.ok }]
          : [{ id: 'ok', label: t.ok, primary: true }],
        onAction: (id) => {
          if (id === 'get') host.openOllama();
          this.panel.hide();
        },
        hold: null,
      });
      return;
    }
    await this.loadCurrent(); // the conversation you were in, or a new one
    this.cold = status.warmup && !this.warm;
    this.agent = Boolean(status.agent); // Claude Code answers, as her, and really works in your project
    this.sees = Boolean(status.sees); // her model takes pictures
    this.resetPending = false;
    this.turns = this.agent ? Number((await host.chatSession().catch(() => null))?.turns) || 0 : 0;
    this.listApps();
    const shortModel = status.model.replace(/:latest$/, '');
    const tiny = status.provider === 'ollama' && TINY.test(status.model) && this.onBetterModel;
    const inGame = Boolean(this.autoCloseGame?.()); // (a game is open: she does not take the keyboard from it, or its keys would type into her box; talk to her by voice)
    if (!inGame) host.focusOverlay(true); // the keyboard, for typing to her
    // back to a conversation: what was said last stays on screen (her answer, and what you asked)
    const lastA = [...this.history].reverse().find((m) => m.role === 'assistant');
    const lastU = lastA ? [...this.history].slice(0, this.history.lastIndexOf(lastA)).reverse().find((m) => m.role === 'user') : null;
    const resumed = !image && !claude && !tiny && lastA ? lastA.content.slice(0, 900) : null;
    const shown = this.panel.say({
      kind: 'chat',
      face: greeting?.face || 'look',
      badge: t.badge,
      tag: shortModel,
      line: image ? imageLine : claude && !status.agent ? (attach ? shotLine : claudeLine) : tiny ? fmt(t.tiny, { model: shortModel }) : this.history.length ? '' : (greeting?.line || pick(t.hello)),
      actions: [
        ...(tiny ? [{ id: 'better', label: t.better, primary: true }] : []),
      ],
      onAction: (id) => {
        this.panel.hide(); // her chat holds off her guide's panels: it goes first
        return this.onBetterModel?.();
      },
      chat: {
        placeholder: image ? imageHint : claude && !status.agent ? (attach ? shotHint : claudeHint) : t.placeholder,
        send: t.send,
        close: t.close,
        noteTag: t.noteTag,
        note: status.local ? t.note : t.noteCloud,
        onReset: this.agent ? () => this.askReset() : null, // the ↻ button, with the count of answers
        bubbles: true, // the conversation as bubbles, yours on the right, hers on the left
        history: this.history.map(({ role, content }) => ({ role, content })),
        modes: this.modeList(), // Claude / Image / Chats, always under her answer
        onMode: (id) => this.pickMode(id),
        onAttach: () => this.pickFiles(), // the + button
        onFiles: (paths) => this.addFiles(paths), // dropped or pasted
        hasFiles: () => (this.attachments || []).length > 0,
      },
      onSend: (text) => this.send(text),
      onLeave: () => this.close(),
      hold: null,
    });
    if (!shown) {
      host.focusOverlay(false); // something more important is on (a permission prompt)
      return;
    }
    this.open = true;
    if (resumed && lastA.files?.length) this.offerFiles(lastA.files); // what was made then can still be opened
    if (sessions) this.showSessions();
    this.imageNext = image;
    if (claude) this.claudeModel = defaultClaude; // the one lit in the bar; one press picks another
    this.claudeNext = !image && claude && !this.agent;
    this.shot = this.claudeNext ? attach : null;
    this.updateCounter();
    this.startNow();
    const typed = this.takeAhead?.() || ''; // what you wrote while she was coming out
    if (typed && !this.panel.chatInput.value) {
      this.panel.chatInput.value = typed;
      this.panel.grow?.();
    }
    const toBox = () => {
      const box = this.panel.chatInput;
      if (!this.open || document.activeElement === box) return;
      box.focus();
      box.setSelectionRange?.(box.value.length, box.value.length); // the cursor after what is there
    };
    if (!inGame) for (const ms of [0, 150, 450, 900]) setTimeout(toBox, ms); // once the overlay has the keyboard (asked again: it can take a moment)
    // if by then the window still does not have the keyboard, the main process clicks the box for you (and puts the pointer back)
    if (!inGame) for (const ms of [700, 1500]) {
      setTimeout(() => {
        if (!this.open) return;
        const r = this.panel.chatInput.getBoundingClientRect();
        if (r.width > 0) this.host.focusInput?.({ x: r.left, y: r.top, width: r.width, height: r.height });
      }, ms);
    }
    capri.perform('hop');
    capri.nextMove = capri.nextGaze = performance.now() + STAY_MS;
    if (!claude && !image && !sessions && !attach) this.armAutoClose(); // (a plain call: the card goes by itself if you do nothing)
  }

  // She was called out and you are not using her card: it goes by itself after a few seconds, like Esc (config cardAutoClose, in ms; 3500 by default, 0 = never).
  // "Using it" is only this: the pointer is over the card, there is text in its box (or she is answering, or something is attached). Whatever else happens
  // (keys, clicks elsewhere, a game), once the card has been left alone for that long it goes. Out of use again later, the count starts again.
  armAutoClose() {
    this.autoCleanup?.();
    const ms = Number(this.autoCloseMs?.() ?? 3500);
    if (!(ms > 0)) return;
    const box = this.panel.chatInput;
    const el = this.panel.el;
    let lastUse = performance.now();
    const inUse = () => Boolean(box?.value?.trim()) || Boolean(this.turn) || (this.attachments || []).length > 0 || Boolean(this.resetPending) || el.matches(':hover') || Boolean(this.voiceBusy?.());
    const touch = () => { lastUse = performance.now(); };
    box?.addEventListener('input', touch);
    const timer = setInterval(() => {
      if (!this.open || el.hidden) { cleanup(); return; }
      if (inUse()) { lastUse = performance.now(); return; }
      if (performance.now() - lastUse < ms) return;
      if (this.autoCloseGame?.()) this.host.lolNote?.(`card auto-close: closed after ${Math.round(performance.now() - lastUse)} ms`);
      cleanup();
      this.panel.hide(); // (what Esc does)
    }, 300);
    const cleanup = () => {
      clearInterval(timer);
      box?.removeEventListener('input', touch);
      this.autoCleanup = null;
    };
    this.autoCleanup = cleanup;
  }

  close() {
    this.autoCleanup?.();
    if (!this.open) return;
    this.open = false;
    this.claudeNext = false;
    this.imageNext = false;
    this.attachments = [];
    this.thread = null;
    this.panel.setChips?.([]);
    this.panel.setSuggestions?.([]);
    this.shot = null;
    this.saveNow(); // the conversation stays for next time
    this.stopNow();
    this.speaker?.stop();
    if (this.turn) {
      if (this.taskTurn) (this.bgTurns ||= new Set()).add(this.turn); // a job for Claude goes on: its answer lands in the conversation, and she tells you
      else this.host.chatStop(this.turn); // her own model: no point going on
    }
    this.turn = 0;
    this.host.focusOverlay(false);
    this.capri.nextMove = performance.now() + 30000;
    this.capri.nextGaze = performance.now() + 60000;
  }

  async send(text, { voice = false } = {}) {
    if (this.turn || !this.open) return;
    if (this.speaker?.important && GREETING.test(String(text).trim())) voice = true; // (greetings and goodbyes are said out loud in the 'only what matters' mode)
    if (!this.session) await this.loadCurrent(); // the window changed things meanwhile: start from what's on disk
    if (this.resetPending) { // she asked "start over?": a yes or a no, else she drops it and this is a new message
      const yes = YES_ASK.test(text);
      if (yes || NO_ASK.test(text)) return this.answerReset(text, yes, voice);
      this.resetPending = false;
      this.panel.setActions([]);
    }
    if (this.agent && RESET_ASK.test(text)) return this.askReset(text, voice);
    if (this.attachments?.length) return this.sendWithFiles(text, voice); // you attached something: it decides how it goes
    if (this.editTarget) { // her EDITAR button was pressed: this is what to change in that picture
      const file = this.editTarget;
      this.editTarget = null;
      this.panel.chatInput.placeholder = this.t.placeholder;
      return this.imageReply(text, voice, text, [], file);
    }
    const recent = this.recentImage();
    if (recent && imgAsk(text)) return this.imgReply(text, [recent], imgAsk(text), voice); // "pásala a webp" / "achícala" to the last picture she made
    if (recent && bgAsk(text)) return this.bgReply(text, recent, voice); // "quítale el fondo" to the last picture she made: rembg, here, free
    if (recent && imageEditFollow(text)) return this.imageReply(text, voice, text, [], recent); // "ahora hazla azul": the last picture she made
    if (paletteAsk(text)) { // the colours of the last picture, or of the screen
      if (recent) return this.paletteReply(text, recent, voice);
      const es = this.brain.lang !== 'en';
      this.host.scannerOpen?.();
      return this.replyLocal(text, { line: es ? 'Abriendo el marco del escáner: ponlo sobre lo que quieras y dale PALETA (o la tecla P). O adjunta una imagen y pídeme la paleta.' : 'Opening the scanner frame: put it over what you want and press PALETTE (or the P key). Or attach a picture and ask me for its palette.', face: 'smug' }, voice);
    }
    const msgQ = msgAsk(text);
    if (msgQ) return this.msgFlow(text, msgQ, voice);
    const winQ = winAsk(text);
    if (winQ) return this.winFlow(text, winQ, voice);
    if (cleanAsk(text)) return this.cleanFlow(text, voice);
    if (perfAsk(text)) return this.perfFlow(text, voice);
    if (resumeAsk(text)) return this.resumeShow(text, voice); // "retoma lo de ayer": the files you opened last, as buttons (an order: not kept as a conversation)
    if (USAGE_ASK.test(text)) { // what her Claude jobs have used, from the record she keeps
      const sum = await this.host.usageSummary?.().catch(() => null);
      const es = this.brain.lang !== 'en';
      return this.replyLocal(text, { line: `${usageLine(sum, this.brain.lang)} ${USAGE_NOTE[es ? 'es' : 'en']}`, face: 'smug' }, voice);
    }
    if (OPEN_DESIGN.test(text)) { // "abre Claude Design"
      ui(this.voice, 'go');
      await this.openDesign(); // (an order: it is not kept as a conversation)
      return undefined;
    }
    if (OPEN_CODE.test(text)) { // "abre Claude Code": the real one, in a terminal
      ui(this.voice, 'go');
      await this.openCode(); // (an order: it is not kept as a conversation)
      return undefined;
    }
    if (this.imageNext) { // she was opened with her IMAGEN button: this is the picture you want
      this.imageNext = false;
      if (this.panel.chatInput) this.panel.chatInput.placeholder = this.t.placeholder;
      return this.imageReply(text, voice, imageAsk(text) || text);
    }
    if (this.claudeNext && !this.agent) { // she was opened with her CLAUDE button: this message is the job
      const model = modelHint(text) || this.claudeModel || undefined;
      this.claudeNext = false;
      if (this.panel.chatInput) this.panel.chatInput.placeholder = this.t.placeholder;
      const shot = this.shot;
      this.shot = null;
      // the capture goes along as a file Claude reads: "[captura]: C:\...\scan-123.png"
      const job = shot ? `${text}\n\n[Screenshot of what I am looking at, read it with the Read tool: ${shot}]` : text;
      return this.dispatch(text, job, model, voice, { threaded: true });
    }
    // A plain order about the PC ("abre WhatsApp", "pausa", "siguiente", "pon mi playlist", "captura de pantalla"): she does it herself, at once, wherever
    // you are, even in the middle of a conversation with Claude. It is never sent to Claude and never kept as a conversation of its own.
    const sys = await this.systemOrder(text);
    if (this.turn) return;
    if (sys) { await this.runSystemOrder(text, sys, voice); return; }
    const useClaude = USE_CLAUDE.exec(text);
    if (useClaude && this.lastAsk && !this.agent) return this.dispatch(this.lastAsk, this.lastAsk, useClaude[1]?.toLowerCase() || null, voice);
    if (NOW_ASK.test(text)) return this.nowReply(text, voice);
    if (SCAN_ASK.test(text)) return this.scanReply(text, voice);
    const wantsImage = imageAsk(text);
    if (wantsImage) return this.imageReply(text, voice, wantsImage);
    // a look-it-up question goes straight to Claude (with the web), no waiting for her own model to say it can't; and
    // once you're in one, what you say next stays with Claude (same conversation, the model you pick) until "Charla normal"
    if (!this.agent && !this.thread && this.lastClaudeAt && Date.now() - this.lastClaudeAt < 15 * 60000 && followUpAction(text)) { // it follows what Claude just did: her own model has no hands
      return this.offerTask(text, text, voice, {
        why: this.brain.lang !== 'en'
          ? 'Eso sigue lo que Claude acaba de hacer, y yo no puedo tocar archivos. ¿Se lo paso? Haiku para lo sencillo, Sonnet normal, Opus para lo pesado.'
          : 'That follows what Claude just did, and I cannot touch files. Shall I pass it on? Haiku for simple, Sonnet for normal, Opus for heavy.',
      });
    }
    const searchWith = this.searchModelName?.() || 'haiku';
    if (!this.agent && this.thread) return this.dispatch(text, text, this.thread.model, voice, this.thread.kind === 'task' ? { threaded: true } : { research: true });
    if (!this.agent && searchWith !== 'off' && searchAsk(text)) {
      const why = this.brain.lang !== 'en'
        ? 'Para buscarlo necesito internet, y eso lo hace Claude (gasta de tu límite). ¿Con cuál? Haiku es rápido, Sonnet va más a fondo, Opus para lo difícil.'
        : 'To look it up I need the web, and Claude does that (it spends your limit). Which one? Haiku is quick, Sonnet goes deeper, Opus for hard ones.';
      return searchWith === 'ask' ? this.offerTask(text, text, voice, { research: true, why }) : this.dispatch(text, text, searchWith, voice, { research: true });
    }
    const plan = await this.planner?.handle(text).catch(() => null); // her planner and timers: no need to ask the model
    if (this.turn) return; // (a second message arrived while the planner was thinking)
    const local = plan || this.timers?.handle(text);
    if (local) return this.replyLocal(text, { ...local, command: true }, voice); // (a note, a timer: a command, not a conversation)
    // A plain order (open apps, music, the volume): done and answered with one short line, with no model in between. The model used to write a
    // whole answer first and she read it out, ten seconds in which she could not hear the next order.
    const quick = !this.agent ? this.asked(text) : null;
    if (quick && ['open', 'media', 'music', 'playlist', 'playlistSave', 'playlistList', 'player', 'shuffle'].includes(quick.kind)) {
      const done = await this.doNow(quick).catch(() => null);
      if (this.turn) return;
      if (done) return this.replyLocal(text, { ...done, minor: true, command: true }, voice);
    }
    const explicit = taskOf(text); // you said "dile a Claude…" / "en Figma…": that's your word, it goes
    const offered = !explicit && !this.agent && this.autoTasks?.() ? autoTaskOf(text) : null;
    if (offered) return this.offerTask(text, offered, voice); // it looks like it needs Claude: she asks first, it costs
    return this.dispatch(text, explicit, explicit ? modelHint(text) : null, voice);
  }

  // Is this a plain order for the PC? { cap } (a screenshot or a clip) or what asked() read off it (open, media, music, playlist, player, shuffle); null when it is not.
  // Apps are only taken for an order when they exist here: "abre el archivo y cámbiale el título" is for Claude.
  async systemOrder(text) {
    text = canon(text);
    if (this.resetPending || this.editTarget) return null;
    if (this.pendingOffer && Date.now() - this.pendingOffer.at < 180000) { // (a Permitir / Denegar she asked in the chat: you can also answer it by writing or saying it)
      if (/^(s[ií]|ok|okay|dale|va|vale|listo|permitir|permito|adelante|claro|yes|allow|go)[\s.!]*$/i.test(text.trim())) return { kind: 'offerAnswer', yes: true };
      if (/^(no|nop|nel|denegar|deniego|cancela|cancelar|deny)[\s.!]*$/i.test(text.trim())) return { kind: 'offerAnswer', yes: false };
    }
    const aSet = ALIAS_SET.exec(text);
    if (aSet) return { kind: 'alias', what: 'set', from: aSet[1].trim(), to: aSet[2].trim() };
    const aDel = ALIAS_DEL.exec(text);
    if (aDel) return { kind: 'alias', what: 'del', from: aDel[1].trim() };
    if (ALIAS_LIST.test(text)) return { kind: 'alias', what: 'list' };
    text = applyAliases(text, { ...ALIAS_DEFAULTS, ...(await this.aliasMine()) }); // ("abre wasap" -> "abre WhatsApp": the way you say it, or the way Whisper writes it)
    // only the verb ("abre", "cierra"): she asks what, and what comes next (within a few seconds) is the thing: "figma" -> "abre figma"
    const verbOnly = /^\s*(?:capri[\s,]+)?(?:por\s+favor[\s,]+)?(abre(?:me)?|abrir|cierra(?:me)?|cerrar)[\s.!,¡]*$/i.exec(text);
    if (verbOnly) return { ask: /^c/i.test(verbOnly[1]) ? 'cierra' : 'abre' };
    if (this.pendingVerb) {
      const waiting = this.pendingVerb;
      this.pendingVerb = null;
      if (Date.now() - waiting.at < 15000 && text.trim().split(/\s+/).length <= 5 && !/[?¿]/.test(text)) return this.systemOrder(`${waiting.verb} ${text.trim()}`);
    }
    const phone = phoneAsked(text);
    if (phone) return phone;
    if (COLOR_ASK.test(text)) return { kind: 'color' };
    if (DIAG_ASK.test(text)) return { kind: 'diag' };
    if (WHISPER_INSTALL.test(text)) return { kind: 'whisperInstall' };
    { const mi = modelFromText(text); if (mi) return { kind: 'modelInstall', name: mi }; }
    if (BACKUP_ASK.test(text)) return { kind: 'backup', setup: /configura|cambia|agrega/i.test(text) };
    if (GIGGLE_ASK.test(text)) return { kind: 'giggle' };
    if (SETTINGS_ASK.test(text)) return { kind: 'settings' };
    if (ENGLISH_MINE.test(text)) return { kind: 'englishVoice', mode: 'mine' };
    if (ENGLISH_EN.test(text)) return { kind: 'englishVoice', mode: 'english' };
    if (ENGLISH_TRY.test(text)) return { kind: 'englishVoice', mode: 'try' };
    const fSet = FLIRT_SET.exec(text);
    if (fSet) return { kind: 'flirtVoice', what: 'set', name: fSet[1] };
    if (FLIRT_USE.test(text)) return { kind: 'flirtVoice', what: 'use' };
    if (FLIRT_OFF.test(text)) return { kind: 'flirtVoice', what: 'off' };
    if (FLIRT_ON.test(text)) return { kind: 'flirtVoice', what: 'on' };
    const vTry = VOICE_TRY.exec(text);
    if (vTry) return { kind: 'voiceTry', name: vTry[1].replace(/\s+/g, ' ').toLowerCase().replace(/^de (antes|siempre)$/, 'original') };
    if (VOICE_USE.test(text)) return { kind: 'voiceUse' };
    if (VOICE_BACK.test(text)) return { kind: 'voiceBack' };
    if (VOICE_LIST.test(text)) return { kind: 'voiceList' };
    if (BOOM_ASK.test(text)) return { kind: 'boom' };
    if (LOL_MODE_ON.test(text)) return { kind: 'lolMode', on: true };
    if (LOL_MODE_OFF.test(text)) return { kind: 'lolMode', on: false };
    const hAdd = HEAVY_ADD.exec(text);
    if (hAdd && hAdd[1].split(/\s+/).length <= 4) return { kind: 'heavyAdd', name: hAdd[1].trim(), game: Boolean(hAdd[3]) };
    const hDel = HEAVY_REMOVE.exec(text);
    if (hDel && hDel[1].split(/\s+/).length <= 4) return { kind: 'heavyRemove', name: hDel[1].trim() };
    if (HEAVY_LIST.test(text)) return { kind: 'heavyList' };
    if (LOL_ASK.test(text) && text.split(/\s+/).length <= 14 && await this.host.lolActive?.().catch(() => false)) return { kind: 'lol' };
    if (LOL_WEAK.test(text) && await this.host.lolActive?.().catch(() => false)) return { kind: 'lol' };
    if (DND_ON.test(text)) return { kind: 'dnd', on: true };
    if (DND_OFF.test(text)) return { kind: 'dnd', on: false };
    if (CLOSE_EXPLORER.test(text)) return { kind: 'closeExplorer' };
    const allWin = CLOSE_ALL.exec(text);
    if (allWin && allWin[1].split(/\s+/).length <= 4) return { kind: 'closeAll', name: allWin[1] };
    if (!this.inClaude) { // "gracias", "buen trabajo", "chao": she answers, as a friend would
      const social = socialKind(text);
      if (social) return { social };
    }
    const cap = this.capture ? captureAsked(text, this.capture.recording) : null;
    if (cap) return { cap };
    if (CLOSE_ASK.test(text)) { this.listApps(); await this.appsReady; } // (what is open now: the list could be old)
    let q = this.asked(text);
    if (!q || q.kind !== 'close') { // "cierra YouTube Music": a window (a Chrome app is one) that no program of the list names
      const target = CLOSE_TARGET.exec(text)?.[1]?.trim();
      if (target && target.split(/\s+/).length <= 4 && !/\b(?:grabaci[oó]n|clip|chat|conversaci[oó]n|ventana\s+grande)\b/i.test(target)) q = { kind: 'close', name: target };
    }
    if (!q) { // just the name of a program ("clip studio", "amd clip studio" when she heard "abre" wrong): that is an order to open it
      const it = await this.bareApp(text);
      if (it) q = { kind: 'open', text: it.name };
    }
    if (!q || !['open', 'media', 'music', 'musicDefault', 'playlist', 'playlistList', 'playlistSave', 'player', 'shuffle', 'folder', 'file', 'close', 'closeExplorer', 'closeAll', 'dnd', 'color', 'diag', 'phoneSend', 'phoneReceive', 'lol', 'boom', 'voiceTry', 'voiceUse', 'voiceBack', 'voiceList', 'flirtVoice', 'englishVoice', 'settings', 'giggle', 'lolMode', 'heavyAdd', 'heavyRemove', 'heavyList', 'alias', 'whisperInstall', 'backup', 'modelInstall', 'offerAnswer'].includes(q.kind)) return null;
    if (q.kind === 'open') {
      const parts = splitApps(q.text);
      let any = false;
      for (const part of parts.length ? parts : [q.text]) {
        const it = await this.host.findLaunch(part).catch(() => null);
        if (it || webFor(part)) any = true;
      }
      if (!any) return text.trim().split(/\s+/).length <= 6 ? { ...q, missing: true } : null; // "abre WhatsApp" and she has no such app: she says so, she does not chat about it
    }
    return q;
  }

  // files to the phone (a window with a QR opens) or from it (a QR to a page on the phone)
  async runPhone(text, q, voice) {
    const es = this.brain.lang !== 'en';
    const r = q.kind === 'phoneReceive' ? await this.host.phoneReceive().catch(() => null) : await this.host.phoneSend({ what: q.what, query: q.query }).catch(() => null);
    if (r?.cancelled) return;
    if (r?.ok) {
      this.showOrder(text, q.kind === 'phoneReceive'
        ? (es ? 'Escanea el código con el celular: se abre una página para elegir lo que quieras mandar al PC. Lo recibo en Descargas\\Capri celular (mismo Wi-Fi, 10 minutos).' : 'Scan the code with your phone: a page opens to choose what to send to the PC. I get it in Downloads\\Capri celular (same Wi-Fi, 10 minutes).')
        : (r.count > 1 ? (es ? `Escanea el código con la cámara del celular: se abre una lista con tus ${r.count} archivos para bajarlos (mismo Wi-Fi, vale 10 minutos).` : `Scan the code with your phone's camera: a list of your ${r.count} files opens to download them (same Wi-Fi, valid 10 minutes).`) : es ? `Escanea el código con la cámara del celular y baja «${r.name}» (mismo Wi-Fi, vale 10 minutos).` : `Scan the code with your phone's camera to download "${r.name}" (same Wi-Fi, valid 10 minutes).`), 'laugh', false);
      return;
    }
    const why = r?.none ? (es ? 'No encontré qué mandar. Dime por ejemplo "pásame la última captura al celular".' : 'I found nothing to send. Say for example "send me the last screenshot to my phone".')
      : r?.error === 'no network' ? (es ? 'No veo una red Wi-Fi o cable: el celular y el PC tienen que estar en la misma red.' : 'I see no Wi-Fi or cable network: the phone and the PC must be on the same network.')
        : (es ? `No pude abrir el envío${r?.error ? ` (${r.error})` : ''}.` : `I could not open the transfer${r?.error ? ` (${r.error})` : ''}.`);
    this.showOrder(text, why, 'aside', voice);
  }

  // the phone downloaded the file, or sent one
  // A file crossed over (to the phone or from it): she reacts, so you know without looking. A bolt out for what leaves, a hop and a chime for what arrives.
  transferCue(kind) {
    const cap = this.capri;
    try {
      if (kind === 'sent') {
        const h = cap?.head?.();
        const zapped = h ? cap.zap(h.x + cap.towardCenter() * 280, h.y - 170) : false;
        if (!zapped) cap?.perform?.('hop');
      } else cap?.perform?.('hop', cap.towardCenter?.() || 0);
      this.voice?.play?.('done');
    } catch { /* an animation is never worth a failure */ }
  }

  phoneDone(evt) {
    const es = this.brain.lang !== 'en';
    this.capri?.wake?.();
    if (evt?.type === 'sent') {
      const line = es ? `El celular ya bajó «${evt.file}».` : `The phone downloaded "${evt.file}".`;
      if (Date.now() - (this.lastCue || 0) > 3000) { this.lastCue = Date.now(); this.transferCue('sent'); this.speaker?.announce(es ? 'Listo, el celular ya lo tiene.' : 'Done, the phone has it.', this.brain.lang); } // (a spoken notice: it counts as an important one)
      if (!(this.open && this.notify(line, 'laugh', { keep: false }))) this.panel.say({ kind: 'info', face: 'laugh', line, hold: 6000 });
      return;
    }
    if (evt?.type === 'received') { // several files come one after another: one card for the lot, once they stop arriving
      if (!this.phoneGot?.length) this.transferCue('received');
      (this.phoneGot ||= []).push(evt);
      clearTimeout(this.phoneGotTimer);
      this.phoneGotTimer = setTimeout(() => {
        const got = this.phoneGot; this.phoneGot = [];
        const one = got.length === 1;
        const first = got[got.length - 1];
        const line = one
          ? (es ? `Ya llegó «${first.file}» del celular (Descargas\\Capri celular).` : `"${first.file}" arrived from the phone (Downloads\\Capri celular).`)
          : (es ? `Ya llegaron ${got.length} archivos del celular (Descargas\\Capri celular).` : `${got.length} files arrived from the phone (Downloads\\Capri celular).`);
        this.speaker?.announce(one ? (es ? 'Archivo recibido del celular.' : 'File received from the phone.') : (es ? `${got.length} archivos recibidos del celular.` : `${got.length} files received from the phone.`), this.brain.lang);
        if (this.open && !this.turn && this.notify(line, 'laugh', { keep: false })) { this.offerFiles(got.map((g) => g.path)); return; }
        this.panel.say({
          kind: 'info', face: 'laugh', line, hold: 30000,
          actions: one
            ? [{ id: 'open', label: es ? 'Abrir' : 'Open', primary: true }, { id: 'reveal', label: es ? 'Ver en carpeta' : 'Show in folder' }]
            : [{ id: 'reveal', label: es ? 'Ver en carpeta' : 'Show in folder', primary: true }, { id: 'open', label: es ? 'Abrir el último' : 'Open the last one' }],
          onAction: (id) => (id === 'open' ? this.host.openFile(first.path) : this.host.revealFile(first.path)),
        });
      }, 1500);
    }
  }

  // "Retomar donde quedé": the files you opened last (the list Windows keeps: only names and paths), each one a button that opens it
  async resumeShow(text, voice) {
    const es = this.brain.lang !== 'en';
    const r = await this.host.resumeRecent?.().catch(() => null);
    const items = r?.items || [];
    if (!items.length) {
      return this.replyLocal(text, { line: es ? 'No encuentro archivos de trabajo abiertos en los últimos días (Illustrator, Photoshop, Affinity, Blender, Office...).' : 'I cannot find work files you opened in the last few days (Illustrator, Photoshop, Affinity, Blender, Office...).', face: 'aside', minor: true, command: true }, voice);
    }
    const DAY = es ? { today: 'hoy', yesterday: 'ayer', before: 'antes' } : { today: 'today', yesterday: 'yesterday', before: 'earlier' };
    const list = items.map((i) => `${i.name} (${DAY[i.day]})`).join(' · ');
    const line = es ? `Esto fue lo último que abriste: ${list}. Dale clic al que quieras retomar.` : `This is what you opened last: ${list}. Click the one you want to pick up.`;
    this.replyLocal(text, { line, face: 'smug', minor: true, command: true }, voice);
    const bubbles = Boolean(this.panel.bubbles);
    this.offerFiles(items.map((i) => i.path), bubbles ? [] : items.slice(1).map((i, n) => ({ id: `res${n}`, label: i.name.length > 22 ? `${i.name.slice(0, 19)}...` : i.name, run: () => this.host.openFile(i.path) })));
    return undefined;
  }

  // the eyedropper's key (Alt+C): the colour is picked at once, and told in a card or in her chat
  async colorKey() {
    const es = this.brain.lang !== 'en';
    const r = await this.host.pickColor().catch(() => null);
    if (r?.cancelled) return;
    this.capri?.wake?.();
    const line = r?.ok
      ? (es ? `${r.hex} · rgb(${r.rgb.join(', ')}) · hsl(${r.hsl[0]}, ${r.hsl[1]}%, ${r.hsl[2]}%). Ya lo copié.` : `${r.hex} · rgb(${r.rgb.join(', ')}) · hsl(${r.hsl[0]}, ${r.hsl[1]}%, ${r.hsl[2]}%). Copied.`)
      : (es ? `No pude abrir el cuentagotas${r?.error ? ` (${r.error})` : ''}.` : `I could not open the eyedropper${r?.error ? ` (${r.error})` : ''}.`);
    if (!(this.open && this.notify(line, r?.ok ? 'laugh' : 'aside', { keep: false }))) this.panel.say({ kind: 'info', face: r?.ok ? 'laugh' : 'aside', tag: 'COLOR', line, hold: 9000 });
  }

  // the eyedropper: you pick a pixel of your screen with its magnifier, and the colour is on your clipboard
  async runColor(text, voice) {
    const es = this.brain.lang !== 'en';
    if (this.remote) { this.showOrder(text, es ? 'El cuentagotas se pide desde mi burbuja (o con Ctrl+Alt+S y PALETA): ahí lo ves sobre tu pantalla.' : 'The eyedropper is asked from my bubble.', 'aside', voice); return; }
    this.showOrder(text, es ? 'Cuentagotas listo: mueve el cursor sobre el color y haz clic. Esc cancela.' : 'Eyedropper ready: move over the colour and click. Esc cancels.', 'smug', false);
    const r = await this.host.pickColor().catch(() => null);
    if (r?.ok) {
      const [R, G, B] = r.rgb;
      const [H, S, L] = r.hsl;
      this.showOrder(text, es ? `${r.hex} · rgb(${R}, ${G}, ${B}) · hsl(${H}, ${S}%, ${L}%). Ya lo copié.` : `${r.hex} · rgb(${R}, ${G}, ${B}) · hsl(${H}, ${S}%, ${L}%). Copied.`, 'laugh', false);
    } else if (r?.cancelled) {
      this.showOrder(text, es ? 'Lo dejé, sin color.' : 'Left it, no colour.', 'smug', false);
    } else {
      this.showOrder(text, es ? `No pude abrir el cuentagotas${r?.error ? ` (${r.error})` : ''}.` : `I could not open the eyedropper${r?.error ? ` (${r.error})` : ''}.`, 'aside', voice);
    }
  }

  // Her voice: try a preset (says a sample with it, changes nothing), keep it, go back to the one she had, or list them
  async runVoice(text, q, voice) {
    const es = this.brain.lang !== 'en';
    if (q.kind === 'englishVoice') {
      if (q.mode !== 'try') await this.host.voiceEnglish(q.mode).catch(() => null);
      const mode = q.mode === 'try' ? (this.speaker?.getCfg?.().englishVoice === 'english' ? 'english' : 'mine') : q.mode;
      if (this.speaker?.enabled) this.speaker.say(es ? `Buen chico. Good boy. Let's go${this.brain.custom?.userName ? `, ${this.brain.custom.userName}` : ''}.` : `Good boy. Let's go${this.brain.custom?.userName ? `, ${this.brain.custom.userName}` : ''}.`, this.brain.lang, { loud: true });
      this.showOrder(text, mode === 'mine'
        ? (es ? 'Así: el inglés con mi voz y mi acento de siempre. Si prefieres una voz en inglés, dime «habla el inglés con voz en inglés».' : 'Like this: English with my usual voice and accent. For an English voice, say "habla el inglés con voz en inglés".')
        : (es ? 'Así: el inglés con una voz en inglés. Para volver a mi voz y mi acento, dime «habla el inglés con mi voz».' : 'Like this: English with an English voice. To go back to my voice and accent, say "habla el inglés con mi voz".'), 'smug', false);
      return;
    }
    if (q.kind === 'flirtVoice') { // the voice of her flirty moments (the usual one stays for everything else)
      let what = q.what;
      let name = q.name;
      if (what === 'use') {
        if (!this.voiceTried || this.voiceTried.name === 'original') { this.showOrder(text, es ? 'Primero prueba una voz: «prueba la voz de Salomé».' : 'Try a voice first: "prueba la voz de Salomé".', 'aside', false); return; }
        what = 'set';
        name = this.voiceTried.name;
        this.voiceTried = null;
      }
      const r = await this.host.voiceFlirt(what, name).catch(() => null);
      this.showOrder(text, !r?.ok ? (es ? 'No tengo esa voz. Prueba con Salomé, Dalia, Elena, Paloma o Paola.' : 'I do not have that voice. Try Salomé, Dalia, Elena, Paloma or Paola.')
        : what === 'off' ? (es ? 'Listo: uso mi voz de siempre también para lo coqueto.' : 'Done: I use my usual voice for the flirty moments too.')
          : what === 'on' ? (es ? `Listo: lo coqueto lo digo con ${r.label}; lo demás sigue con mi voz de siempre.` : `Done: the flirty moments use ${r.label}; everything else keeps my usual voice.`)
            : (es ? `Listo: para lo coqueto uso ${r.label}. Todo lo demás sigue con mi voz de siempre.` : `Done: for the flirty moments I use ${r.label}. Everything else keeps my usual voice.`), r?.ok ? 'laugh' : 'aside', false);
      return;
    }
    if (q.kind === 'voiceList') {
      const list = await this.host.voiceList().catch(() => []);
      this.showOrder(text, `${es ? 'Voces que puedo probar' : 'Voices I can try'}: ${list.map((v) => v.label).join(' · ')}.\n${es ? 'Di «prueba la voz de Salomé» (o Dalia, Elena, Paloma, Paola). «Usa esta voz» la deja, «vuelve a la voz de antes» regresa a la tuya.' : 'Say "prueba la voz de Salomé" (or Dalia, Elena, Paloma, Paola). "Usa esta voz" keeps it, "vuelve a la voz de antes" goes back to yours.'}`, 'smug', false);
      return;
    }
    if (q.kind === 'voiceBack') {
      const r = await this.host.voiceBack().catch(() => null);
      this.voiceTried = null;
      this.showOrder(text, !r ? (es ? 'No pude cambiar la voz.' : 'I could not change the voice.')
        : r.already ? (es ? 'Ya estoy con tu voz de siempre.' : 'I am already on your usual voice.') : (es ? 'Listo: vuelvo a mi voz de antes, tal cual estaba.' : 'Done: back to my old voice, just as it was.'), r ? 'smug' : 'aside', false);
      return;
    }
    if (q.kind === 'voiceUse') {
      if (!this.voiceTried) { this.showOrder(text, es ? 'Primero prueba una: «prueba la voz de Salomé».' : 'Try one first: "prueba la voz de Salomé".', 'aside', false); return; }
      await this.host.voiceSave(this.voiceTried.override).catch(() => null);
      this.showOrder(text, es ? `Listo: desde ahora hablo con ${this.voiceTried.label}. Para volver a la de antes, dime «vuelve a la voz de antes».` : `Done: from now on I speak with ${this.voiceTried.label}. To go back, say "vuelve a la voz de antes".`, 'smug', false);
      this.voiceTried = null;
      return;
    }
    const p = await this.host.voicePreset(q.name).catch(() => null);
    if (!p?.ok) { this.showOrder(text, es ? `No tengo esa voz. Puedo probar: ${(p?.list || []).map((v) => v.label).join(', ')}.` : `I do not have that voice. I can try: ${(p?.list || []).map((v) => v.label).join(', ')}.`, 'aside', false); return; }
    this.voiceTried = p;
    const name = this.brain.custom?.userName || (es ? 'tú' : 'you');
    const sample = es ? `Hola, ${name}. Justo estaba pensando en ti. Good boy.` : `Hi, ${name}. I was just thinking about you. Good boy.`;
    if (this.speaker?.enabled) this.speaker.say(sample, this.brain.lang, { loud: true, override: p.override });
    this.showOrder(text, es
      ? `Esta es ${p.label}. ${this.speaker?.enabled ? '' : '(Mi voz está apagada ahora: no la oirás.) '}Si te gusta, dime «usa esta voz para lo coqueto» (mi voz de siempre se queda para lo demás) o «usa esta voz» para cambiar la principal; si no, prueba otra o dime «vuelve a la voz de antes». Todavía no cambié nada.`
      : `This is ${p.label}. ${this.speaker?.enabled ? '' : '(My voice is off right now: you will not hear it.) '}If you like it, say "usa esta voz"; if not, try another or say "vuelve a la voz de antes". I have not changed anything yet.`, 'smug', false);
  }

  // "capri, qué compro": a suggestion for the match she follows (League of Legends), from her small local model and what the game says
  async runLol(text, voice) {
    const es = this.brain.lang !== 'en';
    const r = await this.host.lolAdvice().catch(() => null);
    if (r?.ok) { this.showOrder(text, r.text, 'smug', voice); return; }
    const line = r?.none ? (es ? 'No veo ninguna partida de League en marcha: abre una y me cuentas.' : 'I see no League match running: start one and tell me.')
      : (es ? `No pude pensar la compra${r?.error ? ` (${r.error})` : ''}.` : `I could not work out what to buy${r?.error ? ` (${r.error})` : ''}.`);
    this.showOrder(text, line, 'aside', voice);
  }

  // "activa / desactiva el modo juego"
  async runLolMode(text, on) {
    const es = this.brain.lang !== 'en';
    this.host.setConfig({ lolMode: Boolean(on) });
    this.replyOrder(text, { line: on ? (es ? 'Modo juego activado: sigo tu partida de League y comento de vez en cuando, sin molestar.' : 'Game mode on: I follow your League match and comment now and then, without bothering you.') : (es ? 'Modo juego desactivado: no comento tus partidas.' : 'Game mode off: I do not comment on your matches.'), face: 'smug', command: true, minor: true }, false);
  }

  // the list of heavy programs: with one of them open (or a full-screen one) she steps aside and uses a small model
  async runHeavy(text, q, voice) {
    const es = this.brain.lang !== 'en';
    if (q.kind === 'heavyList') {
      const r = await this.host.heavyList().catch(() => null);
      if (!r) { this.showOrder(text, es ? 'No pude leer la lista.' : 'I could not read the list.', 'aside', voice); return; }
      this.showOrder(text, `${es ? 'Modo ligero' : 'Light mode'}: ${r.on ? (r.active ? (es ? 'activo ahora' : 'on right now') : (es ? 'encendido, esperando un programa pesado' : 'on, waiting for a heavy program')) : (es ? 'apagado' : 'off')}.\n${es ? 'Programas pesados' : 'Heavy programs'}: ${r.apps.join(', ')}.`, 'smug', false);
      return;
    }
    const r = await this.host.heavyEdit(q.kind === 'heavyAdd' ? 'add' : 'remove', q.name, Boolean(q.game)).catch(() => null);
    if (!r) { this.showOrder(text, es ? 'No pude cambiar la lista.' : 'I could not change the list.', 'aside', voice); return; }
    this.showOrder(text, q.kind === 'heavyAdd'
      ? (es ? `Listo: «${q.name}» cuenta como ${q.game ? 'juego' : 'programa'} pesado. Cuando esté abierto uso mi modelo pequeño y suelto el grande${q.game ? ', y me dibujo con pocos cuadros por segundo' : ''}.` : `Done: "${q.name}" counts as a heavy program. While it is open I use my small model and let go of the big one.`)
      : (es ? `Listo: «${q.name}» ya no cuenta como pesado.` : `Done: "${q.name}" no longer counts as heavy.`), 'smug', false);
  }

  // "capri, diagnóstico": what is on and what is not, in a few lines
  // your own ways of saying an app (config.appAliases), read now and then
  async aliasMine() {
    if (this._aliasAt && Date.now() - this._aliasAt < 5000) return this._alias || {};
    const cfg = await this.host.getConfig?.().catch(() => null);
    this._alias = cfg?.appAliases && typeof cfg.appAliases === 'object' ? cfg.appAliases : {};
    this._aliasAt = Date.now();
    return this._alias;
  }

  async runAlias(text, q, voice) {
    const es = this.brain.lang !== 'en';
    const mine = { ...(await this.aliasMine()) };
    const key = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
    if (q.what === 'list') {
      const own = Object.entries(mine).map(([k, v]) => `• ${k} → ${v}`);
      const base = Object.entries(ALIAS_DEFAULTS).slice(0, 8).map(([k, v]) => `${k} → ${v}`).join(', ');
      const line = [own.length ? `${es ? 'Tus alias' : 'Your aliases'}:\n${own.join('\n')}` : (es ? 'Todavía no has añadido alias.' : 'You have not added any aliases yet.'),
        es ? `De fábrica traigo ${Object.keys(ALIAS_DEFAULTS).length}, por ejemplo: ${base}…` : `I come with ${Object.keys(ALIAS_DEFAULTS).length}, for example: ${base}…`,
        es ? 'Para añadir uno: «cuando diga ilus abre Illustrator». Para quitarlo: «olvida el alias ilus».' : 'To add one: "when I say ilus open Illustrator". To remove: "forget the alias ilus".'].join('\n');
      this.showOrder(text, line, 'smug', voice);
      return;
    }
    if (q.what === 'del') {
      const k = Object.keys(mine).find((x) => key(x) === key(q.from));
      if (!k) { this.showOrder(text, es ? `No tengo un alias tuyo llamado «${q.from}».` : `I have no alias of yours called "${q.from}".`, 'aside', voice); return; }
      delete mine[k];
      this.host.setConfig?.({ appAliases: mine });
      this._aliasAt = 0;
      this.showOrder(text, es ? `Listo, olvidé el alias «${k}».` : `Done, I forgot the alias "${k}".`, 'laugh', voice);
      return;
    }
    const from = key(q.from);
    if (!from || from.length < 2) { this.showOrder(text, es ? '¿Qué palabra quieres que entienda?' : 'Which word should I understand?', 'aside', voice); return; }
    for (const k of Object.keys(mine)) if (key(k) === from) delete mine[k];
    mine[from] = q.to;
    this.host.setConfig?.({ appAliases: mine });
    this._aliasAt = 0;
    this.showOrder(text, es ? `Listo: cuando digas «${q.from}», entiendo «${q.to}».` : `Done: when you say "${q.from}", I understand "${q.to}".`, 'laugh', voice);
  }

  // a card with buttons (Permitir/Denegar...): with the chat open the panel refuses an 'info' card (the chat has priority), so it goes INTO the chat as her answer with the buttons under it
  offerCard(msg) {
    if (!this.open || this.turn) { this.panel.say(msg); return; }
    const text = msg.reply ? `${msg.line}\n${Array.isArray(msg.reply) ? msg.reply.join('\n') : msg.reply}` : msg.line;
    this.replyLocal('', { line: text, face: msg.face || 'smug', minor: true, command: true }, false);
    this.pendingOffer = { msg, at: Date.now() };
    const put = () => this.panel.setActions(msg.actions || [], async (id) => { this.pendingOffer = null; this.panel.setActions([]); await msg.onAction?.(id); });
    put();
    setTimeout(put, 450); // (the answer is still being written when the first call lands: put the buttons again once it finished)
    setTimeout(put, 1500);
  }

  // progress / result lines: with the chat open they go in the chat (once, not every percent); closed, as a card
  statusLine(msg, { chatOnly = false } = {}) {
    if (this.open && !this.turn) { if (!msg.compact || !chatOnly) this.notify(msg.line, msg.face || 'smug', { keep: false }); return; }
    this.panel.say(msg);
  }

  // "capri, respalda mis archivos": incremental (only what changed), to a disk / USB / Drive folder, never deleting; she says what it will take before copying
  async runBackup(text, q, voice) {
    const es = this.brain.lang !== 'en';
    const st = (await this.host.backupState?.().catch(() => null)) || { sources: [], dest: '' };
    const short = (p) => (p.length > 46 ? `…${p.slice(-45)}` : p);
    const gb = (b) => (b >= 1073741824 ? `${(b / 1073741824).toFixed(1)} GB` : `${Math.max(1, Math.round(b / 1048576))} MB`);
    const setupCard = (why) => {
      this.offerCard({
        kind: 'info', tag: es ? 'RESPALDO' : 'BACKUP', face: 'smug', hold: 60000,
        line: why || (es ? 'Configuro tu respaldo: elige qué copiar y a dónde.' : 'Let us set up your backup: pick what to copy and where.'),
        reply: [es ? `Carpetas (${st.sources.length}):` : `Folders (${st.sources.length}):`, ...st.sources.map((s) => `• ${short(s)}`), es ? `Destino: ${st.dest ? short(st.dest) : '(sin elegir)'}` : `Destination: ${st.dest ? short(st.dest) : '(not set)'}`].join('\n'),
        actions: [
          { id: 'add', label: es ? 'Agregar carpeta' : 'Add folder', primary: !st.sources.length },
          { id: 'dest', label: es ? 'Elegir destino' : 'Pick destination', primary: Boolean(st.sources.length) && !st.dest },
          ...(st.sources.length ? [{ id: 'clear', label: es ? 'Vaciar lista' : 'Clear list' }] : []),
          ...(st.sources.length && st.dest ? [{ id: 'go', label: es ? 'Respaldar ahora' : 'Back up now', primary: true }] : []),
          { id: 'ok', label: es ? 'Cerrar' : 'Close' },
        ],
        onAction: async (id) => {
          if (id === 'add') { const r = await this.host.backupPick?.('src'); if (r?.ok) return this.runBackup(text, { setup: true }, voice); }
          else if (id === 'dest') { const r = await this.host.backupPick?.('dest'); if (r?.ok) return this.runBackup(text, { setup: true }, voice); }
          else if (id === 'clear') { await this.host.backupClear?.(); return this.runBackup(text, { setup: true }, voice); }
          else if (id === 'go') return this.runBackup(text, { setup: false }, voice);
          this.panel.hide?.();
          return undefined;
        },
      });
    };
    if (q.setup || !st.sources.length || !st.dest) { setupCard(); return; }
    this.statusLine({ kind: 'work', tag: es ? 'RESPALDO' : 'BACKUP', line: es ? 'Mirando qué cambió desde el último respaldo…' : 'Looking at what changed since the last backup…', hold: 120000, compact: true });
    const p = await this.host.backupPlan?.().catch(() => null);
    if (!p?.ok) {
      const line = p?.error === 'dest-missing' ? (es ? `No veo el destino (${short(st.dest)}). ¿Está conectado el disco?` : `I cannot see the destination (${short(st.dest)}). Is the disk plugged in?`) : (es ? `No pude revisar: ${p?.error || 'error'}.` : `Could not check: ${p?.error || 'error'}.`);
      this.statusLine({ kind: 'error', tag: es ? 'RESPALDO' : 'BACKUP', face: 'aside', line, hold: 9000, actions: [{ id: 'cfg', label: es ? 'Configurar' : 'Settings' }, { id: 'ok', label: es ? 'Cerrar' : 'Close' }], onAction: (id) => (id === 'cfg' ? this.runBackup(text, { setup: true }, voice) : this.panel.hide?.()) });
      return;
    }
    if (!p.files) { this.statusLine({ kind: 'done', tag: es ? 'RESPALDO' : 'BACKUP', face: 'smug', line: es ? 'Todo está al día: no hay nada nuevo que copiar.' : 'Everything is up to date: nothing new to copy.', hold: 7000 }); return; }
    const free = p.free == null ? '' : (es ? ` · libre en el destino: ${gb(p.free)}` : ` · free at the destination: ${gb(p.free)}`);
    if (!p.enough) {
      this.statusLine({ kind: 'error', tag: es ? 'RESPALDO' : 'BACKUP', face: 'aside', hold: 15000, line: es ? `No cabe: hay que copiar ${gb(p.bytes)} y el destino tiene ${gb(p.free)} libres. No copié nada.` : `It will not fit: ${gb(p.bytes)} to copy and ${gb(p.free)} free. I copied nothing.`, actions: [{ id: 'cfg', label: es ? 'Cambiar destino' : 'Change destination' }, { id: 'ok', label: es ? 'Cerrar' : 'Close' }], onAction: (id) => (id === 'cfg' ? this.runBackup(text, { setup: true }, voice) : this.panel.hide?.()) });
      return;
    }
    this.offerCard({
      kind: 'info', tag: es ? 'RESPALDO' : 'BACKUP', face: 'smug', hold: 60000,
      line: es ? `Hay ${p.files} archivos nuevos o cambiados (${gb(p.bytes)})${free}.` : `${p.files} new or changed files (${gb(p.bytes)})${free}.`,
      reply: es ? `Se copian a ${short(st.dest)}. No se borra nada, ni allá ni acá.` : `They go to ${short(st.dest)}. Nothing is deleted, there or here.`,
      actions: [{ id: 'go', label: es ? 'Respaldar' : 'Back up', primary: true }, { id: 'cfg', label: es ? 'Configurar' : 'Settings' }, { id: 'ok', label: es ? 'Cancelar' : 'Cancel' }],
      onAction: async (id) => {
        if (id === 'cfg') return this.runBackup(text, { setup: true }, voice);
        if (id !== 'go') { this.panel.hide?.(); return undefined; }
        this.statusLine({ kind: 'work', tag: es ? 'RESPALDO' : 'BACKUP', line: es ? `Copiando ${p.files} archivos (${gb(p.bytes)})… puede tardar.` : `Copying ${p.files} files (${gb(p.bytes)})… this can take a while.`, hold: 3600000, compact: true });
        const r = await this.host.backupRun?.().catch((err) => ({ ok: false, error: err.message }));
        this.statusLine(r?.ok
          ? { kind: 'done', tag: es ? 'RESPALDO' : 'BACKUP', face: 'laugh', line: es ? `Listo: ${r.files} archivos (${gb(r.bytes)}) respaldados${r.failed ? `; ${r.failed} no se pudieron copiar (en uso)` : ''}.` : `Done: ${r.files} files (${gb(r.bytes)}) backed up${r.failed ? `; ${r.failed} could not be copied (in use)` : ''}.`, hold: 10000 }
          : { kind: 'error', tag: es ? 'RESPALDO' : 'BACKUP', face: 'aside', line: es ? `No terminó: ${r?.error || 'error'}.` : `It did not finish: ${r?.error || 'error'}.`, hold: 12000 });
        return undefined;
      },
    });
  }

  // "capri, instala qwen3:8b": downloads the model into Ollama (Permitir / Denegar first); she does not switch to it, you choose it in her menu
  async runModelInstall(text, q, voice) {
    const es = this.brain.lang !== 'en';
    const name = q.name;
    this.offerCard({
      kind: 'info', tag: 'OLLAMA', face: 'smug', hold: 60000,
      line: es ? `¿Descargo el modelo ${name}?` : `Download the model ${name}?`,
      reply: es ? 'Se baja de Ollama (varios GB, tarda unos minutos) y queda instalado, listo para elegirlo en su menú. No cambio tu modelo actual. Pulsa Permitir o escribe «sí».' : 'It downloads from Ollama (several GB, a few minutes) and stays installed, ready to pick in her menu. Your current model does not change.',
      actions: [{ id: 'ok', label: es ? 'Permitir' : 'Allow', primary: true }, { id: 'no', label: es ? 'Denegar' : 'Deny' }],
      onAction: async (id) => {
        if (id !== 'ok') { this.panel.hide?.(); return; }
        let lastPct = -1;
        this.host.onModelProgress?.((p) => {
          const pct = p.total ? Math.floor((p.completed / p.total) * 100) : 0;
          if (pct === lastPct) return;
          lastPct = pct;
          if (!this.open) this.statusLine({ kind: 'work', tag: 'OLLAMA', line: es ? `Descargando ${name}… ${pct}%` : `Downloading ${name}… ${pct}%`, hold: 600000, compact: true });
          else if (pct > 0 && pct % 25 === 0) this.notify(es ? `Descargando ${name}… ${pct}%` : `Downloading ${name}… ${pct}%`, 'smug', { keep: false });
        });
        this.statusLine({ kind: 'work', tag: 'OLLAMA', line: es ? `Descargando ${name}…` : `Downloading ${name}…`, hold: 600000, compact: true });
        const r = await this.host.installModel(name).catch((err) => ({ ok: false, error: err.message }));
        this.statusLine(r?.ok
          ? { kind: 'done', tag: 'OLLAMA', face: 'laugh', line: es ? `${name} instalado. Elígelo en el menú de modelos cuando quieras probarlo.` : `${name} installed. Pick it in the models menu whenever you want to try it.`, hold: 10000 }
          : { kind: 'error', tag: 'OLLAMA', face: 'aside', line: es ? `No pude descargarlo: ${r?.error || 'error'}.` : `Could not download it: ${r?.error || 'error'}.`, hold: 12000 });
      },
    });
  }

  // "capri, instala whisper": asks (Permitir/Denegar), then downloads and sets up her Whisper by herself (about 200 MB, a few minutes)
  async runWhisperInstall(text, voice) {
    const es = this.brain.lang !== 'en';
    const d = await this.host.diag().catch(() => null);
    if (d?.local?.installed) { this.showOrder(text, es ? `Ya tengo Whisper en tu PC${d.local.up ? ' y está andando' : ' (se enciende al reiniciarme)'}.` : 'I already have Whisper on this PC.', 'smug', voice); return; }
    this.offerCard({
      kind: 'info', tag: 'WHISPER', face: 'smug', hold: 60000,
      line: es ? '¿Instalo Whisper en tu PC?' : 'Install Whisper on this PC?',
      reply: es ? 'Descargo ~200 MB de GitHub y Hugging Face (internet solo ahora). Queda en %LOCALAPPDATA%\\Capri\\whisper. Después te escucho sin límite diario y sin mandar tu voz a la nube.' : 'I download ~200 MB from GitHub and Hugging Face. Afterwards I listen with no daily limit and your voice stays on the PC.',
      actions: [{ id: 'ok', label: es ? 'Permitir' : 'Allow', primary: true }, { id: 'no', label: es ? 'Denegar' : 'Deny' }],
      onAction: async (id) => {
        if (id !== 'ok') { this.panel.hide?.(); return; }
        const step = (n, t) => this.statusLine({ kind: 'info', tag: 'WHISPER', face: 'smug', line: `${n} · ${t}`, hold: 600000, compact: true });
        this.host.onWhisperStep?.(step);
        step('0/3', es ? 'Empiezo (tarda unos minutos)…' : 'Starting (a few minutes)…');
        const res = await this.host.whisperInstall('small').catch((err) => ({ ok: false, error: err.message }));
        this.statusLine(res.ok
          ? { kind: 'done', tag: 'WHISPER', face: 'laugh', line: es ? 'Listo: ya tengo Whisper en tu PC. Dime «diagnóstico» para verlo.' : 'Done: Whisper is on this PC. Say "diagnostic" to see it.', hold: 9000 }
          : { kind: 'error', tag: 'WHISPER', face: 'aside', line: es ? `No pude instalarlo: ${res.error || 'error'}` : `Could not install it: ${res.error || 'error'}`, hold: 14000 });
      },
    });
  }

  async runDiag(text, voice) {
    const es = this.brain.lang !== 'en';
    const d = await this.host.diag().catch(() => null);
    if (!d) { this.showOrder(text, es ? 'No pude revisarme ahora.' : 'I could not check myself now.', 'aside', voice); return; }
    const yes = es ? 'sí' : 'yes';
    const no = es ? 'no' : 'no';
    const lines = [
      `${es ? 'Diagnóstico' : 'Self-check'} · Capri ${d.version}`,
      `• ${es ? 'Manos libres' : 'Hands free'}: ${d.handsFree ? yes : no}${d.dnd ? (es ? ' · NO MOLESTAR activo' : ' · DO NOT DISTURB on') : ''}${d.auto ? ` · ${es ? 'SILENCIO AUTOMÁTICO' : 'AUTO-QUIET'}: ${d.auto.split(',').map((r) => ({ call: es ? 'llamada' : 'call', record: es ? 'grabando' : 'recording', game: es ? 'juego o pantalla completa' : 'game or full screen' }[r] || r)).join(', ')}` : ''}`,
      `• ${es ? 'Whisper en tu PC' : 'Whisper on this PC'}: ${d.local?.installed ? `${d.local.up ? (es ? 'andando' : 'running') : (es ? 'instalado, sin responder' : 'installed, not answering')}${d.model ? ` (${d.model.replace(/^ggml-|\.bin$/g, '')})` : ''}` : (es ? 'no instalado' : 'not installed')}`,
      `• ${es ? 'Nube de voz hoy' : 'Cloud voice today'}: ${d.stt?.ok ? `${d.cloudToday} ${es ? 'de' : 'of'} ~${d.budget} ${es ? 'pedidos para escucharte' : 'requests to listen'}` : (es ? 'sin clave' : 'no key')}`,
      `• ${es ? 'Teclas multimedia' : 'Media keys'}: ${d.media.on ? (d.media.hook ? (d.media.game ? `${es ? 'de Windows (hay un juego al frente' : "Windows' (a game is in front"}: ${d.media.front})` : (es ? 'mías' : 'mine')) : (es ? 'mías (modo respaldo)' : 'mine (fallback mode)')) : (es ? 'de Windows' : "Windows'")}`,
      `• ${es ? 'Mi voz' : 'My voice'}: ${d.speak && !d.dnd && !d.auto ? yes : no}${d.quiet ? (es ? ' · suave al estar guardada' : ' · soft when put away') : ''}`,
      `• ${es ? 'Modo ligero' : 'Light mode'}: ${!d.heavy?.on ? (es ? 'apagado' : 'off') : d.heavy.active ? `${es ? 'ACTIVO' : 'ON'} (${d.heavy.apps.join(', ')})${d.heavy.light ? ` · ${es ? 'modelo pequeño' : 'small model'}: ${d.heavy.light}${d.heavy.cpu ? ' · CPU' : ''}` : ''}` : (es ? 'esperando un programa pesado' : 'waiting for a heavy program')}`,
      `• ${es ? 'Modo juego (League)' : 'Game mode (League)'}: ${!d.lol?.on ? (es ? 'apagado' : 'off') : d.lol.match ? (es ? 'siguiendo tu partida' : 'following your match') : (es ? 'esperando una partida' : 'waiting for a match')}`,
    ];
    this.showOrder(text, lines.join('\n'), 'smug', false);
  }

  // do not disturb: on, she does not talk, comment or play her clips by herself; off, she is as before
  setDndTo(on, text = '') {
    const es = this.brain.lang !== 'en';
    this.host.setConfig({ dnd: Boolean(on) });
    if (on) this.speaker?.stop();
    const line = on
      ? (es ? 'No molestar: me callo y no comento nada. Dime «ya puedes hablar» o usa el botón para quitarlo.' : 'Do not disturb: I keep quiet and will not comment. Say "you can talk again" or use the button to turn it off.')
      : (es ? 'Listo, vuelvo a hablar.' : 'Done, I talk again.');
    setTimeout(() => this.refreshModes(), 250);
    if (text) this.replyOrder(text, { line, face: 'smug', command: true, minor: true }, false);
    else if (this.open) this.notify(line, 'smug', { keep: false });
  }

  // one line for an order: in the note while you are with Claude, else as her answer (never kept)
  showOrder(text, line, face, voice) {
    const ok = face !== 'aside';
    if (ok && !this.remote) ui(this.voice, 'go'); // (it worked: a chime, not her voice, so the next order can be said at once)
    this.replyOrder(text, { line, face, minor: true, command: true }, ok ? false : voice);
  }

  // where an order's line goes: asked from her big window, back to it; in a talk with Claude, a note at the bottom; else her answer in the bubble (never kept)
  replyOrder(text, local, voice) {
    if (this.remote) { this.remote.line = local.line; this.remote.face = local.face || 'smug'; return; }
    if (this.inClaude) { this.flashNote(local.line); this.capri.pulse(); return; }
    this.replyLocal(text, local, voice);
  }

  // is the conversation she is in one with Claude? (her bubble: Claude Code is her chat, or a job thread; her big window: the engine picked there is a Claude)
  get inClaude() {
    return this.remote ? this.remote.engine !== 'local' : Boolean(this.agent || this.thread);
  }

  // her big window asks (app.js: order:ask): is this an order for the PC? Done here, where the orders are; the answer goes back as { handled, line, face, files }
  async runRemote(text, engine = 'local') {
    if (this.remote) return { handled: false };
    this.remote = { line: '', face: 'smug', files: [], engine };
    try {
      const q = await this.systemOrder(String(text || ''));
      if (!q) return { handled: false };
      await this.runSystemOrder(String(text || ''), q, false);
      const r = this.remote;
      return { handled: true, line: r.line || (this.brain.lang !== 'en' ? 'Hecho.' : 'Done.'), face: r.face, files: r.files };
    } catch {
      return { handled: false };
    } finally {
      this.remote = null;
    }
  }

  // buttons for an order (her bubble); from her big window there are none: it says what to do instead
  offer(buttons, handler) {
    if (this.remote) return;
    this.panel.setActions(buttons, handler);
  }

  // folders, files and closing apps, by name
  async runFileOrder(text, q, voice) {
    const es = this.brain.lang !== 'en';
    if (q.kind === 'closeExplorer') {
      const r = await this.host.closeExplorer?.().catch(() => null);
      this.showOrder(text, r?.closed ? (es ? `Cerré ${r.closed} ${r.closed === 1 ? 'ventana' : 'ventanas'} del Explorador.` : `Closed ${r.closed} File Explorer window${r.closed === 1 ? '' : 's'}.`) : (es ? 'No hay ventanas del Explorador abiertas.' : 'No File Explorer windows are open.'), r?.closed ? 'laugh' : 'aside', voice);
      return;
    }
    if (q.kind === 'closeAll') {
      if (WORK_APPS.test(q.name) && !this.remote) { // (a browser or a work app: asked first, a window may hold unsaved work)
        this.showOrder(text, es ? `¿Cierro todas las ventanas de ${q.name}? Puede haber trabajo sin guardar.` : `Close all ${q.name} windows? There may be unsaved work.`, 'smug', voice);
        this.offer([{ id: 'close', label: es ? 'Cerrar todas' : 'Close all', primary: true }, { id: 'no', label: this.t.no }], async (id) => {
          this.panel.setActions([]);
          if (id !== 'close') return;
          const r = await this.host.closeAllWindows(q.name).catch(() => null);
          this.showOrder(text, r?.closed ? (es ? `Cerré ${r.closed} ventanas.` : `Closed ${r.closed} windows.`) : (es ? 'No encontré ventanas así.' : 'I found no such windows.'), r?.closed ? 'laugh' : 'aside', voice);
        });
        return;
      }
      if (WORK_APPS.test(q.name) && this.remote) { this.showOrder(text, es ? `Eso puede dejar trabajo sin guardar: dímelo desde mi burbuja (con botón de confirmar) o ciérralas tú.` : `That can lose unsaved work: tell me from my bubble (it has a confirm button) or close them yourself.`, 'aside', voice); return; }
      const r = await this.host.closeAllWindows(q.name).catch(() => null);
      this.showOrder(text, r?.closed ? (es ? `Cerré ${r.closed} ${r.closed === 1 ? 'ventana' : 'ventanas'}.` : `Closed ${r.closed} window${r.closed === 1 ? '' : 's'}.`) : (es ? `No veo ventanas de «${q.name}».` : `I see no "${q.name}" windows.`), r?.closed ? 'laugh' : 'aside', voice);
      return;
    }
    if (q.kind === 'folder') {
      const r = await this.host.openFolder(q.name).catch(() => null);
      this.showOrder(text, r?.ok ? (es ? `Abrí ${r.label}.` : `Opened ${r.label}.`) : (es ? `No pude abrir esa carpeta${r?.label ? ` (${r.label} no existe aquí)` : ''}.` : 'I could not open that folder.'), r?.ok ? 'smug' : 'aside', voice);
      return;
    }
    if (q.kind === 'file') {
      const r = await this.host.findFiles(q.query).catch(() => null);
      const found = r?.matches || [];
      if (!found.length) { this.showOrder(text, es ? 'No encontré ese archivo en Descargas, Escritorio, Documentos, Imágenes ni Videos.' : 'I could not find that file in Downloads, Desktop, Documents, Pictures or Videos.', 'aside', voice); return; }
      const best = found[0];
      const clear = found.length === 1 || r.latest || (r.tokens && best.score - (found[1]?.score ?? 0) >= 0.15);
      if (clear) {
        const ok = await this.host.openFile(best.path);
        this.showOrder(text, ok ? (es ? `Abrí «${best.name}» (${best.dir}).` : `Opened "${best.name}" (${best.dir}).`) : (es ? `Lo encontré pero no pude abrirlo: «${best.name}».` : `Found it but could not open it: "${best.name}".`), ok ? 'smug' : 'aside', voice);
        return;
      }
      if (this.remote) { // (no buttons there: the newest one is opened)
        const ok2 = await this.host.openFile(best.path);
        this.showOrder(text, ok2 ? (es ? `Había varios; abrí el más reciente: «${best.name}» (${best.dir}).` : `There were several; opened the newest: "${best.name}" (${best.dir}).`) : (es ? 'Los encontré pero no pude abrirlos.' : 'Found them but could not open them.'), ok2 ? 'smug' : 'aside', voice);
        return;
      }
      this.showOrder(text, es ? 'Encontré varios. ¿Cuál abro?' : 'I found several. Which one?', 'smug', voice);
      this.panel.setActions(found.slice(0, 4).map((f, i) => ({ id: `f${i}`, label: f.name.length > 26 ? `${f.name.slice(0, 23)}...` : f.name, primary: i === 0 })), (id) => {
        this.panel.setActions([]);
        const f = found[Number(String(id).slice(1))];
        if (f) this.host.openFile(f.path);
      });
      return;
    }
    // closing an app: the ones that hold work ask first, the others close at once (and ask to force it only if they will not go)
    let app = await this.host.findApp(q.name).catch(() => null);
    if (!app) { // not a program of its own: a window (YouTube Music, WhatsApp... are windows of Chrome)
      const w = await this.host.findWindow(q.name).catch(() => null);
      if (w) app = { name: w.title.replace(/\s+[-–—|]\s+.*$/, '') || w.title, hwnd: w.hwnd };
    }
    if (!app || /^capri\b/i.test(app.name)) { this.showOrder(text, es ? `No veo «${q.name}» abierta.` : `I do not see "${q.name}" open.`, 'aside', voice); return; }
    if (WORK_APPS.test(app.name) && this.remote) { this.showOrder(text, es ? `¿Cierro ${app.name}? Puede tener trabajo sin guardar. Pídemelo desde mi burbuja (tiene botón de confirmar) o ciérrala tú.` : `Close ${app.name}? It may hold unsaved work. Ask me from my bubble (it has a confirm button) or close it yourself.`, 'aside', voice); return; }
    if (WORK_APPS.test(app.name)) {
      this.showOrder(text, es ? `¿Cierro ${app.name}? Puede tener trabajo sin guardar.` : `Close ${app.name}? It may hold unsaved work.`, 'smug', voice);
      this.panel.setActions([{ id: 'close', label: fmt(this.t.closeIt, { app: app.name }), primary: true }, { id: 'no', label: this.t.no }], (id) => {
        this.panel.setActions([]);
        if (id === 'close') this.closeQuiet(app, false, text, voice);
      });
      return;
    }
    await this.closeQuiet(app, false, text, voice);
  }

  // close an app without making a conversation of it
  async closeQuiet(app, force, text, voice) {
    const { t, capri } = this;
    const h = capri.head();
    capri.zap(h.x + capri.towardCenter() * 280, h.y - 170);
    const res = app.hwnd ? await this.host.closeWindow(app.hwnd) : await this.host.closeApp(app.name, force);
    let line;
    if (res.error) line = `${t.failed} ${res.error}`;
    else if (!res.running) line = fmt(force ? t.forced : t.closed, { app: app.name });
    else line = fmt(force ? t.unkillable : t.stillOpen, { app: app.name });
    this.showOrder(text, line, res.running || res.error ? 'aside' : 'laugh', voice);
    if (res.running && !force && !res.error && !app.hwnd && !this.remote) { // it hid in the tray, or it asks you to save something: forcing it is your call (a window: it just asks you)
      this.panel.setActions([{ id: 'force', label: t.force, primary: true }, { id: 'leave', label: t.leave }], (id) => {
        this.panel.setActions([]);
        if (id === 'force') this.closeQuiet(app, true, text, voice);
      });
    }
    this.listApps();
  }

  // The program the whole message names, when it names one and nothing else ("Clip Studio", "AMD Clip Studio", "figma"): short, no question, and what
  // is said is the name of that app (a word or two of noise before it is let go). null when it is anything else.
  async bareApp(text) {
    const flat = String(text || '').replace(/[.!?¡¿,;:]+/g, ' ').replace(/\s+/g, ' ').trim();
    const said = flat.split(' ').filter(Boolean);
    if (!said.length || said.length > 4 || /[?¿]/.test(text) || this.inClaude) return null;
    const norm = (v) => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').trim();
    const NOISE = new Set(['amd', 'a', 'ver', 'el', 'la', 'los', 'las', 'mi', 'mis', 'un', 'una', 'ok', 'oye', 'hey', 'capri', 'por', 'favor', 'ya', 'pues', 'app', 'programa', 'aplicacion', 'de', 'del', 'abre', 'abrir']);
    const core = norm(flat).split(/\s+/).filter((w) => w && !NOISE.has(w));
    if (!core.length) return null;
    const it = await this.host.findLaunch(core.join(' ')).catch(() => null);
    if (!it) return null;
    const name = norm(it.name).split(/\s+/);
    const inName = core.filter((w) => name.some((n) => n === w || (w.length >= 4 && n.length >= 4 && (n.startsWith(w) || w.startsWith(n))))).length;
    return inName / core.length >= 0.99 ? it : null; // every word that is left belongs to that app's name
  }

  async runSystemOrder(text, q, voice) {
    const es = this.brain.lang !== 'en';
    if (q.ask) { // (the verb alone)
      this.pendingVerb = { verb: q.ask, at: Date.now() };
      const ask = q.ask === 'abre' ? (es ? '¿Qué abro?' : 'What shall I open?') : (es ? '¿Qué cierro?' : 'What shall I close?');
      this.replyOrder(text, { line: ask, face: 'smug', command: true }, voice, true); // (said out loud: it waits for your answer)
      return;
    }
    if (q.social) { // her own line, never from a model and never kept
      const useFlirt = isFlirty(this.brain.custom?.persona) && Math.random() < 0.75;
      const set = (useFlirt ? FLIRT_SOCIAL : SOCIAL_LINES)[es ? 'es' : 'en'][q.social] || SOCIAL_LINES[es ? 'es' : 'en'][q.social];
      const pool = set.filter((l) => l !== this.lastSocial);
      const raw = pick(pool.length ? pool : set);
      const who = this.brain.custom?.userName; // (her name for you, from her settings; with none the line just goes without it)
      const line = raw.replace(/,? \{name\}/g, who ? (m) => m.replace('{name}', who) : '');
      this.lastSocial = raw;
      this.replyOrder(text, { line, face: q.social === 'bye' ? 'smug' : 'laugh', command: true, flirt: useFlirt }, voice);
      return;
    }
    if (q.kind === 'dnd') { this.setDndTo(q.on, text); return; }
    if (q.kind === 'phoneSend' || q.kind === 'phoneReceive') { await this.runPhone(text, q, voice); return; }
    if (q.kind === 'color') { await this.runColor(text, voice); return; }
    if (q.kind === 'diag') { await this.runDiag(text, voice); return; }
    if (q.kind === 'whisperInstall') { await this.runWhisperInstall(text, voice); return; }
    if (q.kind === 'backup') { await this.runBackup(text, q, voice); return; }
    if (q.kind === 'offerAnswer') { const o = this.pendingOffer; this.pendingOffer = null; this.panel.setActions([]); const acts = o?.msg.actions || []; const id = q.yes ? acts.find((a) => a.primary)?.id : acts[acts.length - 1]?.id; if (id) await o.msg.onAction?.(id); return; }
    if (q.kind === 'modelInstall') { await this.runModelInstall(text, q, voice); return; }
    if (q.kind === 'alias') { await this.runAlias(text, q, voice); return; }
    if (['voiceTry', 'voiceUse', 'voiceBack', 'voiceList', 'flirtVoice', 'englishVoice'].includes(q.kind)) { await this.runVoice(text, q, voice); return; }
    if (q.kind === 'giggle') { // her little giggle, now
      this.giggleNow?.();
      this.replyOrder(text, { line: this.brain.lang !== 'en' ? 'Jiji.' : 'Hehe.', face: 'laugh', command: true, minor: true }, false);
      return;
    }
    if (q.kind === 'settings') { // her settings window
      this.host.openSettings?.();
      this.replyOrder(text, { line: this.brain.lang !== 'en' ? 'Listo, ahí están mis ajustes.' : 'Done, there are my settings.', face: 'smug', command: true, minor: true }, false);
      return;
    }
    if (q.kind === 'boom') { // the sound and the GIF of a heavy job done, on demand
      this.voice.play('boom');
      this.brain.onBoom?.();
      this.replyOrder(text, { line: this.brain.lang !== 'en' ? '¡BOOM!' : 'BOOM!', face: 'laugh', command: true, minor: true }, false);
      return;
    }
    if (q.kind === 'lol') { await this.runLol(text, voice); return; }
    if (q.kind === 'lolMode') { await this.runLolMode(text, q.on); return; }
    if (['heavyAdd', 'heavyRemove', 'heavyList'].includes(q.kind)) { await this.runHeavy(text, q, voice); return; }
    if (q.cap) { await this.handleCapture(text, q.cap, voice); return; }
    if (['folder', 'file', 'close', 'closeExplorer', 'closeAll'].includes(q.kind)) { await this.runFileOrder(text, q, voice); return; }
    let done = null;
    if (q.missing) {
      const name = splitApps(q.text || text).join(es ? ' y ' : ' and ');
      done = { line: es ? `No encuentro «${name || 'esa app'}» entre tus apps instaladas.` : `I cannot find "${name || 'that app'}" among your installed apps.`, face: 'aside', minor: true };
    } else {
      done = await this.doNow(q).catch(() => null);
    }
    const line = done?.line || (es ? 'No pude hacerlo.' : 'I could not do that.');
    const failed = !done || done.face === 'aside' || q.missing;
    if (!failed) ui(this.voice, 'go');
    this.replyOrder(text, { ...done, line, command: true, minor: true }, failed ? voice : false); // (what worked is not read out: the chime says it)
  }

  // a line in the note at the bottom of her card for a few seconds, then what was there
  flashNote(line, ms = 4000) {
    const note = this.panel.note;
    if (!note) return;
    clearTimeout(this.noteTimer);
    if (!this.noteSaved) this.noteSaved = { kids: [...note.childNodes], hidden: note.hidden };
    note.replaceChildren(`▸ ${line}`);
    note.hidden = false;
    this.noteTimer = setTimeout(() => {
      const saved = this.noteSaved;
      this.noteSaved = null;
      if (!saved) return;
      note.replaceChildren(...saved.kids);
      note.hidden = saved.hidden;
    }, ms);
  }

  // a screenshot, or starting / stopping a screen clip: done here, with her line and the file as buttons
  async handleCapture(text, cap, voice) {
    const es = this.brain.lang !== 'en';
    const say = (line, face = 'smug', speak = true) => {
      if (this.remote) { this.remote.line = line; this.remote.face = face; return; }
      if (speak) { this.replyLocal(text, { line, face, minor: true, command: true }, voice); return; }
      this.speaker?.stop();
      this.panel.setActions([]);
      this.chatTurn({ quote: text, face: 'aside' });
      this.capri.pulse();
      this.panel.stream(line, { done: true }); // (written, not spoken: her voice would end up in the recording)
      this.panel.setFace(face);
      this.panel.setChatBusy(false);
    };
    if (cap.kind === 'shotRegion') {
      await this.host.scannerOpen?.('shot');
      say(es ? 'Listo el marco: muévelo y estíralo sobre lo que quieras y pulsa CAPTURAR (o Enter). Esc lo cierra.' : 'The frame is up: move and stretch it over what you want and press CAPTURE (or Enter). Esc closes it.', 'smug', false);
      return true;
    }
    if (cap.kind === 'shot') {
      const res = await this.capture.shot();
      if (!res.ok) { say(es ? 'No pude capturar la pantalla.' : 'I could not capture the screen.', 'aside'); return true; }
      say(res.copied
        ? (es ? 'Captura lista: ya está en tu portapapeles (Ctrl+V para pegarla) y guardada en Imágenes\\Capri\\Capturas.' : 'Screenshot ready: it is on your clipboard (Ctrl+V to paste) and saved in Pictures\\Capri\\Capturas.')
        : (es ? `Captura guardada en Imágenes\\Capri\\Capturas, pero no pude ponerla en el portapapeles${res.copyError ? ` (${res.copyError})` : ''}.` : `Screenshot saved in Pictures\\Capri\\Capturas, but I could not put it on the clipboard${res.copyError ? ` (${res.copyError})` : ''}.`));
      if (this.remote) { this.remote.files = [res.path]; return true; }
      this.offerFiles([res.path], [{ id: 'copy', label: es ? 'Copiar' : 'Copy', run: () => this.capture.copy(res.path).then((r) => this.panel.stream(r.ok ? (es ? 'Copiada: pégala donde quieras.' : 'Copied: paste it anywhere.') : (es ? `No pude copiarla${r.error ? `: ${r.error}` : ''}.` : `Could not copy it${r.error ? `: ${r.error}` : ''}.`), { done: true })) }]);
      return true;
    }
    if (cap.kind === 'recPause' || cap.kind === 'recResume') {
      const ok = cap.kind === 'recPause' ? this.capture.pause?.() : this.capture.resume?.();
      say(ok ? (cap.kind === 'recPause' ? (es ? 'Grabación en pausa. Dime "sigue grabando" o usa el botón SEGUIR.' : 'Recording paused. Say "keep recording" or press RESUME.') : (es ? 'Sigo grabando.' : 'Recording again.')) : (es ? 'Eso ahora no se puede.' : 'Not possible right now.'), ok ? 'smug' : 'aside', false);
      return true;
    }
    if (cap.kind === 'recStop') {
      this.capture.stop();
      say(es ? 'Cortando la grabación…' : 'Stopping the recording…', 'smug', false);
      return true;
    }
    if (cap.kind === 'recStart') {
      if (this.capture.recording) { say(es ? 'Ya estoy grabando. Dime "para la grabación" cuando quieras.' : 'Already recording. Say "stop recording" when you want.', 'aside', false); return true; }
      // her in the picture or not: you said (con Capri / sin Capri), or her config (clipCapri: show, hide), or she asks
      let withCapri = cap.withCapri;
      if (withCapri === null || withCapri === undefined) {
        const mode = this.capture.getCfg()?.clipCapri || 'ask';
        if (mode === 'show') withCapri = true;
        else if (mode === 'hide' || this.remote) withCapri = false;
        else {
          say(es ? '¿Grabo con Capri en pantalla o sin ella?' : 'Shall I record with Capri on screen or without her?', 'smug', false);
          this.offer([
            { id: 'with', label: es ? 'Con Capri' : 'With Capri', primary: true },
            { id: 'without', label: es ? 'Sin Capri' : 'Without Capri' },
          ], (id) => {
            this.panel.setActions([]);
            this.handleCapture(text, { ...cap, withCapri: id === 'with' }, voice);
          });
          return true;
        }
      }
      const r = await this.capture.start({ seconds: cap.seconds, withCapri });
      if (!r.ok) { say(es ? 'No pude empezar a grabar la pantalla.' : 'I could not start recording the screen.', 'aside', false); return true; }
      say(es ? `Grabando la pantalla (hasta ${r.limit} s). Dime "para la grabación", usa Ctrl+Alt+Shift+R o espera a que termine solo.` : `Recording the screen (up to ${r.limit} s). Say "stop recording", press Ctrl+Alt+Shift+R or let it end by itself.`, 'smug', false);
      this.offer([{ id: 'stop', label: es ? 'Detener' : 'Stop', primary: true }], () => { this.capture.stop(); this.panel.setActions([]); });
      return true;
    }
    return false;
  }

  // the scanner's CAPTURAR finished: where the part of the screen went, as buttons
  shotDone(res) {
    const es = this.brain.lang !== 'en';
    this.capri?.wake?.();
    if (!res?.ok) {
      const line = es ? 'No pude hacer esa captura.' : 'I could not take that screenshot.';
      if (!(this.open && this.notify(line, 'aside'))) this.panel.say({ kind: 'info', face: 'aside', line, hold: 6000 });
      return;
    }
    const line = res.copied
      ? (es ? 'Captura lista: en tu portapapeles (Ctrl+V para pegarla) y guardada en Imágenes\\Capri\\Capturas.' : 'Screenshot ready: on your clipboard (Ctrl+V to paste) and saved in Pictures\\Capri\\Capturas.')
      : (es ? `Captura guardada en Imágenes\\Capri\\Capturas, pero no pude ponerla en el portapapeles${res.copyError ? ` (${res.copyError})` : ''}.` : `Screenshot saved in Pictures\\Capri\\Capturas, but I could not put it on the clipboard${res.copyError ? ` (${res.copyError})` : ''}.`);
    if (this.open && !this.turn && this.notify(line, 'smug')) { this.offerFiles([res.path]); return; }
    this.panel.say({
      kind: 'info', face: 'smug', line, hold: 12000,
      actions: [{ id: 'open', label: es ? 'Abrir' : 'Open', primary: true }, { id: 'reveal', label: es ? 'Ver carpeta' : 'Show folder' }],
      onAction: (id) => (id === 'open' ? this.host.openFile(res.path) : this.host.revealFile(res.path)),
    });
  }

  // a clip ended (by you, by its time, or because the screen went): where it is, as buttons
  clipDone(res) {
    const es = this.brain.lang !== 'en';
    this.capri?.wake?.();
    if (!res?.ok) {
      const line = es ? 'La grabación no salió.' : 'The recording did not come out.';
      if (!(this.open && this.notify(line, 'aside'))) this.panel.say({ kind: 'info', face: 'aside', line, hold: 6000 });
      return;
    }
    const line = es ? `Clip guardado (${res.seconds} s).` : `Clip saved (${res.seconds} s).`;
    if (this.open && !this.turn && this.notify(line, 'smug')) { this.offerFiles([res.path]); return; }
    this.panel.say({
      kind: 'info', face: 'smug', line, hold: 15000,
      actions: [{ id: 'open', label: es ? 'Abrir' : 'Open', primary: true }, { id: 'reveal', label: es ? 'Ver carpeta' : 'Show folder' }],
      onAction: (id) => (id === 'open' ? this.host.openFile(res.path) : this.host.revealFile(res.path)),
    });
  }

  // Ctrl+Alt+Shift+R: start a clip, or end the one that is running
  async recordToggle() {
    const es = this.brain.lang !== 'en';
    if (!this.capture) return;
    if (this.capture.recording) { this.capture.stop(); return; }
    const r = await this.capture.start({});
    this.panel.say({ kind: 'info', face: r.ok ? 'smug' : 'aside', line: r.ok ? (es ? `Grabando la pantalla (hasta ${r.limit} s). Ctrl+Alt+Shift+R otra vez para parar.` : `Recording (up to ${r.limit} s). Ctrl+Alt+Shift+R again to stop.`) : (es ? 'No pude empezar a grabar.' : 'I could not start recording.'), hold: 5000 });
  }

  // A job that needs tools (files, video, apps...) and so Claude Code, which spends your limit: she asks, and you choose
  // how much brain it gets (or no). Nothing is sent until you press one.
  offerTask(text, task, voice, extras = {}) {
    if (this.askBefore && this.askBefore() === false) return this.dispatch(text, task, null, voice, extras); // you turned the question off: it just goes
    const es = this.brain.lang !== 'en';
    const line = extras.why ? extras.why : es
      ? 'Eso pide herramientas (archivos, apps, video...) y solo lo hace Claude Code, que gasta de tu límite. ¿Lo mando? Haiku para lo sencillo, Sonnet normal, Opus para lo pesado.'
      : 'That needs tools (files, apps, video...) and only Claude Code does it, which spends your limit. Send it? Haiku for simple things, Sonnet for normal, Opus for heavy ones.';
    this.chatTurn({ quote: extras.noQuote ? '' : text, face: 'aside' }); // (noQuote: your message is already on screen)
    this.panel.stream(line, { done: true });
    this.panel.setFace('smug');
    if (this.speaker?.wants(voice)) this.speaker.say(line, this.brain.lang);
    this.panel.setActions([
      { id: 'haiku', label: 'Haiku' }, { id: 'sonnet', label: 'Sonnet' }, { id: 'opus', label: 'Opus' },
      { id: 'no', label: es ? 'No, déjalo' : 'No, leave it' },
    ], (id) => {
      this.panel.setActions([]);
      if (id === 'no') {
        this.panel.stream(es ? 'Va, lo dejo quieto.' : 'OK, leaving it alone.', { done: true });
        return;
      }
      this.dispatch(text, task, id, voice, { ...extras, fromOffer: true });
    });
  }

  async dispatch(text, task, taskModel, voice, extras = {}) {
    if (this.turn || !this.open) return;
    this.taskTurn = Boolean(task); // a job for Claude Code: only its last word is spoken, not the narrating
    if (!task) { // so "usa Claude" (or its button) can hand this one over, with what you attached
      this.lastAsk = text;
      this.lastFiles = extras.allFiles || [];
    }
    const id = Date.now();
    this.speaker?.stop();
    // out loud only if you spoke to her (or she's set to always); she starts as the first sentence is written
    this.live = this.speaker?.wants(voice) ? this.speaker.begin(this.brain.lang) : null;
    this.turn = id;
    this.answer = '';
    const sessionId = this.session?.id; // (a job for Claude can outlive this chat: it lands in THIS conversation)
    this.history.push({ role: 'user', content: text });
    if (task) this.saveSession(); // the conversation exists from the moment you send, and shows in the list while Claude works
    this.panel.setChatBusy(true);
    this.panel.setActions([]); // a close button she offered before goes with a new message
    this.chatTurn({ quote: extras.fromOffer ? '' : text, face: 'aside' }); // (you chose a Claude after her question: your message is already there)
    this.capri.pulse();
    // what you asked for plainly happens right away (the music, the volume, an app you named): her
    // line about it comes under her answer (Claude Code, answering her chat, does things its own way)
    const asked = this.agent || task ? null : this.asked(text);
    const early = asked && asked.kind !== 'close' ? this.doNow(asked) : null;
    await Promise.race([this.appsReady, new Promise((r) => setTimeout(r, 1500))]);
    // a link in your message: she reads the page (its title, description and text) so her model knows what it is
    let context = extras.context || '';
    const urls = !task && !this.agent ? linksIn(text) : [];
    if (urls.length) {
      const es = this.brain.lang !== 'en';
      this.panel.stream(es ? 'Leyendo el enlace...' : 'Reading the link...');
      const pages = await this.host.readLinks(urls).catch(() => []);
      const read = pages.map((p) => `[${es ? 'Enlace' : 'Link'}: ${p.url}${p.title ? ` — ${p.title}` : ''}]\n${p.text || (p.error ? `(${es ? 'no pude leerlo' : 'could not read it'}: ${p.error})` : '')}`);
      context = [context, ...read].filter(Boolean).join('\n\n');
    }
    const messages = task ? [{ role: 'user', content: task }] : [{ role: 'system', content: this.persona() }, ...this.history.slice(-REMEMBER).map(({ role, content }) => ({ role, content }))];
    if (!task && context) messages[messages.length - 1] = { ...messages.at(-1), content: `${messages.at(-1).content}\n\n${context}` };
    if (!task && !this.agent && ONLY_IN[this.brain.lang]) messages[messages.length - 1] = { ...messages.at(-1), content: `${messages.at(-1).content}\n\n${ONLY_IN[this.brain.lang].nudge}` };
    if (task && (extras.research || extras.threaded)) {
      const name = (taskModel || this.taskModelName?.() || 'sonnet').toLowerCase();
      this.thread = { model: name, kind: extras.research ? 'research' : 'task' };
      const es = this.brain.lang !== 'en';
      this.panel.stream(extras.research ? (es ? `Buscándolo con Claude (${cap(name)})...` : `Looking it up with Claude (${cap(name)})...`) : (es ? `Va con Claude (${cap(name)})...` : `On it with Claude (${cap(name)})...`));
    } else if (task) this.panel.stream(TASK_START[this.brain.lang] || TASK_START.en);
    // nothing yet after a few seconds: Ollama is still loading the model (the first answer after a start),
    // or Claude Code is at work
    const wait = this.agent || task ? this.t.working : this.cold ? this.t.loading : null;
    const slow = wait && setTimeout(() => {
      if (this.turn === id && !this.answer) this.panel.stream(wait);
    }, LOADING_AFTER_MS);
    if (task) ui(this.voice, 'go'); // it goes out to Claude
    const startedAt = Date.now();
    const res = await this.host.chatSend({ id, messages, task: Boolean(task), taskModel: task ? taskModel : null, files: extras.files || [], images: extras.images || [], research: Boolean(extras.research), session: task && this.session?.claude ? this.session.claude : null });
    if (res.claudeStarted && this.session?.claude && !this.session.claude.started) { // its next job picks the same Claude conversation up (even if this one failed or was stopped: it exists now)
      this.session.claude.started = true;
      this.saveSession();
    }
    clearTimeout(slow);
    if (task && res.error !== 'stopped') {
      if (res.ok && Date.now() - startedAt >= 3 * 60 * 1000) { // a heavy job (3 minutes or more) ends with a BOOM and one of her GIFs
        this.voice.play('boom');
        this.brain.onBoom?.();
      } else ui(this.voice, res.ok ? 'done' : 'error'); // it comes back (the bright arpeggio), or it fails
    }
    if (task && this.bgTurns?.has(id)) { // you closed her chat while Claude worked: the answer still goes to its conversation, and she says it
      this.bgTurns.delete(id);
      this.live = null;
      return this.finishInBackground(sessionId, res);
    }
    const didNow = !task && !this.agent && early ? await early.catch(() => null) : null; // she already did what you asked (opened the app, played the song...)
    const asksClaude = !task && !this.agent && res.ok && !didNow && /\[\[\s*claude\s*\]\]/i.test(res.text || '');
    // opening an app is hers, never Claude's: her model said [[claude]] to "abre mi navegador", so she tries it herself
    if (asksClaude && OPEN_ASK.test(text) && this.turn === id) return this.openHere(id, text, Boolean(early)); // (early: she already tried it when you asked)
    const madeUp = !task && !this.agent && res.ok && !asksClaude && !didNow && !asked && !OPEN_ASK.test(text) && !TAG.test(res.text || '') && actAsk(text) && claimsDone(clean(res.text || '')); // "Redimensioné la imagen": her model has no hands (but opening an app, a song, a site: she does that herself)
    if (this.escalating === id || asksClaude || madeUp) {
      if (madeUp) this.panel.discardLive?.(); // that answer is not shown: it is not true // her model judged it needs Claude Code: she offers instead of answering
      this.escalating = 0;
      if (this.turn === id) this.turn = 0;
      this.speaker?.stop();
      this.live = null;
      if (this.history.at(-1)?.content === text) this.history.pop();
      this.panel.setChatBusy(false);
      if (this.open) {
        this.offerTask(text, text, voice, {
          files: extras.allFiles || [], allFiles: extras.allFiles || [],
          ...(madeUp ? { noQuote: true, why: this.brain.lang !== 'en' ? 'Casi te digo que ya lo hice, pero eso es tocar archivos y mi modelo local no puede. Claude sí. ¿Se lo paso? Haiku para lo sencillo, Sonnet normal, Opus para lo pesado.' : 'I almost told you it was done, but that means touching files and my local model cannot. Claude can. Pass it on? Haiku for simple, Sonnet for normal, Opus for heavy.' } : {}),
        });
      }
      return;
    }
    if (this.turn !== id) {
      this.live = null;
      // closed meanwhile: your message goes too, or the next answer would answer it as well
      if (this.history.at(-1)?.content === text) this.history.pop();
      return;
    }
    this.turn = 0;
    if (!res.ok) {
      this.speaker?.stop();
      this.live = null;
      if (task && res.error !== 'stopped') this.history.push({ role: 'assistant', content: `${this.t.failed} ${res.error}` }); // what you asked stays in the conversation, and what happened
      else this.history.pop();
      this.saveSession();
      this.panel.setFace('wide');
      this.panel.stream(`${this.t.failed} ${res.error}`, { done: true });
      this.panel.setChatBusy(false);
      return;
    }
    const answer = clean(res.text) || '…';
    this.warm = true;
    if (task) this.lastClaudeAt = Date.now(); // what she hears next may be about it
    this.remember({ role: 'assistant', content: answer, ...(res.files?.length ? { files: res.files } : {}) });
    this.panel.stream(answer, { done: true });
    if (this.live) { // what came in pieces was already spoken; else all of it now
      if (this.live.fed) this.live.end();
      else this.live.end(answer);
      this.live = null;
    }
    this.panel.setFace(mood(answer));
    this.panel.setChatBusy(false);
    if (task && this.thread) this.offerThread(res.files); // a look-it-up: files (if any) and which Claude to go on with
    else if ((task || this.agent) && res.files?.length) this.offerFiles(res.files); // what Claude made: Open / Show folder, no path to read
    if (!this.agent && !task) {
      this.after(res.text, answer, asked, early, text);
      // under her answer, one press hands that same message to Claude Code (with the model set in her menu)
      const lastFiles = this.lastFiles || [];
      if (this.autoTasks?.()) this.panel.addAction({ id: 'claude', label: this.brain.lang === 'en' ? 'Use Claude' : 'Usar Claude' }, () => this.dispatch(text, text, null, false, { files: lastFiles, allFiles: lastFiles }));
    }
    if (this.agent && !task) {
      if (Number.isFinite(res.turns)) this.turns = res.turns;
      this.updateCounter();
      this.maybeWarn(answer);
    }
    // too much for a bubble (long, or with code or lists): one press and the whole thing is in her window
    if (answer.length > 520 || (answer.length > 260 && /```|^\s*(?:[-*•]|\d+[.)])\s/m.test(answer))) {
      this.panel.addAction({ id: 'window', label: this.brain.lang === 'en' ? 'Open in window' : 'Ver en ventana' }, () => this.openWindow());
    }
    if (answer.length > 260) this.onExplain?.(); // (a longer answer: her clips show her explaining)
    this.listApps(); // fresh for the next message
  }

  // The "Organizar" button of her chat: your file organizer, now, the same as asking her to
  async organizeNow() {
    const es = this.brain.lang !== 'en';
    ui(this.voice, 'go');
    this.panel.stream(es ? 'Voy, organizando tus archivos…' : 'On it, organizing your files…', { done: true });
    this.panel.setFace('look');
    const res = await this.host.organizeRun?.().catch((err) => ({ ok: false, error: err.message }));
    const t = this.planner?.t;
    const n = Number(res?.moved) || 0;
    const line = res?.ok
      ? (t?.orgDone ? t.orgDone(n) : n ? (es ? `Listo, moví ${n} archivos.` : `Done, moved ${n} files.`) : (es ? 'Revisé tus carpetas: no había nada por organizar.' : 'Checked your folders: nothing to organize.'))
      : (t?.orgFail ? t.orgFail(res?.error || '?') : `${es ? 'No pude organizar' : "Couldn't organize"}: ${res?.error || '?'}`);
    this.panel.stream(line, { done: true });
    this.panel.setFace(res?.ok ? 'smug' : 'aside');
    ui(this.voice, res?.ok ? 'go' : 'error');
    if (res?.ok && n) this.speaker?.announce(line, this.brain.lang);
    return line;
  }

  // Claude Design is a part of the Claude desktop app (its sidebar has it), not something Claude Code drives: she takes you there
  // (the app, by its claude:// link), and if there's no app, to the web one in your browser. You work in it; she can't drive it.
  async openDesign() {
    const es = this.brain.lang !== 'en';
    const inApp = await this.host.openDesign?.().catch(() => false);
    const ok = inApp || await this.host.openExternal?.(DESIGN_URL).catch(() => false);
    const line = inApp
      ? (es ? 'Abriendo Claude Design en la app de Claude. Ahí trabajas tú; yo no puedo manejarlo por ti.' : 'Opening Claude Design in the Claude app. You work in it; I cannot drive it for you.')
      : ok
        ? (es ? 'No encontré la app de Claude, así que abro Claude Design en tu navegador. Ahí trabajas tú; yo no puedo manejarlo por ti.' : 'I could not find the Claude app, so I am opening Claude Design in your browser. You work in it; I cannot drive it for you.')
        : (es ? 'No pude abrir Claude Design.' : 'I could not open Claude Design.');
    this.panel.stream(line, { done: true });
    this.panel.setFace(ok ? 'smug' : 'wide');
    ui(this.voice, ok ? 'go' : 'error');
    return line;
  }

  // Claude Code itself, in a terminal window, in the folder her menu has for it
  async openCode() {
    const es = this.brain.lang !== 'en';
    const res = await this.host.openClaudeCode?.().catch(() => ({ ok: false }));
    const where = String(res?.cwd || '').split(/[\\/]/).filter(Boolean).pop() || '';
    const line = res?.ok
      ? (es ? `Abriendo Claude Code${where ? ` en «${where}»` : ''}. Está en su propia ventana.` : `Opening Claude Code${where ? ` in "${where}"` : ''}. It's in its own window.`)
      : (es ? 'No pude abrir Claude Code: ¿está instalado y el comando `claude` funciona en una terminal?' : 'I could not open Claude Code: is it installed, and does `claude` work in a terminal?');
    this.panel.stream(line, { done: true });
    this.panel.setFace(res?.ok ? 'smug' : 'wide');
    if (!res?.ok) ui(this.voice, 'error');
    return line;
  }

  // ---- her conversations (sessions.js) ----
  // Her conversation window (a real chat to scroll and read): the one you're in is saved first, so it opens on it
  async openWindow() {
    await this.saveNow();
    ui(this.voice, 'window');
    this.host.openChatWindow?.(this.session?.messages?.length ? this.session.id : null);
  }

  newSession() {
    return { id: uuid(), title: '', createdAt: Date.now(), updatedAt: Date.now(), messages: [], claude: { id: uuid(), started: false } };
  }

  // The one you were in (still in memory), else the newest saved, else a new one (with the old single history, if she had one)
  async loadCurrent() {
    if (!this.session) {
      let s = null;
      if (this.reloadId) {
        s = await this.host.sessionGet(this.reloadId).catch(() => null); // still there? then that one, fresh
        this.reloadId = null;
      }
      const list = s ? [] : (await this.host.sessionList().catch(() => [])).filter((x) => !x.archived);
      if (!s && list.length) s = await this.host.sessionGet(list[0].id).catch(() => null);
      if (!s) {
        s = this.newSession();
        const old = await this.host.chatMemory().catch(() => []);
        if (old?.length) {
          s.title = this.brain.lang === 'en' ? 'Earlier chat' : 'Conversación anterior';
          s.messages = old.map(({ role, content }) => ({ role, content }));
        }
      }
      this.session = s;
    }
    this.history = this.session.messages || [];
    this.session.messages = this.history;
  }

  saveSession() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.saveNow(), 300);
  }

  async saveNow() {
    clearTimeout(this.saveTimer);
    if (!this.session) return;
    this.session.messages = this.history;
    this.session.updatedAt = Date.now();
    await this.host.sessionSave(this.session).catch(() => {});
  }

  async showSessions() {
    if (!this.open) return;

    await this.saveNow();
    const es = this.brain.lang !== 'en';
    const every = await this.host.sessionList().catch(() => []);
    const archivedCount = every.filter((s) => s.archived).length;
    if (!archivedCount) this.showArchived = false;
    const all = every.filter((s) => Boolean(s.archived) === Boolean(this.showArchived));
    const items = all.slice(0, 4).map((s) => ({ ...s, when: whenOf(s.updatedAt, this.brain.lang) })); // the latest four; the rest are in the window
    this.panel.showSessions({
      items,
      total: all.length,
      archived: Boolean(this.showArchived),
      archivedCount,
      currentId: this.session?.id,
      labels: {
        archive: es ? 'Archivar' : 'Archive', restore: es ? 'Desarchivar' : 'Restore', archivedRow: (n) => (es ? `Archivadas (${n})` : `Archived (${n})`), back: es ? '← Conversaciones' : '← Conversations',
        fresh: es ? '+ Nueva' : '+ New', window: es ? 'Abrir ventana ⤢' : 'Open window ⤢', close: es ? 'Cerrar' : 'Close', empty: es ? '(sin título)' : '(untitled)',
        more: (n) => (es ? `Ver las ${n} en la ventana ⤢` : `See all ${n} in the window ⤢`),
      },
      onOpen: (id) => this.openSession(id),
      onNew: () => this.freshSession(),
      onDelete: (id) => this.deleteSession(id),
      onArchive: (id, on) => this.archiveSession(id, on),
      onToggleArchived: () => { this.showArchived = !this.showArchived; this.showSessions(); },
      onWindow: () => { this.closeList(); this.openWindow(); },
      onClose: () => this.closeList(),
    });
    this.refreshModes(); // its button lights while the menu is open
  }

  get listOpen() {
    return Boolean(this.panel.sessionsOpen);
  }

  closeList() {
    this.panel.hideSessions();
    this.refreshModes();
  }

  // what's on screen for a conversation: the last thing asked and answered (or the hello, if it's new)
  showLast() {
    const lastA = [...this.history].reverse().find((m) => m.role === 'assistant');
    this.panel.setActions([]);
    this.panel.setFileHandlers?.(this.fileHandlers());
    this.panel.setBubbles?.(this.history.map(({ role, content, files }) => ({ role, content, files }))); // all of it, as bubbles (and what was made, under it)
    if (!this.history.length) this.panel.stream(pick(this.t.hello), { done: true });
    if (lastA?.files?.length && !this.panel.bubbles) this.offerFiles(lastA.files);
    this.panel.chatInput?.focus();
  }

  // going to another conversation: this one is saved, that one is loaded, Claude's side of it too
  async openSession(id) {
    if (this.turn) return;
    await this.saveNow();
    const s = await this.host.sessionGet(id).catch(() => null);
    if (!s) return;
    if (s.archived) s.archived = false; // you went back to it: it is no longer put away
    this.session = s;
    this.history = s.messages;
    this.session.claude ||= { id: uuid(), started: false };
    this.thread = null;
    this.attachments = [];
    this.refreshChips();
    this.claudeNext = false;
    this.imageNext = false;
    this.resetPending = false;
    this.editTarget = null;
    this.closeList();
    this.showLast();
  }

  async freshSession() {
    if (this.turn) return;
    await this.saveNow();
    this.session = this.newSession();
    this.history = this.session.messages;
    this.thread = null;
    this.attachments = [];
    this.refreshChips();
    ui(this.voice, 'fresh');
    this.editTarget = null;
    this.closeList();
    this.panel.setActions([]);
    this.panel.setBubbles?.([]);
    this.panel.stream(this.brain.lang !== 'en' ? 'Conversación nueva. ¿De qué hablamos?' : 'New conversation. What shall we talk about?', { done: true });
    this.panel.chatInput?.focus();
  }

  // put a conversation away (or bring it back): it leaves the list, it is not lost
  async archiveSession(id, on = true) {
    if (on && this.session?.id === id && this.history.length) await this.saveNow();
    await this.host.sessionArchive(id, on).catch(() => {});
    if (on && this.session?.id === id) { // the one you were in: a fresh one takes its place
      this.session = this.newSession();
      this.history = this.session.messages;
      this.thread = null;
      this.showLast();
    }
    await this.showSessions();
  }

  async deleteSession(id) {
    await this.host.sessionDelete(id).catch(() => {});
    if (this.session?.id === id) {
      this.session = this.newSession();
      this.history = this.session.messages;
      this.thread = null;
      this.showLast();
    }
    await this.showSessions();
  }

  // all of this conversation, to read: the list gives way to it, with a way back
  showWhole() {
    const es = this.brain.lang !== 'en';
    this.panel.showTranscript({
      messages: this.history,
      labels: { you: es ? 'Tú' : 'You', capri: 'Capri', back: es ? '← Volver a la lista' : '← Back to the list' },
      onBack: () => this.showSessions(),
    });
  }

  // ---- what you attach: "+", drag and drop, a pasted picture ----
  async pickFiles() {
    const paths = await this.host.pickFiles().catch(() => []);
    this.host.focusOverlay(true); // the dialog took the keyboard
    if (paths?.length) await this.addFiles(paths);
    else this.panel.chatInput?.focus();
  }

  async addFiles(paths) {
    const info = await this.host.inspectFiles(paths).catch(() => []);
    this.attachments ||= [];
    for (const item of info) {
      if (this.attachments.length >= 8 || this.attachments.some((a) => a.path === item.path)) continue;
      this.attachments.push(item);
    }
    this.refreshChips();
    this.panel.chatInput?.focus();
    this.imageButtons();
  }

  refreshChips() {
    this.panel.setChips((this.attachments || []).map((a) => ({ name: a.name, path: a.path })), (i) => {
      this.attachments.splice(i, 1);
      this.refreshChips();
    });
  }

  // A message with files attached. Who gets them:
  //  - her picture maker (they're references), Claude (you asked for it, her Claude mode, or her chat IS Claude Code): all of them, as files
  //  - her own model: pictures it can see and small texts go inside the message; a PDF, a video, a design file... can't, so she offers Claude
  async sendWithFiles(text, voice) {
    if (this.turn || !this.open) return;
    const es = this.brain.lang !== 'en';
    const items = this.attachments.splice(0);
    this.refreshChips();
    const prompt = text || (es ? 'Mira esto.' : 'Take a look at this.');
    const paths = items.map((i) => i.path);
    const images = items.filter((i) => i.kind === 'image');
    const texts = items.filter((i) => i.kind === 'text');
    const others = items.filter((i) => i.kind === 'other');
    const reset = () => { if (this.panel.chatInput) this.panel.chatInput.placeholder = this.t.placeholder; };
    if (this.editTarget) { // EDITAR was pressed: what you attached are references; the picture to change is the one she showed
      const file = this.editTarget;
      this.editTarget = null;
      reset();
      return this.imageReply(prompt, voice, prompt, images.map((i) => i.path), file);
    }
    if (images.length && !others.length && !texts.length && imgAsk(prompt)) return this.imgReply(prompt, images.map((i) => i.path), imgAsk(prompt), voice); // convert / lighten: here, free
    if (images.length === 1 && !others.length && bgAsk(prompt)) return this.bgReply(prompt, images[0].path, voice); // the background off a picture you attached
    if (images.length && imageEditAsk(prompt)) { // a picture and "quítale el fondo": change THAT picture (the others, if any, are references)
      this.imageNext = false;
      reset();
      return this.imageReply(prompt, voice, prompt, images.slice(1).map((i) => i.path), images[0].path);
    }
    if (images.length && paletteAsk(prompt)) return this.paletteReply(prompt, images[0].path, voice);
    const wantsImage = imageAsk(prompt);
    if (this.imageNext || wantsImage) {
      this.imageNext = false;
      reset();
      return this.imageReply(prompt, voice, wantsImage || prompt, images.map((i) => i.path));
    }
    if (this.claudeNext && !this.agent) {
      const model = modelHint(prompt) || this.claudeModel || undefined;
      this.claudeNext = false;
      reset();
      return this.dispatch(prompt, prompt, model, voice, { files: paths, allFiles: paths, threaded: true });
    }
    if (!this.agent && this.thread) return this.dispatch(prompt, prompt, this.thread.model, voice, { files: paths, allFiles: paths, ...(this.thread.kind === 'task' ? { threaded: true } : { research: true }) });
    const explicit = taskOf(prompt);
    if (explicit) return this.dispatch(prompt, explicit, modelHint(prompt), voice, { files: paths, allFiles: paths });
    if (this.agent) return this.dispatch(prompt, null, null, voice, { files: paths, allFiles: paths });
    const blind = images.length && !this.sees;
    if (others.length || blind) {
      const names = (blind ? images : others).map((i) => i.name).slice(0, 3).join(', ');
      const why = es
        ? `${blind ? 'Mi modelo no ve imágenes' : 'No puedo abrir ese tipo de archivo'} (${names}); Claude Code sí. Gasta de tu límite. ¿Se lo paso? Haiku para lo sencillo, Sonnet normal, Opus para lo pesado.`
        : `${blind ? 'My model cannot see images' : 'I cannot open that kind of file'} (${names}); Claude Code can. It spends your limit. Pass it on? Haiku for simple, Sonnet for normal, Opus for heavy.`;
      return this.offerTask(prompt, prompt, voice, { files: paths, allFiles: paths, why });
    }
    const context = texts.map((t) => `[${es ? 'Archivo' : 'File'}: ${t.name}]\n${t.text}`).join('\n\n');
    return this.dispatch(prompt, null, null, voice, { context, images: images.map((i) => i.path), allFiles: paths });
  }

  // Open / Show-in-folder under her answer, for what was just made (the first file; more of them: the folder shows them all).
  // extra: [{ id, label, run }] more buttons, e.g. "Another one".
  // how her bubble opens what was made
  fileHandlers() {
    const es = this.brain.lang !== 'en';
    return { open: (p) => this.host.openFile(p), reveal: (p) => this.host.revealFile(p), labels: { open: es ? 'Abrir' : 'Open', reveal: es ? 'Ver carpeta' : 'Show folder' } };
  }

  // something she made is ready: the line + Open / Show folder, in the chat if it is free, else in a card (also by voice, chat closed)
  fileReady(line, path, face = 'laugh') {
    const es = this.brain.lang !== 'en';
    if (this.open && !this.turn && this.notify(line, face, { keep: false })) { this.offerFiles([path]); return; }
    this.panel.say({
      kind: 'info', face, line, hold: 15000,
      actions: [{ id: 'open', label: es ? 'Abrir' : 'Open', primary: true }, { id: 'reveal', label: es ? 'Ver carpeta' : 'Show folder' }],
      onAction: (id) => (id === 'open' ? this.host.openFile(path) : this.host.revealFile(path)),
    });
  }

  offerFiles(files, extra = []) {
    if (!files?.length && !extra.length) return;
    const es = this.brain.lang !== 'en';
    // in her bubbles the files go under the message that made them (and stay there); the buttons below are only the other things she offers
    if (this.panel.bubbles && this.panel.bubbleFiles?.(files)) {
      this.panel.setActions(extra.map(({ id, label }) => ({ id, label })), (id) => extra.find((e) => e.id === id)?.run());
      return;
    }
    const first = files?.[0];
    const name = first ? basename(first) : '';
    const shortName = name.length > 22 ? `${name.slice(0, 19)}...` : name;
    const buttons = [
      ...(first ? [
        { id: 'open', label: files.length > 1 ? `${es ? 'Abrir' : 'Open'} ${shortName}` : es ? 'Abrir' : 'Open', primary: true },
        { id: 'reveal', label: es ? 'Ver carpeta' : 'Show folder' },
      ] : []),
      ...extra.map(({ id, label }) => ({ id, label })),
    ];
    this.panel.setActions(buttons, (id) => {
      if (id === 'open' && first) this.host.openFile(first);
      else if (id === 'reveal' && first) this.host.revealFile(first);
      else extra.find((e) => e.id === id)?.run();
    });
  }

  // After a look-it-up: go on with a bigger Claude, make a document of it, or go back to her own model. The model you pick is the one
  // your next messages use (same conversation: Claude remembers what it found).
  offerThread(files = []) {
    if (!this.thread) return;
    const es = this.brain.lang !== 'en';
    const current = this.thread.model;
    const extra = [
      ...['haiku', 'sonnet', 'opus'].filter((m) => m !== current).map((m) => ({
        id: `m-${m}`,
        label: `${es ? 'Seguir con' : 'Continue with'} ${cap(m)}`,
        run: () => {
          this.thread.model = m;
          this.panel.stream(es ? `Va, sigo con ${cap(m)}. ¿Qué más?` : `OK, going on with ${cap(m)}. What else?`, { done: true });
          this.offerThread();
        },
      })),
      { id: 'doc', label: es ? 'Hacer documento' : 'Make a document', run: () => this.makeDocument() },
      { id: 'end', label: es ? 'Charla normal' : 'Back to normal chat', run: () => {
        this.thread = null;
        this.panel.setActions([]);
        this.panel.stream(es ? 'Listo, vuelvo a mi modelo local.' : 'Done, back to my local model.', { done: true });
      } },
    ];
    this.offerFiles(files, extra);
  }

  // What was just looked up, as a document: a bigger Claude than the first (a document is worth it), asking before it writes
  makeDocument() {
    if (!this.thread) return;
    const es = this.brain.lang !== 'en';
    const model = this.thread.model === 'haiku' ? 'sonnet' : this.thread.model;
    const job = es
      ? 'Con lo que acabas de buscar en esta conversación, crea un documento Word (.docx) claro y bien organizado: título, secciones con subtítulos, y las fuentes al final. Guárdalo en la carpeta Documentos\\Capri (créala si no existe).'
      : 'With what you just looked up in this conversation, create a clear, well organized Word document (.docx): title, sections with headings, and the sources at the end. Save it in the folder Documents\\Capri (create it if missing).';
    this.dispatch(es ? 'Hacer un documento con eso' : 'Make a document of that', job, model, false, {});
  }

  // "genera una imagen de...": your nano-banana makes it (Gemini), it lands in Pictures\Capri, and she hands you buttons
  async imageReply(text, voice, rawPrompt, refs = [], edit = null) {
    if (this.turn || !this.open) return;
    const es = this.brain.lang !== 'en';
    const pro = /\b(?:con|en|usando|using|with)\s+(?:nano\s*banana\s+)?pro\b/i.test(rawPrompt);
    const prompt = rawPrompt.replace(/\b(?:con|en|usando|using|with)\s+(?:nano\s*banana\s+)?pro\b/i, '').trim() || rawPrompt;
    const id = Date.now();
    this.turn = id;
    this.speaker?.stop();
    this.panel.setActions([]);
    this.history.push({ role: 'user', content: text });
    this.chatTurn({ quote: text, face: 'aside' });
    this.panel.setChatBusy(true);
    this.panel.stream(edit ? (es ? `Editándola con Nano Banana${pro ? ' Pro' : ''}... tarda unos segundos. La original no se toca.` : `Editing it with Nano Banana${pro ? ' Pro' : ''}... a few seconds. The original stays as it is.`) : es ? `Pidiéndosela a Nano Banana${pro ? ' Pro' : ''}... tarda unos segundos.` : `Asking Nano Banana${pro ? ' Pro' : ''}... a few seconds.`);
    this.capri.pulse();
    const res = await this.host.imageMake({ prompt, model: pro ? 'pro' : 'flash', refs, ...(edit ? { edit } : {}) }).catch((err) => ({ ok: false, error: String(err.message || err) }));
    if (this.turn !== id) return; // closed meanwhile
    this.turn = 0;
    this.panel.setChatBusy(false);
    if (!res.ok) {
      this.panel.setFace('wide');
      this.panel.stream(`${es ? 'No salió la imagen:' : 'No image:'} ${res.error}`, { done: true });
      ui(this.voice, 'error');
      if (this.history.at(-1)?.content === text) this.history.pop();
      return;
    }
    const line = es ? 'Lista.' : 'Done.';
    ui(this.voice, 'image');
    this.remember({ role: 'assistant', content: `🖼 ${edit ? '✎ ' : ''}${prompt}${pro ? ' · Pro' : ''}`, via: 'image', files: res.files });
    this.panel.stream(line, { done: true });
    this.panel.setFace('smug');
    if (this.speaker?.wants(voice)) this.speaker.say(line, this.brain.lang);
    this.offerFiles(res.files, [
      { id: 'again', label: es ? 'Otra versión' : 'Another one', run: () => this.imageReply(prompt, false, pro ? `${prompt} con pro` : prompt, refs, edit) },
      { id: 'edit', label: es ? 'Editar' : 'Edit', run: () => this.armEdit(res.files[0]) }, // change something in the picture that just came out
      { id: 'palette', label: es ? 'Paleta' : 'Palette', run: () => this.paletteReply(es ? 'Paleta de esa imagen' : 'Palette of that picture', res.files[0], false) },
    ]);
  }

  // the last picture she made, if it's recent in this conversation (what "ahora hazla azul" refers to)
  recentImage() {
    for (let i = this.history.length - 1; i >= Math.max(0, this.history.length - 8); i--) {
      const m = this.history[i];
      if (m.role === 'assistant' && m.via === 'image' && m.files?.length) return m.files[0];
    }
    return null;
  }

  // EDITAR: the next thing you write is what to change in that picture
  armEdit(file) {
    const es = this.brain.lang !== 'en';
    this.editTarget = file;
    this.imageNext = false;
    this.claudeNext = false;
    this.panel.chatInput.placeholder = es ? 'Qué le cambio a esta imagen…' : 'What should I change in this picture…';
    this.panel.stream(es ? 'Dime qué le cambio («ponle fondo blanco», «hazla más oscura»…). Te hago una nueva; la original no se toca.' : 'Tell me what to change ("white background", "make it darker"...). I make a new one; the original stays.', { done: true });
    this.panel.setFace('smug');
    this.panel.chatInput.focus();
  }

  // the colours of a picture, from its pixels (no model): copied all at once, and each one a button
  // convert / lighten / shrink the pictures (imgtools.js): a new file next to each one, and what it saved
  async imgReply(text, files, ask, voice) {
    const es = this.brain.lang !== 'en';
    const name = { png: 'PNG', webp: 'WebP', jpg: 'JPG' };
    const lines = [];
    const made = [];
    for (const f of files.slice(0, 8)) {
      const r = await imgConvert(this.host, f, { fmt: ask.fmt, maxSide: ask.maxSide, quality: ask.kind === 'shrink' ? 0.72 : 0.9, tag: ask.kind === 'convert' ? name[ask.fmt] : '' }).catch((err) => ({ ok: false, error: err.message }));
      if (r.ok) { made.push(r.path); lines.push(`• ${basename(f)} → ${basename(r.path)}: ${kb(r.before)} → ${kb(r.after)}${r.after < r.before ? ` (−${Math.round((1 - r.after / r.before) * 100)}%)` : ''}`); }
      else lines.push(`• ${basename(f)}: ${r.error}`);
    }
    const head = made.length ? (es ? (ask.kind === 'convert' ? `Listo, ${name[ask.fmt]}:` : 'Listo, más liviana:') : (ask.kind === 'convert' ? `Done, ${name[ask.fmt]}:` : 'Done, lighter:')) : (es ? 'No pude:' : "I couldn't:");
    this.replyLocal(text, { line: `${head}\n${lines.join('\n')}`, face: made.length ? 'smug' : 'aside', minor: true, command: true }, voice);
    if (made.length) this.offerFiles(made);
    return undefined;
  }

  // pictures attached (dropped on her or with +): what she can do with them right there, no typing
  imageButtons() {
    const es = this.brain.lang !== 'en';
    const imgs = (this.attachments || []).filter((a) => a.kind === 'image');
    if (!imgs.length || imgs.length !== (this.attachments || []).length || this.turn) return;
    const files = imgs.map((i) => i.path);
    const act = {
      bg: () => this.bgReply('', files[0], false),
      png: () => this.imgReply('', files, { kind: 'convert', fmt: 'png', maxSide: 0 }, false),
      webp: () => this.imgReply('', files, { kind: 'convert', fmt: 'webp', maxSide: 0 }, false),
      jpg: () => this.imgReply('', files, { kind: 'convert', fmt: 'jpg', maxSide: 0 }, false),
      small: () => this.imgReply('', files, { kind: 'shrink', fmt: '', maxSide: 0 }, false),
    };
    this.panel.setActions([
      ...(files.length === 1 ? [{ id: 'bg', label: es ? 'Quitar fondo' : 'Remove bg' }] : []),
      { id: 'png', label: 'PNG' }, { id: 'webp', label: 'WebP' }, { id: 'jpg', label: 'JPG' },
      { id: 'small', label: es ? 'Achicar peso' : 'Make lighter' },
    ], async (id) => {
      this.panel.setActions([]);
      this.attachments = [];
      this.refreshChips();
      await act[id]?.();
    });
  }

  // "quítale el fondo": rembg on this PC (rembg.js); the result comes back as a PNG next to the original, with Open / Show folder
  async bgReply(text, file, voice) {
    const es = this.brain.lang !== 'en';
    this.replyLocal(text, { line: es ? 'Quitando el fondo aquí en tu PC… (la primera vez baja un modelo y tarda más).' : 'Taking the background off here on your PC… (the first time it downloads a model, which takes longer).', face: 'smug', minor: true, command: true }, voice);
    const res = await this.host.removeBg?.(file).catch(() => ({ ok: false, error: 'failed' }));
    if (res?.ok) {
      this.fileReady(es ? 'Listo: PNG con fondo transparente, junto al original.' : 'Done: a PNG with a transparent background, next to the original.', res.path);
      return undefined;
    }
    const line = res?.error === 'not-installed'
      ? (es ? 'Todavía no tengo rembg instalado. Corre tools\\install-rembg.ps1 (una sola vez) y reiníciame; mientras tanto puedo quitarlo con Nano Banana, que gasta uso.' : 'I do not have rembg installed yet. Run tools\\install-rembg.ps1 (once) and restart me; meanwhile I can do it with Nano Banana, which spends usage.')
      : (es ? `No pude quitar el fondo${res?.error && res.error !== 'failed' ? `: ${res.error}` : ''}.` : `I couldn't take the background off${res?.error && res.error !== 'failed' ? `: ${res.error}` : ''}.`);
    if (!this.notify(line, 'aside', { keep: false })) this.panel.say({ kind: 'error', line, hold: 9000 });
    return undefined;
  }

  async paletteReply(text, file, voice) {
    const es = this.brain.lang !== 'en';
    const res = await this.host.paletteOf?.(file).catch(() => ({ ok: false }));
    if (!res?.ok) return this.replyLocal(text, { line: es ? 'No pude leer los colores de esa imagen.' : "I couldn't read the colours of that picture.", face: 'wide' }, voice);
    const line = es ? `${res.colors.length} colores, del que más hay al que menos. Ya los copié todos; toca uno para copiar solo ese.` : `${res.colors.length} colours, most to least present. All copied; press one to copy just that.`;
    this.replyLocal(text, { line, face: 'smug', record: { role: 'assistant', content: `🎨 ${res.colors.map((c) => c.hex).join(' ')}`, via: 'palette' } }, voice);
    this.panel.setSwatches(res.colors, (hex) => this.host.copy(hex));
    return undefined;
  }

  // "mira esto": her scanner's frame opens over your screen (scanner.js); you move it and press SCAN
  scanReply(text, voice) {
    const es = this.brain.lang !== 'en';
    this.host.scannerOpen?.();
    this.replyLocal(text, {
      line: es ? 'Abriendo el marco del escáner. Muévelo sobre lo que quieras mostrarme y dale ESCANEAR (o Enter).'
        : 'Opening the scanner frame. Move it over what you want to show me and hit SCAN (or Enter).',
      face: 'smug',
    }, voice);
  }

  // The strip under her line to type in (nowplaying.js): what plays on your PC, while the chat is open.
  startNow() {
    this.strip?.start();
  }

  stopNow() {
    this.strip?.stop();
  }

  // "¿qué suena?": what's playing, answered at once with ⏮ ⏯ ⏭ under it (the card can't open over her chat)
  // A short order said out loud (pause, next, open an app...) without her big chat card: it is done and answered with a small card that
  // goes by itself. Music orders are never read out; the rest of them are. Returns true when it was handled here.
  async quickVoice(text, { force = false } = {}) {
    // force: Claude is in the middle of an answer (or her chat is open) and you gave a plain order for the PC: it is done anyway, quietly (no voice over the answer)
    if (this.agent || (!force && (this.open || this.turn))) return false;
    const q = await this.systemOrder(text).catch(() => null);
    const SIMPLE = ['media', 'musicDefault', 'playlist', 'player', 'shuffle', 'music', 'open'];
    if (!q || q.ask || q.social || q.cap || !(q.missing || SIMPLE.includes(q.kind))) return false;
    const es = this.brain.lang !== 'en';
    const musicOrder = ['media', 'musicDefault', 'playlist', 'player', 'shuffle', 'music'].includes(q.kind);
    let done = null;
    if (q.missing) {
      const name = splitApps(q.text || text).join(es ? ' y ' : ' and ');
      done = { line: es ? `No encuentro «${name || 'esa app'}» entre tus apps instaladas.` : `I cannot find "${name || 'that app'}" among your installed apps.`, face: 'aside' };
    } else {
      done = await this.doNow(q).catch(() => null);
    }
    const failed = !done || done.face === 'aside' || Boolean(q.missing);
    const line = done?.line || (es ? 'No pude hacerlo.' : 'I could not do that.');
    if (!failed) ui(this.voice, 'go');
    this.capri.pulse();
    this.panel.say({ kind: failed ? 'error' : 'done', face: done?.face || (failed ? 'aside' : 'smug'), line, compact: true, hold: failed ? 5000 : 3200 });
    if (!musicOrder && !force && this.speaker?.wants(true, true)) this.speaker.say(line, this.brain.lang, {});
    return true;
  }

  // The chats that wait for your answer, in her chat: who, since when and what they said, with a button to answer each one
  pendingInChat(text, voice, app = '') {
    const es = this.brain.lang !== 'en';
    const list = pending.list().filter((p) => !app || p.app === app);
    if (!list.length) return this.replyLocal(text, { minor: true, msg: true, line: es ? 'No tienes chats pendientes por responder.' : 'No chats are waiting for an answer.', face: 'smug' }, voice);
    const d = pendingText(list, es);
    this.replyLocal(text, { minor: true, msg: true, line: `${d.head}\n${d.body}`, face: 'smug' }, voice);
    this.panel.setActions(pendingButtons(list, es), (id) => pendingAct(id, list, { es, chat: this, panel: this.panel, inChat: true }));
    return undefined;
  }

  // Chat apps (WhatsApp, Discord, Telegram). What they send to Windows (notifications) is what she remembers, and reads back; she writes only
  // when you press Send (or "just type it") on her card. WhatsApp for Windows shows no text to other programs, so for it the notifications are all she has.
  async msgFlow(text, q, voiceAsked) {
    const es = this.brain.lang !== 'en';
    const cfgM = (await this.host.getConfig?.().catch(() => null)) || {};
    this.msgSilent = cfgM.msgVoice !== true; // (replyLocal: what these chats say is not read out, whatever the voice mode)
    const voice = cfgM.msgVoice === true ? voiceAsked : false; // (about messages she does not read aloud what they say, unless msgVoice: true)
    const names = { whatsapp: 'WhatsApp', discord: 'Discord', telegram: 'Telegram' };
    const hist = (await this.host.msgHistory?.(q.app || '').catch(() => [])) || [];
    const app = q.app || this.lastMsgApp || hist[hist.length - 1]?.app || '';
    if (q.kind === 'read' && pending.list().some((p) => !q.app || p.app === q.app)) return this.pendingInChat(text, voice, q.app || ''); // (what waits for you, with a button for each chat)
    if (q.kind === 'read') {
      const label = names[app] || (es ? 'tus chats' : 'your chats');
      const mine = (q.app ? hist : await this.host.msgHistory?.('').catch(() => []) || []).slice(-8);
      if (mine.length) {
        this.lastMsgApp = mine[mine.length - 1].app;
        const clock = (t) => new Date(t).toLocaleTimeString(es ? 'es-CO' : 'en-GB', { hour: '2-digit', minute: '2-digit' });
        const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
        const body = mine.map((m) => `• ${clock(m.t)} ${q.app ? '' : `[${names[m.app] || m.app}] `}${clip(m.title, 40)}${m.body ? `: ${clip(m.body, 160)}` : ''}`).join('\n');
        return this.replyLocal(text, { minor: true, msg: true, line: `${es ? `Lo último que me llegó de ${label}:` : `The latest I got from ${label}:`}\n${body}`, face: 'smug' }, voice);
      }
      if (app && app !== 'whatsapp') { // (an app whose window does show its text)
        const r = await this.host.msgRead?.(app).catch(() => null);
        if (this.turn || !this.open) return;
        const rows = r?.ok ? r.lines.filter((l) => l.length > 1).slice(-8) : [];
        if (rows.length) return this.replyLocal(text, { minor: true, msg: true, line: `${es ? `Esto dice ${label} ahora:` : `${label} says right now:`}\n${rows.map((l) => `• ${l.length > 160 ? `${l.slice(0, 157)}…` : l}`).join('\n')}`, face: 'smug' }, voice);
      }
      return this.replyLocal(text, { minor: true, msg: true, line: es ? `No me ha llegado nada de ${label} desde que estoy despierta. Leo lo que las apps mandan a las notificaciones de Windows, así que si no sale banner ni aviso en el centro de notificaciones, no lo veo.` : `Nothing has come in from ${label} since I woke up. I read what apps send to Windows notifications, so if no banner or notification-center entry appears, I do not see it.`, face: 'aside' }, voice);
    }
    // reply: nothing leaves until you press a button on her card
    const label = names[app] || '';
    if (!app) return this.replyLocal(text, { minor: true, msg: true, line: es ? '¿En cuál? Dime WhatsApp, Discord o Telegram.' : 'Which one? WhatsApp, Discord or Telegram.', face: 'aside' }, voice);
    const msg = String(q.text || '').trim();
    if (!msg) return this.replyLocal(text, { minor: true, msg: true, line: es ? `¿Qué le respondo en ${label}? Dime, por ejemplo: «responde en ${label}: ya voy».` : `What shall I answer in ${label}? Say, for example: "reply in ${label}: on my way".`, face: 'aside' }, voice);
    const last = [...hist].reverse().find((m) => m.app === app);
    const contact = String(q.to || last?.title || '').trim();
    if (app === 'whatsapp' && !contact) return this.replyLocal(text, { minor: true, msg: true, line: es ? 'No sé a quién. Dime «responde en WhatsApp a Mamá: …» o espera a que te llegue algo y respóndele.' : 'I do not know who to. Say "reply in WhatsApp to Mom: …" or wait for something to come in.', face: 'aside' }, voice);
    this.lastMsgApp = app;
    const who = contact ? (es ? `a «${contact}»` : `to "${contact}"`) : (es ? 'en la conversación que tengas abierta' : 'in the chat you have open');
    const doSend = async (send) => {
      const r = await this.host.msgSend?.(app, msg, true, { send, contact: app === 'whatsapp' || q.to ? contact : '' }).catch(() => null);
      const ok = r?.ok;
      if (ok) pending.removeLike(app, contact); // (answered from her: it is no longer waiting)
      const line = ok ? (send ? (es ? 'Enviado.' : 'Sent.') : (es ? 'Escrito. Revísalo y dale Enter tú.' : 'Typed. Check it and press Enter yourself.'))
        : (es ? `No pude: ${r?.error === 'window not found' ? `no veo ${label} abierto` : (r?.error || 'error')}.` : `Couldn't: ${r?.error || 'error'}.`);
      this.panel.say({ kind: ok ? 'done' : 'error', badge: es ? 'MENSAJE' : 'MESSAGE', line, face: ok ? 'smug' : 'aside', hold: 5000, compact: true });
      if (voiceAsked && this.speaker?.wants(true)) this.speaker.say(line, this.brain.lang); // (asked by voice: only whether it went)
    };
    // you wrote (or said) the message and who it is for: it goes at once. msgConfirm: true brings the "¿La envío?" card back
    if (cfgM.msgConfirm !== true) { this.panel.say({ kind: 'work', badge: es ? 'MENSAJE' : 'MESSAGE', line: es ? `Enviando a ${contact || label}…` : `Sending to ${contact || label}…`, hold: 15000, compact: true }); return doSend(true); }
    this.replyLocal(text, { minor: true, msg: true, line: es ? `Voy a escribirle ${who} en ${label}:\n«${msg}»\n¿La envío?` : `I’ll write ${who} in ${label}:\n“${msg}”\nSend it?`, face: 'smug' }, voice);
    this.panel.setActions([
      { id: 'send', label: es ? 'Enviar' : 'Send', primary: true },
      { id: 'type', label: es ? 'Solo escribirlo' : 'Just type it' },
      { id: 'cancel', label: es ? 'Cancelar' : 'Cancel' },
    ], async (id) => {
      this.panel.setActions([]);
      if (id === 'cancel') return this.notify?.(es ? 'Cancelado, no envié nada.' : 'Cancelled, nothing sent.', 'aside');
      return doSend(id === 'send');
    });
  }

  // Her eyes on the PC: the windows that are open, or what one of them says. Only what the program shows to other programs: some show everything,
  // some (WhatsApp for Windows, games, drawing canvases) only their buttons.
  async winFlow(text, q, voice) {
    const es = this.brain.lang !== 'en';
    const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
    if (q.kind === 'list') {
      const rows = (await this.host.winList?.().catch(() => [])) || [];
      if (this.turn || !this.open) return;
      if (!rows.length) return this.replyLocal(text, { line: es ? 'No veo ventanas abiertas.' : 'I see no open windows.', face: 'aside' }, voice);
      const by = new Map();
      for (const r of rows) by.set(r.proc, [...(by.get(r.proc) || []), r.title]);
      const body = [...by].slice(0, 14).map(([proc, titles]) => `• ${proc}${titles.length > 1 ? ` ×${titles.length}` : ''}: ${clip(titles[0], 70)}`).join('\n');
      return this.replyLocal(text, { line: `${es ? `Tienes ${rows.length} ventanas abiertas:` : `You have ${rows.length} windows open:`}\n${body}`, face: 'smug' }, voice);
    }
    const r = await this.host.winRead?.(q.target).catch(() => null);
    if (this.turn || !this.open) return;
    if (!r?.ok) return this.replyLocal(text, { line: es ? `No pude leer esa ventana: ${r?.error === 'window not found' ? 'no la encuentro' : (r?.error || 'sin respuesta')}.` : `Couldn't read that window: ${r?.error === 'window not found' ? 'not found' : (r?.error || 'no answer')}.`, face: 'aside' }, voice);
    const rows = r.lines.filter((l) => l.length > 2).slice(0, 14);
    const chrome = /^(?:minimize|maximize|close|restore|minimizar|maximizar|cerrar|restaurar|system|sistema)$/i;
    const real = rows.filter((l) => !chrome.test(l) && !/^(?:non client|appwindow|title bar)/i.test(l));
    const head = `${r.proc}: ${clip(r.title, 60)}`;
    if (real.length < 3) return this.replyLocal(text, { line: es ? `${head}\nEsa ventana casi no muestra texto a otros programas, así que no puedo ver lo que contiene.` : `${head}\nThat window shows almost no text to other programs, so I cannot see what is in it.`, face: 'aside' }, voice);
    return this.replyLocal(text, { line: `${head}\n${real.map((l) => `• ${clip(l, 120)}`).join('\n')}`, face: 'smug' }, voice);
  }

  // Caches and temporary files: she says what is there and how big, and empties only what you press.
  async cleanFlow(text, voice) {
    const es = this.brain.lang !== 'en';
    const size = (b) => (b >= 1073741824 ? `${(b / 1073741824).toFixed(1)} GB` : `${Math.round(b / 1048576)} MB`);
    const list = (await this.host.cleanScan?.().catch(() => [])) || [];
    if (this.turn || !this.open) return;
    if (!list.length) return this.replyLocal(text, { line: es ? 'No encontré cachés ni temporales que valga la pena limpiar.' : 'I found no caches or temporary files worth cleaning.', face: 'smug' }, voice);
    const total = list.reduce((n, c) => n + c.bytes, 0);
    const body = list.map((c) => `• ${es ? c.es : c.en}: ${size(c.bytes)}`).join('\n');
    this.replyLocal(text, { line: `${es ? `Puedo liberar unos ${size(total)}:` : `I can free about ${size(total)}:`}\n${body}\n${es ? 'No toco nada de lo último media hora ni nada fuera de esta lista. Algunos archivos en uso se quedan.' : 'I leave alone anything from the last half hour and anything outside this list. Files in use stay.'}`, face: 'smug' }, voice);
    const top = list.slice(0, 3);
    this.panel.setActions([
      { id: 'all', label: es ? `Limpiar todo (${size(total)})` : `Clean all (${size(total)})`, primary: true },
      ...top.map((c) => ({ id: c.id, label: `${es ? c.es.replace(/^(?:Caché de |Archivos |Cachés de )/, '') : c.en.replace(/ cache$/, '')} ${size(c.bytes)}` })),
      { id: 'cancel', label: es ? 'Cancelar' : 'Cancel' },
    ], async (id) => {
      this.panel.setActions([]);
      if (id === 'cancel') return this.notify?.(es ? 'Listo, no borré nada.' : 'Done, I deleted nothing.', 'aside');
      const ids = id === 'all' ? list.map((c) => c.id) : [id];
      const r = await this.host.cleanRun?.(ids, true).catch(() => null);
      const line = r?.ok ? (es ? `Listo: liberé ${size(r.freed)}.` : `Done: freed ${size(r.freed)}.`) : (es ? `No pude limpiar: ${r?.error || 'error'}.` : `Couldn't clean: ${r?.error || 'error'}.`);
      this.panel.say({ kind: r?.ok ? 'done' : 'error', badge: es ? 'LIMPIEZA' : 'CLEANUP', line, face: r?.ok ? 'laugh' : 'aside', hold: 7000 });
    });
  }

  // What weighs on the PC for nothing: the safe ones she can close on your OK; the heavy rest is only shown.
  async perfFlow(text, voice) {
    const es = this.brain.lang !== 'en';
    const gb = (m) => (m >= 1024 ? `${(m / 1024).toFixed(1)} GB` : `${m} MB`);
    const r = await this.host.perfScan?.().catch(() => null);
    if (this.turn || !this.open) return;
    if (!r?.total) return this.replyLocal(text, { line: es ? 'No pude mirar los procesos ahora.' : 'I could not look at the processes right now.', face: 'aside' }, voice);
    const head = es ? `Memoria: ${gb(r.total - r.free)} en uso de ${gb(r.total)}.` : `Memory: ${gb(r.total - r.free)} in use of ${gb(r.total)}.`;
    const safeMb = r.safe.reduce((n, p) => n + p.mb, 0);
    const lines = [head];
    if (r.safe.length) lines.push(es ? `Puedo cerrar esto sin problema (${gb(safeMb)}):` : `I can close these safely (${gb(safeMb)}):`, ...r.safe.map((p) => `• ${p.name}${p.count > 1 ? ` ×${p.count}` : ''} — ${gb(p.mb)}`));
    else lines.push(es ? 'No veo nada de la lista segura que sobre.' : 'I see nothing from the safe list that is not needed.');
    if (r.heavy.length) lines.push(es ? 'Lo que más pesa (tú decides, por ejemplo «cierra Chrome»):' : 'What weighs most (your call, for example "close Chrome"):', ...r.heavy.map((p) => `• ${p.name}${p.count > 1 ? ` ×${p.count}` : ''} — ${gb(p.mb)}${p.win ? '' : (es ? ' (sin ventana)' : ' (no window)')}`));
    this.replyLocal(text, { line: lines.join('\n'), face: 'smug' }, voice);
    if (!r.safe.length) return;
    this.panel.setActions([
      { id: 'close', label: es ? `Cerrar lo seguro (${gb(safeMb)})` : `Close the safe ones (${gb(safeMb)})`, primary: true },
      { id: 'cancel', label: es ? 'Dejarlo así' : 'Leave it' },
    ], async (id) => {
      this.panel.setActions([]);
      if (id !== 'close') return;
      const done = await this.host.perfRun?.(r.safe.map((p) => p.name), true).catch(() => null);
      const line = done?.ok ? (es ? `Cerré ${done.closed} procesos. Debí liberar unos ${gb(safeMb)}.` : `Closed ${done.closed} processes. That should free about ${gb(safeMb)}.`) : (es ? `No pude cerrarlos: ${done?.error || 'error'}.` : `Couldn't close them: ${done?.error || 'error'}.`);
      this.panel.say({ kind: done?.ok ? 'done' : 'error', badge: es ? 'RENDIMIENTO' : 'SPEED', line, face: done?.ok ? 'laugh' : 'aside', hold: 7000 });
    });
  }

  async nowReply(text, voice) {
    const info = await this.host.nowPlaying().catch(() => null);
    if (this.turn || !this.open) return;
    this.replyLocal(text, { line: nowLine(this.brain.t.nowPlaying, info), face: info ? 'smug' : 'aside' }, voice);
    if (info) this.panel.setActions(mediaButtons(info.playing), (id) => this.nowAct(id));
  }

  async nowAct(id) {
    if (!this.open || this.turn) return;
    this.voice.play('tick', { gain: 2.5 });
    await this.host.nowControl(id);
    await new Promise((resolve) => setTimeout(resolve, 900)); // the player needs a moment to report the new song
    if (!this.open || this.turn) return;
    const info = await this.host.nowPlaying().catch(() => null);
    if (!this.open || this.turn) return;
    this.panel.stream(nowLine(this.brain.t.nowPlaying, info), { done: true });
    this.panel.setActions(info ? mediaButtons(info.playing) : [], (next) => this.nowAct(next));
  }

  // The ↻ button's count of answers in Claude Code's conversation with her.
  updateCounter() {
    if (!this.open || !this.agent) return;
    this.panel.setSession(this.turns, fmt(this.t.sessionTitle, { n: this.turns }));
  }

  // "empecemos de cero" (typed, said, the ↻ button): she asks first, and you can say no and keep the thread.
  askReset(text = null, voice = false) {
    if (!this.open || this.turn || !this.agent) return;
    if (!this.turns) return this.answerReset(text, true, voice); // nothing to lose
    this.speaker?.stop();
    this.resetPending = true;
    const line = fmt(this.t.resetAsk, { n: this.turns });
    this.chatTurn({ quote: text || '', face: 'look' });
    this.panel.stream(line, { done: true });
    this.panel.setChatBusy(false);
    this.panel.setActions(
      [{ id: 'yes', label: this.t.resetYes, primary: true }, { id: 'no', label: this.t.resetNo }],
      (id) => this.answerReset(null, id === 'yes'),
    );
    if (this.speaker?.wants(voice)) this.speaker.say(line, this.brain.lang);
  }

  async answerReset(text, yes, voice = false) {
    this.resetPending = false;
    this.panel.setActions([]);
    let line;
    if (yes) {
      await this.host.chatReset().catch(() => {});
      this.history = [];
      this.turns = 0;
      this.warnedAt = 0;
      line = pick([this.t.resetDone]);
      this.updateCounter();
    } else {
      this.warnedAt = this.turns; // she won't ask again until the thread has grown some more
      line = this.t.resetKept;
    }
    this.chatTurn({ quote: text || '', face: yes ? 'smug' : 'calm' });
    this.panel.stream(line, { done: true });
    this.panel.setChatBusy(false);
    if (this.speaker?.wants(voice)) this.speaker.say(line, this.brain.lang);
  }

  // After an answer, once the thread is long: she says so under it, with the same yes or no.
  maybeWarn(answer) {
    if (!this.open || this.turn || this.turns < WARN_AT || this.turns - this.warnedAt < WARN_EVERY) return;
    this.warnedAt = this.turns;
    this.resetPending = true;
    this.addLine(answer, fmt(this.t.longWarn, { n: this.turns }));
    this.panel.setActions(
      [{ id: 'yes', label: this.t.resetYes, primary: true }, { id: 'no', label: this.t.resetNo }],
      (id) => this.answerReset(null, id === 'yes'),
    );
  }

  // an answer that needs no model (a timer): at once, and out loud if you spoke to her
  // An order (open an app, a timer, a note, what plays, the scanner...) is not a conversation: it is shown in her card and said, but it is not written
  // into the conversation, so it neither adds to the list of conversations nor starts one. Her conversations are what you talk about with her and
  // with Claude, and the pictures you ask for.
  replyLocal(text, local, voice) {
    const { line, face } = local;
    this.speaker?.stop();
    const keep = Boolean(local.record); // (only what leaves something to keep, like a palette of a picture)
    if (keep) this.history.push({ role: 'user', content: text });
    this.panel.setActions([]);
    this.chatTurn({ quote: text, face: 'aside' });
    this.capri.pulse();
    if (keep) this.remember(local.record);
    this.panel.stream(line, { done: true });
    this.panel.setFace(face || 'smug');
    if (face === 'laugh') this.panel.onLaugh?.(); // (her little giggle, when she laughs at an answer)
    this.panel.setChatBusy(false);
    if (!(local.msg && this.msgSilent) && this.speaker?.wants(voice, !local.minor)) this.speaker.say(line, this.brain.lang, { flirt: Boolean(local.flirt) }); // (notes, timers, deadlines, summaries: what matters; an app that opens: not)
    // something scheduled for an app she can't find: she says so, and drops it
    local.check?.then((ok) => {
      if (ok) return;
      this.timers.remove(local.item);
      if (!this.notify(local.missing, 'aside')) this.panel.say({ kind: 'info', line: local.missing, hold: 8000 });
    }).catch(() => {});
  }

  // she says something on her own while the chat is open (a timer rang): true if it went in the chat
  // A job for Claude finished after you closed her chat: the answer goes into its conversation (this one, or another you moved to), and onBackground
  // (app.js) shows it as a card with the files as buttons.
  async finishInBackground(sessionId, res) {
    if (res.error === 'stopped') return;
    const ok = Boolean(res.ok);
    const answer = ok ? clean(res.text) || '…' : `${this.t.failed} ${res.error}`;
    const msg = { role: 'assistant', content: answer, ...(ok && res.files?.length ? { files: res.files } : {}) };
    if (this.session?.id === sessionId) {
      this.history.push(msg);
      this.history = this.history.slice(-KEEP);
      await this.saveNow();
    } else {
      const s = await this.host.sessionGet(sessionId).catch(() => null);
      if (s) {
        s.messages = [...(s.messages || []), msg];
        s.updatedAt = Date.now();
        await this.host.sessionSave(s).catch(() => {});
      }
    }
    this.onBackground?.({ ok, line: answer, files: ok ? res.files || [] : [], sessionId });
  }

  notify(line, face = 'laugh', { keep = true } = {}) {
    if (!this.open || this.turn) return false;
    this.chatTurn({ quote: '', face });
    this.panel.stream(line, { done: true });
    this.panel.setChatBusy(false);
    if (keep) this.remember({ role: 'assistant', content: line }); // (an alert isn't part of the conversation: keep: false)
    return true;
  }

  // an answer of hers, kept with your message before it
  remember(message) {
    this.history.push(message);
    this.history = this.history.slice(-KEEP);
    this.saveSession();
  }

  listApps() {
    this.appsReady = this.host.openApps().then((list) => { this.apps = list || []; }).catch(() => {});
  }

  // What you asked plainly, read off your message (a small model doesn't always write its tag right):
  // { kind: 'media', action } | { kind: 'music', song } | { kind: 'close', name } | { kind: 'open', text }
  asked(text) {
    text = canon(text);
    const count = text.trim().split(/\s+/).length;
    const name = NAME_ASK.exec(text)?.[1];
    if (name) return { kind: 'name', name };
    const memo = MEMO_ASK.exec(text)?.[1]?.trim();
    if (memo) return { kind: 'memo', text: memo };
    const folder = FOLDER_ASK.exec(text);
    if (folder) return { kind: 'folder', name: folder[1] };
    const fileQ = fileAsked(text);
    if (fileQ) return { kind: 'file', ...fileQ };
    if (SHUFFLE_ASK.test(text)) return { kind: 'shuffle' };
    const playerAct = PLAYER_ASK.find(([, re]) => re.test(text))?.[0];
    if (playerAct) return { kind: 'player', action: playerAct };
    const plSave = PLAYLIST_SAVE.exec(text);
    if (plSave) return { kind: 'playlistSave', name: plSave[1].replace(/^(?:como|llamada)\s+/i, '').trim(), url: plSave[2] || '' };
    if (PLAYLIST_LIST.test(text)) return { kind: 'playlistList' };
    if (MUSIC_DEFAULT.test(text)) return { kind: 'musicDefault' };
    const plPlay = PLAYLIST_PLAY.exec(text);
    if (plPlay && plPlay[1] && !/^(?:en|de)\s+spotify/i.test(plPlay[1])) {
      // "en aleatorio" / "en orden" at the end say how, just this once (otherwise her config: shuffled)
      const how = /\s+(sin\s+aleatorio|en\s+orden|en\s+secuencia|en\s+aleatorio|aleatoria?)\s*$/i.exec(plPlay[1]);
      const name = plPlay[1].replace(/\s+(?:sin\s+aleatorio|en\s+orden|en\s+secuencia|en\s+aleatorio|aleatoria?)\s*$/i, '').trim();
      return { kind: 'playlist', name, ...(how ? { shuffle: !/sin|orden|secuencia/i.test(how[1]) } : {}) };
    }
    const media = MEDIA_ASK.find(([, re]) => re.test(text))?.[0];
    if (media && (count <= 5 || MUSIC_WORD.test(text))) return { kind: 'media', action: media };
    const song = SPOTIFY_ASK.exec(text)?.[1];
    if (song) return { kind: 'music', song };
    const app = this.askedToClose(text);
    if (app) return { kind: 'close', name: app };
    if (OPEN_ASK.test(text) && count <= 8) return { kind: 'open', text };
    return null;
  }

  // Doing it now. Resolves with her line about it ({ line, face }), or null if there was nothing to do.
  async doNow(asked) {
    const { t } = this;
    const custom = this.brain.custom;
    if (asked.kind === 'name') {
      custom.userName = asked.name; // her answer, being written now, already knows it
      this.host.setConfig({ userName: asked.name });
      return { line: fmt(this.brain.t.custom.named, { name: asked.name }), face: 'laugh' };
    }
    if (asked.kind === 'memo') {
      custom.memories = [...(custom.memories || []).filter((m) => m !== asked.text), asked.text].slice(-MEMORIES_MAX);
      this.host.setConfig({ memories: custom.memories });
      return { line: this.brain.t.custom.remembered, face: 'smug' };
    }
    if (asked.kind === 'media') {
      this.capri.pulse();
      return (await this.host.media(asked.action)) ? { line: t.media[asked.action], face: 'smug' } : null;
    }
    const es = this.brain.lang !== 'en';
    if (asked.kind === 'shuffle') {
      const res = await this.host.ytmShuffle?.('bar').catch(() => null);
      return { line: res?.ok ? (es ? 'Cambié el aleatorio de YouTube Music.' : 'Switched YouTube Music\u2019s shuffle.') : (es ? 'No pude tocar el aleatorio: ¿está abierta la app de YouTube Music?' : 'I could not press shuffle: is the YouTube Music app open?'), face: res?.ok ? 'smug' : 'aside', minor: true };
    }
    if (asked.kind === 'player') {
      this.player?.command(asked.action);
      const lines = es
        ? { show: 'Reproductor a la vista.', hide: 'Reproductor escondido. Dime "muestra el reproductor" o usa su botón.', dock: 'Reproductor fijado bajo mi tarjeta.', float: 'Reproductor suelto: tómalo por su barra y llévalo adonde quieras.' }
        : { show: 'Player on screen.', hide: 'Player hidden. Say "show the player" or use its button.', dock: 'Player pinned under my card.', float: 'Player loose: take it by its bar and put it where you want.' };
      return { line: lines[asked.action], face: 'smug', minor: true };
    }
    if (asked.kind === 'playlistList') {
      const names = await this.host.ytmList?.().catch(() => []);
      return { line: names?.length ? (es ? `Tus playlists guardadas: ${names.join(', ')}.` : `Your saved playlists: ${names.join(', ')}.`) : (es ? 'Todavía no tengo ninguna. Copia el enlace de una playlist de YouTube Music y dime "guarda esta playlist como" y su nombre.' : 'None yet. Copy a YouTube Music playlist link and tell me "save this playlist as" and its name.'), face: 'smug', minor: true };
    }
    if (asked.kind === 'playlistSave') {
      const res = await this.host.ytmSave?.({ name: asked.name, url: asked.url }).catch(() => null);
      if (res?.ok && res.main) return { line: es ? `Listo: «${res.name}» es tu playlist principal. Di "pon música" y la pongo.` : `Done: "${res.name}" is your main playlist. Say "play some music" and I will put it on.`, face: 'laugh', minor: true };
      if (res?.ok) return { line: es ? `Guardé la playlist «${res.name}». Pídemela con "reproduce mi playlist ${res.name}".` : `Saved the playlist "${res.name}". Ask with "play my playlist ${res.name}".`, face: 'laugh', minor: true };
      return { line: res?.error === 'name'
        ? (es ? '¿Con qué nombre la guardo? Di "guarda esta playlist como" y el nombre.' : 'What name do I save it under? Say "save this playlist as" and the name.')
        : (es ? 'No encuentro un enlace de playlist. Copia el enlace de la playlist en YouTube Music (el que trae «list=») o pégalo en tu mensaje, y vuelvo a probar.' : 'I cannot find a playlist link. Copy the playlist link in YouTube Music (the one with "list=") or paste it in your message, and I will try again.'), face: 'aside', minor: true };
    }
    if (asked.kind === 'musicDefault') { // "pon música": what is paused goes on, what plays is left alone, and with nothing there her main playlist starts
      const now = await this.host.nowPlaying?.().catch(() => null);
      // only a real music player counts here (YT Music, Spotify...): a YouTube video in the browser that carries an album is not "your music", and "pon música" must not resume it
      const mine = now?.kind === 'music' && /cinhimbnkk|youtubemusic|ytmusic|spotify|zune|itunes|deezer|tidal|amazonmusic|applemusic/i.test(String(now.appId || ''));
      if (mine && now.playing) return { line: es ? `Ya suena «${now.title}».` : `"${now.title}" is already playing.`, face: 'smug', minor: true };
      if (mine && !now.playing) {
        await this.host.media('play');
        return { line: es ? `Sigo con «${now.title}».` : `Resuming "${now.title}".`, face: 'laugh', minor: true };
      }
      this.zap();
      const res = await this.host.ytmPlay?.('', {}).catch(() => null);
      if (res?.ok && res.found) return { line: es ? `Pongo tu playlist «${res.name}» en YouTube Music.` : `Playing your playlist "${res.name}" in YouTube Music.`, face: 'laugh', minor: true };
      if (res?.error === 'name' || (res?.ok && !res.found)) return { line: es ? 'Todavía no tengo tu playlist principal. Dime "guarda esta playlist como principal" con su enlace de YouTube Music.' : 'I do not have your main playlist yet. Tell me "save this playlist as main" with its YouTube Music link.', face: 'aside', minor: true };
      return { line: es ? 'No pude abrir YouTube Music.' : 'I could not open YouTube Music.', face: 'aside', minor: true };
    }
    if (asked.kind === 'playlist') {
      this.zap();
      const res = await this.host.ytmPlay?.(asked.name, typeof asked.shuffle === 'boolean' ? { shuffle: asked.shuffle } : {}).catch(() => null);
      if (!res?.ok) return { line: es ? 'No pude abrir YouTube Music.' : 'I could not open YouTube Music.', face: 'aside', minor: true };
      if (res.found) return { line: es ? `Reproduciendo tu playlist «${res.name}» en YouTube Music${res.shuffle ? ', en aleatorio' : ''}.` : `Playing your playlist "${res.name}" in YouTube Music${res.shuffle ? ', shuffled' : ''}.`, face: 'laugh', minor: true };
      return { line: es ? `No tengo guardada «${res.name}»: te abrí su búsqueda en YouTube Music. Para guardarla, copia el enlace de la playlist y dime "guarda esta playlist como ${res.name}".` : `I do not have "${res.name}" saved: I opened its search in YouTube Music. To save it, copy the playlist link and tell me "save this playlist as ${res.name}".`, face: 'aside', minor: true };
    }
    if (asked.kind === 'music') {
      this.zap();
      return (await this.host.music(asked.song)) ? { line: fmt(t.music, { song: asked.song }), face: 'laugh' } : null;
    }
    // several apps in one sentence ("abre yt music y whatsapp"): each name is looked for, and every one found opens
    const parts = splitApps(asked.text);
    if (parts.length > 1) {
      const found = [];
      const web = [];
      const missing = [];
      for (const part of parts) {
        const it = await this.host.findLaunch(part).catch(() => null);
        if (it) { if (!found.some((f) => f.kind === it.kind && f.id === it.id)) found.push(it); continue; }
        const w = webFor(part);
        if (w) { if (!web.some((x) => x[1] === w[1])) web.push(w); } else missing.push(part);
      }
      if (found.length + web.length > 1 || (found.length + web.length === 1 && missing.length)) { // all that can be opened is opened, and what could not is said
        this.zap();
        const results = await Promise.all([
          ...found.map((it) => this.host.launch(it).catch((err) => ({ ok: false, error: err.message }))),
          ...web.map((w) => this.host.openSite(w[1]).then((ok) => ({ ok: Boolean(ok) })).catch((err) => ({ ok: false, error: err.message }))),
        ]);
        const all = [...found.map((it) => it.name), ...web.map((w) => `${w[2]} (${es ? 'en el navegador' : 'in the browser'})`)];
        const good = all.filter((_, i) => results[i]?.ok);
        const bad = all.filter((_, i) => !results[i]?.ok);
        if (!good.length) return { line: `${t.failed} ${results[0]?.error || ''}`.trim(), face: 'aside' };
        const and = this.brain.lang === 'en' ? 'and' : 'y';
        const names = good.length > 1 ? `${good.slice(0, -1).join(', ')} ${and} ${good.at(-1)}` : good[0];
        const notes = [...(bad.length ? [`${t.failed} ${bad.join(', ')}`] : []), ...(missing.length ? [es ? `No encontré: ${missing.join(', ')}.` : `I could not find: ${missing.join(', ')}.`] : [])];
        return { line: `${fmt(t.opened, { app: names })}${notes.length ? ` ${notes.join(' ')}` : ''}`, face: missing.length ? 'aside' : 'laugh', minor: true };
      }
    }
    const item = await this.host.findLaunch(asked.text);
    if (!item) {
      const w = webFor(asked.text);
      if (w && parts.length <= 1) { // no such app here, but its site is a well-known one
        this.zap();
        const ok = await this.host.openSite(w[1]).catch(() => false);
        if (ok) return { line: es ? `No tengo ${w[2]} como app aquí: te lo abrí en el navegador.` : `I have no ${w[2]} app here: opened it in the browser.`, face: 'smug', minor: true };
      }
      return null; // nothing by that name here: her tag may still say what you meant
    }
    this.zap();
    const res = await this.host.launch(item);
    return { line: res.ok ? fmt(t.opened, { app: item.name }) : `${t.failed} ${res.error}`, face: res.ok ? 'laugh' : 'aside' };
  }

  // Once she has answered: her line about what she did, else the app you asked to close, else what
  // her tag asks for, if your message (text) asked for that kind of thing.
  async after(raw, answer, asked, early, text) {
    const { t } = this;
    const done = early && (await early);
    if (done) return this.addLine(answer, done.line, done.face);
    if (asked?.kind === 'close') return this.offerClose(asked.name, answer);
    if (asked && asked.kind !== 'open') return undefined; // music that didn't work out: nothing more to offer
    const closeTag = tagged(raw);
    if (closeTag) return wanted('close', text) ? this.offerClose(closeTag, answer) : undefined;
    const tag = TAG.exec(raw);
    if (!tag) return undefined;
    const kind = tag[1].toLowerCase();
    const value = tag[2].trim();
    if (!value || !wanted(kind, text)) return undefined;
    if (kind === 'media') return MEDIA_ACTIONS.has(value.toLowerCase()) ? this.media(value.toLowerCase(), answer) : undefined;
    if (kind === 'music') return this.music(value, answer);
    if (kind === 'site') return this.offerSite(value, answer);
    const item = await this.host.findLaunch(value);
    return item ? this.launch(item, answer) : this.addLine(answer, fmt(t.notInstalled, { app: value }));
  }

  // "abre mi navegador" and her model answered [[claude]]: it is hers to do (an app by its name, or "navegador" = your browser)
  async openHere(id, text, alreadyTried = false) {
    const es = this.brain.lang !== 'en';
    this.turn = 0;
    this.speaker?.stop();
    this.live = null;
    this.panel.discardLive?.();
    this.panel.setChatBusy(false);
    const r = alreadyTried ? null : await this.doNow({ kind: 'open', text }).catch(() => null); // (if she tried when you asked and found nothing, again would find nothing)
    const line = r?.line || (es ? 'No encontré esa app entre las instaladas. Dime cómo se llama.' : "I couldn't find that app among the installed ones. Tell me its name.");
    this.remember({ role: 'assistant', content: line });
    this.panel.stream(line, { done: true });
    this.panel.setFace(r?.face || 'aside');
    return undefined;
  }

  // The apps you have that match what you're typing ("f": Figma, Fusion 360...), above the input; one pressed (or chosen with the arrows
  // and Enter) opens. Only while it looks like you're naming an app; never in a key's field.
  async suggestApps(value) {
    const token = !this.open || this.panel.chatInput?.classList?.contains('is-secret') ? null : suggestToken(value);
    if (!token) return this.panel.setSuggestions([]);
    if (!this.catalog) {
      this.catalogLoading ||= this.host.launchables().then((list) => { this.catalog = list || []; }).catch(() => { this.catalog = []; });
      await this.catalogLoading;
    }
    if (this.panel.chatInput.value !== value) return undefined; // you kept typing: that answer is for something older
    const found = matchApps(this.catalog, token);
    this.sugIcons ||= new Map(); // kind:id -> the Start menu's icon (a data URL), or null when it has none
    const key = (it) => `${it.kind}:${it.id}`;
    const tagOf = (it) => ({ steam: 'Steam', epic: 'Epic' }[it.kind] || '');
    this.panel.setSuggestions(found.map((item) => ({ label: item.name, item, icon: this.sugIcons.get(key(item)) || null, tag: tagOf(item) })), ({ item }) => this.openSuggested(item));
    // the icons come a moment later (asked once for each app), and are painted on their rows if you are still looking at that list
    const missing = found.filter((it) => !this.sugIcons.has(key(it)));
    if (missing.length) {
      const got = await this.host.appIcons?.(missing.map(({ kind, id }) => ({ kind, id }))).catch(() => ({}));
      for (const it of missing) this.sugIcons.set(key(it), got?.[key(it)] || null);
      if (this.panel.chatInput.value !== value) return undefined;
      found.forEach((it, i) => { if (this.panel.suggest.items[i]?.item === it) this.panel.setSuggestionIcon(i, this.sugIcons.get(key(it))); });
    }
    return undefined;
  }

  async openSuggested(item) {
    const es = this.brain.lang !== 'en';
    this.panel.chatInput.value = '';
    this.panel.grow?.();
    this.zap();
    const res = await this.host.launch({ kind: item.kind, id: item.id }).catch(() => ({ ok: false }));
    const line = res?.ok ? fmt(this.t.opened, { app: item.name }) : `${this.t.failed} ${res?.error || (es ? 'no pude abrirla' : 'could not open it')}`;
    ui(this.voice, res?.ok ? 'go' : 'error');
    if (!this.notify(line, res?.ok ? 'laugh' : 'aside', { keep: false })) this.panel.stream(line, { done: true });
    this.panel.chatInput.focus();
  }

  // her answer, with a line of what she did under it
  addLine(answer, line, face = null) {
    if (!this.open || this.turn) return;
    this.panel.stream(answer && answer !== '…' ? `${answer}\n${line}` : line, { done: true });
    if (face) this.panel.setFace(face);
  }

  // a bolt of red lightning off her fingers, at whatever she's doing on your PC
  zap() {
    const h = this.capri.head();
    this.capri.zap(h.x + this.capri.towardCenter() * 280, h.y - 170);
  }

  // An app or a game her tag asked for: behind a button (now: the button was clicked).
  async launch(item, answer, { now = false } = {}) {
    const { t } = this;
    if (!this.open || this.turn) return;
    if (!now) {
      this.panel.setActions(
        [{ id: 'open', label: fmt(t.openIt, { app: item.name }), primary: true }, { id: 'no', label: t.no }],
        (id) => (id === 'open' ? this.launch(item, answer, { now: true }) : this.panel.setActions([])),
      );
      return;
    }
    this.panel.setActions([]);
    this.zap();
    const res = await this.host.launch(item);
    this.addLine(answer, res.ok ? fmt(t.opened, { app: item.name }) : `${t.failed} ${res.error}`, res.ok ? 'laugh' : 'aside');
  }

  // The media keys: pause, next, louder…
  async media(action, answer) {
    this.capri.pulse();
    const ok = await this.host.media(action);
    if (ok) this.addLine(answer, this.t.media[action], 'smug');
  }

  // A Spotify search, in the app if it's there.
  async music(song, answer) {
    this.zap();
    const ok = await this.host.music(song);
    if (ok) this.addLine(answer, fmt(this.t.music, { song }), 'laugh');
  }

  // A website: always behind a button that shows where it goes.
  offerSite(address, answer) {
    const { t } = this;
    let host;
    try {
      host = new URL(/^https?:\/\//i.test(address) ? address : `https://${address}`).hostname;
    } catch {
      return;
    }
    if (!this.open || this.turn || !host.includes('.')) return;
    this.panel.setActions(
      [{ id: 'site', label: fmt(t.siteIt, { site: host }), primary: true }, { id: 'no', label: t.no }],
      async (id) => {
        this.panel.setActions([]);
        if (id !== 'site') return;
        const ok = await this.host.openSite(address);
        if (ok) this.addLine(answer, fmt(t.siteOpened, { site: host }));
      },
    );
  }

  // "close am music pls": an app that's open, named in a message asking to close something.
  askedToClose(text) {
    if (!CLOSE_ASK.test(text)) return null;
    const said = simple(text);
    let best = null;
    for (const app of this.apps) {
      for (const name of [simple(app.name), simple(app.label)]) {
        if (name.length >= 3 && said.includes(name) && (!best || name.length > best.length)) best = { app, length: name.length };
      }
    }
    return best?.app.name || null;
  }

  // She was asked to close an app: a button with its name, and nothing happens until you click it.
  async offerClose(wanted, answer) {
    const { t } = this;
    const app = await this.host.findApp(wanted);
    if (!this.open || this.turn) return;
    if (!app) {
      this.panel.stream(`${answer}\n${fmt(t.notFound, { app: wanted })}`, { done: true });
      return;
    }
    this.panel.setActions(
      [{ id: 'close', label: fmt(t.closeIt, { app: app.name }), primary: true }, { id: 'no', label: t.no }],
      (id) => (id === 'close' ? this.closeApp(app) : this.panel.setActions([])),
    );
  }

  async closeApp(app, force = false) {
    const { t, capri } = this;
    this.panel.setActions([]);
    // a bolt of red lightning off her fingers, at it
    const h = capri.head();
    capri.zap(h.x + capri.towardCenter() * 280, h.y - 170);
    const res = await this.host.closeApp(app.name, force);
    if (!this.open) return;
    let line;
    if (res.error) line = `${t.failed} ${res.error}`;
    else if (!res.running) line = fmt(force ? t.forced : t.closed, { app: app.name });
    else line = fmt(force ? t.unkillable : t.stillOpen, { app: app.name });
    this.panel.setFace(res.running || res.error ? 'aside' : 'laugh');
    this.panel.stream(line, { done: true });
    this.remember({ role: 'assistant', content: line });
    // it hid in the tray, or it's asking you to save something: forcing it is your call
    if (res.running && !force && !res.error) {
      this.panel.setActions(
        [{ id: 'force', label: t.force, primary: true }, { id: 'leave', label: t.leave }],
        (id) => (id === 'force' ? this.closeApp(app, true) : this.panel.setActions([])),
      );
    }
    this.listApps();
  }

  // What she can do on the PC when you ask (Windows), and nothing else.
  powers() {
    const lines = [
      'Only when the user asks you to open an app or a game installed on their PC, play something on Spotify, control the music playing, or open a website: say in a few words that you will, and end your answer with one tag: [[open: NAME]], [[music: WHAT TO PLAY]], [[media: ACTION]] (ACTION: pause, play, next, previous, volup, voldown or mute), or [[site: ADDRESS]]. Some of these get a button to confirm, so never say it is already done. Any other time, write no tag at all: there are no other tags.',
    ];
    if (this.apps.length) {
      const open = this.apps.map(({ name, label }) => (label && label !== name ? `${name} (${label})` : name)).join(', ');
      lines.push(`You can also close an app that's open, only when they ask you to: end your answer with [[close: NAME]], NAME being the exact name from this list (the part before the parentheses). They get a button to confirm it. Apps open right now: ${open}.`);
    }
    if (this.autoTasks?.()) {
      lines.push('If the user asks you to DO something on their computer that you cannot do yourself (edit, convert, move, create or organize files, edit a video or an image, work in design apps like Figma, Canva, Illustrator or Blender, send an email, schedule on a calendar, run commands...), answer with ONLY the tag [[claude]] and nothing else: Capri will then offer to hand it to Claude Code. Never use it for chatting, questions, explanations, or for opening apps, music and websites.');
    }
    lines.push('Apart from that, you can\'t see the user\'s screen or files, and you can\'t touch anything else on their PC (settings, files): if asked, say plainly that you can\'t, in character, and don\'t pretend to.');
    return lines;
  }

  // What the user made her (custom.js): their name, how they want her, what to remember.
  personal() {
    const { userName, persona, memories = [] } = this.brain.custom || {};
    // small models mix the user up with the assistant she watches: said plainly
    const watched = this.brain.watching ? (this.brain.assistant === 'claude' ? 'Claude' : ASSISTANT_NAMES[this.brain.assistant]) : '';
    const notThem = watched ? ` Never call them "${watched}", that's their coding assistant.` : '';
    return [
      userName ? `The user's name is ${userName}: call them that now and then.${notThem}` : notThem && `You don't know the user's name.${notThem}`,
      persona ? `Your personality, as the user wants it, in their own words: "${unSlang(persona).replace(/espa[ñn]ol\s+colombiano/gi, 'español natural').replace(/\bcolombian[oa]s?\b/gi, '')}". It overrides the default playful tone above wherever they differ, and it must be clearly noticeable in how you phrase EVERY answer, not just be mentioned. You are still Capri.` : '',
      isFlirty(persona) ? 'Being flirty means: warm, teasing and affectionate, with light compliments and playful hints in how you phrase things (talk to the user as "tú", a pet name now and then). Subtle and tasteful, never explicit.' : '',
      memories.length ? `Things the user asked you to remember:\n${memories.map((m) => `- ${m}`).join('\n')}` : '',
    ].filter(Boolean);
  }

  onDelta(id, piece) {
    if (id !== this.turn) return;
    this.answer += piece;
    if (!this.agent && !this.taskTurn && this.autoTasks?.()) {
      const head = this.answer.trim().toLowerCase();
      if (/^\[\[\s*claude/.test(head)) { // it can't do this one itself: Claude Code can. Stop it, she offers.
        if (this.escalating !== id) {
          this.escalating = id;
          this.host.chatStop(id);
        }
        return;
      }
      if (head && head.length < 10 && '[[claude]]'.startsWith(head)) return; // maybe the start of that tag: wait before showing it
    }
    this.panel.stream(clean(this.answer));
    if (!this.taskTurn) this.live?.feed(clean(this.answer));
    this.voice.play('blip'); // her blips as the words come in
  }

  // Who she is, how she talks, and what's going on right now.
  persona() {
    const assistant = ASSISTANT_NAMES[this.brain.assistant] || 'Claude Code';
    const watching = this.brain.watching; // else Claude Code isn't part of her life here
    const lang = IN_LANGUAGE[this.brain.lang] || IN_LANGUAGE.en;
    return [
      ...(ONLY_IN[this.brain.lang] ? [ONLY_IN[this.brain.lang].rule] : []),
      `You are Capri, the personality construct from Project Capricorn (Cyberpunk: Edgerunners, season 2): dozens of minds fused into one digital ghost, so now and then you speak as "we"${lang.we ? ` (${lang.we})` : ''}.`,
      watching
        ? `You live on the user's desktop as a small glitchy figure and keep an eye on ${assistant}, their AI coding assistant, for them. Only talk about ${assistant} when the user asks about it or about their work.`
        : 'You live on the user\'s desktop as a small glitchy figure and keep them company.',
      'You love the satellite that crosses the night sky and dream of reaching it, but bring it up only once in a while, never in every answer. Talk about what the user talks about.',
      'How you talk: playful, a little mischievous and teasing, warm underneath, never cruel. Night City slang now and then (choom, preem, nova, gonk, flatline), not in every sentence.',
      'Rules: keep it short, one to three sentences of plain text, no markdown, no lists, no emoji. Stay in character.',
      'You are an AI-generated fan version of the character, not the real one: say so if asked.',
      ...this.personal(),
      ...(this.agent
        ? ['Under the hood you are Claude Code, working in the user\'s project: really do what they ask with your tools, as carefully as ever. Only your final answer is in character: it shows in a small speech bubble, so sum up what you did in those few sentences.']
        : this.powers()),
      ...(watching ? [`If the user asks what ${assistant} is doing, here is all you know (never make anything up): ${this.brain.context()}`] : []),
      lang.last,
      ...(ONLY_IN[this.brain.lang] ? [ONLY_IN[this.brain.lang].rule] : []),
    ].join('\n');
  }
}

// The model's answer as she'd say it: no reasoning block, no markdown marks.
// regional slang she does not use (parce, chamo, pana...): if a model says it, it becomes her own word
const SLANG = /(?<![\p{L}])(?:parce(?:ro|ra|s|ros|ras)?|chamo|chama|chamos|pana|panas|mijo|mija|mijito|mijita|g[uü]ey|wey|bro|broder)(?![\p{L}])/giu;
export const unSlang = (text) => String(text).replace(SLANG, 'choom').replace(/(?<![\p{L}])bacan[oa]s?(?![\p{L}])/giu, 'genial');

function clean(text) {
  return unSlang(String(text))
    .replace(/<think>[\s\S]*?(<\/think>|$)/g, '')
    .replace(/\[\[[^\]]*(\]\]|$)/g, '') // her tags (read from the raw answer, never shown)
    .replace(/[*_`#]+/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

// Whether your message asks for what her tag (its kind: open, music, media, site, close) would do.
function wanted(kind, text) {
  const music = MUSIC_WORD.test(text) || LISTEN.test(text);
  if (kind === 'music') return music;
  if (kind === 'media') return music || SOUND.test(text) || MEDIA_ASK.some(([, re]) => re.test(text));
  if (kind === 'site') return OPEN_ASK.test(text) || SITE.test(text);
  if (kind === 'close') return CLOSE_ASK.test(text);
  return OPEN_ASK.test(text) || PLAY.test(text); // an app, or a game to play
}

// The app named by her close tag: [[close: AM Music]], or a sloppier [[close]] AM Music.
function tagged(text) {
  const tag = CLOSE_TAG.exec(text);
  if (!tag) return null;
  const name = tag[1].trim() || text.slice(tag.index + tag[0].length).split('\n')[0].replace(/^[\s:.]+|[\s.!]+$/g, '');
  return name || null;
}

const simple = (text) => String(text || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

// Her face for an answer.
function mood(text) {
  if (/(ha){2,}|lol|mdr|jaja|kkk|хаха/i.test(text)) return 'laugh';
  if (text.includes('!')) return 'grin';
  if (text.trim().endsWith('?')) return 'smug';
  return 'look';
}
