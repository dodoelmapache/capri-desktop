'use strict';

// Game mode for League of Legends ("modo juego"): while a match is on she follows it through the game's own local data
// (the Live Client Data API, https://127.0.0.1:2999, which only answers on this PC while a match is running).
// No screen capture, no model in the loop: it costs next to nothing. Her remarks are her own lines, a text bubble
// (her soft voice and one of her GIFs in the top left corner unless config lolVoice / lolClips are false), and not too often. A build suggestion comes only when you ask ("capri, qué compro")
// and is answered by her small local model with what the game says you and the other team have.
// Her remarks are off until you turn the game mode on (config.lolMode, or "capri, activa el modo juego"); "qué compro" works either way.
// What she saw is in _logs/lol.log.

const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');

const EVERY_MS = 8000;
const MIN_GAP_MS = 45 * 1000;     // never two remarks within this (config lolGap, in seconds)
const GOLD_AT = 1500;             // gold she nags about (once in a while)
const GOLD_EVERY = 5 * 60 * 1000;
const HINT_EVERY = 6 * 60 * 1000;
// which of her GIFs (clips.js) goes with each remark, in the top left corner
const CLIP = { start: 'saludo', firstBlood: 'risa', kill: 'risa', multi2: 'risa', multi3: 'risa', multi4: 'risa', multi5: 'risa', ace: 'risa', win: 'risa', death3: 'sorpresa', death6: 'sorpresa', lose: 'sorpresa', aceTheirs: 'sorpresa', antiheal: 'sorpresa', crit: 'idle', defMr: 'sorpresa', defArmor: 'sorpresa', boots: 'idle', wards: 'idle', dragonSoon: 'idle', baronSoon: 'sorpresa', baronTheirs: 'sorpresa', baronMine: 'risa', dragonMine: 'risa', dragonTheirs: 'idle', lvl6: 'idle', gold: 'idle', armor: 'idle', mr: 'idle',
  streak3: 'risa', streak5: 'risa', turretMine: 'risa', turretTheirs: 'sorpresa', inhibMine: 'risa', inhibTheirs: 'sorpresa', heraldMine: 'risa', heraldTheirs: 'idle', lvl11: 'idle', lvl16: 'idle',
  itemDone: 'idle', csGood: 'risa', csBad: 'idle', long30: 'idle', long40: 'idle', enemyFed: 'sorpresa', deadShop: 'idle' };
// which of her synthesized sounds (voice.js) goes with each remark: kills, objectives, warnings... (config lolSfx, volume lolSfxVol)
const SFX = { start: 'hello', firstBlood: 'kill', kill: 'kill', multi2: 'multi', multi3: 'multi', multi4: 'multi', multi5: 'boom', ace: 'boom', aceTheirs: 'death', streak3: 'streak', streak5: 'streak',
  death3: 'death', death6: 'death', lose: 'lose', win: 'win', antiheal: 'warn', armor: 'warn', mr: 'warn', crit: 'warn', defMr: 'warn', defArmor: 'warn', boots: 'item', wards: 'warn', dragonSoon: 'warn', baronSoon: 'warn', enemyFed: 'warn', dragonMine: 'objective', baronMine: 'objective', turretMine: 'objective', inhibMine: 'objective', heraldMine: 'objective',
  dragonTheirs: 'warn', baronTheirs: 'warn', turretTheirs: 'warn', inhibTheirs: 'warn', heraldTheirs: 'warn', itemDone: 'item', gold: 'item', lvl6: 'rise', lvl11: 'rise', lvl16: 'rise', csGood: 'star', deadShop: 'item' };
const ITEMS = {
  antiheal: { ad: "Mortal Reminder, Executioner's Calling", ap: "Morellonomicon, Oblivion Orb" },
  armor: { ad: "Lord Dominik's, Serylda's Grudge, Mortal Reminder" },
  mr: { ap: "Void Staff, Cryptbloom" },
  crit: { ad: "Infinity Edge, Phantom Dancer, Rapid Firecannon" },
  defMr: { ad: "Maw of Malmortius, Banshee's Veil, Mercury's Treads" },
  defArmor: { ad: "Guardian Angel, Randuin's Omen, Plated Steelcaps" },
};
const itemsFor = (h) => ITEMS[h.key]?.[h.kind] || ITEMS[h.key]?.ad || '';

// RIOT'S RULES (developer.riotgames.com, Game Integrity): no cooldown or spawn timers, no in-match advice or build suggestions, nothing that decides for you,
// and no information the player does not already see. So, with config lolSafe (on unless you set it to false), she only COMMENTS on what has already happened
// (kills, deaths, objectives taken, level ups, the end) with humor, and sums the match up when it is over. The rest below stays in the file but is never said.
const BANNED = new Set(['dragonSoon', 'baronSoon', 'antiheal', 'armor', 'mr', 'crit', 'defMr', 'defArmor', 'boots', 'wards', 'gold', 'deadShop', 'enemyFed']);

const log = (line) => {
  try {
    const dir = path.join(__dirname, '..', '..', '_logs');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'lol.log'), `${new Date().toISOString()} ${line}\n`);
  } catch { /* a packaged app cannot write there */ }
};

// the game's certificate is Riot's own, so it is not checked: it is always this PC, port 2999
function api(pathname, timeout = 2500) {
  return new Promise((resolve) => {
    const req = https.get({ host: '127.0.0.1', port: 2999, path: `/liveclientdata/${pathname}`, rejectUnauthorized: false, timeout, agent: false }, (res) => {
      if (res.statusCode !== 200) { res.resume(); resolve(null); return; }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; if (body.length > 4e6) req.destroy(); });
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve(null); } });
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));
  });
}

