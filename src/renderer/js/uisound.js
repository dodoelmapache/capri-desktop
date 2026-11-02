// What each thing you do in her chats sounds like: her own synthesized cues (voice.js), the same ones she uses everywhere
// else, and your own files in her sounds folder replace them like they replace any cue. Used by her bubble and her window.

export const UI = {
  press: ['tick', { gain: 2 }],        // a button: a small click with a body to it
  on: ['blip', { mood: 'alert' }],     // something lit up: a higher chirp
  off: ['blip', { mood: 'error' }],    // ...and went out: a lower one
  open: ['rise'],                      // a menu opens: the quick upward whoosh
  close: ['tick', { gain: 1 }],        // ...and closes: a light tick
  switch: ['teleport-in'],             // going to another conversation: she arrives (the zap of her teleporting)
  fresh: ['teleport-in'],              // a new conversation
  window: ['possess'],                 // the big window: the three falling chirps of her taking a window over
  send: ['tick', { gain: 2 }],         // your message goes
  go: ['rise'],                        // a job goes out to Claude
  image: ['star'],                     // a picture is ready (or asked for): her satellite ping
  drop: ['land'],                      // a file lands in her hands: the soft digital thump
  delete: ['bolt', { soft: true }],    // a conversation burned: small hacking sparks
  warn: ['alert'],
  done: ['done'],                      // Claude finished: the bright arpeggio
  error: ['error'],
  hello: ['hello'],
};

export function ui(voice, kind) {
  if (!voice) return;
  const [cue, opts] = UI[kind] || UI.press;
  try {
    voice.play(cue, opts || {});
  } catch { /* no audio yet (before the first click) or no sound device: silence, never an error */ }
}
