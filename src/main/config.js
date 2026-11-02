'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

const DEFAULTS = {
  scale: 0.6,        // sprite scale, 0.6 ≈ 250px tall
  muted: false,
  volume: 0.7,
  lang: 'en',        // English by default; her menu > Language changes it ('auto' follows the system language, or 'es' / 'fr' / 'pt' / 'ru')
  displayId: null,   // null = primary display
  wander: true,      // random teleports when idle
  followWindow: true, // she goes and sits on the window you are using (a few seconds after you settle on it)
  sprites: true,     // her drawn sprite-sheet body (assets/sprites, spritebody.js) for her calm moments; false: only the shader body as before
  possess: true,     // now and then she dives into the window she sits on and takes it over
  visible: true,
  welcomed: false,   // she has introduced herself (her welcome panel)
  assistant: 'auto', // the coding assistant she watches: 'claude' or 'codex' ('auto': whichever has her hooks)
  linked: false,     // a Claude Code event has reached her at least once
  chatModel: null,   // the model she talks with (null: the provider's first one)
  provider: 'ollama', // who answers her chat: a key of llm.js PROVIDERS
  apiKeys: {},       // { openai: 'sk-...' }, else the provider's env variable
  customUrl: '',     // the 'custom' provider: any OpenAI-compatible base URL (http://host:port/v1)
  claudeCwd: null,   // the folder Claude Code works in (null: your home folder)
  userName: '',      // what she calls you
  persona: '',       // how you want her, in your words (her chat)
  myLines: [],       // lines of yours she says now and then, with hers
  memories: [],      // things you asked her to remember (her chat)
  handsFree: false,  // she listens for "Capri…" with the mic open (talk.js); everything heard goes to the speech service
  msgVoice: false, // she reads messages aloud (what they say, the pending list): off by default, a card and a sound are enough
  msgStealth: true, // sending a message from her: the chat app is moved out of sight while she types in it (false: it shows, as before)
  msgConfirm: false, // "responde en WhatsApp a X: ..." goes at once; true asks "¿La envío?" first
  hwAlerts: true, // disk almost full, processor hot, laptop battery low, Bluetooth keyboard/mouse battery low (hwalerts.js); hwTempAt / hwBatteryAt / hwDeviceAt move the lines
  backupSources: [], // folders to back up (backup.js): added with "agrega una carpeta a mi respaldo"
  backupDest: '', // where they go: an external disk, a USB or a Drive folder
  heavyClose: true, // a heavy program opens: she offers (Permitir / Denegar) to close the safe background things, and gives your model back afterwards
  perfNever: [], // programs she never offers to close, whatever they are (names, e.g. ["dropbox"])
  lolSafe: true, // League mode follows Riot's rules: no timers, no cooldowns, no build advice during a match; only comments on what happened and a summary at the end (lol.js)
  avScan: true, // new risky files in Downloads are checked with Windows Defender (avscan.js): she only reports, never deletes
  dictate: true, // hold dictateKey, talk, let go: the words are typed where the cursor is (dictate.js)
  dictateKey: 'Control+Alt+Space',
  handsFreeDefault: false, // (once, the first time she starts with this version: hands free is turned on; after that your menu choice stays)
  appAliases: {},    // your own ways of saying an app: { "ilus": "Illustrator" }; said or typed "cuando diga ilus abre Illustrator" (intents.js has her starter list)
  announce: 'away',  // she speaks up on her own (Claude finished, needs you, a timer): 'away' (you're elsewhere or it was long), 'always' or 'never'
  sendDir: '',           // where she leaves files to send by Blip (empty: Desktop\\Para enviar)
  syncDir: '',           // a Google Drive / OneDrive folder that syncs to your tablets and phone (optional)
  syncSet: false,        // (the first run sets syncDir to your Drive folder, once)
  organizeOnStart: true, // her start runs your file-organizing script (OrganizarArchivos.ps1)
  organizeScript: '',    // its path; empty: Desktop\\Organizacion Claude\\Otros\\OrganizarArchivos.ps1
  claudeDirs: [],        // more folders Claude Code may read and write in her tasks (besides Organizacion Claude)
  planner: {},       // project stopwatch, deadlines, summaries already given (planner.js)
  briefing: true,    // she gives the morning summary and the evening wrap-up on her own
  timers: [],        // timers and pomodoro still running (timers.js)
  styled: false,     // her Spanish way of talking was set up once (app.js); change it in her menu: "Personalizarla…"
  claudeChatModel: 'sonnet', // model for her Claude Code chat ('opus', 'sonnet' or 'haiku', the fastest; '' = Claude Code's own default)
  modelSet: '',      // marks that her chat model was moved to Sonnet once (app.js)
  claudeTaskModel: 'sonnet', // model for tasks you hand Claude Code by voice ("dile a Claude que…")
  claudeEffort: '',  // how rigorously Claude works: '' (Claude Code's own), 'low', 'medium', 'high', 'xhigh' or 'max' (not Haiku)
  claudeLean: true,  // her chat starts Claude Code without your MCP servers or skills (much quicker); false: with everything
  claudeMode: 'default', // Claude Code's permission mode in her chat: 'default' only reads, 'acceptEdits' edits without asking
  speak: true,       // she can read her chat answers out loud (talk.js); false: never
  speakMode: 'voice', // when: 'voice' (only if you talked to her by voice), 'always' or 'never'
  speakVoice: '',    // part of a Windows voice's name ("Sabina", "Helena"...); '' = the best Spanish one
  speakRate: 1.05,   // how fast she talks
  ttsProvider: 'auto', // her voice: 'auto' (ElevenLabs if a key and voice id are set, else Edge's free neural voices), 'elevenlabs', 'edge' or 'system' (Windows')
  edgeVoice: '',     // an Edge neural voice by name ("es-MX-DaliaNeural", "es-CO-GonzaloNeural"); '' = one for her language (Colombian Spanish: Salome)
  edgeRate: '+14%',   // Edge voice: speed, relative ("+8%", "-5%")
  edgePitch: '+10Hz', // Edge voice: pitch, relative ("+6Hz", "+2st")
  ttsVoiceId: '',    // the ElevenLabs voice (its id, from elevenlabs.io › Voices)
  ttsModel: 'eleven_v4', // 'eleven_v4' (expressive), 'eleven_v4_turbo' (expressive and faster), 'eleven_v3', 'eleven_multilingual_v2' or 'eleven_flash_v2_5'
  ttsFx: true,       // a touch of "the other minds in her" over her voice: a faint doubling
  sttProvider: 'auto', // who turns your voice into text (Ctrl+Alt+V): 'auto' (groq, then openai), 'groq' or 'openai'
  sttModel: 'accurate', // 'accurate' (whisper-large-v3: hears you better) or 'turbo' (a bit faster, a bit less careful)
  sttLocal: 'auto',  // a Whisper on this PC (whisper.cpp server, tools/install-whisper-local.ps1): 'auto' = used when it is installed; true / false to force it: no key, no limit, nothing leaves the PC
  sttWake: 'auto',   // who listens for her name (hands free): 'auto' = the cloud while today's budget lasts (it is quicker), then her Whisper on this PC; 'local' or 'cloud' to force
  sttWakeBudget: 1200, // requests a day she spends on that in 'auto' (the free cloud allows 2000: the rest is for your orders)
  sttLocalFast: true, // her Whisper looks at the first ~10 s of a clip only (quicker)
  sttLocalModel: '', // which model file of that folder ('small', 'medium', 'turbo'...); '' = the quickest one there
  sttLocalUrl: '',   // where it listens ('' = http://127.0.0.1:8178/inference)
  sttLocalFirst: false, // true: this PC's Whisper before the cloud ones (sttProvider: 'local' = only this one)
  sttLanguage: '',   // language you speak ('es', 'en'...); '' = her language
  claude: true,      // she watches Claude Code (off: she just keeps you company, no word of it)
  translateKey: 'Control+Alt+T', // select text anywhere and press it: she translates / explains / summarises it, with her own model
  selectionMode: 'translate',
  selectionEngine: 'local', // who does it: her own model (free), or a Claude: haiku / sonnet / opus
  codeBridge: true,         // the Claude Code that her CODE button opens reports your 5-hour / weekly usage to her (a status line, only in that session)
  windowKey: 'Control+Alt+W', // the key that opens her conversation window (her menu offers others if a program already has it)
  winEngine: 'local', // her conversation window: who answers ('local' her own model, or 'haiku', 'sonnet', 'opus')
  winWeb: true,       // ...and whether Claude may read the web there without asking
  searchModel: 'haiku', // "¿qué me dices sobre...?", "investiga...": goes straight to Claude Code with this model ('haiku', 'sonnet', 'opus'), 'ask' = asks first, 'off' = her own model answers
  autoEscalateAsk: true, // when something needs Claude Code: ask first with Haiku / Sonnet / Opus buttons (false: it just goes, with the model in her menu)
  autoEscalate: true, // chatting with a local or cheap model: what needs tools (edit files, Figma, video...) goes to Claude Code by itself
  scanProvider: 'auto', // who looks at her scanner's picture: 'auto' (a vision model in Ollama if you have one, free), 'ollama' or 'claude'
  autoLook: false,         // now and then she looks at your screen (a model that sees) and says one thing about it. Off until you turn it on; never with Claude
  ambientActive: true,     // she also comments while she's out and about, not only put away
  colorKey: 'Alt+C', // the key of the eyedropper, from anywhere ("Control+Alt+K", "Alt+Shift+C"...). A key a program already uses is not given to her, and she says so
  rembgModel: 'isnet-general-use', // the model rembg uses to take backgrounds off (tools/install-rembg.ps1)
  wakeEngine: 'auto',  // her name heard on this PC with openWakeWord (tools/install-wakeword.ps1, needs a capri.onnx model): 'auto' = used when installed, 'off'
  wakeThreshold: 0.5,  // how sure it must be (0..1)
  wakeModel: '',       // a model file of %LOCALAPPDATA%\\Capri\\wake ('' = capri*.onnx)
  wakeStrict: false,   // true: phrases where it heard no "Capri" are not sent to the speech service (saves Groq's daily limit)
  downloadsWatch: true, // she tells you when new files pile up in Downloads and offers to organize them (downloads.js)
  toasts: true, // she reads the notifications of WhatsApp/Discord/Telegram from Windows and shows them in her own style (toasts.js)
  msgWatch: true, // she tells you when WhatsApp/Discord/Telegram show unread messages (msgwatch.js, from the window title only)
  msgApps: ['whatsapp', 'discord', 'telegram'], // which ones she watches (take one out to stop hearing about it)
  micWarn: true, // she tells you when the microphone she listens with has gone silent
  downloadsMin: 4,   // how many new files make her speak
  breakMins: 60,     // minutes at the PC before she suggests a break (ambient.js)
  resumeExts: '',    // "retomar donde quedé": extensions she looks for in your recent files (empty: design, 3D and office files)
  resumeDays: 7,     // ...and how many days back
  autoQuiet: true,   // she keeps quiet by herself during a call (microphone in use by another program), while she records the screen and with a game or a full-screen program in front (autoquiet.js); false: only your own do-not-disturb
  dndAuto: '',       // (hers, not yours: why she is quiet by herself right now; '' when she is not)
  dnd: false,        // do not disturb: she does not talk, comment or play her clips by herself (a button in her chat bar and her menu; "no molestar" / "ya puedes hablar")
  quietVolume: 0.3,  // how loud (of her usual volume) she speaks when put away in her corner and for her passing remarks: 0.1 very soft, 1 as always
  quietStowed: true, // false: she speaks at her usual volume even when put away
  ambientVoice: 'sometimes', // her comments: 'never' (text bubble and sounds only), 'sometimes' with her voice, or 'always'
  nanoBananaPath: '', // her "Imagina...": where your nano_banana.py is (empty: Documents\\nano-banana\\nano_banana.py)
  restTalk: 'often', // put away in her corner: 'never' (stays quiet), 'sometimes' (every 7-16 min) or 'often' (every 2-6 min) comments on the PC and what's open
  restSide: 'left',  // sitting in her corner: on the 'left' (by her biochip) or the 'right'
  rest: 'corner',    // where she rests when nothing's going on: 'corner', or 'taskbar' (sitting on it)
  motion: 'auto',    // her animations: 'auto' (like Windows' animation effects), 'full' or 'reduced'
  clips: true,       // her clips: animations of the character, from a folder of yours, played beside her now and then (clips.js)
  clipsDir: '',      // that folder; '' = Desktop\\Organización Claude\\video\\Capri personaje
  captureCopy: true, // a screenshot is also put on the clipboard (Ctrl+V pastes it), as well as saved
  captureDir: '',    // where her screenshots go ('' = Pictures\\Capri\\Capturas)
  clipDir: '',       // where her screen clips go ('' = Videos\\Capri\\Clips)
  clipCapri: 'ask',  // does Capri show in a screen clip? 'ask' (she asks each time; the hotkey leaves her out), 'show' or 'hide'
  clipMax: 120,      // seconds a clip lasts at most when you do not say how long (never more than 10 minutes)
  clipAudio: true,   // the clip carries the PC's sound
  clipMic: false,    // ...and, if true, your voice from the microphone too (her menu > Clips with my voice)
  mediaKeys: true,   // your keyboard's media keys (play/pause, next, previous) go to her player card instead of Windows' own pop-up, while she is out and no game has the screen
  gameProcs: 'leagueoflegends|league of legends|leagueclient|valorant|cs2|csgo|dota2|fortniteclient|overwatch|apex|rocketleague|eldenring|gta5', // programs that count as a game: with one in front she lets go of the media keys (Windows' own player takes them)
  browserApp: 'zen', // "abre el navegador" opens this one (a part of its name in the Start menu: "zen", "chrome", "firefox"); '' = your default browser
  ytDefault: '',     // the id of the YouTube Music playlist "pon música" plays (set by saving a playlist as "principal"; the first one you save is it until then)
  ytmShuffleOn: false, // true: your YouTube Music playlists always start shuffled when she plays them (by default they just play, and you shuffle with the ALEATORIO button of her player, or say "en aleatorio")
  playerCard: true,   // what plays, in a card of its own (player.js) instead of the small strip in her chat card
  playerFloat: false, // that card loose, where you left it (playerPos), instead of under her main card
  playerPos: null,    // { x, y }: where you left it
  playerBigCard: 'compact', // her main card grown big: the player above it becomes a slim bar ('compact'), hides meanwhile ('hide') or stays as it is ('show')
  playerHidden: false, // hidden with its ✕; shown again from her menu or by saying "muestra el reproductor"
  look: 'hud',      // her look: 'hud' (red HUD details on her cards, hud.css) or 'classic' (as she was before)
  wheelApps: [],     // the apps on her wheel (wheel.js): [{ name, kind, id }], as launch.js lists them
  heavyMode: true,   // with a game or a heavy program open she steps aside: her big local model leaves memory and she talks with a small one meanwhile (heavy.js)
  heavyApps: [],     // which programs count (names, part of one is enough: "league of legends", "blender"); empty = the built-in list; "capri, trata photoshop como pesado" adds one
  heavyModel: '',    // the small model she uses meanwhile (an Ollama name); '' = the smallest one you have
  heavyCpuOnly: true, // that small model runs on the CPU, so the video memory stays with the game
  heavyExtra: null,  // the heavy programs you added (null: the ones of the old list, heavyApps)
  heavyOff: [],      // built-in heavy programs you switched off (the tray and her settings window show them with a check mark)
  heavyGames: [],    // the ones of that list you called "juego pesado": with them open her drawing is cut down too
  gameClickThrough: true, // with a game in front her window lets every click through (right-click is how you move in LoL); her settings window has the switch
  heavyFps: 4,       // frames a second she is drawn at with a game in front (usually 12): about the cost of nothing; 0 = no cut
  lolMode: true,     // League of Legends game mode, on by itself when a match starts: she comments now and then, with voice and GIFs (lol.js). "Desactiva el modo juego" mutes her remarks; "qué compro" works either way

  lolSpeak: true,    // ...and with her voice (the game's automatic quiet does not mute it; do-not-disturb does). false: only the bubble
  cardAutoClose: 3500, // her card, when you call her out and then do nothing, goes by itself after this many ms (0: it stays until you close it with Esc or the X)
  boomVol: 0.5,      // the BOOM's own volume, from 0.05 to 1 (the sound and her "¡Buuuuum!")
  boomSay: true,     // she also says the BOOM out loud ("¡Buuum!") when a heavy job is done
  giggle: true,      // her little giggle, soft, now and then when she laughs (a kill, a joke, "gracias"...)
  giggleLevel: 0.7,  // how loud her giggle is (of her usual volume)
  englishVoice: 'mine', // English phrases inside her Spanish lines: 'mine' (her own voice and accent, the phrase respelled) or 'english' (an English voice, Aria)
  flirtVoice: 'salome', // the voice for her flirty moments (voices.js: salome, dalia, elena, paloma, paola): her usual one stays for everything else
  flirtVoiceOn: false,  // true: her flirty moments use the voice above ("activa la voz coqueta"); false: her usual voice says everything, as now
  lolShout: true,    // at each kill of yours she shouts a short onomatopoeia ("¡Pum!", "¡Bam!") when there is no longer remark for it
  lolSfx: true,      // ...and a synthesized sound effect for what happens (a kill, a turret, a warning...), at lolSfxVol of her usual volume
  lolSfxVol: 0.5,
  lolGap: 45,        // seconds between two of her remarks about the match, at least
  lolVolume: 0.4,    // how loud that voice is, from 0.1 to 1 (her usual volume = 1)
  lolVoiceSoft: false, // true: that voice is soft (like her passing remarks) instead of at her usual volume
  lolClips: true,    // ...and one of her GIFs (the folder of her clips) in the top left corner of the screen with each remark
  motionAsked: false, // she asked once, Windows' animations being off, whether to move anyway
};