// --- rules about what to buy (no model: the item numbers are the game's own, the same in every language) -------------
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const HEALERS = new Set(['drmundo', 'soraka', 'aatrox', 'vladimir', 'warwick', 'sylas', 'swain', 'olaf', 'briar', 'yuumi', 'sona', 'nami', 'seraphine', 'kayn']); // who heals a lot
const ANTIHEAL_IDS = new Set([3123, 3916, 3165, 3033, 6609, 3075, 3076]); // Executioner's Calling, Oblivion Orb, Morellonomicon, Mortal Reminder, Chempunk Chainsword, Thornmail, Bramble Vest
const ANTIHEAL_NAME = /executioner|oblivion orb|morellonomicon|mortal reminder|chempunk|thornmail|bramble vest/i;
const ARMOR_NAME = /frozen heart|randuin|thornmail|sunfire|dead man|plated steelcaps|guardian angel|zhonya|bramble|gargoyle|iceborn|warden's mail|abyssal|jak'sho|kaenic/i;
const MR_NAME = /banshee|force of nature|maw of malmortius|mercury|spirit visage|abyssal mask|hexdrinker|wit's end|negatron|kaenic|silvermere|adaptive helm/i;
const items = (p) => (Array.isArray(p.items) ? p.items : []);
const hasAntiheal = (p) => items(p).some((i) => ANTIHEAL_IDS.has(Number(i.itemID)) || ANTIHEAL_NAME.test(i.displayName || ''));
const count = (p, re) => items(p).filter((i) => re.test(i.displayName || '')).length;

// what the rules see: [{ key, champ?, n? }] (healers without anti-heal on your side, stacked armor, stacked magic resist)
// who is a tank, who deals magic damage (by champion: the game gives no damage type), what counts as crit, boots, magic resist or armor items (by item number)
const TANKS = new Set(['ornn', 'malphite', 'sion', 'maokai', 'chogath', 'drmundo', 'shen', 'rammus', 'zac', 'sejuani', 'amumu', 'nautilus', 'leona', 'alistar', 'braum', 'skarner', 'tahmkench', 'poppy', 'galio', 'ksante', 'gragas', 'volibear', 'nunuwillump', 'taric', 'rell', 'jarvaniv', 'thresh', 'blitzcrank']);
const AP_CHAMPS = new Set(['ahri', 'akali', 'anivia', 'annie', 'aurelionsol', 'azir', 'brand', 'cassiopeia', 'diana', 'ekko', 'elise', 'evelynn', 'fiddlesticks', 'fizz', 'heimerdinger', 'hwei', 'karma', 'karthus', 'kassadin', 'katarina', 'leblanc', 'lissandra', 'lux', 'malzahar', 'mordekaiser', 'morgana', 'neeko', 'nidalee', 'orianna', 'ryze', 'seraphine', 'swain', 'sylas', 'syndra', 'taliyah', 'teemo', 'twistedfate', 'veigar', 'velkoz', 'vex', 'viktor', 'vladimir', 'xerath', 'ziggs', 'zilean', 'zoe', 'zyra', 'soraka', 'sona', 'nami', 'janna', 'lillia', 'rumble', 'singed', 'yuumi', 'milio', 'renataglasc', 'aurora', 'mel']);
const CRIT_IDS = new Set([3031, 3046, 3094, 3085, 6671, 6675, 3508, 3032, 3087, 6673]); // Infinity Edge, Phantom Dancer, Rapid Firecannon, Runaan's, Galeforce, Navori, Essence Reaver, Yun Tal, Statikk, Shieldbow
const CRIT_NAME = /infinity edge|phantom dancer|rapid firecannon|runaan|galeforce|navori|essence reaver|yun tal|statikk|immortal shieldbow/i;
const BOOT_IDS = new Set([1001, 3006, 3009, 3020, 3047, 3111, 3117, 3158, 2422]);
const BOOT_NAME = /boots|greaves|treads|swiftness|lucidity/i;
const MR_IDS = new Set([3156, 3102, 3111, 4401, 3065, 3139]);
const ARMOR_IDS = new Set([3026, 3143, 3110, 3047, 3075, 3076, 3157]);
const haveAny = (p, ids, re) => items(p).some((i) => ids.has(Number(i.itemID)) || re.test(i.displayName || ''));

