import { Capri } from './capri.js';
import { FxLayer, GRAB_FRAMES } from './fx.js';
import { Chip, Mask } from './chip.js';
import { Panel } from './panel.js';
import { Voice } from './voice.js';
import { Brain } from './brain.js';
import { Guide } from './guide.js';
import { Mission } from './mission.js';
import { Chat } from './chat.js';
import { NowPlaying, NowStrip, pickCards } from './nowplaying.js';
import { PlayerCard } from './player.js';
import { Capturer } from './capture.js';
import { RecBar } from './recbar.js';
import { Wheel } from './wheel.js';
import { Speaker, Listener } from './talk.js';
import { Setup } from './setup.js';
import { Timers } from './timers.js';
import { Planner } from './planner.js';
import { Ambient } from './ambient.js';
import { pending, showCard as showPending } from './pending.js';
import { ClipPlayer } from './clips.js';
import { Custom } from './custom.js';
import { linesFor } from './lines.js';
import { pick, fmt, reducedMotion } from './util.js';
import { ui } from './uisound.js';
import { usageLine, USAGE_NOTE, limitLine } from './usagefmt.js';

let heavyAskedUntil = 0; // (after you deny, she does not ask again for 30 minutes)
const msgState = { pile: [], token: 0 }; // the chat-app messages on her card (msgToast): they pile up until you answer, close it or it goes away by itself

const host = window.host;

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// close-ups of her for the cut-ins, frames of the show (tools/build-cutins.py)
const CUTINS = ['grin', 'laugh', 'eyes', 'many', 'look'];
const WATCH_MS = 2000; // how often she checks the pointer still reaches her

// what you made her, from the config (custom.js)
// how she talks to you, the first time (Spanish): in your config, to change from her menu
const STYLE_ES = 'Háblame en español natural y neutro, sin regionalismos, con sarcasmo cariñoso y mucho carisma. Directa, sin tono corporativo ni rodeos. Tutéame como a un colega creativo. Bromea, pero si algo está mal dime la verdad sin adornos. Respuestas cortas, pensadas para decirse en voz alta.';
const LINES_ES = [
  '{name}, ¿otra vez mirándome? Anda a dibujar algo, que te estás volviendo pantalla.',
  'Somos muchos aquí dentro y ninguno quiere hacer tu entrega. Qué pereza, ¿no?',
  'El satélite dice que descanses la vista. Yo solo transmito.',
  '¿Ya guardaste? Digo, por si el universo decide divertirse.',
  'Un pomodoro no le hace daño a nadie. A tu procrastinación sí.',
  'Nova idea: tomar agua. Gonk idea: otro café.',
  'Dime “recuérdame” y yo me encargo de que no se te olvide la entrega.',
  'Aquí flotando mientras tú facturas. Qué vida la mía.',
  'Estírate, {name}. No tengo espalda y aun así me duele verte.',
  'Cuando quieras dime “Capri” y te escucho. O ignórame, ya estoy acostumbrada.',
  'Preem. Hoy sí te veo con ganas. Seguro dura poco.',
  'Si se te acaban las ideas, cobra más y finge que era el plan.',
];
const mine = (cfg) => ({ userName: cfg.userName || '', persona: cfg.persona || '', myLines: cfg.myLines || [], memories: cfg.memories || [] });

