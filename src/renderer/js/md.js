// A small, safe Markdown for her long answers: headings, lists, quotes, code blocks (with a copy button), `code`, **bold**,
// *italic*, [links](https://...) and bare links. Built with createElement + textContent only: nothing in an answer is ever
// treated as HTML, so a page or a file she read can't put anything on screen.

const FENCE = /^\s*```\s*([\w+#.-]*)\s*$/;
const HEADING = /^\s{0,3}(#{1,4})\s+(.*)$/;
const BULLET = /^\s*(?:[-*•])\s+(.*)$/;
const NUMBERED = /^\s*(\d{1,3})[.)]\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;
const RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;

// text -> [{ type: 'code', lang, text } | { type: 'heading', level, text } | { type: 'ul'|'ol', items } | { type: 'quote', text } | { type: 'rule' } | { type: 'p', text }]
export function parse(source) {
  const lines = String(source || '').replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    let m = FENCE.exec(line);
    if (m) { // a code block, up to its closing fence (or the end: it may still be arriving)
      const body = [];
      i += 1;
      while (i < lines.length && !FENCE.test(lines[i])) body.push(lines[i++]);
      i += 1;
      blocks.push({ type: 'code', lang: m[1], text: body.join('\n') });
      continue;
    }
    if (!line.trim()) { i += 1; continue; }
    if (RULE.test(line)) { blocks.push({ type: 'rule' }); i += 1; continue; }
    if ((m = HEADING.exec(line))) { blocks.push({ type: 'heading', level: m[1].length, text: m[2] }); i += 1; continue; }
    if (BULLET.test(line) || NUMBERED.test(line)) {
      const ordered = NUMBERED.test(line) && !BULLET.test(line);
      const items = [];
      while (i < lines.length && (ordered ? NUMBERED.exec(lines[i]) : BULLET.exec(lines[i]))) {
        items.push((ordered ? NUMBERED.exec(lines[i])[2] : BULLET.exec(lines[i])[1]));
        i += 1;
        // a line indented under an item belongs to it
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !BULLET.test(lines[i]) && !NUMBERED.test(lines[i])) items[items.length - 1] += `\n${lines[i++].trim()}`;
      }
      blocks.push({ type: ordered ? 'ol' : 'ul', items });
      continue;
    }
    if (QUOTE.test(line)) {
      const quoted = [];
      while (i < lines.length && QUOTE.test(lines[i])) quoted.push(QUOTE.exec(lines[i++])[1]);
      blocks.push({ type: 'quote', text: quoted.join('\n') });
      continue;
    }
    const para = [];
    while (i < lines.length && lines[i].trim() && !FENCE.test(lines[i]) && !HEADING.test(lines[i]) && !BULLET.test(lines[i]) && !NUMBERED.test(lines[i]) && !QUOTE.test(lines[i]) && !RULE.test(lines[i])) para.push(lines[i++]);
    blocks.push({ type: 'p', text: para.join('\n') });
  }
  return blocks;
}

// inline: [{ t: 'text'|'code'|'b'|'i'|'a', text, href? }]
const INLINE = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\[[^\]\n]+\]\(https?:\/\/[^\s)]+\))|(https?:\/\/[^\s<>"')\]]+[^\s<>"')\].,;:!?])|(?<![\w*])(\*[^*\n]+\*)(?![\w*])|(?<![\w_])(_[^_\n]+_)(?![\w_])/g;

export function inline(text) {
  const out = [];
  let last = 0;
  for (const m of String(text).matchAll(INLINE)) {
    if (m.index > last) out.push({ t: 'text', text: text.slice(last, m.index) });
    const [tok] = m;
    if (m[1]) out.push({ t: 'code', text: tok.slice(1, -1) });
    else if (m[2]) out.push({ t: 'b', text: tok.slice(2, -2) });
    else if (m[3]) {
      const link = /^\[([^\]]+)\]\((.+)\)$/.exec(tok);
      out.push({ t: 'a', text: link[1], href: link[2] });
    } else if (m[4]) out.push({ t: 'a', text: tok, href: tok });
    else out.push({ t: 'i', text: tok.slice(1, -1) });
    last = m.index + tok.length;
  }
  if (last < text.length) out.push({ t: 'text', text: text.slice(last) });
  return out;
}

const TAG = { code: 'code', b: 'strong', i: 'em' };

function fillInline(doc, el, text, onLink) {
  for (const part of inline(text)) {
    if (part.t === 'text') el.append(doc.createTextNode(part.text));
    else if (part.t === 'a') {
      const a = doc.createElement('a');
      a.textContent = part.text;
      a.href = part.href;
      a.title = part.href;
      a.addEventListener('click', (e) => {
        e.preventDefault();
        onLink?.(part.href);
      });
      el.append(a);
    } else {
      const node = doc.createElement(TAG[part.t]);
      node.textContent = part.text;
      el.append(node);
    }
  }
}

// blocks -> a fragment. onLink(url) opens a link; onCopy(text) copies a code block; labels: { copy, copied }
export function render(blocks, doc, { onLink, onCopy, labels = {} } = {}) {
  const frag = doc.createDocumentFragment();
  for (const b of blocks) {
    let el;
    if (b.type === 'code') {
      el = doc.createElement('div');
      el.className = 'md-code';
      const bar = doc.createElement('div');
      bar.className = 'md-code__bar';
      const lang = doc.createElement('span');
      lang.textContent = b.lang || 'code';
      const copy = doc.createElement('button');
      copy.type = 'button';
      copy.textContent = labels.copy || 'Copy';
      copy.addEventListener('click', () => {
        onCopy?.(b.text);
        copy.textContent = labels.copied || 'Copied';
        setTimeout(() => { copy.textContent = labels.copy || 'Copy'; }, 1400);
      });
      bar.append(lang, copy);
      const pre = doc.createElement('pre');
      const code = doc.createElement('code');
      code.textContent = b.text;
      pre.append(code);
      el.append(bar, pre);
    } else if (b.type === 'heading') {
      el = doc.createElement(`h${Math.min(b.level + 2, 6)}`); // h3..h6: a message isn't a page
      fillInline(doc, el, b.text, onLink);
    } else if (b.type === 'ul' || b.type === 'ol') {
      el = doc.createElement(b.type);
      for (const item of b.items) {
        const li = doc.createElement('li');
        fillInline(doc, li, item, onLink);
        el.append(li);
      }
    } else if (b.type === 'quote') {
      el = doc.createElement('blockquote');
      fillInline(doc, el, b.text, onLink);
    } else if (b.type === 'rule') {
      el = doc.createElement('hr');
    } else {
      el = doc.createElement('p');
      fillInline(doc, el, b.text, onLink);
    }
    frag.append(el);
  }
  return frag;
}