function analyze(data, me) {
  const out = [];
  const enemies = (data.allPlayers || []).filter((p) => p.team !== me.team);
  const stats = data.activePlayer?.championStats || {};
  const ap = Number(stats.abilityPower) || 0;
  const ad = Number(stats.attackDamage) || 0;
  const kind = ap > ad * 1.2 ? 'ap' : 'ad'; // (what you deal: it picks the examples)
  if (me.position !== 'UTILITY' && !hasAntiheal(me)) {
    const healers = enemies.filter((p) => HEALERS.has(norm(p.championName)));
    // a healer who is already fed or has lifesteal in the bag: that one first
    const worst = healers.sort((a, b) => ((b.scores?.kills || 0) + (b.scores?.assists || 0)) - ((a.scores?.kills || 0) + (a.scores?.assists || 0)))[0];
    if (worst) out.push({ key: 'antiheal', champ: worst.championName, kind });
  }
  const armored = enemies.filter((p) => count(p, ARMOR_NAME) >= 2).length;
  const resist = enemies.filter((p) => count(p, MR_NAME) >= 2).length;
  if (armored >= 2 && kind === 'ad') out.push({ key: 'armor', n: armored, kind });
  if (resist >= 2 && kind === 'ap') out.push({ key: 'mr', n: resist, kind });
  // tanks on the other team: armor penetration for what you deal with attacks
  const tanks = enemies.filter((p) => TANKS.has(norm(p.championName))).length;
  if (tanks >= 2 && armored < 2 && kind === 'ad' && me.position !== 'UTILITY') out.push({ key: 'armor', n: tanks, kind });
  // a marksman with no crit item yet
  if (me.position === 'BOTTOM' && kind === 'ad' && (Number(me.level) || 1) >= 9 && !haveAny(me, CRIT_IDS, CRIT_NAME)) out.push({ key: 'crit', kind });
  // what the other team deals: magic or physical
  const magic = enemies.filter((p) => AP_CHAMPS.has(norm(p.championName))).length;
  const physical = enemies.filter((p) => !AP_CHAMPS.has(norm(p.championName)) && !TANKS.has(norm(p.championName))).length;
  if (magic >= 4 && me.position !== 'UTILITY' && !haveAny(me, MR_IDS, MR_NAME)) out.push({ key: 'defMr', n: magic, kind });
  if (physical >= 4 && me.position !== 'UTILITY' && !haveAny(me, ARMOR_IDS, ARMOR_NAME)) out.push({ key: 'defArmor', n: physical, kind });
  if (!haveAny(me, BOOT_IDS, BOOT_NAME)) out.push({ key: 'boots', kind });
  if ((Number(me.scores?.wardScore) || 0) < 4 && me.position !== 'UTILITY' && (Number(data.gameData?.gameTime) || 0) > 600) out.push({ key: 'wards', kind });
  return out;
}

const base = (name) => String(name || '').split('#')[0].trim().toLowerCase();
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const fmt = (s, o) => s.replace(/\{(\w+)\}/g, (_, k) => o[k] ?? '');

