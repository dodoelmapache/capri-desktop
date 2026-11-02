// Screenshots and screen clips (main/capture.js does the saving).
//  shot()                         a PNG of her screen, saved: { ok, path }
//  start({ seconds }) / stop()    records the screen (and the PC's sound) until stop() or the time is up; onDone gets { ok, path, seconds }
// She is left out of the picture (her window is excluded from the capture while it runs).

const HARD_MAX = 600; // seconds, whatever is asked
const pickMime = () => {
  const list = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  return list.find((m) => globalThis.MediaRecorder?.isTypeSupported?.(m)) || '';
};

export class Capturer {
  constructor({ host, getCfg }) {
    Object.assign(this, { host, getCfg });
    this.rec = null;       // the clip in progress
    this.onDone = null;    // (res) => void, set by whoever shows the result
  }

  get recording() { return Boolean(this.rec); }

  get elapsed() { return this.rec ? Math.round((performance.now() - this.rec.began) / 1000) : 0; }

  async shot() {
    return this.host.captureShot().catch((err) => ({ ok: false, error: err.message }));
  }

  async copy(file) { // { ok, error? }
    const r = await this.host.captureCopy(file).catch((err) => ({ ok: false, error: String(err?.message || err) }));
    return r && typeof r === 'object' ? r : { ok: Boolean(r) };
  }

  async start({ seconds = 0, withCapri = false } = {}) {
    if (this.rec) return { ok: false, error: 'busy' };
    const cfg = this.getCfg() || {};
    const limit = Math.min(HARD_MAX, Math.max(3, Math.round(seconds || cfg.clipMax || 120)));
    const src = await this.host.captureSource({ withCapri: Boolean(withCapri) }).catch(() => null);
    if (!src?.ok) return { ok: false, error: src?.error || 'nosource' };
    const open = async (withAudio) => navigator.mediaDevices.getUserMedia({
      audio: withAudio ? { mandatory: { chromeMediaSource: 'desktop' } } : false,
      video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: src.id, maxFrameRate: 30 } },
    });
    let stream;
    try {
      try {
        stream = await open(cfg.clipAudio !== false); // with the PC's sound
      } catch {
        stream = await open(false); // (no sound to take: the picture alone)
      }
    } catch (err) {
      await this.host.captureClipEnd('', false).catch(() => {});
      return { ok: false, error: err.message || 'denied' };
    }
    // your voice too (clipMic): the microphone and the PC's sound are mixed into one track
    let mixCtx = null;
    let micStream = null;
    if (cfg.clipMic === true) {
      try {
        micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: true }, video: false });
        mixCtx = new AudioContext();
        const dest = mixCtx.createMediaStreamDestination();
        mixCtx.createMediaStreamSource(micStream).connect(dest);
        if (stream.getAudioTracks().length) mixCtx.createMediaStreamSource(new MediaStream(stream.getAudioTracks())).connect(dest);
        stream = new MediaStream([...stream.getVideoTracks(), ...dest.stream.getAudioTracks()]);
      } catch {
        micStream?.getTracks().forEach((t) => t.stop());
        micStream = null;
        mixCtx?.close().catch(() => {});
        mixCtx = null; // (no microphone to take: the clip goes on without your voice)
      }
    }
    const mime = pickMime();
    const ext = /mp4/.test(mime) ? 'mp4' : 'webm';
    const file = await this.host.captureClipStart(ext).catch(() => null);
    if (!file?.ok) {
      stream.getTracks().forEach((t) => t.stop());
      await this.host.captureClipEnd('', false).catch(() => {});
      return { ok: false, error: file?.error || 'file' };
    }
    const recorder = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: 6_000_000 });
    const rec = { recorder, stream, id: file.id, path: file.path, mixCtx, micStream, began: performance.now(), writes: Promise.resolve(), bytes: 0, limit, timer: 0 };
    recorder.ondataavailable = (e) => {
      if (!e.data?.size) return;
      rec.bytes += e.data.size;
      rec.writes = rec.writes.then(async () => this.host.captureClipChunk(rec.id, await e.data.arrayBuffer())).catch(() => {});
    };
    recorder.onstop = () => this.finish(rec);
    stream.getVideoTracks()[0].addEventListener('ended', () => this.stop()); // (the screen went away)
    recorder.start(1000);
    rec.timer = setTimeout(() => this.stop(), limit * 1000);
    this.rec = rec;
    return { ok: true, limit };
  }

  stop() {
    const rec = this.rec;
    if (!rec) return false;
    clearTimeout(rec.timer);
    try { if (rec.recorder.state !== 'inactive') rec.recorder.stop(); else this.finish(rec); } catch { this.finish(rec); }
    return true;
  }

  async finish(rec) {
    if (this.rec !== rec) return;
    this.rec = null;
    clearTimeout(rec.timer);
    rec.stream.getTracks().forEach((t) => t.stop());
    rec.micStream?.getTracks().forEach((t) => t.stop());
    rec.mixCtx?.close().catch(() => {});
    await rec.writes;
    const res = await this.host.captureClipEnd(rec.id, rec.bytes > 1000).catch(() => ({ ok: false }));
    this.onDone?.({ ...res, seconds: Math.round((performance.now() - rec.began) / 1000) });
  }
}
