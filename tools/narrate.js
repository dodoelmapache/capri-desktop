'use strict';

// Makes the narration of docs/narration.json with HER voice (the one in her settings: ElevenLabs if you set it up, else the free Edge neural voice).
// It runs on your PC and reads your own config.json; nothing is sent anywhere except to the voice service she already uses.
//   node tools\narrate.js [output folder]      (default: .\voz)  ->  es-01.mp3 ... en-09.mp3

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const tts = require('../src/main/tts');

function loadConfig() {
  const base = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  for (const dir of ['Capri', 'capri-desktop']) {
    const file = path.join(base, dir, 'config.json');
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  console.warn('No config.json found: using her default free voice.');
  return {};
}

(async () => {
  const cfg = loadConfig();
  const script = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', 'narration.json'), 'utf8'));
  const out = path.resolve(process.argv[2] || 'voz');
  fs.mkdirSync(out, { recursive: true });
  for (const language of Object.keys(script)) {
    for (const [i, text] of script[language].entries()) {
      const file = path.join(out, `${language}-${String(i + 1).padStart(2, '0')}.mp3`);
      const audio = await tts.speak({ ...cfg, ttsProvider: cfg.ttsProvider || 'auto' }, { text, language });
      fs.writeFileSync(file, audio);
      console.log('ok', file);
    }
  }
  console.log('Done. Tell Claude the folder is ready.');
  process.exit(0);
})().catch((err) => { console.error('Failed:', err.message); process.exit(1); });