const LINES = {
  es: {
    start: ['A jugar con {champ}. Yo me quedo quietecita mirando.', '{champ}, ¿no? Suerte, yo miro desde aquí sin gastar ni un frame. Si dudas con las compras, me preguntas.'],
    firstBlood: ['¡Primera sangre para ti!', 'Primera sangre. Empezamos fuertes.'],
    kill: ['{victim} fuera. Bien jugado.', 'Eliminaste a {victim}. Así se hace.', '{victim} al suelo.', 'Buen chico. {victim} fuera.', '{victim} fuera. Good boy.'],
    multi2: ['¡Doble!', '¡Doble! Good boy.', '¡Bam, bam! ¡Doble!'], multi3: ['¡Triple, qué barbaridad!', '¡Pum, pum, pum! ¡Triple!'], multi4: ['¡CUÁDRUPLE!', '¡Buum! ¡Cuádruple!'], multi5: ['¡PENTAKILL! No lo puedo creer.', '¡BUUUM! ¡PENTAKILL!'],
    death3: ['Van {n} muertes. Respira y juega un poquito más seguro, ¿sí?', '{n} muertes... inhala, exhala, sigue.'],
    death6: ['{n} muertes. A lo mejor toca esperar a tu equipo y farmear tranquilo.'],
    lvl6: ['Nivel 6: ya tienes el definitivo. Úsalo con cabeza.'],
    gold: ['Llevas {gold} de oro sin gastar. Un recall no te mataría.', '{gold} de oro en el bolsillo... ¿tienda?'],
    antiheal: ['{champ} se cura demasiado y no llevas anti-curación. Piensa en {items}.', 'Ojo con {champ}: cura mucho y tú sin anti-curación. {items} te ayudaría.'],
    armor: ['Hay {n} rivales con mucha armadura. Te iría bien penetración de armadura ({items}).'],
    mr: ['Hay {n} rivales con mucha resistencia mágica. Te iría bien penetración mágica ({items}).'],
    crit: ['Vas de tirador y todavía sin críticos. Piensa en {items}.', 'Sin objetos de crítico a estas alturas... {items} te darían mucho más daño.'],
    defMr: ['{n} rivales hacen daño mágico y no llevas resistencia mágica. Mira {items}.'],
    defArmor: ['{n} rivales hacen daño físico. Algo de armadura te ayudaría: {items}.'],
    boots: ['Todavía sin botas. Pasa por la tienda cuando puedas.', 'Sin botas a estas alturas: vas lento. Cómpralas en tu próximo recall.'],
    wards: ['Muy poca visión en el mapa. Un guardián de control en la tienda no te vendría mal.', 'Casi no has puesto guardianes. Un poco de visión salva partidas.'],
    dragonSoon: ['El dragón nace en unos 30 segundos. Ve moviéndote.', 'Dragón a punto de aparecer. ¿Hay visión en el río?'],
    baronSoon: ['El Barón está por aparecer. Cuidado con las peleas cerca del foso.', 'Barón en unos segundos. Ojo con la visión ahí.'],
    dragonMine: ['Dragón para tu equipo.'], dragonTheirs: ['Se llevaron el dragón.'],
    baronMine: ['¡Barón para ustedes! A presionar.'], baronTheirs: ['Barón para el otro equipo. Cuidado ahí.'],
    ace: ['¡ACE! Equipo enemigo eliminado.', '¡Buuum! ¡ACE!'], aceTheirs: ['Ace en contra. Toca defender.'],
    streak3: ['{n} seguidas sin morir. ¡Vas imparable!', 'Racha de {n}. Que no se te suba, pero qué bien.'], streak5: ['¡{n} seguidas! Eres una máquina.'],
    turretMine: ['Torre rival al suelo.', 'Cayó una torre enemiga. A seguir presionando.'], turretTheirs: ['Cayó una de tus torres. Ojo con el mapa.'],
    inhibMine: ['¡Inhibidor enemigo destruido! Hay que cerrar esto.'], inhibTheirs: ['Cayó uno de tus inhibidores. Toca defender la base.'],
    heraldMine: ['Heraldo para tu equipo. Úsenlo bien.'], heraldTheirs: ['Se llevaron el Heraldo.'],
    lvl11: ['Nivel 11: el definitivo sube de rango.'], lvl16: ['Nivel 16: tu definitivo ya está al máximo.'],
    itemDone: ['Objeto completo: {item}. Se nota el progreso.', '{item} listo. Vas armando la build.'],
    csGood: ['Llevas {cs} súbditos ({pm} por minuto). Muy buen farmeo.'], csBad: ['Llevas {cs} súbditos ({pm} por minuto). Si puedes, farmea un poco más.'],
    long30: ['Treinta minutos de partida: una pelea mal tomada y se acaba.'], long40: ['Cuarenta minutos... esto ya es una maratón. Cuidado con cada pelea.'],
    enemyFed: ['{champ} va muy adelantado ({kills} bajas). Juega con cuidado cerca de él.', 'Ojo con {champ}: lleva {kills} kills.'],
    deadShop: ['Estás muerto {n} s con {gold} de oro. Puedes comprar mientras revives, o dime «qué compro».'],
    win: ['¡Victoria! Bien jugado.', 'Ganaron. Me gusta.', 'Victoria. Buen chico.', '¡Ganaste! Good boy.'], lose: ['Derrota. Pasa; la siguiente es mejor.', 'Perdieron esta. Respira y a otra.'],
  },
  en: {
    start: ['Playing {champ}. I stay quiet and watch.', '{champ}, nice. Good luck, I am watching from here without using a frame. Ask me if you doubt your shopping.'],
    firstBlood: ['First blood is yours!', 'First blood. Strong start.'],
    kill: ['{victim} down. Nicely done.', 'You took out {victim}.', '{victim} is on the floor.', 'Good boy. {victim} is down.'],
    multi2: ['Double kill!', 'Bam, bam! Double kill!'], multi3: ['Triple kill, wow!', 'Boom, boom, boom! Triple!'], multi4: ['QUADRA KILL!', 'Boom! Quadra kill!'], multi5: ['PENTAKILL! I cannot believe it.', 'BOOOM! PENTAKILL!'],
    death3: ['{n} deaths so far. Breathe and play a bit safer, yes?', '{n} deaths... inhale, exhale, keep going.'],
    death6: ['{n} deaths. Maybe wait for your team and farm calmly.'],
    lvl6: ['Level 6: your ultimate is up. Use it wisely.'],
    gold: ['{gold} gold unspent. A recall would not kill you.', '{gold} gold in your pocket... shop?'],
    antiheal: ['{champ} heals way too much and you have no anti-heal. Think about {items}.', 'Watch out for {champ}: heavy healing and you have none to cut it. {items} would help.'],
    armor: ['{n} enemies are stacking armor. Armor penetration would help ({items}).'],
    mr: ['{n} enemies are stacking magic resist. Magic penetration would help ({items}).'],
    crit: ['You are a marksman with no crit items yet. Think about {items}.', 'No crit items by now... {items} would give you a lot more damage.'],
    defMr: ['{n} enemies deal magic damage and you have no magic resist. Look at {items}.'],
    defArmor: ['{n} enemies deal physical damage. Some armor would help: {items}.'],
    boots: ['Still no boots. Stop by the shop when you can.', 'No boots by now: you are slow. Buy them on your next recall.'],
    wards: ['Very little vision on the map. A control ward from the shop would not hurt.', 'You have barely placed wards. A little vision saves games.'],
    dragonSoon: ['The dragon spawns in about 30 seconds. Start moving.', 'Dragon about to spawn. Do we have vision in the river?'],
    baronSoon: ['Baron is about to spawn. Careful with fights near the pit.', 'Baron in a few seconds. Watch the vision there.'],
    dragonMine: ['Dragon for your team.'], dragonTheirs: ['They took the dragon.'],
    baronMine: ['Baron is yours! Push!'], baronTheirs: ['Baron to the other team. Careful there.'],
    ace: ['ACE! Enemy team wiped.', 'BOOOM! ACE!'], aceTheirs: ['Ace against you. Time to defend.'],
    streak3: ['{n} in a row without dying. Unstoppable!', 'A streak of {n}. Do not let it go to your head, but wow.'], streak5: ['{n} in a row! You are a machine.'],
    turretMine: ['Enemy turret down.', 'An enemy turret fell. Keep the pressure on.'], turretTheirs: ['One of your turrets fell. Watch the map.'],
    inhibMine: ['Enemy inhibitor destroyed! Close this out.'], inhibTheirs: ['One of your inhibitors fell. Time to defend the base.'],
    heraldMine: ['Herald for your team. Use it well.'], heraldTheirs: ['They took the Herald.'],
    lvl11: ['Level 11: your ultimate ranks up.'], lvl16: ['Level 16: your ultimate is maxed.'],
    itemDone: ['Item complete: {item}. Progress shows.', '{item} done. The build is coming together.'],
    csGood: ['{cs} minions ({pm} per minute). Great farming.'], csBad: ['{cs} minions ({pm} per minute). If you can, farm a bit more.'],
    long30: ['Thirty minutes in: one bad fight and it is over.'], long40: ['Forty minutes... this is a marathon. Careful with every fight.'],
    enemyFed: ['{champ} is way ahead ({kills} kills). Careful near him.', 'Watch out for {champ}: {kills} kills.'],
    deadShop: ['You are dead for {n} s with {gold} gold. You can shop while you respawn, or ask me "what should I buy".'],
    win: ['Victory! Well played.', 'You won. I like it.', 'Victory. Good boy.'], lose: ['Defeat. It happens; the next one is better.', 'You lost this one. Breathe and go again.'],
  },
};

