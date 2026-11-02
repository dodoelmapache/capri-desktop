import { createApp } from './chatwin-app.js';
import { Voice } from './voice.js';

const cw = window.cw;
const info = await cw.info();
// her sounds: the same synthesized cues (and your own files in her sounds folder) as everywhere else she is
const voice = new Voice();
voice.configure({ muted: info.muted, volume: info.volume });
cw.listSounds?.().then((list) => list?.length && voice.loadCustom(list)).catch(() => {});
createApp({ doc: document, cw, info, voice });
