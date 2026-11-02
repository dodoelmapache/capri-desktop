// Picture tools on this PC, no Claude and no cloud: convert PNG / WebP / JPG, make it lighter (fewer bytes) or smaller (fewer pixels).
// The picture is decoded and re-encoded by Chromium itself (canvas), so no program has to be installed. The original is never touched:
// the result is a new file next to it.

const MIME = { png: 'image/png', webp: 'image/webp', jpg: 'image/jpeg' };

// opts: { fmt: 'png'|'webp'|'jpg' (default: keep), maxSide: px (0 = keep), quality: 0..1 }
export async function convert(host, file, opts = {}) {
  const read = await host.imgRead(file);
  if (!read?.ok) return { ok: false, error: read?.error || 'cannot read it' };
  const from = (/\.([a-z0-9]+)$/i.exec(file)?.[1] || 'png').toLowerCase().replace('jpeg', 'jpg');
  const fmt = MIME[opts.fmt] ? opts.fmt : (MIME[from] ? from : 'png');
  let bmp;
  try { bmp = await createImageBitmap(new Blob([read.data])); } catch { return { ok: false, error: 'not a picture I can open' }; }
  let w = bmp.width;
  let h = bmp.height;
  const big = Math.max(w, h);
  if (opts.maxSide > 0 && big > opts.maxSide) { const k = opts.maxSide / big; w = Math.max(1, Math.round(w * k)); h = Math.max(1, Math.round(h * k)); }
  const cv = new OffscreenCanvas(w, h);
  const ctx = cv.getContext('2d');
  if (fmt === 'jpg') { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h); } // (JPG has no transparency: white behind)
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  const blob = await cv.convertToBlob({ type: MIME[fmt], quality: opts.quality ?? 0.82 });
  const res = await host.imgWrite(file, fmt, opts.tag || (opts.maxSide ? 'pequeña' : (fmt === from ? 'ligera' : fmt)), await blob.arrayBuffer());
  return res?.ok ? { ok: true, path: res.path, before: read.bytes, after: res.bytes, w, h } : { ok: false, error: res?.error || 'cannot save it' };
}

export const kb = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