// her tone when you asked for "coqueta" (config persona): some of her remarks have a flirty version, used most of the time
const isFlirty = (persona) => /coquet|flirt|seduc|p[ií]cara|picante|rom[aá]ntic/i.test(String(persona || ''));
const FLIRT = {
  es: {
    start: ['{champ}... qué buena elección. Yo te miro jugar desde aquí, calladita. Y si me necesitas, ya sabes.', 'A jugar con {champ}. Me encanta verte concentrado.'],
    firstBlood: ['Primera sangre. Me encanta cuando empiezas así.'],
    kill: ['{victim} fuera y ni te despeinas. Me gusta.', 'Eliminaste a {victim}. Sigue así y me vas a enamorar.', '{victim} al suelo. Qué manera de jugar.', '{victim} fuera. Good boy.', 'Buen chico. {victim} al suelo.'],
    multi2: ['¡Doble! Uy, qué intensidad.'], multi3: ['¡Triple! Me tienes sin palabras.'], multi4: ['¡CUÁDRUPLE! Ven aquí, tú.'], multi5: ['¡PENTAKILL! Me muero. Eres increíble.'],
    streak3: ['{n} seguidas. Estás que no hay quien te pare.'], streak5: ['¡{n} seguidas! Dime que no estás presumiendo para mí.'],
    death3: ['{n} muertes... ven, respira conmigo y volvemos a la carga.'], death6: ['{n} muertes. Tranquilo, yo sigo creyendo en ti.'],
    lvl6: ['Nivel 6. Ya tienes el definitivo: úsalo como tú sabes.'],
    gold: ['{gold} de oro guardado... gástalo en ti, que te lo mereces.'],
    win: ['¡Ganamos! Te mereces un premio... ya lo pensaré.', 'Victoria. Qué orgullo de ti.', 'Victoria. Good boy.'], lose: ['Perdimos esta, pero igual sigues siendo lo mejor de mi pantalla.', 'Derrota. Ven, que la próxima la ganamos juntos.'],
  },
  en: {
    start: ['{champ}... nice pick. I will watch you play from here, quietly. And if you need me, you know.', 'Playing {champ}. I love watching you focus.'],
    firstBlood: ['First blood. I love it when you start like that.'],
    kill: ['{victim} down and you did not even mess up your hair. I like it.', 'You took out {victim}. Keep that up and I will fall for you.', '{victim} on the floor. What a way to play.', '{victim} is down. Good boy.'],
    multi2: ['Double kill! Mmm, so intense.'], multi3: ['Triple kill! You leave me speechless.'], multi4: ['QUADRA KILL! Come here, you.'], multi5: ['PENTAKILL! I am dying. You are incredible.'],
    streak3: ['{n} in a row. Nobody can stop you.'], streak5: ['{n} in a row! Tell me you are not showing off for me.'],
    death3: ['{n} deaths... come, breathe with me and we go again.'], death6: ['{n} deaths. Easy, I still believe in you.'],
    lvl6: ['Level 6. You have your ultimate: use it the way you do.'],
    gold: ['{gold} gold saved up... spend it on yourself, you deserve it.'],
    win: ['We won! You deserve a prize... I will think of one.', 'Victory. So proud of you.'], lose: ['We lost this one, but you are still the best thing on my screen.', 'Defeat. Come on, we win the next one together.'],
  },
};

// a few more with an English phrase in them ("let's go"): talk.js speaks those with an English voice
const MORE_ES = {
  start: ['A jugar con {champ}. Let\'s go.'], kill: ['Nice one. {victim} fuera.'], firstBlood: ['Primera sangre. Nice one.'], multi2: ['¡Doble! Nice one.'],
  streak3: ['{n} seguidas. Let\'s go.'], death3: ['{n} muertes. Respira.'], death6: ['Respira. Un punto a la vez.'], lvl6: ['Nivel 6. Let\'s go.'],
  ace: ['¡ACE! Let\'s go.'], win: ['Victoria. Well done.', 'Victoria. That\'s my boy.'], lose: ['Derrota. Next one.'],
};
for (const [key, extra] of Object.entries(MORE_ES)) { LINES.es[key]?.push(...extra); FLIRT.es[key]?.push(...extra); }

// what she shouts at each kill of yours, a short onomatopoeia (config lolShout), on top of her remarks: not more than one every few seconds
// the remarks said with more energy (faster and higher, and louder): kills in a row, a pentakill, an ace, victory...
const EXCITED = new Set(['firstBlood', 'multi2', 'multi3', 'multi4', 'multi5', 'ace', 'streak3', 'streak5', 'win']);
const SHOUT = {
  es: ['¡Pum!', '¡Bam!', '¡Zas!', '¡Toma!', '¡Pow!', '¡Buum!'],
  en: ['Boom!', 'Bam!', 'Pow!', 'Gotcha!', 'Zap!'],
};