async function boot() {
  let [config, image, intro, ...cutins] = await Promise.all([
    host.getConfig(),
    loadImage('../../assets/capri/capri-full.png'),
    // her intro: her close-up grabbing the screen, and its drawings with her mouth and arm moving
    Promise.all(GRAB_FRAMES.map((name) => loadImage(`../../assets/capri/intro-${name}.webp`).catch(() => null)))
      // decoded now, not the first time each one shows up (a hitch right on "hi", on the wave)
      .then((cels) => Promise.all(cels.map((cel) => cel && createImageBitmap(cel))))
      .then((cels) => (cels[0] ? Object.fromEntries(GRAB_FRAMES.map((name, i) => [name, cels[i]])) : null)),
    ...CUTINS.map((name) => loadImage(`../../assets/capri/cutin-${name}.png`)),
    document.fonts.load('600 16px "Chakra Petch"'),
    document.fonts.load('400 11px "JetBrains Mono"'),
  ]);
  document.documentElement.lang = config.lang;
  // her animations: like Windows, full or reduced (her menu)
  const applyMotion = (setting) => {
    reducedMotion.setting = setting || 'auto';
    document.documentElement.dataset.motion = reducedMotion.matches ? 'reduced' : 'full';
  };
  applyMotion(config.motion);
  // her look: the HUD details (hud.css) or classic, as she was
  const applyLook = (look) => { document.documentElement.dataset.look = look === 'classic' ? 'classic' : 'hud'; };
  applyLook(config.look);
  reducedMotion.onSystemChange(() => applyMotion(reducedMotion.setting));

  const fx = new FxLayer(document.getElementById('fx'), {
    cutins: Object.fromEntries(CUTINS.map((name, i) => [name, cutins[i]])),
    intro,
  });
  fx.resize(innerWidth, innerHeight);
  // how far the top of the taskbar is from the bottom of her window: she covers it too while she
  // rests on it (the floor she stands on stays its top)
  let floorGap = config.floorGap ?? 0;
  const chip = new Chip(document.getElementById('chip'));
  chip.place(innerWidth, innerHeight - floorGap);
  const mask = new Mask(document.getElementById('mask'));

  const voice = new Voice();
  voice.configure(config);
  host.listSounds().then((list) => list.length && voice.loadCustom(list));

  const panel = new Panel({
    panel: document.getElementById('panel'),
    ticker: document.getElementById('ticker'),
    labels: linesFor(config.lang, config.assistant),
  });

  const capri = new Capri({
    root: document.getElementById('capri'),
    canvas: document.getElementById('sprite'),
    image,
    fx,
    voice,
  });
  capri.wander = config.wander;
  capri.possessWindows = config.possess;
  capri.restOn = config.rest || 'corner';
  capri.restSide = config.restSide === 'right' ? 'right' : 'left';
  capri.sprites = config.sprites !== false;
  capri.followWindow = config.followWindow !== false;
  capri.setView(innerWidth, innerHeight, innerHeight - floorGap);
  capri.setScale(config.scale);

  const mission = new Mission();
  const brain = new Brain({ capri, panel, voice, host, mission, lang: config.lang, assistant: config.assistant });

  // Click-through everywhere except on her body, the panel and her biochip.
  let interactive = false;
  let mouse = null;
  const setInteractive = (on) => {
    if (on === interactive) return;
    interactive = on;
    host.setInteractive(on);
  };
  const onChip = () => Boolean(chip.visible && mouse && chip.contains(mouse.x, mouse.y, 0));
  let wheel = null; // her wheel (wheel.js): while it's open the overlay takes the pointer everywhere
  let player = null; // her player card (player.js): the overlay takes the pointer over it, and all the way while you drag it
  let recbar = null; // the bar of a clip being recorded (recbar.js): pause and stop, in her interface
  const refreshHit = () => {
    if (capri.dragging || capri.pressed || wheel?.open || player?.dragging) return setInteractive(true);
    if (!mouse) return setInteractive(false);
    const r = panel.rect();
    const onPanel = r && mouse.x >= r.left && mouse.x <= r.right && mouse.y >= r.top && mouse.y <= r.bottom;
    document.body.style.cursor = onChip() ? 'pointer' : '';
    return setInteractive(Boolean(onPanel || capri.hit(mouse.x, mouse.y) || onChip() || player?.contains(mouse.x, mouse.y, 4) || recbar?.contains(mouse.x, mouse.y, 4)));
  };
  // Her biochip: her eyes on it follow the pointer over it, and she comes out when you click it
  // (only then, so the pointer passing through that corner doesn't call her back).
  // Her mask, asleep: the pointer coming over it stirs her, and a moment of that wakes her up.
  let wakeTimer = 0;
  const comeOut = () => {
    if (capri.stowed) host.setConfig({ visible: true }); // the tray and Ctrl+Alt+C follow
    capri.unstow();
  };
  const hoverChip = () => {
    chip.pointer = chip.visible && mouse && chip.contains(mouse.x, mouse.y) ? mouse : null;
    const near = mask.visible && mouse && mask.contains(mouse.x, mouse.y, 30);
    mask.pointer = near ? mouse : null;
    if (!near) {
      clearTimeout(wakeTimer);
      wakeTimer = 0;
    } else if (!wakeTimer) {
      wakeTimer = setTimeout(() => {
        wakeTimer = 0;
        if (capri.dormant) capri.wake();
      }, 400);
    }
  };
  // Where the pointer really is, ~11 times a second (not only when it moves): she walks, and ends up under a pointer that never
  // moved, so no mousemove would tell the window to become solid, and the click would go to what's behind her.
  setInterval(async () => {
    if (capri.dragging || wheel?.open) return;
    const at = await host.cursor().catch(() => null);
    if (!at?.inside) return;
    mouse = { x: at.x, y: at.y };
    refreshHit(); // (she may have moved under it, or it under her)
  }, 40); // (a click right after the pointer arrives must find the window already solid)
  let lastMove = 0;
  window.addEventListener('mousemove', (e) => {
    lastMove = performance.now();
    mouse = { x: e.clientX, y: e.clientY };
    refreshHit();
    hoverChip();
  });
  document.addEventListener('mouseleave', () => {
    mouse = null;
    refreshHit();
    hoverChip();
  });
  // Where the pointer really is, every couple of seconds: if it moved over her window and no
  // mousemove came, the hook that brings it to her is gone (Windows drops it without a word, after
  // sleep say), and main.js puts in a new one.
  let seen = null;
  let rearmedAt = -Infinity;
  setInterval(async () => {
    const at = await host.cursor().catch(() => null);
    const before = seen;
    seen = at;
    if (!at?.inside || !before?.inside || (at.x === before.x && at.y === before.y)) return;
    const now = performance.now();
    if (now - lastMove < WATCH_MS * 1.5 || now - rearmedAt < 20000) return;
    rearmedAt = now;
    host.rearm();
  }, WATCH_MS);
  // A file dragged from Explorer sends no mouse events, so her window would stay click-through and the drop would land on
  // whatever is under it. While her chat is open, if the pointer is over it, the chat takes the pointer.
  setInterval(async () => {
    if (!chat.open || !panel.visible) return;
    const at = await host.cursor().catch(() => null);
    const r = panel.rect();
    if (!at?.inside || !r) return;
    if (at.x >= r.left - 6 && at.x <= r.right + 6 && at.y >= r.top - 6 && at.y <= r.bottom + 6) setInteractive(true);
  }, 120);
  // A file dropped ON HER (not on the chat box): they are for her. The pointer over her makes the window solid while you drag
  // (Explorer sends no mouse events), and the drop opens her chat with the files attached, whatever the chat was doing.
  setInterval(async () => {
    if (chat.open && panel.visible) return; // the chat has its own drop zone
    const at = await host.cursor().catch(() => null);
    if (at?.inside && capri.hit(at.x, at.y)) setInteractive(true);
  }, 120);
  const fileDrag = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  const overHer = (e) => capri.hit(e.clientX, e.clientY) && !panel.el?.contains?.(e.target);
  const dropHint = (on) => document.body.classList.toggle('capri-drop', on);
  const dragOverHer = (e) => {
    if (!fileDrag(e) || !overHer(e)) return dropHint(false);
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    return dropHint(true);
  };
  window.addEventListener('dragenter', dragOverHer);
  window.addEventListener('dragover', dragOverHer);
  window.addEventListener('dragleave', (e) => { if (!e.relatedTarget) dropHint(false); });
  window.addEventListener('drop', async (e) => {
    dropHint(false);
    if (!fileDrag(e) || !overHer(e)) return;
    e.preventDefault();
    const paths = [...(e.dataTransfer.files || [])].map((f) => window.host?.pathOf?.(f) || host.pathOf?.(f)).filter(Boolean);
    if (!paths.length) return;
    ui(voice, 'drop');
    if (!chat.open) await chat.start();
    await chat.addFiles(paths);
    chat.panel.chatInput && (chat.panel.chatInput.placeholder = brain.lang !== 'en' ? 'Qué hago con esto…' : 'What should I do with this…');
  });
  window.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (chip.visible && chip.contains(e.clientX, e.clientY, 0)) host.openMenu();
  });
  window.addEventListener('click', (e) => {
    if (chip.visible && chip.contains(e.clientX, e.clientY, 0)) comeOut();
  });

  // wiring
  // Her cards stay put while she breathes and fidgets: the card follows where she IS (walking, being dragged, turning, moving to
  // another place), not the little bob of her idle motion, which on a long text tires the eyes. A shift under a few pixels is ignored.
  let cardAt = null;
  const CARD_DEAD_ZONE = 12;
  capri.onMove = (head) => {
    const bob = capri.bob || 0;
    const calm = { ...head, y: head.y - bob, top: head.top - bob }; // (her head without the bob)
    const lean = capri.pointing ? -capri.pointing.dir : 0;
    const still = cardAt && cardAt.lean === lean && cardAt.vw === capri.view?.w && cardAt.vh === capri.view?.h
      && Math.hypot(calm.x - cardAt.x, calm.y - cardAt.y) < CARD_DEAD_ZONE && Math.abs(calm.top - cardAt.top) < CARD_DEAD_ZONE;
    if (!still) {
      cardAt = { x: calm.x, y: calm.y, top: calm.top, lean, vw: capri.view?.w, vh: capri.view?.h };
      // pointing at something: the panel goes on her other side, so it doesn't cover it
      panel.setAnchor({ ...calm, lean }, capri.view);
    }
    // she may have moved out from under a still pointer: never leave a dead click zone behind
    refreshHit();
  };
  capri.onTeleport = (phase) => (phase === 'start' ? panel.suspend() : panel.resume());
  capri.chipAt = () => chip.center();
  capri.onStow = () => {
    panel.hide(); // any way of putting her away takes her chat card down (left up, it would block her next chat) and closes the chat
    if (chat.open) chat.close();
    chip.setMode(capri.mode);
    chip.show();
    setTimeout(() => placeChip?.(), 0);
  };
  capri.onUnstow = () => chip.hide();
  capri.onDoze = (phase, face) => {
    if (phase === 'start') {
      mask.place(face.x, face.y, capri.scale * 1.1);
      mask.show();
    } else if (phase === 'waking') {
      mask.wake();
    } else {
      mask.hide();
    }
  };
  capri.onMode = (mode, prev) => chip.setMode(mode, prev);
  // now and then she says something about the satellite: while she looks at it, or once
  // the red light has gone up (never during, nothing should cover that)
  capri.onGaze = (when) => {
    const lines = when === 'end' ? brain.t.uplink : brain.t.gaze;
    if (!panel.visible && Math.random() < (when === 'end' ? 0.6 : 0.4)) panel.say({ kind: 'info', line: pick(lines), hold: 3800 });
  };
  capri.onClick = () => {
    if (panel.visible) panel.hide();
    else brain.status();
  };
  panel.onChar = (kind) => voice.play('blip', { mood: kind });
  panel.onUi = (kind) => ui(voice, kind); // her buttons, menu, bubbles and drops all have their sound
  panel.onTalk = (talking) => talking && capri.perform('talk');
  capri.onMenu = () => host.openMenu();

  // Her guide (guide.js): her welcome on first launch, and "How does it work?" in her menu,
  // where she takes you to things and points at them.
  const guide = new Guide({ capri, panel, voice, host, brain });
  // Talking to her (chat.js): "Talk to her" in her menu, or the button when you click her idle.
  // Voice (talk.js): she reads her answers out loud, and Ctrl+Alt+V lets you talk to her
  let liveConfig = config;
  const speaker = new Speaker(() => liveConfig, host);
  capri.isTalking = () => speaker.speaking;
  speaker.quietWhen = () => capri.stowed && liveConfig?.quietStowed !== false; // put away in her corner: she speaks softly
  const chat = new Chat({ capri, panel, voice, host, brain, speaker });
  const nowPlaying = new NowPlaying({ capri, panel, host, brain, voice }); // "Now playing" in her menu
  const strip = new NowStrip({ panel, host, voice }); // what plays, under her chat and the card when you click her
  chat.strip = strip;
  // her player card: what plays, bigger, under her main card or loose where you put it (the small strip in her chat gives way to it)
  player = new PlayerCard({ host, capri, panel, voice, getConfig: () => liveConfig, pickCards });
  strip.player = player;
  chat.player = player;
  const capture = new Capturer({ host, getCfg: () => liveConfig }); // screenshots and screen clips
  chat.capture = capture;
  host.onOrderAsk?.(async ({ id, text, engine }) => { // her big window asks if a message is an order for the PC
    const r = await chat.runRemote(text, engine).catch(() => ({ handled: false }));
    host.orderAnswer?.({ id, ...r });
  });
  capture.onDone = (res) => chat.clipDone(res);
  recbar = new RecBar({ capture, getCfg: () => liveConfig, voice, onChange: () => refreshHit() });
  brain.strip = strip;
  wheel = new Wheel({ host, panel, voice, brain, getCfg: () => liveConfig, keepFocus: () => chat.open }); // Ctrl+Alt+R
  wheel.onChange = () => refreshHit();
  brain.onWheel = () => { // the button next to "Háblame": the card goes, the wheel opens around the pointer
    panel.hide();
    wheel.show();
  };
  chat.onWheel = () => wheel.show();
  // A job for Claude that finished after you closed her chat: what it said, the files it made as buttons (you press one and it opens),
  // and a way to the conversation, where all of it is kept.
  chat.onBackground = ({ ok, line, files, sessionId }) => {
    const es = brain.lang !== 'en';
    const name = (f) => String(f).split(/[\\/]/).pop();
    const short = (n) => (n.length > 28 ? `${n.slice(0, 25)}...` : n);
    const shown = line.length > 300 ? `${line.slice(0, 297)}…` : line;
    ambient.anchor();
    panel.say({
      kind: ok ? 'done' : 'error', face: ok ? 'smug' : 'wide', tag: 'CLAUDE', line: shown, hold: files.length ? 60000 : 15000,
      actions: [
        ...files.slice(0, 3).map((f, i) => ({ id: `open:${i}`, label: `${es ? 'Abrir' : 'Open'} ${short(name(f))}`, primary: i === 0 })),
        ...(files.length ? [{ id: 'reveal', label: es ? 'Ver carpeta' : 'Show folder' }] : []),
        { id: 'chat', label: es ? 'Ver en el chat' : 'See in chat' },
      ],
      onAction: async (id) => {
        if (id.startsWith('open:')) host.openFile(files[Number(id.slice(5))]);
        else if (id === 'reveal') host.revealFile(files[0]);
        else if (id === 'chat') {
          await chat.start();
          chat.openSession(sessionId);
        }
      },
    });
    speaker.announce(ok ? (es ? 'Claude terminó.' : 'Claude is done.') : (es ? 'Claude no pudo.' : 'Claude could not.'), brain.lang);
  };
  const listener = new Listener({ capri, panel, host, voice, chat, speaker, getCfg: () => liveConfig });
  chat.voiceBusy = () => listener.engaged(); // her card stays while you are talking to her by voice
  brain.onTalk = (opts) => chat.start(opts);
  brain.onClaude = () => chat.start({ claude: true });
  brain.onImage = () => chat.start({ image: true });
  brain.onSessions = () => chat.start({ sessions: true }); // her chat, with the menu of her latest conversations open
  brain.claudeButton = () => liveConfig.provider !== 'claude'; // with Claude Code as her chat, everything is Claude already
  // she speaks up on her own: Claude finished, needs you, crashed (brain.js)
  brain.announceMode = config.speakMode === 'important' && config.announce !== 'never' ? 'always' : config.announce || 'away';
  brain.onAnnounce = (line) => speaker.announce(line, brain.lang);
  // Timers and pomodoro (timers.js): chat.js answers them at once; this is what happens when one rings
  const timers = new Timers({
    lang: config.lang,
    onChange: (items) => host.setConfig({ timers: items.map(({ id, ...rest }) => rest) }),
    onFire: async (item, text) => {
      if (capri.stowed) {
        host.setConfig({ visible: true });
        await capri.unstow();
      }
      capri.wake();
      let line = text;
      if (item.kind === 'action') {
        // what you scheduled ("a las 8 abre Spotify"): she does it now, with a bolt of lightning
        const h = capri.head();
        capri.zap(h.x + capri.towardCenter() * 280, h.y - 170);
        line = await runAction(item.action);
      } else {
        voice.play('alert');
        capri.perform('hop');
      }
      const badge = item.kind === 'work' || item.kind === 'break' ? 'POMODORO' : item.kind === 'action' ? 'PLAN' : item.at ? 'ALARM' : 'TIMER';
      if (!chat.notify(line)) panel.say({ kind: 'done', badge, line, face: 'laugh', hold: 12000 });
      speaker.announce(line, brain.lang);
    },
  });
  // an app to open or a song to play, scheduled by you; she says how it went
  const runAction = async ({ type, value }) => {
    const c = brain.t.chat;
    if (type === 'music') return (await host.music(value)) ? fmt(c.music, { song: value }) : `${c.failed} ${value}`;
    const found = await host.findLaunch(value);
    if (!found) return fmt(c.notInstalled, { app: value });
    const res = await host.launch(found);
    return res.ok ? fmt(c.opened, { app: found.name }) : `${c.failed} ${res.error}`;
  };
  timers.verify = async (action) => action.type !== 'open' || Boolean(await host.findLaunch(action.value));
  // her chat on Sonnet (it was saved as another model): once, so a model you pick later in config.json stays
  if (config.modelSet !== 'sonnet-1') {
    host.setConfig({ claudeChatModel: 'sonnet', modelSet: 'sonnet-1' });
    config = { ...config, claudeChatModel: 'sonnet', modelSet: 'sonnet-1' };
  }
  // the Drive folder that syncs to your tablets and phone, set once (change it later in config.json)
  if (!config.syncSet) {
    const syncDir = 'G:\\Mi unidad\\para enviar a mi celular';
    host.setConfig({ syncDir: config.syncDir || syncDir, syncSet: true });
    config = { ...config, syncDir: config.syncDir || syncDir, syncSet: true };
  }
  timers.restore(config.timers);
  // what rang while she was closed or the PC off: she tells you when she's back
  if (timers.missed?.length) {
    const hh = (ms) => new Date(ms).toLocaleTimeString(brain.lang === 'en' ? 'en-US' : 'es-CO', { hour: 'numeric', minute: '2-digit' });
    const list = timers.missed.slice(0, 5).map((m) => `${m.label || (brain.lang === 'en' ? 'alarm' : 'alarma')} (${hh(m.end)})`).join('; ');
    const line = brain.lang === 'en' ? `While I was off, these went by: ${list}.` : `Mientras no estaba, se pasaron: ${list}.`;
    setTimeout(() => {
      if (!chat.notify(line, 'aside')) panel.say({ kind: 'info', line, face: 'aside', hold: 20000 });
      speaker.announce(line, brain.lang);
    }, 12000);
  }
  chat.timers = timers;
  // Planner (planner.js): project stopwatch, deadlines, voice notes, day summaries. chat.js answers it first.
  const planner = new Planner({ host, timers, mission, lang: config.lang, name: config.userName });
  planner.restore(config.planner);
  chat.planner = planner;
  chat.askBefore = () => liveConfig.autoEscalateAsk !== false; // "it needs Claude": ask first (default) or just send it
  chat.taskModelName = () => liveConfig.claudeTaskModel || 'sonnet';
  chat.searchModelName = () => liveConfig.searchModel || 'haiku'; // "¿qué me dices sobre...?": which Claude answers it by itself
  chat.dndOn = () => liveConfig.dnd === true; // do not disturb
  chat.autoCloseGame = () => Boolean(liveConfig.heavyGame);
  chat.autoCloseMs = () => liveConfig.cardAutoClose ?? 3500; // her card goes by itself after this long if you do nothing (0: never)
  chat.setDnd = (on) => host.setConfig({ dnd: Boolean(on) });
  chat.autoTasks = () => liveConfig.autoEscalate !== false; // a light chat model hands what needs tools to Claude Code
  planner.onRemind = (line) => {
    if (!chat.notify(line, 'smug')) panel.say({ kind: 'info', line, face: 'smug', hold: 14000 });
    speaker.announce(line, brain.lang);
  };
  const planTick = () => planner.tick(new Date(), { morning: config.briefing !== false, evening: config.briefing !== false, busy: capri.stowed || capri.busy || Boolean(chat.turn) });
  setTimeout(planTick, 20000);
  setInterval(planTick, 5 * 60 * 1000);
  // Put away in her corner she still talks now and then: how the PC is doing, what's in front (ambient.js).
  // Her menu › When she rests › When she is put away: quiet, now and then, or often.
  const ambient = new Ambient({ host, capri, panel, chip, brain, guide, chat, speaker, voice, getConfig: () => liveConfig });
  // her clips: animations of the character from a folder of yours, beside her now and then (clips.js)
  const clips = new ClipPlayer({ host, capri, panel, chip, chat, guide, getConfig: () => liveConfig });
  panel.onSay = (msg) => clips.onPanel(msg);
  ambient.clips = clips;
  // her little giggle, now and then when she laughs: soft, never twice within 25 s, never while you asked her for quiet or you are on a call
  let lastGiggle = 0;
  panel.onLaugh = () => {
    const c = liveConfig || {};
    const now = Date.now();
    if (c.giggle === false || c.dnd === true || /call|record/.test(c.dndAuto || '') || now - lastGiggle < 25000) return;
    lastGiggle = now;
    setTimeout(() => voice.playLevel('giggle', Number(c.giggleLevel) || 0.7), 120);
  };
  chat.giggleNow = () => voice.playLevel('giggle', Number(liveConfig?.giggleLevel) || 0.7); // "ríete": now, without waiting
  // the voice with more energy for shouts (BOOM, a kill, a pentakill): faster and higher than her usual, or an onomatopoeia comes out flat
  const EXCITED = { edgeRate: '+30%', edgePitch: '+35Hz' };
  const BOOM_VOICE = { edgeRate: '-18%', edgePitch: '+20Hz' }; // the BOOM itself is drawn out (slower and long: "Buuuuum"), not quick like the other shouts
  brain.onBoom = () => { // a heavy job done: its BOOM comes with one of her GIFs, in the top left corner, and she says it herself, as an onomatopoeia
    clips.play('risa', { corner: true, force: true });
    if (liveConfig?.boomSay !== false && speaker.enabled) setTimeout(() => speaker.say(String(brain.lang).startsWith('es') ? '¡Buuuuum!' : 'Boooooom!', brain.lang, { loud: true, level: Math.min(1, Math.max(0.3, (Number(liveConfig?.boomVol) || 0.5) + 0.1)), override: BOOM_VOICE }), 380);
  };
  speaker.onSpeak = () => clips.play('voz'); // she talks out loud...
  chat.onExplain = () => clips.play('voz'); // ...or explains something at length
  ambient.start();

  // chats that wait for your answer: the Pendientes button of her chat bar follows the list, and one gentle reminder (config pendingRemind: false turns it off)
  pending.onChange(() => chat.refreshModes?.());
  let pendingRemindedAt = 0;
  setInterval(async () => {
    const n = pending.count();
    if (!n) return;
    const cfgNow = await host.getConfig?.().catch(() => null);
    if (!cfgNow || cfgNow.pendingRemind === false || cfgNow.dnd || cfgNow.dndAuto || guide.running || chat.open || chat.turn) return;
    const now = Date.now();
    const list = pending.list();
    const fresh = list.some((p) => !p.reminded && now - p.last > 5 * 60000); // waiting 5+ minutes and she has not told you about it
    if (now - pendingRemindedAt < 10 * 60000 || !(fresh || (pendingRemindedAt && now - pendingRemindedAt > 45 * 60000))) return;
    const es = brain.lang !== 'en';
    const names = list.slice(0, 3).map((p) => (p.title.length > 22 ? `${p.title.slice(0, 21)}…` : p.title)).join(', ');
    capri.wake?.();
    const shown = panel.say({
      kind: 'info', face: 'smug', tag: es ? 'PENDIENTES' : 'PENDING', hold: 15000,
      line: es ? `Tienes ${n} ${n === 1 ? 'chat' : 'chats'} sin responder: ${names}${n > 3 ? '…' : ''}.` : `${n} ${n === 1 ? 'chat is' : 'chats are'} waiting for an answer: ${names}${n > 3 ? '…' : ''}.`,
      actions: [{ id: 'see', label: es ? 'Ver' : 'See', primary: true }, { id: 'later', label: es ? 'Luego' : 'Later' }],
      onAction: (id) => { if (id === 'see') showPending({ panel, chat, es }); else panel.hide(); },
    });
    if (shown) { pendingRemindedAt = now; list.forEach((p) => { p.reminded = now; }); }
  }, 60000);
  // hands free is ON by default (done once, the first time with this version; turning it off in her menu afterwards stays off). With no microphone plugged in she
  // says nothing and starts by herself when one shows up (talk.js).
  if (!config.handsFreeDefault) {
    host.setConfig({ handsFreeDefault: true, handsFree: true });
    config = { ...config, handsFreeDefault: true, handsFree: true };
  }
  if (config.handsFree) listener.setHandsFree(true); // the mic open for "Capri…"
  // her way of talking, set up once in Spanish (her menu › Personalizarla… changes all of it)
  if (!config.styled && String(config.lang).startsWith('es')) {
    const patch = { styled: true, ...(config.persona ? {} : { persona: STYLE_ES }), ...(config.myLines?.length ? {} : { myLines: LINES_ES }) };
    host.setConfig(patch);
    config = { ...config, ...patch };
  }
  // Getting her chat going with buttons (setup.js): Ollama and a model, a key, or an address
  const setup = new Setup({ guide, panel, host, brain, capri, voice });
  guide.setup = setup;
  guide.onTalk = () => chat.start();
  chat.onSetup = (status) => setup.chat(status);
  chat.onBetterModel = () => setup.better();
  setup.onReady = () => chat.start();
  // What she calls you, how she is, your lines, what she remembers (custom.js)
  const custom = new Custom({ guide, host, brain, capri, voice });
  guide.custom = custom;
  brain.custom = mine(config);
  // the first Claude Code event that ever reaches her: so you know it worked
  brain.linked = config.linked;
  brain.watching = config.claude !== false;
  brain.onLinked = () => {
    host.setConfig({ linked: true, welcomed: true });
    voice.play('hello');
    capri.perform('hop');
    panel.say({ kind: 'done', badge: 'LINK', line: brain.t.welcome.linked, hold: 6000 });
  };

  // The demo's second half, after its fake Claude session: everything she does on her own, one
  // after the other, a line before each.
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (done, max = 15000) => {
    for (const t0 = Date.now(); !done() && Date.now() - t0 < max;) await wait(100);
  };
  const free = () => !capri.busy && !capri.act && capri.stance !== 'fall';
  brain.onShowcase = async () => {
    const t = brain.t.showcase;
    const caption = (line) => panel.say({ kind: 'info', line, hold: 2200 });
    capri.nextMove = capri.nextGaze = performance.now() + 120000; // nothing of her own in between
    if (capri.stowed) await capri.unstow();
    if (capri.dormant) capri.wake();
    await until(free);
    panel.hide();

    caption(t.minds);
    await wait(1000);
    await capri.perform('split');
    await wait(900);

    caption(t.zap);
    await wait(1000);
    const h = capri.head();
    capri.zap(h.x + capri.towardCenter() * 280, h.y - 170);
    await wait(1800);

    panel.hide();
    if (capri.gaze({ big: true })) await until(() => !capri.sky);
    await wait(2500);

    // a little terminal opens for her to take over, and closes under her once she's done with it
    if (capri.possessWindows && (await host.demoWindow(true))) {
      const top = () => capri.windows.wins.find((w) => capri.canSit(w)); // it opens on top of everything
      await until(top, 4000);
      const win = top();
      const seat = win && { win, dx: win.w * 0.4 };
      if (seat) {
        panel.hide();
        await capri.sitOn(seat);
        await until(free);
        caption(t.possess);
        await wait(1400);
        panel.hide();
        await capri.possess();
        await wait(1800);
      }
      host.demoWindow(false);
      await wait(400);
      await until(free); // she may have fallen off it
      await wait(900);
    }

    caption(t.sleep);
    await wait(1400);
    panel.hide();
    capri.setMode('sleep');
    await wait(2500); // dozing off
    await capri.doze();
    await wait(4500);
    capri.wake();
    await until(free);
    await wait(1200);

    caption(t.chip);
    await wait(1600);
    panel.hide();
    await capri.stow();
    await wait(3500);
    await capri.unstow();
    await wait(600);
    panel.say({ kind: 'info', line: t.end, hold: 5000 });
  };

  host.onClaudeEvent((evt) => brain.handle(evt));
  // Put away she can still sit on the window in front (her menu > When she rests): her mask rides on its top edge
  const placeChip = () => {
    if (!capri.stowed && !capri.stowing) return;
    if (liveConfig.rest === 'window') {
      const { wins, fg } = capri.windows;
      const front = wins.find((w) => w.id === fg);
      const x = front ? Math.min(Math.max(front.x + front.w - 90, front.x + 70), capri.view.w - 60) : 0;
      if (front && !front.max && front.w > 260 && front.y > 90 && front.y < capri.view.floor - 80 && !capri.covered(front, x)) {
        chip.perch(front, capri.view);
        return;
      }
    }
    if (chip.perched) chip.home(innerWidth, innerHeight - floorGap); // nothing to sit on (or not asked to): her corner
  };
  host.onWindows((data) => {
    capri.setWindows(data);
    brain.onWindows(data);
    placeChip();
  });
  // the windows as they are now: the watcher only speaks again when something changes
  host.windowsNow().then((data) => data && capri.setWindows(data));

  host.onResize(({ width, height, gap = 0 }) => {
    floorGap = gap;
    fx.resize(width, height);
    chip.place(width, height - gap);
    capri.setView(width, height, height - gap);
  });
  window.addEventListener('resize', () => {
    fx.resize(innerWidth, innerHeight);
    chip.place(innerWidth, innerHeight - floorGap);
    capri.setView(innerWidth, innerHeight, innerHeight - floorGap);
  });

  host.onConfig((cfg) => {
    liveConfig = cfg;
    voice.configure(cfg);
    capri.wander = cfg.wander;
    capri.possessWindows = cfg.possess;
    capri.restOn = cfg.rest || 'corner';
    const sideChanged = capri.restSide !== (cfg.restSide === 'right' ? 'right' : 'left');
    capri.restSide = cfg.restSide === 'right' ? 'right' : 'left';
    if (sideChanged && capri.stance === 'sit' && capri.perch?.id === 'taskbar' && !capri.busy) capri.goHome(); // (the side changed: she moves over to it)
    capri.sprites = cfg.sprites !== false;
    capri.followWindow = cfg.followWindow !== false;
    placeChip();
    applyMotion(cfg.motion);
    applyLook(cfg.look);
    if ((cfg.claude === false && brain.watching) || cfg.assistant !== brain.assistant) {
      guide.answer(null);
      panel.hide();
      capri.stopPointing();
      brain.replyFor = null;
      brain.linked = cfg.linked;
      // no longer watching Claude Code: whatever it was in the middle of is no business of hers
      brain.sessions.clear();
      panel.setTicker(null);
      if (capri.mode === 'work' || capri.mode === 'alert') capri.setMode('idle');
    }
    brain.watching = cfg.claude !== false;
    brain.announceMode = cfg.speakMode === 'important' && cfg.announce !== 'never' ? 'always' : cfg.announce || 'away'; // ('only what matters': Claude finishing is always said)
    timers.lang = cfg.lang;
    planner.lang = cfg.lang;
    planner.name = cfg.userName;
    config = { ...config, briefing: cfg.briefing };
    listener.setHandsFree(Boolean(cfg.handsFree));
    brain.custom = mine(cfg);
    brain.assistant = cfg.assistant;
    panel.labels = linesFor(cfg.lang, cfg.assistant);
    voice.boomLevel = Math.min(1, Math.max(0.05, Number(cfg.boomVol) || 0.5)); // (the BOOM's own volume)
    capri.gameLite = cfg.heavyLite > 0 ? 1000 / cfg.heavyLite : 0; // (heavy.js: a game has the PC)
    capri.wander = cfg.wander && !cfg.heavyGame; // (and while it is open she stays in her corner)
    if (Boolean(cfg.heavyGame) !== Boolean(capri.gameMode)) {
      capri.setGameMode(cfg.heavyGame);
      if (cfg.heavyGame) { // (what the window sees with a game over it: if it is drawn or not)
        let frames = 0;
        const t0 = performance.now();
        const count = () => { frames += 1; if (performance.now() - t0 < 3000) requestAnimationFrame(count); else host.lolNote?.(`game open: visibility=${document.visibilityState} · ${frames} frames in 3 s`); };
        setTimeout(() => requestAnimationFrame(count), 4000);
      }
    }
    if (cfg.scale !== capri.scale) capri.setScale(cfg.scale);
    if (cfg.lang !== brain.lang) {
      brain.lang = cfg.lang;
      panel.labels = linesFor(cfg.lang, cfg.assistant);
      document.documentElement.lang = cfg.lang;
    }
  });

  // What you selected, translated / explained / summarised by her own model: a card with what you selected, her answer, and the buttons
  // to copy it or to try the other two ways (each one asks her model again).
  const SEL_TAG = {
    es: { translate: 'TRADUCIR', explain: 'EXPLICAR', summarize: 'RESUMIR' },
    en: { translate: 'TRANSLATE', explain: 'EXPLAIN', summarize: 'SUMMARIZE' },
  };
  const SEL_BTN = {
    es: { translate: 'Traducir', explain: 'Explicar', summarize: 'Resumir', copy: 'Copiar' },
    en: { translate: 'Translate', explain: 'Explain', summarize: 'Summarize', copy: 'Copy' },
  };
  const SEL_ENG = {
    es: { local: 'LOCAL', haiku: 'HAIKU', sonnet: 'SONNET', opus: 'OPUS' },
    en: { local: 'LOCAL', haiku: 'HAIKU', sonnet: 'SONNET', opus: 'OPUS' },
  };
  const SEL_WITH = {
    es: { local: 'Con mi modelo local', haiku: 'Con Haiku', sonnet: 'Con Sonnet', opus: 'Con Opus' },
    en: { local: 'With my local model', haiku: 'With Haiku', sonnet: 'With Sonnet', opus: 'With Opus' },
  };
  function selectionCard(mode, source, text, engine = 'local') {
    const L = brain.lang === 'en' ? 'en' : 'es';
    const quote = source.length > 180 ? `${source.slice(0, 177)}…` : source;
    const tagOf = (m, e) => `${SEL_TAG[L][m]} · ${SEL_ENG[L][e]}`;
    const run = async (m, e) => {
      panel.say({ kind: 'info', face: 'smug', tag: tagOf(m, e), quote, line: L === 'en' ? 'One moment…' : 'Un momento…', hold: 120000 });
      const res = await host.selectionRun({ mode: m, text: source, engine: e }).catch((err) => ({ ok: false, error: String(err.message || err) }));
      if (res.ok) selectionCard(m, source, res.text, e);
      else panel.say({ kind: 'error', face: 'aside', tag: tagOf(m, e), quote, line: res.error, hold: 12000 });
    };
    ambient.anchor();
    panel.say({
      kind: 'info', face: 'smug', tag: tagOf(mode, engine), quote, line: text, hold: Math.min(70000, 15000 + text.length * 40),
      actions: [
        { id: 'copy', label: SEL_BTN[L].copy, primary: true },
        ...['translate', 'explain', 'summarize'].filter((m) => m !== mode).map((m) => ({ id: `mode:${m}`, label: SEL_BTN[L][m] })),
        ...['local', 'haiku', 'sonnet', 'opus'].filter((e) => e !== engine).map((e) => ({ id: `eng:${e}`, label: SEL_WITH[L][e] })), // the same, by another one
      ],
      onAction: async (id) => {
        if (id === 'copy') await host.copy(text);
        else if (id.startsWith('mode:')) await run(id.slice(5), engine);
        else if (id.startsWith('eng:')) await run(mode, id.slice(4));
      },
    });
  }

  // Type-ahead: her chat opens after she has come out (a second, with her animation). If you start writing the moment you press the key, the
  // letters go into this hidden box (the window has the keyboard by then) and into her real box when it appears: none is lost.
  const ahead = Object.assign(document.createElement('textarea'), { className: 'typeahead', tabIndex: -1, ariaHidden: 'true' });
  ahead.style.cssText = 'position:fixed;left:-300px;top:0;width:200px;height:30px;opacity:0;pointer-events:none;';
  document.body.append(ahead);
  let aheadTimer = 0;
  const catchKeys = () => {
    ahead.value = '';
    ahead.focus();
    clearTimeout(aheadTimer);
    aheadTimer = setTimeout(() => { ahead.value = ''; }, 9000); // (if her chat never opens, nothing is left lying there)
  };
  chat.takeAhead = () => {
    const text = ahead.value;
    ahead.value = '';
    clearTimeout(aheadTimer);
    return text;
  };

  host.onCommand(async (cmd) => {
    const t = brain.t;
    switch (cmd.name) {
      case 'teleport':
        capri.teleport(capri.spot('random'));
        break;
      case 'listen': // Ctrl+Alt+V or her menu's Voice: talk to her
        listener.toggle();
        break;
      case 'windowCall': // a voice call in her big window: this bubble neither listens nor talks until it ends
        listener.windowCall = Boolean(cmd.on);
        speaker.windowCall = Boolean(cmd.on);
        if (cmd.on) { speaker.stop(); listener.followUntil = 0; listener.cue?.(null); }
        break;
      case 'wakeHit': // openWakeWord heard her name (wakeword.js)
        listener.wakeHit();
        break;
      case 'dictate': // hold-to-dictate key (down / up)
        listener.dictation(cmd.phase);
        break;
      case 'colorKey': // the eyedropper's key
        chat.colorKey();
        break;
      case 'phoneDone': // a file went to the phone, or came from it
        chat.phoneDone(cmd);
        break;
      case 'shotDone': // the scanner's CAPTURAR
        chat.shotDone(cmd);
        break;
      case 'recordToggle': // Ctrl+Alt+G: start or stop recording the screen
        chat.recordToggle();
        break;
      case 'mediaKey': // the keyboard's play/pause, next, previous: her player card does it, and shows itself a moment
        if (player) player.mediaKey(cmd.action);
        else host.nowControl?.(cmd.action);
        break;
      case 'status':
        brain.status();
        break;
      case 'customize': // "Make her yours" in her menu
        custom.open();
        break;
      case 'setupChat': // "Set it up with her" in her menu's AI model
        setup.chat();
        break;
      case 'setupKey': // "API key or address" in her menu's AI model, or a service picked there that needs one
        setup.key();
        break;
      case 'setupFree': // --dev: Claude Code (or Codex) through Ollama
        setup.free();
        break;
      case 'setupStep': // --dev: one step of her setup on its own (pickModel, pull, pickKeyed, address…)
        guide.scene(() => setup[cmd.step]?.(...(cmd.args || [])));
        break;
      case 'rearmed': // a new mouse hook (main.js): click-through until the pointer comes over her again
        mouse = null;
        refreshHit();
        break;
      case 'rearm': // --dev: as if she'd noticed the pointer no longer reaches her
        host.rearm();
        break;
      case 'loseGl': { // --dev: as if the GPU had been reset (waking from sleep): she goes, then comes back
        const lose = capri.sprite.gl.getExtension('WEBGL_lose_context');
        lose?.loseContext();
        setTimeout(() => lose?.restoreContext(), cmd.ms ?? 1500);
        break;
      }
      case 'answer': { // --dev: as if that button of her panel had been clicked (her chat's too)
        const button = document.querySelector(`.panel__action[data-id="${CSS.escape(cmd.id)}"]`);
        if (button) button.click();
        else guide.answer(cmd.id);
        break;
      }
      case 'assistantChanged': // Claude Code, Codex or Antigravity, picked in her menu
        guide.welcome();
        break;
      case 'welcome': // "How does it work?" in her menu
        guide.menu();
        break;
      case 'forget': // "Forget our conversations" in her menu, maybe with her chat open
        chat.history = [];
        chat.session = null;
        chat.thread = null;
        chat.panel.hideSessions();
        chat.turns = 0;
        chat.warnedAt = 0;
        chat.resetPending = false;
        chat.updateCounter();
        break;
      case 'chat': // "Talk to her" in her menu
        chat.start();
        break;
      case 'scanResult': { // her scanner looked at what's inside its frame
        const es = brain.lang !== 'en';
        const line = cmd.ok ? cmd.text : (es ? `No pude ver eso: ${cmd.error}` : `Couldn't see that: ${cmd.error}`);
        if (!chat.notify(line, cmd.ok ? 'smug' : 'aside')) {
          ambient.anchor();
          const tag = cmd.ok && cmd.ms ? `${cmd.engine || 'scan'} · ${(cmd.ms / 1000).toFixed(1)} s` : '';
          const shown = panel.say({ kind: cmd.ok ? 'info' : 'error', line, tag, face: cmd.ok ? 'smug' : 'aside', hold: Math.min(40000, 12000 + line.length * 60) });
          // what she saw is on file: one press and you tell Claude what to do with it
          if (shown && cmd.ok && cmd.file) panel.addAction({ id: 'ask', label: es ? 'Pedir algo a Claude' : 'Ask Claude' }, () => chat.start({ claude: true, attach: cmd.file }));
        }
        if (cmd.ok) speaker.announce(line, brain.lang);
        break;
      }
      case 'selection': { // her selection key: what you had selected, worked on by her own model
        const es = brain.lang !== 'en';
        const L = es ? 'es' : 'en';
        if (cmd.phase === 'empty') {
          panel.say({ kind: 'error', face: 'aside', line: es ? 'No vi texto seleccionado. Selecciónalo y pulsa el atajo otra vez (si esa app corre como administrador, no puedo copiarlo).' : "I didn't see any selected text. Select it and press the shortcut again (if that app runs as administrator I can't copy from it).", hold: 9000 });
        } else if (cmd.phase === 'start') {
          ambient.anchor();
          panel.say({ kind: 'info', face: 'smug', tag: `${SEL_TAG[L][cmd.mode]} · ${SEL_ENG[L][cmd.engine || 'local']}`, quote: cmd.source.length > 180 ? `${cmd.source.slice(0, 177)}…` : cmd.source, line: es ? 'Un momento…' : 'One moment…', hold: 120000 });
        } else if (cmd.phase === 'error') {
          panel.say({ kind: 'error', face: 'aside', tag: `${SEL_TAG[L][cmd.mode || 'translate']} · ${SEL_ENG[L][cmd.engine || 'local']}`, line: cmd.error, hold: 12000 });
        } else {
          selectionCard(cmd.mode, cmd.source, cmd.text, cmd.engine || 'local');
        }
        break;
      }
      case 'palette': { // her scanner's PALETA: the colours of what's inside its frame
        const es = brain.lang !== 'en';
        if (!cmd.ok) {
          panel.say({ kind: 'error', face: 'aside', line: es ? 'No pude sacar los colores de ahí.' : "I couldn't read the colours from there.", hold: 7000 });
          break;
        }
        ambient.anchor();
        const n = cmd.colors.length;
        const shown = panel.say({ kind: 'info', face: 'smug', tag: es ? 'PALETA' : 'PALETTE', line: es ? `${n} colores. Ya los copié todos; toca uno para copiar solo ese.` : `${n} colours. All copied; press one to copy just that.`, hold: 30000 });
        if (shown) panel.setSwatches(cmd.colors, (hex) => host.copy(hex));
        speaker.announce(es ? 'Paleta lista.' : 'Palette ready.', brain.lang);
        break;
      }
      case 'powerFailed': { // the wheel's sleep / restart / shut down: Windows refused it, and she says why
        const es = brain.lang !== 'en';
        const what = { sleep: es ? 'dormir el PC' : 'put the PC to sleep', restart: es ? 'reiniciar el PC' : 'restart the PC', shutdown: es ? 'apagar el PC' : 'shut the PC down', cancel: es ? 'cancelar' : 'cancel' }[cmd.action] || cmd.action;
        const tail = cmd.action === 'sleep' && cmd.hint === 'noefecto'
          ? (es ? ` Probé ${cmd.tried?.length || 4} métodos y ninguno durmió el PC: algo de tu equipo lo impide (un driver o un programa). Lo que dijo cada uno está en capri-desktop\\_logs\\power.log.` : ` I tried ${cmd.tried?.length || 4} ways and none put the PC to sleep: something on your machine prevents it (a driver or a program). What each said is in capri-desktop\\_logs\\power.log.`)
          : '';
        ambient.anchor();
        panel.say({ kind: 'error', face: 'wide', tag: es ? 'ENERGÍA' : 'POWER', line: `${es ? 'No pude' : 'I could not'} ${what}: ${cmd.reason || '?'}.${tail}`, hold: 20000 });
        break;
      }
      case 'limitAlert': { // you are close to running out of Claude (or you have): she says it once per level
        const line = limitLine(cmd, brain.lang);
        const face = cmd.level >= 95 ? 'wide' : 'aside';
        ui(voice, cmd.level >= 100 ? 'error' : 'warn');
        if (!chat.notify(line, face, { keep: false })) {
          ambient.anchor();
          panel.say({ kind: 'alert', face, tag: 'CLAUDE', line, hold: 16000 });
        }
        speaker.announce(line, brain.lang);
        break;
      }
      case 'usage': { // her menu > Claude usage
        const es = brain.lang !== 'en';
        const sum = await host.usageSummary().catch(() => null);
        ambient.anchor();
        panel.say({ kind: 'info', face: 'smug', tag: es ? 'USO' : 'USAGE', line: usageLine(sum, brain.lang), quote: USAGE_NOTE[es ? 'es' : 'en'], hold: 24000 });
        break;
      }
      case 'shortcutBusy': { // a key she asked Windows for belongs to another program (a tablet or mouse driver, say)
        const es = brain.lang !== 'en';
        const keys = (cmd.keys || []).join(', ');
        panel.say({
          kind: 'error', face: 'aside', hold: 16000,
          line: es ? `${keys}: lo tiene otro programa (¿el de tu tablet o mini teclado?). Para la ventana, elige otro en mi menú → Atajo de la ventana.` : `${keys}: another program has it (your tablet or keypad driver?). For the window, pick another in my menu → Window shortcut.`,
        });
        break;
      }
      case 'sound': // something outside her overlay wants one of her sounds (the window opened with her key, from her menu)
        ui(voice, cmd.kind);
        break;
      case 'ollamaStatus': { // her menu > Check Ollama
        const es = brain.lang !== 'en';
        const models = cmd.models.join(', ');
        const line = !cmd.running
          ? (es ? 'Ollama no responde. Ábrelo (la llama de la bandeja de Windows) o corre «ollama serve» en una terminal.' : 'Ollama is not answering. Open it (the llama in the Windows tray) or run "ollama serve" in a terminal.')
          : !cmd.models.length
            ? (es ? 'Ollama funciona pero no tiene modelos. Para charlar: «ollama pull llama3.2». Para que vea imágenes: «ollama pull gemma3:4b».' : 'Ollama works but has no models. To chat: "ollama pull llama3.2". To see images: "ollama pull gemma3:4b".')
            : (es ? `Ollama funciona. Modelos: ${models}. ${cmd.vision.length ? `Con visión: ${cmd.vision.join(', ')}.` : 'Ninguno ve imágenes: «ollama pull gemma3:4b».'}` : `Ollama works. Models: ${models}. ${cmd.vision.length ? `With vision: ${cmd.vision.join(', ')}.` : 'None sees images: "ollama pull gemma3:4b".'}`);
        const woke = cmd.started ? (es ? 'Estaba apagado: lo encendí. ' : 'It was off: I turned it on. ') : '';
        ambient.anchor();
        panel.say({ kind: cmd.running && cmd.models.length ? 'info' : 'error', line: woke + line, face: cmd.running ? 'smug' : 'aside', hold: 20000 });
        break;
      }
      case 'gameSay': // lol.js: a remark about the League match she follows: a bubble (and her soft voice only if config lolVoice); she does not move: she keeps out of the game's way
        if (!cmd.line) break;
        {
          const folded = Boolean(capri.stowed);
          if (folded) panel.resume(); // (her panel is put aside while she is folded away: it comes back for the remark, like her other comments)
          ambient.anchor();
          const shown = panel.say({ kind: 'info', line: cmd.line, tag: cmd.recap ? 'RESUMEN' : 'LEAGUE', face: cmd.face || 'smug', hold: cmd.recap ? 15000 : 7000, compact: folded });
          if (!shown) { if (folded) panel.suspend(); break; }
          if (cmd.sfx && cmd.sfxOn !== false) voice.playLevel(cmd.sfx, cmd.sfxVol); else voice.play('tick');
          if (folded) { // her eyes open a moment, and her panel is put aside again after
            chip.setMode('alert');
            setTimeout(() => {
              if (!capri.stowed) return;
              chip.setMode(capri.mode);
              if (!chat.open && !guide.running) panel.suspend();
            }, 7600);
          }
          if (cmd.clip && cmd.clips !== false) clips.play(cmd.clip, { corner: true }); // a little GIF in the top left corner of the screen
          if (cmd.voice) { // her voice, though the automatic quiet of the game is on (not a call, not a recording): at her usual volume so it is heard over the game, soft only if config lolVoiceSoft
            speaker.gameVoiceUntil = Date.now() + 20000;
            const c = liveConfig || {};
            const ok = speaker.enabled && !speaker.speaking;
            const hot = Boolean(cmd.shout || cmd.excited); // a shout or a big moment: with energy, and louder than the usual level
            if (ok) speaker.announce(cmd.line, brain.lang, cmd.soft ? { quiet: true, flirt: Boolean(cmd.flirt) } : { loud: true, level: hot ? Math.max(Number(cmd.level) || 0, cmd.shout ? 0.8 : 0.6) : Number(cmd.level) || 0, flirt: Boolean(cmd.flirt), override: hot ? EXCITED : null });
            host.lolNote?.(`voice: ${ok ? 'asked' : 'NOT asked'} · enabled=${speaker.enabled} speaking=${speaker.speaking} speak=${c.speak} mode=${c.speakMode} dnd=${c.dnd} auto=${c.dndAuto || '-'} announce=${c.announce} muted=${c.muted} vol=${c.volume}`);
          }
        }
        break;
      case 'ambientNow': // her menu > What she sees now: she says what she sees right now, timers be damned
        ambient.now();
        break;
      case 'nowplaying': // "Now playing" in her menu
        nowPlaying.show();
        break;
      case 'wheel': // Ctrl+Alt+R or her menu: her wheel of apps and power buttons
        wheel?.toggle();
        break;
      case 'report': // "Mission report" in her menu
        if (capri.stowed) {
          host.setConfig({ visible: true });
          await capri.unstow();
        }
        capri.wake();
        if (brain.report()) capri.perform('curious', capri.towardCenter());
        break;
      case 'fakeClaude': { // --dev: the topmost window (the test window) is where a prompt was typed, and you're elsewhere
        const win = capri.windows.wins[0];
        if (win) {
          brain.sessions.set('dev', { id: 'dev', project: 'dev', taskStart: Date.now(), count: 0, files: new Set(), log: [], working: true, waiting: false, window: win.id, seen: Date.now() });
          capri.windows = { ...capri.windows, fg: -1 };
        }
        break;
      }
      case 'guide': // --dev: one topic of her guide (welcome, menu, connect, icon, claude, folder)
        if (cmd.topic === 'welcome') guide.welcome();
        else if (cmd.topic === 'menu') guide.menu();
        else if (typeof guide[cmd.topic] === 'function') guide.scene(() => guide[cmd.topic]());
        break;
      case 'stowToggle': { // Ctrl+Alt+C (or her tray): she decides by where she really is
        if (liveConfig?.heavyGame) { // (a game is open: a note in lol.log of what she sees, to find what stops her)
          host.lolNote?.(`stowToggle: stowed=${capri.stowed} stowing=${capri.stowing} busy=${capri.busy} hidden=${capri.hidden} act=${Boolean(capri.act)} visibility=${document.visibilityState}`);
          setTimeout(() => host.lolNote?.(`stowToggle +2s: stowed=${capri.stowed} stowing=${capri.stowing} busy=${capri.busy} visibility=${document.visibilityState}`), 2000);
        }
        for (let i = 0; capri.stowing && i < 40; i++) await new Promise((r) => setTimeout(r, 100)); // (a fold in progress finishes first)
        if (capri.stowed) { // in her biochip: back out, with her chat open and the keyboard in its box
          if (!liveConfig?.heavyGame) { // (not with a game open: its keys must not type into her box)
            host.focusOverlay(true); // (asked at once, while the key you pressed still counts for Windows: later, with other windows open, it refuses)
            catchKeys(); // and what you type while she comes out and her box opens is kept, and goes into the box
          }
          host.setConfig({ visible: true });
          chat.start({ greeting: { line: brain.idleLine(), face: pick(['calm', 'smug', 'aside']) } });
        } else { // out: into her biochip
          panel.hide(); // (her chat card goes with her: left up, it blocks the next chat from opening, since it will not step on a chat)
          if (chat.open) chat.close();
          host.setConfig({ visible: false });
          capri.stow();
        }
        break;
      }
      case 'stow': // Ctrl+Alt+C: into her biochip, or back out
        if (cmd.on) capri.stow();
        // back out: her chat opens with the keyboard in its box, so you can write at once (it brings her out first)
        else chat.start({ greeting: { line: brain.idleLine(), face: pick(['calm', 'smug', 'aside']) } });
        break;
      case 'satellite': // the whole sequence, on demand (tray)
        if (capri.stowed) {
          host.setConfig({ visible: true });
          await capri.unstow();
        }
        capri.wake();
        if (capri.stance === 'peek') await capri.unpeek();
        if (!capri.gaze({ big: true })) setTimeout(() => capri.gaze({ big: true }), 1500);
        break;
      case 'msgToast': { // what a chat app sent to Windows (toasts.js), in her style: who, what, and a way to answer
        pending.add(cmd.items || []); // (kept even when she stays quiet: it waits in her Pendientes until you answer)
        const cfgNow = await host.getConfig?.().catch(() => null);
        if (cfgNow?.dnd || cfgNow?.dndAuto || guide.running) break;
        const es = brain.lang !== 'en';
        const items = cmd.items || [];
        if (!items.length) break;
        const names = { whatsapp: 'WhatsApp', discord: 'Discord', telegram: 'Telegram' };
        const clip = (t, n) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);
        // everything that came in and has not been dealt with stays on her card: a second message must not wipe the first
        const nowMs = Date.now();
        msgState.pile = msgState.pile.filter((m) => nowMs - m.at < 600000).concat(items.map((i) => ({ ...i, at: nowMs }))).slice(-30);
        const pile = msgState.pile;
        const last = pile[pile.length - 1];
        const name = names[last.app] || last.app;
        chat.lastMsgApp = last.app;
        // grouped by who wrote (the chat's name), each with its messages in order
        const groups = [];
        for (const m of pile) {
          let g = groups.find((x) => x.app === m.app && x.title === m.title);
          if (!g) { g = { app: m.app, title: m.title, texts: [] }; groups.push(g); }
          if (m.body) {
            const prev = g.texts[g.texts.length - 1];
            const same = prev && (prev === m.body || prev.replace(/ ×\d+$/, '') === m.body);
            if (same) g.texts[g.texts.length - 1] = `${m.body} ×${(Number(/ ×(\d+)$/.exec(prev)?.[1]) || 1) + 1}`; // (the same thing twice, a sticker for one: once, with its count)
            else g.texts.push(m.body);
          }
        }
        const many = pile.length > 1;
        const VOICE_NOTE = /🎤|🎙|🔊|mensaje de voz|nota de voz|voice (?:message|note)|\baudio\b|\bptt\b|^\s*\(?\d{1,2}:\d{2}\)?\s*$/i; // (what WhatsApp shows in a toast for a voice note: it sends no sound, only that it came)
        const voiceNote = VOICE_NOTE.test(String(last.body || '')) || (!last.body && VOICE_NOTE.test(String(last.title || '')));
        const line = !many
          ? `${clip(last.title, 60)}${last.body ? `\n${clip(last.body, 220)}` : ''}`
          : groups.length === 1
            ? (es ? `${pile.length} mensajes de ${clip(groups[0].title, 40)}` : `${pile.length} messages from ${clip(groups[0].title, 40)}`)
            : (es ? `${pile.length} mensajes de ${groups.length} chats` : `${pile.length} messages from ${groups.length} chats`);
        const reply = many ? groups.map((g) => `${g.app === last.app || groups.every((x) => x.app === g.app) ? '' : `[${names[g.app] || g.app}] `}${g.title}\n${g.texts.length ? g.texts.map((t) => `  · ${clip(t, 400)}`).join('\n') : '  ·'}`).join('\n\n') : '';
        const recent = groups.slice(-3).reverse(); // (the ones she offers a button for: the latest three chats)
        const actions = groups.length <= 1
          ? [{ id: 'reply:0', label: es ? 'Responder' : 'Reply', primary: true }]
          : recent.map((g, i) => ({ id: `reply:${i}`, label: `${es ? 'Resp.' : 'Re:'} ${clip(g.title, 14)}`, primary: i === 0 }));
        if (voiceNote) actions.splice(actions.length, 0, { id: 'open', label: es ? `Abrir ${name} (oír)` : `Open ${name} (listen)` });
        actions.push({ id: 'close', label: es ? 'Cerrar' : 'Close' });
        const token = ++msgState.token;
        if (cfgNow?.msgSound !== false) voice.play('alert'); // (a sound, not her voice: msgSound: false for silence)
        capri.wake?.();
        panel.say({
          kind: 'info', face: 'smug', tag: name.toUpperCase(), line, reply, pile: true, hold: many ? 40000 : 14000,
          actions,
          onLeave: () => setTimeout(() => { if (token === msgState.token) msgState.pile = []; }, 0), // (gone, not replaced by a newer one: what was on it is dealt with)
          onAction: async (id) => {
            if (id === 'close') { msgState.pile = []; panel.hide(); return; } // the card goes away (the panel leaves it to onAction)
            if (id === 'open') { // a voice note: its sound only plays inside the app, so she brings the app up
              const hit = await host.findLaunch?.(name).catch(() => null);
              if (hit) host.launch?.(hit);
              return;
            }
            if (!id.startsWith('reply')) return;
            const g = groups.length <= 1 ? groups[0] : recent[Number(id.split(':')[1]) || 0];
            const gName = names[g?.app] || name;
            const who = g?.app === 'whatsapp' && g.title.length <= 40 && !/[:,]/.test(g.title) ? ` ${es ? 'a' : 'to'} ${g.title}` : '';
            msgState.pile = [];
            if (!chat.open) await chat.start();
            const box = panel.chatInput;
            if (box) { box.value = es ? `responde en ${gName}${who}: ` : `reply in ${gName}${who}: `; box.focus(); }
          },
        });
        break;
      }
      case 'msgNew': { // unread messages in a chat app (msgwatch.js, from the window title only): she says so and offers to read them
        const cfgNow = await host.getConfig?.().catch(() => null);
        if (cfgNow?.dnd || cfgNow?.dndAuto || chat.turn || guide.running) break;
        const es = brain.lang !== 'en';
        const name = { whatsapp: 'WhatsApp', discord: 'Discord', telegram: 'Telegram' }[cmd.app] || cmd.app;
        chat.lastMsgApp = cmd.app;
        capri.wake?.();
        panel.say({
          kind: 'info', face: 'smug', tag: name.toUpperCase(), hold: 20000,
          line: es ? `${name}: ${cmd.count > 1 ? `${cmd.count} mensajes nuevos` : 'mensaje nuevo'}. ¿Te lo leo?` : `${name}: ${cmd.count > 1 ? `${cmd.count} new messages` : 'new message'}. Read it to you?`,
          actions: [{ id: 'read', label: es ? 'Leer' : 'Read', primary: true }, { id: 'later', label: es ? 'Luego' : 'Later' }, { id: 'off', label: es ? 'No avisar más' : 'Stop telling me' }],
          onAction: async (id) => {
            if (id === 'off') { host.setConfig?.({ msgWatch: false }); panel.hide(); return; }
            if (id === 'close' || id === 'later') { panel.hide(); return; } // Cerrar / Luego / Ahora no: the card goes away (the panel leaves it to onAction)
            if (id !== 'read') return;
            if (!chat.open) await chat.start();
            chat.send(es ? `lee mis mensajes de ${name}` : `read my messages from ${name}`, { voice: false });
          },
        });
        break;
      }
      case 'hwAlert': { // the PC itself (hwalerts.js): a drive almost full, heat, a battery low
        const cfgNow = await host.getConfig?.().catch(() => null);
        if (cfgNow?.dnd || cfgNow?.dndAuto || guide.running) break;
        const es = brain.lang !== 'en';
        const clean = [{ id: 'clean', label: es ? 'Limpiar' : 'Clean up', primary: true }, { id: 'ok', label: es ? 'Entendido' : 'Got it' }];
        const text = {
          disk: es ? `El disco ${cmd.drive} está al ${cmd.usedPct}% (quedan ${cmd.freeGb} GB).${cmd.level === 'crit' ? ' Ya casi no cabe nada.' : ''}` : `Drive ${cmd.drive} is ${cmd.usedPct}% full (${cmd.freeGb} GB left).`,
          temp: es ? `El procesador anda en ${cmd.temp} °C. Revisa la ventilación o cierra lo pesado.` : `The processor is at ${cmd.temp} °C. Check the airflow or close heavy things.`,
          battery: es ? `Batería del portátil al ${cmd.pct}%. Conecta el cargador.` : `Laptop battery at ${cmd.pct}%. Plug in the charger.`,
          device: es ? `A «${cmd.name}» le queda ${cmd.pct}% de batería.` : `"${cmd.name}" has ${cmd.pct}% battery left.`,
        }[cmd.kind];
        if (!text) break;
        capri.wake?.();
        voice.play('alert');
        panel.say({
          kind: 'alert', face: 'aside', tag: es ? 'EQUIPO' : 'PC', line: text, hold: 20000,
          actions: cmd.kind === 'disk' ? clean : [{ id: 'ok', label: es ? 'Entendido' : 'Got it', primary: true }],
          onAction: async (id) => {
            if (id !== 'clean') { panel.hide?.(); return; }
            if (!chat.open) await chat.start();
            chat.send(es ? 'libera espacio' : 'free up space', { voice: false });
          },
        });
        break;
      }
      case 'heavyOn': { // a heavy program (Illustrator, a game, LoL...) opened: she offers to close what is safe to close, and only on your OK
        const cfgNow = await host.getConfig?.().catch(() => null);
        if (cfgNow?.dnd || cfgNow?.dndAuto || guide.running || Date.now() < heavyAskedUntil) break;
        const es = brain.lang !== 'en';
        const r = await host.perfScan?.().catch(() => null);
        const mb = (r?.safe || []).reduce((n, p) => n + p.mb, 0);
        if (!r?.safe?.length || mb < 150) break; // (nothing worth the question)
        const gb = (m) => (m >= 1024 ? `${(m / 1024).toFixed(1)} GB` : `${m} MB`);
        const prog = (cmd.apps || [])[0] || (es ? 'un programa pesado' : 'a heavy program');
        capri.wake?.();
        panel.say({
          kind: 'info', face: 'smug', tag: es ? 'RENDIMIENTO' : 'SPEED', hold: 30000,
          line: es ? `Abriste ${prog}. ¿Cierro lo que no usas para darle aire (${gb(mb)})?` : `You opened ${prog}. Shall I close what you are not using to give it room (${gb(mb)})?`,
          reply: r.safe.map((p) => `• ${p.name}${p.count > 1 ? ` ×${p.count}` : ''} — ${gb(p.mb)}`).join('\n') + (es ? '\nSolo de una lista segura; tus programas de trabajo y chats no se tocan.' : '\nOnly from a safe list; your work programs and chats are left alone.'),
          actions: [{ id: 'yes', label: es ? 'Permitir' : 'Allow', primary: true }, { id: 'no', label: es ? 'Denegar' : 'Deny' }],
          onAction: async (id) => {
            if (id !== 'yes') { heavyAskedUntil = Date.now() + 30 * 60 * 1000; panel.hide?.(); return; }
            const res = await host.perfRun?.(r.safe.map((p) => p.name), true).catch(() => null);
            panel.say({ kind: res?.ok ? 'done' : 'error', badge: es ? 'RENDIMIENTO' : 'SPEED', face: res?.ok ? 'laugh' : 'aside', hold: 7000, line: res?.ok ? (es ? `Cerré ${res.closed} procesos (~${gb(mb)}). Al cerrar ${prog} te devuelvo mi modelo grande.` : `Closed ${res.closed} processes (~${gb(mb)}). When ${prog} closes I give my big model back.`) : (es ? `No pude cerrarlos: ${res?.error || 'error'}.` : `Could not close them: ${res?.error || 'error'}.`) });
          },
        });
        break;
      }
      case 'heavyOff': // the heavy program closed: her big model comes back by itself (heavy.js); she only says so, once and short
        if (!(await host.getConfig?.().catch(() => null))?.dnd && !guide.running && !chat.open) panel.say({ kind: 'info', face: 'smug', tag: brain.lang !== 'en' ? 'RENDIMIENTO' : 'SPEED', line: brain.lang !== 'en' ? 'Listo, vuelvo a mi modelo normal.' : 'Done, back to my normal model.', hold: 3500, compact: true });
        break;
      case 'avAlert': { // Windows Defender flagged a new file in Downloads (avscan.js): she says so even in do-not-disturb, and only offers
        const es = brain.lang !== 'en';
        capri.wake?.();
        panel.say({
          kind: 'alert', face: 'aside', tag: es ? 'DEFENDER' : 'DEFENDER', hold: 60000,
          line: es ? `Windows Defender marcó «${cmd.name}» como sospechoso${cmd.threat ? ` (${cmd.threat})` : ''}. No lo abras.` : `Windows Defender flagged "${cmd.name}"${cmd.threat ? ` (${cmd.threat})` : ''}. Do not open it.`,
          actions: [
            { id: 'vt', label: 'VirusTotal', primary: true },
            { id: 'show', label: es ? 'Ver en carpeta' : 'Show in folder' },
            { id: 'ok', label: es ? 'Entendido' : 'Got it' },
          ],
          onAction: (id) => {
            if (id === 'vt') host.avVirusTotal?.(cmd.file);
            else if (id === 'show') host.avShow?.(cmd.file);
            else panel.hide?.();
          },
        });
        break;
      }
      case 'downloadsNew': { // new files piled up in Downloads (downloads.js): she offers to organize them, and never moves anything by herself
        const cfgNow = await host.getConfig?.().catch(() => null);
        if (cfgNow?.dnd || cfgNow?.dndAuto || chat.turn || guide.running) break; // (a call, a game, a chat: not now; the next batch will ask again)
        const es = brain.lang !== 'en';
        const more = cmd.count > cmd.names.length ? '…' : '';
        const line = es
          ? `Cayeron ${cmd.count} archivos nuevos en Descargas (${cmd.names.join(', ')}${more}). ¿Los organizo con tu script?`
          : `${cmd.count} new files landed in Downloads (${cmd.names.join(', ')}${more}). Shall I organize them with your script?`;
        capri.wake?.();
        panel.say({
          kind: 'info', face: 'smug', tag: es ? 'DESCARGAS' : 'DOWNLOADS', line, hold: 30000,
          actions: [
            { id: 'go', label: es ? 'Organizar' : 'Organize', primary: true },
            { id: 'later', label: es ? 'Ahora no' : 'Not now' },
            { id: 'off', label: es ? 'No avisar más' : 'Stop telling me' },
          ],
          onAction: async (id) => {
            if (id === 'off') { host.setConfig?.({ downloadsWatch: false }); panel.hide(); return; }
            if (id === 'close' || id === 'later') { panel.hide(); return; } // Cerrar / Luego / Ahora no: the card goes away (the panel leaves it to onAction)
            if (id !== 'go') return;
            const r = await host.organizeRun?.().catch((err) => ({ ok: false, error: err.message }));
            const msg = !r?.ok ? (es ? `No pude organizar: ${r?.error || 'error'}` : `Couldn't organize: ${r?.error || 'error'}`)
              : r.moved ? (es ? `Listo, moví ${r.moved} archivos.` : `Done, moved ${r.moved} files.`)
                : (es ? 'Revisé: no había nada por organizar.' : 'Checked: nothing to organize.');
            panel.say({ kind: r?.ok ? 'done' : 'error', badge: 'ORDEN', line: msg, face: r?.ok ? 'smug' : 'aside', hold: 8000 });
          },
        });
        break;
      }
      case 'organized': { // the file organizer finished (at start, from her menu, or when you asked)
        const es = brain.lang !== 'en';
        const line = !cmd.ok ? (es ? `No pude organizar tus archivos: ${cmd.error}` : `Couldn't organize your files: ${cmd.error}`)
          : cmd.moved ? (es ? `Organicé tus archivos: moví ${cmd.moved}. El reporte está en Organizacion Claude.` : `Files organized: moved ${cmd.moved}. The report is in Organizacion Claude.`)
            : (es ? 'Revisé tus carpetas: no había nada por organizar.' : 'Checked your folders: nothing to organize.');
        if (!chat.notify(line, cmd.ok ? 'smug' : 'aside')) panel.say({ kind: cmd.ok ? 'done' : 'error', badge: 'ORDEN', line, face: cmd.ok ? 'smug' : 'aside', hold: 10000 });
        if (cmd.ok && cmd.moved) speaker.announce(line, brain.lang);
        break;
      }
      case 'hooks':
        if (cmd.ok) panel.say({ kind: 'info', line: cmd.action === 'install' ? t.hooksOk : t.hooksRemoved, hold: 6000 });
        else panel.say({ kind: 'error', line: fmt(t.hooksFail, { error: cmd.error }), hold: 9000 });
        break;
      // --dev helpers
      case 'intro': // her intro again, as when she starts (still: as with Windows' animations off)
        panel.hide();
        await capri.intro(capri.spot('post'), cmd.still ? { still: true } : {});
        break;
      case 'pose':
        capri.debug = cmd.params || null;
        if (cmd.still) capri.nextMove = capri.nextGaze = Infinity; // no wandering off mid-test
        if (cmd.hush) {
          panel.setTicker(null);
          panel.hide();
        }
        if (cmd.scale) capri.setScale(cmd.scale);
        if (cmd.stance) capri.setStance(cmd.stance, cmd);
        if (cmd.at) capri.pos = cmd.at;
        if (cmd.facing) capri.facing = cmd.facing;
        capri.drawFrame();
        break;
      case 'config': // a setting, as if changed from her menu
        host.setConfig(cmd.patch || {});
        break;
      case 'focus': // as if window `fg` had come to the front
        capri.windows = { ...capri.windows, fg: cmd.fg };
        brain.onWindows(capri.windows);
        break;
      case 'freeze':
        capri.hidden = Boolean(cmd.on);
        break;
      case 'act':
        // behaviours by method name (gaze, celebrate, hurt, shed, peek, fall, wanderStep...) or acts by name
        if (cmd.act === 'sit') {
          // pile: n-th window she could sit on from the top of the pile (0: the --dev test window
          // opened last), instead of the usual choice
          const top = cmd.pile !== undefined && capri.windows.wins.filter((w) => capri.canSit(w))[cmd.pile];
          const seat = top ? { win: top, dx: top.w * 0.4 } : capri.pickSeat();
          if (seat) capri.sitOn(seat);
        } else if (typeof capri[cmd.act] === 'function') capri[cmd.act](...(cmd.args || []));
        else capri.perform(cmd.act, cmd.dir || 0);
        break;
      default:
        break;
    }
  });

  // entrance: her face big in the corner says hi, then she dives down to her spot
  // (put away last time: she starts in her biochip)
  if (config.visible === false) capri.stowNow();
  else if (intro) await capri.intro(capri.spot('post'));
  else await capri.materialize(capri.spot('post'));
  // Windows has its animations off and she's following it: she barely moves. The first time, she
  // says so and asks whether to move anyway (her menu › Animations changes it later).
  if (reducedMotion.setting === 'auto' && reducedMotion.system && !config.motionAsked) {
    const m = brain.t.motion;
    await new Promise((done) => {
      const asked = panel.say({
        kind: 'info',
        face: 'aside',
        guide: true,
        line: m.line,
        quote: m.quote,
        actions: [{ id: 'full', label: m.full, primary: true }, { id: 'reduced', label: m.still }],
        onAction: (id) => {
          host.setConfig({ motion: id, motionAsked: true });
          panel.hide();
          if (id === 'full') capri.perform('hop');
        },
        onLeave: done,
        hold: null,
      });
      if (!asked) done();
    });
  }
  const hooks = await host.hooksStatus();
  // her welcome: the first time, or while she's meant to watch Claude Code and isn't plugged into it
  if (!config.welcomed || (config.claude && !hooks.installed)) guide.welcome();
  else panel.say({ kind: 'info', line: brain.onlineLine(), hold: 4000 });

  // In the evening, after a real day's work, she brings you her report card once, on her own,
  // at a quiet moment.
  setInterval(() => {
    const day = mission.day;
    const quiet = !brain.busySessions.length && !panel.visible && !guide.running && !capri.busy && !capri.act;
    if (new Date().getHours() < 18 || day.reported || day.missions < 3 || !quiet) return;
    if (capri.stowed || capri.dormant || capri.mode === 'sleep') return;
    if (brain.report()) {
      mission.markReported();
      capri.perform('curious', capri.towardCenter());
    }
  }, 60000);
}

boot().catch((err) => {
  console.error('[capri] boot failed', err);
});
