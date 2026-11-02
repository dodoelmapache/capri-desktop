// The Allow / Deny card. Enter allows, Escape denies.

const $ = (sel) => document.querySelector(sel);

const info = await window.permission.info();
if (info) {
  const { text } = info;
  $('.card__title').textContent = text.title;
  $('.card__tool').textContent = info.tool;
  $('.card__what').textContent = info.summary;
  $('.card__where').textContent = info.folder ? `${text.in} ${info.folder}` : '';
  $('.is-allow').textContent = text.allow;
  $('.is-deny').textContent = text.deny;
  $('.is-always').textContent = text.always;
  $('.is-always').hidden = !info.canAlways;
}

for (const btn of document.querySelectorAll('[data-answer]')) {
  btn.addEventListener('click', () => window.permission.answer(btn.dataset.answer));
}
window.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') window.permission.answer('allow');
  if (e.key === 'Escape') window.permission.answer('deny');
});