let cache = null;

function file() {
  return path.join(app.getPath('userData'), 'config.json');
}

function load(fresh = false) {
  if (cache && !fresh) return cache;
  try {
    cache = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(file(), 'utf8')) };
  } catch {
    cache = { ...DEFAULTS };
  }
  return cache;
}

function save(patch) {
  cache = { ...load(), ...patch };
  try {
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    fs.writeFileSync(file(), JSON.stringify(cache, null, 2));
  } catch (err) {
    console.error('[capri] could not save config:', err.message);
  }
  return cache;
}

// Where her screenshots and screen clips go: what you set (captureDir / clipDir), else, if your Desktop has an "Organización Claude" folder with
// "capturas de pantalla" / "video" inside, there; else Pictures\\Capri\\Capturas and Videos\\Capri\\Clips.
function mediaDirs(cfg = load()) {
  const desk = app.getPath('desktop');
  const root = ['Organización Claude', 'Organizacion Claude'].map((n) => path.join(desk, n)).find((d) => fs.existsSync(d));
  const sub = (names) => root && names.map((n) => path.join(root, n)).find((d) => fs.existsSync(d));
  return {
    shots: cfg.captureDir || sub(['capturas de pantalla', 'Capturas de pantalla']) || path.join(app.getPath('pictures'), 'Capri', 'Capturas'),
    clips: cfg.clipDir || sub(['video', 'Video', 'videos']) || path.join(app.getPath('videos'), 'Capri', 'Clips'),
  };
}

module.exports = { load, save, file, DEFAULTS, mediaDirs };