// { getCfg, lang(), onSay({ line, face }) }  ->  { setPresent(bool), context(), active() }
function start({ getCfg, lang, onSay }) {
  let present = false;
  let timer = null;
  let busy = false;
  let last = null;          // the last full read of the match
  let lastEventId = -1;
  let spoke = 0;
  let announced = false;
  let sixSaid = false;
  let lastDeaths = 0;
  let lastGold = 0;
  let muteLogged = false;
  let lastShout = 0;
  let streak = 0;           // your kills in a row without dying
  let seenItems = null;     // the items you had (item ids), to notice a new finished one
  const said = new Set();   // one-time remarks of this match (level 11, minute 30, a fed enemy...)
  let deadSaid = false;
  let nextDragonAt = 300;    // when the next dragon / the baron appear (seconds of the match), to warn a little before
  let nextBaronAt = 1200;
  const lastHint = {};      // when she last said each rule's hint (they come back no sooner than every 6 minutes)
  const say = (key, vars = {}, { force = false, face = 'smug' } = {}) => {
    const now = Date.now();
    const cfg = getCfg();
    if (cfg.lolSafe !== false && BANNED.has(key)) return false;
    if (cfg.lolMode !== true || cfg.dnd === true) {
      if (!muteLogged) { muteLogged = true; log(`remarks are off: ${cfg.dnd === true ? 'do not disturb is on' : 'game mode is off (say "activa el modo juego")'}`); }
      return false; // (her remarks only with the game mode on)
    }
    if (!force && now - spoke < (Number(cfg.lolGap) > 0 ? Number(cfg.lolGap) * 1000 : MIN_GAP_MS)) return false;
    let pool = (LINES[lang()] || LINES.es)[key];
    const flirt = (FLIRT[lang()] || FLIRT.es)[key];
    let flirty = false;
    if (flirt && isFlirty(cfg.persona) && Math.random() < 0.65) { pool = flirt; flirty = true; }
    if (!pool) return false;
    spoke = now;
    log(`remark: ${key}`);
    onSay({ line: fmt(pick(pool), vars), flirt: flirty, excited: EXCITED.has(key), face, voice: cfg.lolSpeak !== false, clip: CLIP[key] || 'idle', sfx: SFX[key] || '', sfxOn: cfg.lolSfx !== false, sfxVol: Math.min(1, Math.max(0.05, Number(cfg.lolSfxVol) || 0.5)), clips: cfg.lolClips !== false, soft: cfg.lolVoiceSoft === true, level: Math.min(1, Math.max(0.1, Number(cfg.lolVolume) || 0.4)) });
    return true;
  };

  // a kill of yours and no remark this time (the gap): at least the short shout, with the kill sound and no GIF
  const shout = () => {
    const now = Date.now();
    const cfg = getCfg();
    if (cfg.lolMode !== true || cfg.dnd === true || cfg.lolShout === false || now - lastShout < 6000) return false;
    lastShout = now;
    log('remark: shout');
    onSay({ line: pick(SHOUT[lang()] || SHOUT.es), face: 'laugh', flirt: false, sfx: 'kill', sfxOn: cfg.lolSfx !== false, sfxVol: Math.min(1, Math.max(0.05, Number(cfg.lolSfxVol) || 0.5)), clip: '', clips: false, shout: true, voice: cfg.lolSpeak !== false, soft: cfg.lolVoiceSoft === true, level: Math.min(1, Math.max(0.1, Number(cfg.lolVolume) || 0.4)) });
    return true;
  };

  // the match summed up when it ends (what happened, never what to do): champion, K/D/A, farm, minutes, and a joke
  let recapped = false;
  const recap = (result) => {
    if (recapped || !last) return;
    const cfg = getCfg();
    const { me, time } = last;
    if (cfg.lolMode !== true || cfg.dnd === true || time < 240) return;
    recapped = true;
    const k = Number(me.scores?.kills) || 0;
    const d = Number(me.scores?.deaths) || 0;
    const a = Number(me.scores?.assists) || 0;
    const cs = Number(me.scores?.creepScore) || 0;
    const min = Math.max(1, Math.round(time / 60));
    const es = lang() !== 'en';
    const kda = d === 0 ? k + a : (k + a) / d;
    const quip = es
      ? (d >= 10 ? 'Hoy la muerte te quiso mucho.' : kda >= 4 ? 'Jugaste fino, ¿eh?' : d === 0 ? 'Sin morir ni una vez. Presumido.' : k >= 10 ? 'Qué manera de repartir.' : result === 'Win' ? 'Una más para la colección.' : 'Esas pasan. La próxima sale mejor.')
      : (d >= 10 ? 'Death really liked you today.' : kda >= 4 ? 'You played clean, huh?' : d === 0 ? 'Not a single death. Show-off.' : k >= 10 ? 'What a way to hand it out.' : result === 'Win' ? 'One more for the collection.' : 'These happen. The next one goes better.');
    const head = result === 'Win' ? (es ? 'Victoria' : 'Victory') : result === 'Lose' ? (es ? 'Derrota' : 'Defeat') : (es ? 'Fin de la partida' : 'Match over');
    log(`recap: ${me.championName} ${k}/${d}/${a} ${cs} cs ${min} min ${result || '?'}`);
    onSay({ line: `${head} · ${me.championName} ${k}/${d}/${a} · ${cs} CS · ${min} min. ${quip}`, flirt: false, excited: false, face: result === 'Win' ? 'laugh' : 'smug', voice: cfg.lolSpeak !== false, clip: result === 'Win' ? 'risa' : 'idle', sfx: '', sfxOn: false, clips: cfg.lolClips !== false, soft: cfg.lolVoiceSoft === true, level: Math.min(1, Math.max(0.1, Number(cfg.lolVolume) || 0.4)), recap: true });
  };

  const reset = () => { recapped = false; last = null; lastEventId = -1; announced = false; sixSaid = false; lastDeaths = 0; lastGold = 0; muteLogged = false; streak = 0; seenItems = null; said.clear(); deadSaid = false; nextDragonAt = 300; nextBaronAt = 1200; for (const k of Object.keys(lastHint)) delete lastHint[k]; };

  const handle = (data) => {
    const ap = data.activePlayer || {};
    const myName = base(ap.riotId || ap.summonerName || ap.riotIdGameName);
    const players = Array.isArray(data.allPlayers) ? data.allPlayers : [];
    const me = players.find((p) => base(p.riotId) === myName || base(p.summonerName) === myName || base(p.riotIdGameName) === myName);
    if (!me) return;
    const time = Number(data.gameData?.gameTime) || 0;
    const isMe = (n) => base(n) === myName;
    const teamOf = (n) => players.find((p) => base(p.riotId) === base(n) || base(p.summonerName) === base(n) || base(p.riotIdGameName) === base(n))?.team;
    const wasFirst = !last;
    last = { data, me, time };
    const events = Array.isArray(data.events?.Events) ? data.events.Events : [];

    if (wasFirst) {
      // joining a match already on: what happened before is not commented
      if (time > 45) lastEventId = events.reduce((m, e) => Math.max(m, Number(e.EventID) || 0), -1);
      lastDeaths = Number(me.scores?.deaths) || 0;
      sixSaid = (Number(me.level) || 1) >= 6;
      log(`match read: ${me.championName} (${me.team}) · ${players.length} players · ${time.toFixed(0)} s`);
    }
    if (!announced && time < 600) { announced = true; say('start', { champ: me.championName }, { force: true }); }

    for (const e of events) {
      const id = Number(e.EventID);
      if (!Number.isFinite(id) || id <= lastEventId) continue;
      lastEventId = id;
      const name = e.EventName;
      if (name === 'FirstBlood' && isMe(e.Recipient)) say('firstBlood', {}, { force: true });
      else if (name === 'ChampionKill' && isMe(e.VictimName)) streak = 0;
      else if (name === 'ChampionKill' && isMe(e.KillerName)) {
        streak += 1;
        const victim = players.find((p) => base(p.riotId) === base(e.VictimName) || base(p.summonerName) === base(e.VictimName))?.championName || e.VictimName;
        const spoken = (streak === 5 || streak === 3 || streak === 7) ? (say(streak === 3 ? 'streak3' : 'streak5', { n: streak }, { face: 'laugh' }) || say('kill', { victim })) : say('kill', { victim });
        if (!spoken) shout();
      }
      else if (name === 'TurretKilled' || name === 'InhibKilled') {
        const t = /_T(\d)_/.exec(String(e.TurretKilled || e.InhibKilled || ''))?.[1]; // T1 is the blue side (ORDER), T2 the red one (CHAOS)
        const side = t === '1' ? 'ORDER' : t === '2' ? 'CHAOS' : '';
        if (side) say(`${name === 'TurretKilled' ? 'turret' : 'inhib'}${side === me.team ? 'Theirs' : 'Mine'}`, {});
      }
      else if (name === 'HeraldKill' && teamOf(e.KillerName)) say(teamOf(e.KillerName) === me.team ? 'heraldMine' : 'heraldTheirs', {});
      else if (name === 'Multikill' && isMe(e.KillerName)) say(`multi${Math.min(5, Number(e.KillStreak) || 2)}`, {}, { force: true, face: 'laugh' });
      else if (name === 'DragonKill') { nextDragonAt = (Number(e.EventTime) || time) + 300; say(teamOf(e.KillerName) === me.team ? 'dragonMine' : 'dragonTheirs', {}); }
      else if (name === 'BaronKill') { nextBaronAt = (Number(e.EventTime) || time) + 360; say(teamOf(e.KillerName) === me.team ? 'baronMine' : 'baronTheirs', {}); }
      else if (name === 'Ace') say(e.AcingTeam === me.team ? 'ace' : 'aceTheirs', {}, { force: true });
      else if (name === 'GameEnd') { say(e.Result === 'Win' ? 'win' : 'lose', {}, { force: true, face: e.Result === 'Win' ? 'laugh' : 'aside' }); setTimeout(() => recap(e.Result), 6000); }
    }

    const gold = Math.floor(Number(ap.currentGold) || 0);
    const deaths = Number(me.scores?.deaths) || 0;
    if (deaths > lastDeaths) {
      if (deaths === 3 || deaths === 5) say('death3', { n: deaths }, { face: 'aside' });
      else if (deaths === 7 || deaths === 10) say('death6', { n: deaths }, { face: 'aside' });
    }
    lastDeaths = deaths;
    if (!sixSaid && (Number(me.level) || 1) >= 6) { sixSaid = true; say('lvl6'); }
    for (const lv of [11, 16]) { if ((Number(me.level) || 1) >= lv && !said.has(`lvl${lv}`)) { said.add(`lvl${lv}`); say(`lvl${lv}`); } }
    // a finished item (the first time you have it)
    const have = (Array.isArray(me.items) ? me.items : []).filter((i) => Number(i.itemID));
    if (!seenItems) seenItems = new Set(have.map((i) => Number(i.itemID)));
    for (const i of have) {
      if (seenItems.has(Number(i.itemID))) continue;
      seenItems.add(Number(i.itemID));
      if (Number(i.price) >= 2200) say('itemDone', { item: i.displayName });
    }
    // farming, at minute 10 and 20 (not for the support)
    const cs = Number(me.scores?.creepScore) || 0;
    for (const m of [10, 20]) {
      if (time >= m * 60 && !said.has(`cs${m}`) && !wasFirst) {
        said.add(`cs${m}`);
        const pm = Math.round((cs / (time / 60)) * 10) / 10;
        if (me.position !== 'UTILITY' && me.position !== 'JUNGLE' && me.position !== 'NONE' && time < m * 60 + 120) {
          if (pm >= 8) say('csGood', { cs, pm });
          else if (pm < 5) say('csBad', { cs, pm });
        }
      }
    }
    for (const m of [30, 40]) { if (time >= m * 60 && !said.has(`long${m}`)) { said.add(`long${m}`); if (time < m * 60 + 120) say(`long${m}`); } }
    // a rival far ahead
    if (time > 480) {
      for (const p of players) {
        const k = Number(p.scores?.kills) || 0;
        const d = Number(p.scores?.deaths) || 0;
        if (p.team !== me.team && k >= 8 && k - d >= 7 && !said.has(`fed:${p.championName}`)) { said.add(`fed:${p.championName}`); say('enemyFed', { champ: p.championName, kills: k }); break; }
      }
    }
    // dead for a while with gold: you can shop while you respawn
    if (me.isDead && !deadSaid && Number(me.respawnTimer) >= 20 && gold >= 1000) { deadSaid = true; say('deadShop', { n: Math.round(me.respawnTimer), gold }); }
    if (!me.isDead) deadSaid = false;
    if (gold >= GOLD_AT && !me.isDead && Date.now() - lastGold > GOLD_EVERY) { if (say('gold', { gold })) lastGold = Date.now(); }
    // the dragon and the baron are about to appear (only in the normal map): a warning half a minute before
    if (data.gameData?.gameMode === 'CLASSIC' && !me.isDead) {
      if (time >= nextDragonAt - 35 && time < nextDragonAt - 5 && !said.has(`dragon:${nextDragonAt}`)) { said.add(`dragon:${nextDragonAt}`); say('dragonSoon', {}); }
      if (time >= nextBaronAt - 40 && time < nextBaronAt - 5 && !said.has(`baron:${nextBaronAt}`)) { said.add(`baron:${nextBaronAt}`); say('baronSoon', {}); }
    }
    // what to buy, by the rules: from minute 8, never while you are dead, one hint at a time
    if (getCfg().lolSafe === false && time > 480 && !me.isDead) {
      for (const h of analyze(data, me).sort(() => Math.random() - 0.5)) { // (in a random order: not always the same one first)
        if (Date.now() - (lastHint[h.key] || 0) < HINT_EVERY) continue;
        if (say(h.key, { champ: h.champ, n: h.n, items: itemsFor(h, lang()) }, { face: 'aside' })) lastHint[h.key] = Date.now();
        break;
      }
    }
  };

  const look = async () => {
    if (busy) return;
    busy = true;
    try {
      const data = await api('allgamedata');
      if (data) handle(data);
      else if (last) { log('the match data stopped answering'); recap(''); reset(); }
    } catch (err) {
      log(`error: ${err.message}`);
    } finally { busy = false; }
  };

  return {
    // the game's process is there or not: the look runs only while it is
    setPresent(on) {
      if (on === present) return;
      present = Boolean(on);
      if (present) { timer = setInterval(look, EVERY_MS); timer.unref?.(); look(); log('League of Legends is running: following the match'); }
      else { clearInterval(timer); timer = null; reset(); log('League of Legends closed'); }
    },
    active: () => Boolean(last),
    // what the game says, for her small model: you, your items, the other team
    context() {
      if (!last || getCfg().lolSafe !== false) return null; // (safe mode: no build advice during a match)
      const { data, me, time } = last;
      const names = (p) => (Array.isArray(p.items) ? p.items.map((i) => i.displayName).filter(Boolean) : []);
      const kda = (p) => `${p.scores?.kills ?? 0}/${p.scores?.deaths ?? 0}/${p.scores?.assists ?? 0}`;
      const enemies = (data.allPlayers || []).filter((p) => p.team !== me.team);
      const mates = (data.allPlayers || []).filter((p) => p.team === me.team && p !== me);
      const gold = Math.floor(Number(data.activePlayer?.currentGold) || 0);
      return {
        champion: me.championName, level: me.level, gold, minutes: Math.floor(time / 60),
        text: [
          `Game: ${data.gameData?.gameMode || '?'}, minute ${Math.floor(time / 60)}.`,
          `Me: ${me.championName}${me.position ? ` (${me.position})` : ''}, level ${me.level}, KDA ${kda(me)}, ${gold} gold unspent. Items: ${names(me).join(', ') || 'none'}.`,
          `My team: ${mates.map((p) => `${p.championName} ${kda(p)}`).join('; ') || '-'}.`,
          ...analyze(data, me).map((h) => `Rule: ${({ antiheal: `${h.champ} heals a lot and I have no anti-heal`, armor: `${h.n} enemies are tanks or stack armor`, mr: `${h.n} enemies stack magic resist`, crit: 'I am a marksman with no crit item', defMr: `${h.n} enemies deal magic damage and I have no magic resist`, defArmor: `${h.n} enemies deal physical damage and I have no armor`, boots: 'I have no boots', wards: 'my vision score is low' })[h.key]}${itemsFor(h) ? ` (suggest ${itemsFor(h)})` : ''}.`),
          `Enemy team: ${enemies.map((p) => `${p.championName}${p.position ? ` (${p.position})` : ''} ${kda(p)} items: ${names(p).join(', ') || 'none'}`).join('; ') || '-'}.`,
        ].join('\n'),
      };
    },
  };
}

module.exports = { start, api, analyze, note: (t) => log(`ui: ${String(t).slice(0, 300)}`) };
