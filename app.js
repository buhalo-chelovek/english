'use strict';
/* Мои слова — личный тренажёр английских слов (PWA).
   Слова и статусы живут в Google Таблице; приложение читает и пишет их через Apps Script.
   Локально (localStorage) хранится копия для работы без интернета. */

const APP_VERSION = '2.0.0';
const DAY = 864e5;
// Дни до следующего повторения для коробок 0..7.
// 1 — «не знаю», 2..6 — «повторить» (через 1, 3, 7, 14, 30 дней), 7 — «выучил» (проверка раз в 14 дней).
const INTERVALS = [0, 0, 1, 3, 7, 14, 30, 14];

// ---------- storage ----------
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { toast('Не удалось сохранить данные на устройстве'); } },
};
const K = { settings: 'ew.settings', words: 'ew.words', progress: 'ew.progress', meta: 'ew.meta' };
const DEFAULTS = {
  script: '', token: '', dir: 'td', filter: 'unlearned', session: 20,
  autoSpeak: false, voice: '', rate: 0.9, theme: 'auto', autoSync: true, shuffle: true,
};
let S = Object.assign({}, DEFAULTS, LS.get(K.settings, {}));
let WORDS = LS.get(K.words, []);
let P = LS.get(K.progress, {});
let META = Object.assign({ lastSync: 0, pushedAt: 0, best: {}, lastError: '', tabs: [] }, LS.get(K.meta, {}));
const saveS = () => LS.set(K.settings, S);
const saveW = () => LS.set(K.words, WORDS);
const saveP = () => LS.set(K.progress, P);
const saveM = () => LS.set(K.meta, META);

// ---------- helpers ----------
const app = document.getElementById('app');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };
const isRu = s => /[а-яё]/i.test(s);
const sizeCls = (s, md = 22, sm = 60) => (s.length > sm ? 'sm' : s.length > md ? 'md' : '');
const plural = (n, one, few, many) => { const a = n % 100, b = n % 10; return (a > 10 && a < 20) ? many : b === 1 ? one : (b >= 2 && b <= 4) ? few : many; };
const words = n => `${n} ${plural(n, 'слово', 'слова', 'слов')}`;

let toastTimer;
function toast(msg, ms = 2600) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

const ic = p => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
const I = {
  back: ic('<path d="M15 18l-6-6 6-6"/>'),
  gear: ic('<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>'),
  sync: ic('<path d="M21 12a9 9 0 0 1-15.5 6.2L3 16"/><path d="M3 12a9 9 0 0 1 15.5-6.2L21 8"/><path d="M21 3v5h-5"/><path d="M3 21v-5h5"/>'),
  speak: ic('<path d="M11 5L6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/>'),
  star: ic('<path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 2.9 1.1-6.2L3 9.6l6.2-.9z"/>'),
  shuffle: ic('<path d="M16 3h5v5"/><path d="M4 20L21 3"/><path d="M21 16v5h-5"/><path d="M15 15l6 6"/><path d="M4 4l5 5"/>'),
  cards: ic('<rect x="3" y="7" width="14" height="14" rx="2"/><path d="M7 3h12a2 2 0 0 1 2 2v12"/>'),
  learn: ic('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>'),
  write: ic('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>'),
  test: ic('<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1"/><path d="M9 13l2 2 4-4"/>'),
  match: ic('<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>'),
  undo: ic('<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>'),
  check: ic('<path d="M5 12l5 5L20 7"/>'),
  x: ic('<path d="M18 6L6 18M6 6l12 12"/>'),
  plus: ic('<path d="M12 5v14M5 12h14"/>'),
};

// ---------- navigation ----------
const nav = [];
let viewSeq = 0, onKey = null;
function draw() {
  viewSeq++; onKey = null;
  try { speechSynthesis.cancel(); } catch (e) {}
  nav[nav.length - 1]();
  window.scrollTo(0, 0);
}
function go(view) { nav.push(view); history.pushState({ n: nav.length }, ''); draw(); }
function back() { if (nav.length > 1) history.back(); }
function home() { const n = nav.length - 1; if (n > 0) history.go(-n); }
window.addEventListener('popstate', () => { if (nav.length > 1) { nav.pop(); draw(); } });
function later(fn, ms) { const my = viewSeq; return setTimeout(() => { if (my === viewSeq) fn(); }, ms); }
function refresh() { const v = nav[nav.length - 1]; if (v && v.refreshable) v(); }
function bind(h) {
  app.onclick = e => {
    const el = e.target.closest('[data-a]');
    if (!el || !app.contains(el)) return;
    const a = el.dataset.a;
    if (h[a]) h[a](el, e);
    else if (a === 'back') back();
    else if (a === 'home') home();
    else if (a === 'say') speak(el.dataset.t);
  };
}
document.addEventListener('keydown', e => {
  if (!onKey || e.ctrlKey || e.metaKey || e.altKey) return;
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);
  onKey(e, typing);
});

function bar({ title, root = false, actions = '' }) {
  return `<header class="bar">${root ? '' : `<button class="ic" data-a="back" aria-label="Назад">${I.back}</button>`}
    <h1>${esc(title)}</h1>${actions}</header>`;
}

// ---------- статусы и интервальное повторение ----------
// В таблице: пусто (новое) · «не знаю» · «повторить» · «выучил».
// «Выучил» ставится только после верных ответов на всех повторениях подряд: через 1, 3, 7, 14 и 30 дней.
// Любая ошибка обнуляет цепочку.
const ST = { none: '', bad: 'не знаю', rep: 'повторить', ok: 'выучил' };
const statusOfBox = b => !b ? ST.none : b === 1 ? ST.bad : b >= 7 ? ST.ok : ST.rep;
function normStatus(s) {
  s = String(s || '').trim().toLowerCase().replace(/ё/g, 'е');
  if (/^выуч/.test(s)) return ST.ok;
  if (/^повтор/.test(s)) return ST.rep;
  if (/^не ?зна/.test(s)) return ST.bad;
  return ST.none;
}
const MLABEL = { new: 'Новые', learning: 'Не знаю', familiar: 'Повторить', mastered: 'Выучил' };
function mastery(w) {
  const b = P[w.id]?.b || 0;
  return b === 0 ? 'new' : b === 1 ? 'learning' : b >= 7 ? 'mastered' : 'familiar';
}
const isDue = (w, now = Date.now()) => { const r = P[w.id]; return !!(r && r.b > 0 && r.d <= now); };
const blank = () => ({ b: 0, d: 0, c: 0, w: 0 });
function commit(w, r) {
  r.t = w.t; r.sh = w.s; r.st = statusOfBox(r.b); r.u = Date.now();
  P[w.id] = r; saveP(); schedulePush();
}
function applyStatus(r, st, now) {
  if (st === ST.ok) { r.b = 7; r.d = now + INTERVALS[7] * DAY; }
  else if (st === ST.rep) { r.b = 2; r.d = now; }
  else if (st === ST.bad) { r.b = 1; r.d = now; }
  else { r.b = 0; r.d = 0; }
}
function grade(w, ok) {
  const now = Date.now();
  const prev = P[w.id] ? { ...P[w.id] } : null;
  const r = P[w.id] ? { ...P[w.id] } : blank();
  if (ok) {
    r.c = (r.c || 0) + 1;
    // шаг вперёд только когда подошёл срок повторения (или слово новое)
    if (!r.b || r.d <= now) { r.b = r.b >= 7 ? 7 : Math.max(2, r.b + 1); r.d = now + INTERVALS[r.b] * DAY; }
  } else {
    r.w = (r.w || 0) + 1;
    if (r.b >= 7) { r.b = 2; r.d = now + DAY; } // ошибся в выученном — снова «повторить», цепочка с начала
    else { r.b = 1; r.d = now; }
  }
  r.l = now;
  commit(w, r);
  return () => commit(w, prev ? { ...prev } : blank());
}
function setStatus(w, st) { const r = P[w.id] ? { ...P[w.id] } : blank(); applyStatus(r, st, Date.now()); commit(w, r); }
function toggleStar(w) {
  const r = P[w.id] ? { ...P[w.id] } : blank();
  r.s = !r.s; commit(w, r);
  return r.s;
}
const starred = w => !!P[w.id]?.s;
function stats(list) {
  const s = { new: 0, learning: 0, familiar: 0, mastered: 0 };
  for (const w of list) s[mastery(w)]++;
  return s;
}
function uniqById(list) { const seen = new Set(); return list.filter(w => !seen.has(w.id) && seen.add(w.id)); }
function dueWords() { const now = Date.now(); return uniqById(WORDS.filter(w => isDue(w, now))); }
function prioritize(list, n) {
  const now = Date.now();
  const score = w => { const r = P[w.id]; if (!r || !r.b) return 1; if (r.d <= now) return 0; return 1 + r.b; };
  return shuffle(list).sort((a, b) => score(a) - score(b)).slice(0, n);
}
function mbar(list) {
  const s = stats(list), n = list.length || 1;
  return `<div class="mbar" title="Выучил ${s.mastered}, повторить ${s.familiar}, не знаю ${s.learning}, новые ${s.new}">
    <i class="m-mastered" style="width:${s.mastered / n * 100}%"></i><i class="m-familiar" style="width:${s.familiar / n * 100}%"></i><i class="m-learning" style="width:${s.learning / n * 100}%"></i></div>`;
}
function legend(list) {
  const s = stats(list);
  return `<div class="legend"><span><i class="m-mastered"></i>Выучил ${s.mastered}</span><span><i class="m-familiar"></i>Повторить ${s.familiar}</span><span><i class="m-learning"></i>Не знаю ${s.learning}</span><span><i class="m-new"></i>Новые ${s.new}</span></div>`;
}

// ---------- speech ----------
function voices() { try { return speechSynthesis.getVoices(); } catch (e) { return []; } }
function speak(text, lang) {
  if (!text || !('speechSynthesis' in window)) return;
  lang = lang || (isRu(text) ? 'ru' : 'en');
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const vs = voices();
  const v = lang === 'en'
    ? (vs.find(v => v.voiceURI === S.voice) || vs.find(v => /^en[-_]US/i.test(v.lang)) || vs.find(v => /^en/i.test(v.lang)))
    : vs.find(v => /^ru/i.test(v.lang));
  if (v) u.voice = v;
  u.lang = v?.lang || (lang === 'en' ? 'en-US' : 'ru-RU');
  u.rate = lang === 'en' ? +S.rate || 0.9 : 1;
  speechSynthesis.speak(u);
}
const sayBtn = t => `<button class="ic" data-a="say" data-t="${esc(t)}" aria-label="Озвучить">${I.speak}</button>`;
const maybeAutoSpeak = t => { if (S.autoSpeak && !isRu(t)) speak(t, 'en'); };

// ---------- answer checking ----------
function norm(s, keepParens) {
  let x = String(s ?? '').toLowerCase().replace(/ё/g, 'е').replace(/[’‘`´]/g, "'");
  if (!keepParens) x = x.replace(/\([^)]*\)|\[[^\]]*\]/g, ' ');
  return x.replace(/[^\p{L}\p{N}' -]+/gu, ' ').replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
}
const stripArt = s => s.replace(/^(to|a|an|the) /, '');
function variants(a) {
  const v = new Set([norm(a), norm(a, true)]);
  String(a).split(/[,;\/|]|\s+or\s+|\s+или\s+/i).forEach(p => v.add(norm(p)));
  for (const x of [...v]) v.add(stripArt(x));
  v.delete('');
  return [...v];
}
function lev(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 9;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
function check(input, answer) {
  const n = norm(input);
  if (!n) return { ok: false };
  const vs = variants(answer), n2 = stripArt(n);
  if (vs.includes(n) || vs.includes(n2)) return { ok: true };
  for (const v of vs) if (v.length >= 4 && lev(n2, v) <= (v.length >= 8 ? 2 : 1)) return { ok: true, typo: true };
  return { ok: false };
}

// ---------- questions ----------
function qa(w, dir = S.dir) {
  const d = dir === 'mix' ? (Math.random() < .5 ? 'td' : 'dt') : dir;
  return d === 'td' ? { q: w.t, a: w.d, d } : { q: w.d, a: w.t, d };
}
function distractors(w, side, pool, n = 3) {
  const right = norm(w[side]);
  const seen = new Set([right]);
  const out = [];
  for (const src of [shuffle(pool), shuffle(WORDS)]) {
    for (const o of src) {
      const k = norm(o[side]);
      if (!k || seen.has(k)) continue;
      seen.add(k); out.push(o[side]);
      if (out.length >= n) return out;
    }
  }
  return out;
}

// ---------- Google Таблица (через Apps Script) ----------
const H = {
  t: /^(word|words|term|english|eng|en|слово|слова|термин|англ)/,
  d: /^(translation|definition|meaning|russian|rus|ru|перевод|значение|определение|рус)/,
  st: /^(status|статус)/,
  x: /^(example|examples|note|notes|transcription|context|sentence|comment|пример|заметк|примечан|транскрипц|контекст|предложен|коммент)/,
  s: /^(set|module|topic|category|deck|lesson|набор|модуль|тема|категория|колода|раздел|урок)/,
};
function parseRows(rows, defSet) {
  rows = rows.map(r => r.map(c => String(c ?? '').trim())).filter(r => r.some(Boolean));
  if (!rows.length) return [];
  // по умолчанию: A — слово, B — перевод, C — статус, D — пример
  let t = 0, d = 1, st = 2, x = [3], s = -1, start = 0;
  const h = rows[0].map(c => c.toLowerCase());
  const find = re => h.findIndex(c => re.test(c));
  if (h.some(c => Object.values(H).some(re => re.test(c)))) {
    start = 1;
    const ft = find(H.t), fd = find(H.d);
    t = ft >= 0 ? ft : 0;
    d = fd >= 0 ? fd : (t === 1 ? 0 : 1);
    st = find(H.st);
    x = h.map((c, i) => i).filter(i => H.x.test(h[i]));
    s = find(H.s);
  }
  const out = [];
  for (let i = start; i < rows.length; i++) {
    const r = rows[i];
    const term = r[t] || '', def = r[d] || '';
    if (!term || !def) continue;
    out.push({
      id: norm(term, true) || term.toLowerCase(), t: term, d: def,
      x: x.map(j => r[j]).filter(Boolean).join(' · '),
      s: (s >= 0 && r[s]) || defSet,
      st: st >= 0 ? normStatus(r[st]) : ST.none,
    });
  }
  return out;
}
async function scriptCall(body) {
  if (!body) {
    const u = S.script + (S.script.includes('?') ? '&' : '?') + 'action=all' + (S.token ? '&token=' + encodeURIComponent(S.token) : '');
    const r = await fetch(u, { cache: 'no-store' });
    const j = await r.json();
    if (j.error) throw new Error(j.error);
    return j;
  }
  const r = await fetch(S.script, { method: 'POST', body: JSON.stringify({ ...body, token: S.token }), headers: { 'Content-Type': 'text/plain;charset=utf-8' } });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j;
}
function mergeProgress(remote) {
  let n = 0;
  for (const [id, r] of Object.entries(remote || {})) {
    if (!r || typeof r !== 'object') continue;
    if (!P[id] || (r.u || 0) > (P[id].u || 0)) { P[id] = r; n++; }
  }
  if (n) saveP();
  return n;
}
// Если статус в таблице поменяли руками — таблица главнее.
// r.ss — статус, который, по нашим данным, сейчас записан в таблице.
function reconcile() {
  const now = Date.now();
  let n = 0;
  for (const w of uniqById(WORDS)) {
    const r = P[w.id];
    const known = r ? (r.ss ?? r.st ?? ST.none) : ST.none;
    if (w.st === known) continue;
    const nr = r ? { ...r } : blank();
    applyStatus(nr, w.st, now);
    Object.assign(nr, { t: w.t, sh: w.s, st: w.st, ss: w.st, u: now });
    P[w.id] = nr; n++;
  }
  if (n) saveP();
  return n;
}

let syncing = false, pushing = false;
async function sync({ silent = false } = {}) {
  if (syncing) return;
  if (!S.script) { if (!silent) toast('Сначала подключите таблицу в настройках'); return; }
  if (!navigator.onLine) { if (!silent) toast('Нет интернета — работаю с сохранёнными словами'); return; }
  syncing = true; document.querySelectorAll('[data-a=sync]').forEach(b => b.classList.add('spin'));
  try {
    await pushProgress(true); // сначала отправляем свои изменения
    const j = await scriptCall();
    META.tabs = (j.sheets || []).map(s => s.name);
    const list = [];
    for (const sh of j.sheets || []) list.push(...parseRows(sh.values || [], sh.name));
    const seen = new Set();
    WORDS = list.filter(w => { const k = w.s + '\u0001' + w.id + '\u0001' + w.d; return !seen.has(k) && seen.add(k); });
    saveW();
    mergeProgress(j.progress);
    reconcile();
    await pushProgress(true);
    META.lastSync = Date.now(); META.lastError = ''; saveM();
    if (!silent) toast(`Синхронизировано: ${words(uniqById(WORDS).length)}`);
  } catch (e) {
    META.lastError = 'Не удалось синхронизироваться: ' + e.message; saveM();
    if (!silent || !WORDS.length) toast(META.lastError, 7000);
  } finally {
    syncing = false;
    document.querySelectorAll('[data-a=sync]').forEach(b => b.classList.remove('spin'));
    refresh();
  }
}
let pushTimer;
function schedulePush() { if (!S.script) return; clearTimeout(pushTimer); pushTimer = setTimeout(() => pushProgress(), 3000); }
async function pushProgress(throwErr) {
  if (!S.script || !navigator.onLine || pushing) return;
  const since = META.pushedAt || 0, started = Date.now();
  const items = {};
  for (const [id, r] of Object.entries(P)) if ((r.u || 0) > since) items[id] = { ...r, ss: r.st };
  if (!Object.keys(items).length) return;
  pushing = true;
  try {
    await scriptCall({ action: 'update', items });
    for (const [id, it] of Object.entries(items)) if (P[id] && P[id].u === it.u) P[id].ss = it.st;
    saveP();
    META.pushedAt = started; saveM();
  } catch (e) { if (throwErr) throw e; }
  finally { pushing = false; }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') { clearTimeout(pushTimer); pushProgress(); }
  else if (S.autoSync && S.script && Date.now() - META.lastSync > 60e3) sync({ silent: true });
});
window.addEventListener('online', () => pushProgress());

function syncInfo() {
  if (!S.script) return 'Таблица не подключена';
  if (!META.lastSync) return 'Ещё не синхронизировано';
  const d = new Date(META.lastSync);
  return 'Синхронизировано ' + d.toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

// ---------- data access ----------
function setsMap() {
  const m = new Map();
  for (const w of WORDS) { if (!m.has(w.s)) m.set(w.s, []); m.get(w.s).push(w); }
  return m;
}
const GROUPS = ['learning', 'familiar', 'new', 'mastered'];
const setTitle = k => k === '*' ? 'Все слова' : k === '★' ? 'Избранное' : k.startsWith('st:') ? MLABEL[k.slice(3)] : k;
function listFor(k) {
  if (k === '*') return uniqById(WORDS);
  if (k === '★') return uniqById(WORDS.filter(starred));
  if (k.startsWith('st:')) return uniqById(WORDS).filter(w => mastery(w) === k.slice(3));
  return WORDS.filter(w => w.s === k);
}
function applyFilter(list, key) {
  if (S.filter === 'unlearned' && key !== 'st:mastered') return list.filter(w => mastery(w) !== 'mastered');
  if (S.filter === 'starred') return list.filter(starred);
  return list;
}

// ======================= VIEWS =======================

const SETUP_STEPS = `<ol>
  <li>Откройте таблицу → «Расширения» → «Apps Script».</li>
  <li>Удалите всё в редакторе и вставьте код скрипта: <button class="btn" data-a="copycode" style="min-height:34px;padding:4px 10px">Скопировать код</button></li>
  <li>Сохраните (значок дискеты), затем «Начать развёртывание» → «Новое развёртывание» → значок шестерёнки → «Веб-приложение».</li>
  <li>«Запуск от имени»: <b>Я</b>; «У кого есть доступ»: <b>Все</b>. Нажмите «Развернуть» и разрешите доступ (если Google предупредит — «Дополнительные настройки» → «Перейти на страницу…»).</li>
  <li>Скопируйте «URL веб-приложения» (заканчивается на <code>/exec</code>) и вставьте ниже.</li>
</ol>`;

function viewHome() {
  const m = setsMap(), all = uniqById(WORDS), due = dueWords().length, st = stats(all);
  const fav = all.filter(starred);
  const actions = `<button class="ic" data-a="sync" aria-label="Синхронизировать" title="Синхронизировать">${I.sync}</button>
    <button class="ic" data-a="settings" aria-label="Настройки" title="Настройки">${I.gear}</button>`;
  let body;
  if (!S.script) {
    body = `<div class="card">
      <h2>Подключите Google Таблицу</h2>
      <p class="muted small">Приложение берёт слова из таблицы и записывает туда статус: «не знаю», «повторить», «выучил». Так телефон и компьютер всегда показывают одно и то же. Настраивается один раз:</p>
      ${SETUP_STEPS}
      <div class="stack"><input id="surl" type="url" inputmode="url" placeholder="https://script.google.com/macros/s/…/exec" autocomplete="off">
      <button class="btn primary" data-a="connect">Подключить</button></div>
      <p class="muted small">На втором устройстве достаточно вставить тот же URL.</p></div>`;
  } else if (!WORDS.length) {
    body = `<div class="card">
      <h2>Слов пока нет</h2>
      <p class="muted">Нажмите «Синхронизировать», чтобы загрузить слова из таблицы.</p>
      ${META.lastError ? `<p class="err">${esc(META.lastError)}</p>` : ''}
      <div class="row"><button class="btn primary" data-a="sync">${I.sync} Синхронизировать</button>
      <button class="btn" data-a="settings">Настройки</button></div></div>`;
  } else {
    const fresh = st.new + st.learning;
    body = `<div class="stats">
        <div class="stat"><b>${all.length}</b><span>${plural(all.length, 'слово', 'слова', 'слов')}</span></div>
        <div class="stat"><b>${st.mastered}</b><span>выучил</span></div>
        <div class="stat"><b>${due}</b><span>повторить сейчас</span></div></div>
      ${due ? `<button class="btn primary big" data-a="review">${I.sync} Повторить сейчас · ${due}</button>`
        : fresh ? `<button class="btn primary big" data-a="learnNew">${I.learn} Учить слова · ${fresh}</button>`
        : `<button class="btn primary big" data-a="open" data-k="*">${I.cards} На сегодня всё повторено</button>`}
      ${META.lastError ? `<p class="err">${esc(META.lastError)}</p>` : ''}
      <h2 class="sec">Наборы</h2>
      <div class="sets">${[...m].map(([name, ws]) => setCard(name, name, ws)).join('')}
        ${m.size > 1 ? setCard('*', 'Все слова', all) : ''}</div>
      <h2 class="sec">По статусу</h2>
      <div class="sets">${GROUPS.map(g => { const ws = all.filter(w => mastery(w) === g); return ws.length ? setCard('st:' + g, MLABEL[g], ws) : ''; }).join('')}
        ${fav.length ? setCard('★', '★ Избранное', fav) : ''}</div>`;
  }
  app.innerHTML = `${bar({ title: 'Мои слова', root: true, actions })}<main class="wrap">${body}<p class="foot">${esc(syncInfo())}</p></main>`;
  if (syncing) document.querySelectorAll('[data-a=sync]').forEach(b => b.classList.add('spin'));
  bind({
    settings: () => go(viewSettings),
    sync: () => sync(),
    open: el => go(makeSet(el.dataset.k)),
    review: () => go(makeCards('Повторение', shuffle(dueWords()), { review: true })),
    learnNew: () => go(makeQuiz('Учить слова', prioritize(all.filter(w => ['new', 'learning'].includes(mastery(w))), S.session), ['mc', 'write'])),
    connect: () => saveScript(document.getElementById('surl').value),
    copycode: copyCode,
  });
}
viewHome.refreshable = true;

function saveScript(u, token) {
  u = String(u || '').trim();
  if (u && !/^https:\/\/script\.google(usercontent)?\.com\/.+/.test(u)) return toast('Нужен URL вида https://script.google.com/macros/s/…/exec');
  if (u !== S.script) { META.pushedAt = 0; META.lastSync = 0; saveM(); }
  S.script = u;
  if (token !== undefined) S.token = token.trim();
  saveS();
  refresh();
  if (u) sync(); else toast('Сохранено');
}
async function copyCode() {
  try {
    const code = await (await fetch('apps-script.gs', { cache: 'no-store' })).text();
    await navigator.clipboard.writeText(code);
    toast('Код скопирован — вставьте его в редактор Apps Script');
  } catch (e) { window.open('apps-script.gs', '_blank'); }
}

function setCard(key, name, ws) {
  const st = stats(ws), pct = ws.length ? Math.round(st.mastered / ws.length * 100) : 0;
  const meta = key.startsWith('st:') ? words(ws.length) : `${words(ws.length)} · выучил ${pct}%`;
  return `<button class="setcard" data-a="open" data-k="${esc(key)}">
    <div class="setname">${esc(name)}</div>
    <div class="setmeta">${meta}</div>${mbar(ws)}</button>`;
}

function makeSet(key) {
  let query = '';
  const v = () => {
    const all = listFor(key);
    const list = applyFilter(all, key);
    const seg = (name, val, label) => `<button class="${S[name] === val ? 'on' : ''}" data-a="opt" data-o="${name}" data-v="${val}">${label}</button>`;
    app.innerHTML = `${bar({ title: setTitle(key) })}
      <main class="wrap">
        ${mbar(all)}${legend(all)}
        <div class="modes">
          <button class="mode" data-a="mode" data-m="cards">${I.cards}Карточки</button>
          <button class="mode" data-a="mode" data-m="learn">${I.learn}Заучивание</button>
          <button class="mode" data-a="mode" data-m="write">${I.write}Письмо</button>
          <button class="mode" data-a="mode" data-m="test">${I.test}Тест</button>
          <button class="mode" data-a="mode" data-m="match">${I.match}Подбор</button>
        </div>
        <div class="opts">
          <div class="seg">${seg('dir', 'td', 'EN → RU')}${seg('dir', 'dt', 'RU → EN')}${seg('dir', 'mix', 'Микс')}</div>
          <div class="seg">${seg('filter', 'all', 'Все')}${seg('filter', 'unlearned', 'Без выученных')}${seg('filter', 'starred', '★')}</div>
        </div>
        <p class="muted small">В занятии: ${words(list.length)} из ${all.length}${list.length > S.session ? ` (в «Заучивании» и «Письме» — по ${S.session} за раз)` : ''}</p>
        <input id="q" type="search" placeholder="Поиск по словам" value="${esc(query)}" autocomplete="off">
        <ul class="words" id="wl"></ul>
      </main>`;
    renderList(all);
    document.getElementById('q').oninput = e => { query = e.target.value; renderList(all); };
    bind({
      opt: el => { S[el.dataset.o] = el.dataset.v; saveS(); v(); },
      mode: el => {
        const L = applyFilter(listFor(key), key);
        if (!L.length) return toast('Нет слов для занятия — смените фильтр');
        const t = setTitle(key), m = el.dataset.m;
        if (m === 'cards') go(makeCards(t, S.shuffle ? shuffle(L) : L));
        if (m === 'learn') go(makeQuiz(t, prioritize(L, S.session), ['mc', 'write'], L));
        if (m === 'write') go(makeQuiz(t, prioritize(L, S.session), ['write'], L));
        if (m === 'test') go(makeTest(t, L));
        if (m === 'match') go(makeMatch(t, L, key));
      },
      star: el => {
        const w = WORDS.find(x => x.id === el.dataset.id);
        if (w) el.classList.toggle('on', toggleStar(w));
      },
    });
  };
  function renderList(all) {
    const q = norm(query);
    const shown = q ? all.filter(w => norm(w.t).includes(q) || norm(w.d).includes(q)) : all;
    document.getElementById('wl').innerHTML = shown.slice(0, 1500).map(w => `<li class="w">
      <span class="dot m-${mastery(w)}" title="${MLABEL[mastery(w)]}"></span>
      <div class="wt"><b>${esc(w.t)}</b><span>${esc(w.d)}</span>${w.x ? `<small>${esc(w.x)}</small>` : ''}</div>
      ${sayBtn(w.t)}<button class="ic star ${starred(w) ? 'on' : ''}" data-a="star" data-id="${esc(w.id)}" aria-label="Избранное">${I.star}</button></li>`).join('')
      || '<li class="muted center">Ничего не найдено</li>';
  }
  v.refreshable = true;
  return v;
}

// ---------- Карточки ----------
function makeCards(title, deck, { review = false } = {}) {
  let i = 0, flipped = false, know = [], learn = [], hist = [];
  let cur = null;
  const v = () => (i >= deck.length ? end() : card());
  function card() {
    const w = deck[i];
    if (!cur || cur.w !== w) cur = { w, ...qa(w) };
    const front = cur.q, backT = cur.a;
    app.innerHTML = `${bar({ title, actions: review ? '' : `<button class="ic" data-a="shuf" title="Перемешать" aria-label="Перемешать">${I.shuffle}</button>` })}
      <div class="study">
        <div class="progress"><i style="width:${i / deck.length * 100}%"></i></div>
        <div class="counter">${i + 1} / ${deck.length}</div>
        <div class="flip" id="fl" style="margin-top:12px">
          <div class="card3d ${flipped ? 'flipped' : ''}" id="c3">
            <div class="face front"><span class="side">${isRu(front) ? 'Перевод' : 'Слово'}</span>
              <div class="tools">${sayBtn(front)}<button class="ic star ${starred(w) ? 'on' : ''}" data-a="star" aria-label="Избранное">${I.star}</button></div>
              <div class="big-t ${sizeCls(front)}">${esc(front)}</div></div>
            <div class="face back"><span class="side">${isRu(backT) ? 'Перевод' : 'Слово'}</span>
              <div class="tools">${sayBtn(backT)}</div>
              <div class="big-t ${sizeCls(backT)}">${esc(backT)}</div>${w.x ? `<div class="ex">${esc(w.x)}</div>` : ''}</div>
          </div>
        </div>
        <div class="cardctl">
          <button class="btn no" data-a="no">${I.x} ${review ? 'Забыл' : 'Ещё учу'} <b>${learn.length}</b></button>
          <button class="ic" data-a="undo" aria-label="Отменить" ${hist.length ? '' : 'disabled'}>${I.undo}</button>
          <button class="btn yes" data-a="yes">${I.check} ${review ? 'Помню' : 'Знаю'} <b>${know.length}</b></button>
        </div>
        <div class="stline"><span class="muted small">Статус в таблице:</span><div class="seg">${[ST.bad, ST.rep, ST.ok].map(s => `<button class="${statusOfBox(P[w.id]?.b) === s ? 'on' : ''}" data-a="setst" data-v="${s}">${s}</button>`).join('')}</div></div>
        <div class="kbd">Пробел — перевернуть · ← ещё учу · → знаю · Z — отменить · S — озвучить</div>
      </div>`;
    if (!flipped) maybeAutoSpeak(front);
    const fl = document.getElementById('fl');
    let sx = null, dx = 0, moved = false;
    fl.onpointerdown = e => { if (e.target.closest('button')) return; sx = e.clientX; dx = 0; moved = false; fl.classList.add('dragging'); };
    fl.onpointermove = e => {
      if (sx == null) return;
      dx = e.clientX - sx; if (Math.abs(dx) > 8) moved = true;
      fl.style.transform = `translateX(${dx}px) rotate(${dx / 25}deg)`;
      fl.classList.toggle('hint-ok', dx > 70); fl.classList.toggle('hint-bad', dx < -70);
    };
    const up = () => {
      if (sx == null) return;
      sx = null; fl.classList.remove('dragging', 'hint-ok', 'hint-bad'); fl.style.transform = '';
      if (dx > 80) answer(true); else if (dx < -80) answer(false); else if (!moved) flip();
    };
    fl.onpointerup = up; fl.onpointercancel = () => { dx = 0; up(); };
    bind({
      no: () => answer(false), yes: () => answer(true), undo, shuf: () => { deck = shuffle(deck.slice(i)); i = 0; know = []; learn = []; hist = []; cur = null; flipped = false; v(); toast('Перемешано'); },
      star: el => el.classList.toggle('on', toggleStar(w)),
      setst: el => { setStatus(w, el.dataset.v); toast(`«${w.t}»: ${el.dataset.v}`); v(); },
    });
    onKey = e => {
      if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); flip(); }
      else if (e.key === 'ArrowRight') answer(true);
      else if (e.key === 'ArrowLeft') answer(false);
      else if (e.key === 'z' || e.key === 'я' || e.key === 'Backspace') undo();
      else if (e.key === 's' || e.key === 'ы') speak(flipped ? backT : front);
    };
  }
  function flip() {
    flipped = !flipped;
    document.getElementById('c3')?.classList.toggle('flipped', flipped);
    if (flipped) maybeAutoSpeak(cur.a);
  }
  function answer(ok) {
    const w = deck[i];
    hist.push({ ok, undo: grade(w, ok) });
    (ok ? know : learn).push(w);
    i++; flipped = false; cur = null; v();
  }
  function undo() {
    const h = hist.pop(); if (!h) return;
    h.undo(); i--; (h.ok ? know : learn).pop(); flipped = false; cur = null; v();
  }
  function end() {
    app.innerHTML = `${bar({ title })}<div class="study"><div class="card done">
      <div class="emoji">${learn.length ? '💪' : '🎉'}</div>
      <h2>${review ? 'Повторение закончено' : 'Колода пройдена!'}</h2>
      <p class="muted">${review ? 'Помню' : 'Знаю'}: <b>${know.length}</b> · ${review ? 'Забыл' : 'Ещё учу'}: <b>${learn.length}</b></p>
      <div class="stack" style="margin-top:16px">
        ${learn.length ? `<button class="btn primary" data-a="again">Повторить незнакомые · ${learn.length}</button>` : ''}
        ${learn.length ? `<button class="btn" data-a="learnIt">Заучить незнакомые</button>` : ''}
        <button class="btn" data-a="restart">Начать заново</button>
        <button class="btn ghost" data-a="back">Готово</button>
      </div></div></div>`;
    bind({
      again: () => { deck = shuffle(learn); i = 0; know = []; learn = []; hist = []; v(); },
      learnIt: () => { nav[nav.length - 1] = makeQuiz(title, shuffle(learn), ['mc', 'write']); draw(); },
      restart: () => { deck = shuffle(deck); i = 0; know = []; learn = []; hist = []; v(); },
    });
    onKey = e => { if (e.key === 'Enter') { e.preventDefault(); app.querySelector('.btn.primary, .btn')?.click(); } };
  }
  return v;
}

// ---------- Заучивание / Письмо ----------
function makeQuiz(title, list, stages, pool = list) {
  const ROUND = 7;
  const items = shuffle(list).map(w => ({ w, st: 0, miss: false }));
  let queue = [], round = 0, rr = { ok: 0, n: 0 }, cur = null, phase = 'q'; // раунд: каждое слово спрашивается один раз
  const remaining = () => items.filter(it => it.st < stages.length);
  const v = () => { if (!cur) next(); else render(); };
  function startRound() {
    round++; rr = { ok: 0, n: 0 };
    queue = shuffle(remaining().slice(0, ROUND));
  }
  function next() {
    if (!queue.length) {
      if (!remaining().length) return finish();
      if (round > 0) return roundSummary();
      startRound();
    }
    const it = queue.shift();
    let type = stages[it.st];
    const { q, a, d } = qa(it.w);
    const side = d === 'td' ? 'd' : 't';
    let opts = null;
    if (type === 'mc') {
      const ds = distractors(it.w, side, pool, 3);
      if (ds.length < 1) type = 'write';
      else opts = shuffle([a, ...ds]);
    }
    cur = { it, type, q, a, opts, side, user: null, res: null };
    phase = 'q'; render();
  }
  function progressPct() { const tot = items.length * stages.length; return items.reduce((s, it) => s + Math.min(it.st, stages.length), 0) / tot * 100; }
  function head() {
    return `${bar({ title })}<div class="study"><div class="progress"><i style="width:${progressPct()}%"></i></div>
      <div class="counter">Выучено ${items.length - remaining().length} из ${items.length}</div>`;
  }
  function render() {
    const { it, type, q, a, opts } = cur, w = it.w;
    const label = type === 'mc' ? (isRu(a) ? 'Выберите перевод' : 'Выберите слово') : (isRu(a) ? 'Напишите перевод' : 'Напишите по-английски');
    let body = `<div class="qbox" style="margin-top:12px">
      <div class="qlabel"><span>${label}${it.miss && phase === 'q' ? ' · ещё раз' : ''}</span><span>${sayBtn(q)}</span></div>
      <div class="qtext ${sizeCls(q, 22, 60)}">${esc(q)}</div>`;
    if (type === 'mc') {
      body += `<div class="opts4">${opts.map((o, k) => {
        let cls = '';
        if (phase === 'fb') { if (o === a) cls = 'right'; else if (o === cur.user) cls = 'wrong'; }
        return `<button class="opt ${cls}" data-a="pick" data-k="${k}" ${phase === 'fb' ? 'disabled' : ''}><span class="n">${k + 1}</span><span>${esc(o)}</span></button>`;
      }).join('')}</div>`;
      if (phase === 'q') body += `<div class="row" style="margin-top:10px"><button class="btn ghost" data-a="dunno">Не знаю</button></div>`;
    } else if (phase === 'q') {
      body += `<form class="answer-row" id="af" autocomplete="off">
        <input id="ans" type="text" autocapitalize="off" autocorrect="off" spellcheck="false" lang="${isRu(a) ? 'ru' : 'en'}" placeholder="${isRu(a) ? 'Перевод…' : 'English…'}">
        <button class="btn primary" type="submit">Ответить</button></form>
        <div class="row" style="margin-top:6px"><button class="btn ghost" data-a="dunno">Не знаю</button></div>`;
    }
    if (phase === 'fb') {
      const r = cur.res;
      if (r.ok) body += `<div class="fb ok"><div class="t">${r.typo ? 'Почти! Засчитано, но есть опечатка' : 'Верно!'}</div>${r.typo || type === 'write' ? `<div class="ans">${esc(a)}</div>` : ''}</div>`;
      else body += `<div class="fb bad"><div class="t">${cur.user ? 'Неправильно' : 'Правильный ответ:'}</div>
        ${cur.user ? `<div class="yours">${esc(cur.user)}</div><div class="small muted" style="margin-top:6px">Правильный ответ:</div>` : ''}
        <div class="ans">${esc(a)}</div>${w.x ? `<div class="ex" style="margin-top:6px">${esc(w.x)}</div>` : ''}</div>`;
      body += `<div class="row" style="margin-top:12px;justify-content:flex-end">
        ${!r.ok && type === 'write' && cur.user ? `<button class="btn" data-a="override">Мой ответ верен</button>` : ''}
        ${!r.ok || r.typo ? `<button class="btn primary" data-a="cont">Дальше</button>` : ''}</div>`;
    }
    app.innerHTML = head() + body + `</div></div>`;
    if (phase === 'q') maybeAutoSpeak(q);
    const inp = document.getElementById('ans');
    if (inp) { inp.focus(); document.getElementById('af').onsubmit = e => { e.preventDefault(); submit(inp.value); }; }
    bind({
      pick: el => submit(opts[+el.dataset.k]),
      dunno: () => submit(''),
      cont: () => { cur = null; next(); },
      override,
    });
    onKey = (e, typing) => {
      if (phase === 'q' && type === 'mc' && /^[1-4]$/.test(e.key) && opts[+e.key - 1] != null) submit(opts[+e.key - 1]);
      else if (phase === 'fb' && e.key === 'Enter' && !typing) { e.preventDefault(); cur = null; next(); }
    };
  }
  function submit(user) {
    const { it, type, a } = cur;
    const res = !user ? { ok: false } : type === 'mc' ? { ok: user === a } : check(user, a);
    cur.user = user; cur.res = res; cur.prevMiss = it.miss;
    rr.n++;
    if (res.ok) advance(it);
    else { if (!it.miss) cur.undo = grade(it.w, false); it.miss = true; }
    phase = 'fb'; render();
    if (res.ok && !res.typo) later(() => { cur = null; next(); }, type === 'mc' ? 650 : 900);
  }
  function advance(it) {
    rr.ok++; it.st++;
    if (it.st >= stages.length && !it.miss) grade(it.w, true);
  }
  function override() {
    const { it } = cur;
    cur.undo?.(); it.miss = cur.prevMiss;
    advance(it); cur = null; next();
  }
  function roundSummary() {
    app.innerHTML = head() + `<div class="card done" style="margin-top:12px">
      <div class="emoji">👍</div><h2>Раунд ${round} пройден</h2>
      <p class="muted">Правильных ответов: ${rr.ok} из ${rr.n}</p>
      ${mbarItems()}
      <button class="btn primary big" data-a="go" style="margin-top:16px">Продолжить</button></div></div></div>`;
    bind({ go: () => { startRound(); next(); } });
    onKey = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); startRound(); next(); } };
  }
  function mbarItems() {
    const done = items.filter(it => it.st >= stages.length).length, mid = items.filter(it => it.st > 0 && it.st < stages.length).length, n = items.length;
    return `<div class="mbar" style="margin-top:12px"><i class="m-mastered" style="width:${done / n * 100}%"></i><i class="m-learning" style="width:${mid / n * 100}%"></i></div>
      <div class="legend" style="justify-content:center"><span><i class="m-mastered"></i>Готово ${done}</span><span><i class="m-learning"></i>В процессе ${mid}</span><span><i class="m-new"></i>Осталось ${n - done - mid}</span></div>`;
  }
  function finish() {
    const hard = items.filter(it => it.miss);
    app.innerHTML = `${bar({ title })}<div class="study"><div class="card done">
      <div class="emoji">🎉</div><h2>Отлично, всё выучено!</h2>
      <p class="muted">${words(items.length)}, без ошибок — ${items.length - hard.length}</p>
      ${hard.length ? `<ul class="review">${hard.map(it => `<li class="bad"><div class="q">${esc(it.w.t)}</div><div class="a">${esc(it.w.d)}</div></li>`).join('')}</ul>` : ''}
      <div class="stack" style="margin-top:16px">
        ${pool.length > items.length ? `<button class="btn primary" data-a="more">Следующие слова</button>` : ''}
        <button class="btn" data-a="again">Пройти ещё раз</button>
        <button class="btn ghost" data-a="back">Готово</button></div></div></div>`;
    bind({
      more: () => { nav[nav.length - 1] = makeQuiz(title, prioritize(pool, S.session), stages, pool); draw(); },
      again: () => { nav[nav.length - 1] = makeQuiz(title, list, stages, pool); draw(); },
    });
  }
  return v;
}

// ---------- Тест ----------
function makeTest(title, list) {
  let phase = 'setup', n = Math.min(20, list.length), qs = [], i = 0;
  const types = { mc: true, write: true, tf: true };
  const v = () => (phase === 'setup' ? setup() : phase === 'q' ? question() : results());
  function setup() {
    const counts = [...new Set([5, 10, 20, 30, list.length].filter(c => c <= list.length))];
    app.innerHTML = `${bar({ title: 'Тест · ' + title })}<div class="study"><div class="card">
      <h2>Настройка теста</h2>
      <label class="lbl">Количество вопросов</label>
      <div class="seg">${counts.map(c => `<button class="${c === n ? 'on' : ''}" data-a="n" data-v="${c}">${c === list.length && c > 30 ? 'Все (' + c + ')' : c}</button>`).join('')}</div>
      <label class="lbl">Типы вопросов</label>
      <label class="switch">Выбор из вариантов <input type="checkbox" data-t="mc" ${types.mc ? 'checked' : ''}></label>
      <label class="switch">Верно / неверно <input type="checkbox" data-t="tf" ${types.tf ? 'checked' : ''}></label>
      <label class="switch">Письменный ответ <input type="checkbox" data-t="write" ${types.write ? 'checked' : ''}></label>
      <button class="btn primary big" data-a="start" style="margin-top:14px">Начать тест</button></div></div>`;
    app.querySelectorAll('input[data-t]').forEach(c => c.onchange = () => { types[c.dataset.t] = c.checked; });
    bind({
      n: el => { n = +el.dataset.v; setup(); },
      start: () => {
        const on = Object.keys(types).filter(k => types[k]);
        if (!on.length) return toast('Выберите хотя бы один тип вопросов');
        build(on); phase = 'q'; i = 0; v();
      },
    });
  }
  function build(on) {
    qs = shuffle(list).slice(0, n).map((w, k) => {
      let type = on[k % on.length];
      const { q, a, d } = qa(w);
      const side = d === 'td' ? 'd' : 't';
      const ds = distractors(w, side, list, 3);
      if ((type === 'mc' || type === 'tf') && !ds.length) type = 'write';
      const r = { w, type, q, a, user: null, ok: false };
      if (type === 'mc') r.opts = shuffle([a, ...ds]);
      if (type === 'tf') { r.truth = Math.random() < .5; r.cand = r.truth ? a : ds[0]; }
      return r;
    });
    qs = shuffle(qs);
  }
  function question() {
    if (i >= qs.length) { phase = 'res'; return results(true); }
    const r = qs[i];
    let body = `<div class="qbox" style="margin-top:12px"><div class="qlabel"><span>${r.type === 'tf' ? 'Верный ли перевод?' : r.type === 'mc' ? 'Выберите ответ' : 'Напишите ответ'}</span><span>${sayBtn(r.q)}</span></div>
      <div class="qtext ${sizeCls(r.q, 22, 60)}">${esc(r.q)}</div>`;
    if (r.type === 'mc') body += `<div class="opts4">${r.opts.map((o, k) => `<button class="opt" data-a="pick" data-k="${k}"><span class="n">${k + 1}</span><span>${esc(o)}</span></button>`).join('')}</div>`;
    if (r.type === 'tf') body += `<div class="tfcand">${esc(r.cand)}</div><div class="opts4"><button class="opt" data-a="tf" data-v="1"><span class="n">1</span>Верно</button><button class="opt" data-a="tf" data-v="0"><span class="n">2</span>Неверно</button></div>`;
    if (r.type === 'write') body += `<form class="answer-row" id="af" autocomplete="off"><input id="ans" type="text" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="Ответ…"><button class="btn primary" type="submit">Ответить</button></form>`;
    body += `<div class="row" style="margin-top:10px"><button class="btn ghost" data-a="skip">Пропустить</button></div></div>`;
    app.innerHTML = `${bar({ title: 'Тест · ' + title })}<div class="study"><div class="progress"><i style="width:${i / qs.length * 100}%"></i></div>
      <div class="counter">Вопрос ${i + 1} из ${qs.length}</div>${body}</div>`;
    maybeAutoSpeak(r.q);
    const inp = document.getElementById('ans');
    if (inp) { inp.focus(); document.getElementById('af').onsubmit = e => { e.preventDefault(); ans(inp.value, check(inp.value, r.a).ok); }; }
    bind({
      pick: el => { const o = r.opts[+el.dataset.k]; ans(o, o === r.a); },
      tf: el => { const b = el.dataset.v === '1'; ans(b ? 'Верно' : 'Неверно', b === r.truth); },
      skip: () => ans('', false),
    });
    onKey = (e, typing) => {
      if (typing) return;
      if (r.type === 'mc' && /^[1-4]$/.test(e.key) && r.opts[+e.key - 1] != null) { const o = r.opts[+e.key - 1]; ans(o, o === r.a); }
      if (r.type === 'tf' && (e.key === '1' || e.key === '2')) { const b = e.key === '1'; ans(b ? 'Верно' : 'Неверно', b === r.truth); }
    };
  }
  function ans(user, ok) { qs[i].user = user; qs[i].ok = ok; i++; question(); }
  function results(first) {
    if (first) for (const r of qs) grade(r.w, r.ok);
    const ok = qs.filter(r => r.ok).length, pct = Math.round(ok / qs.length * 100);
    const wrong = qs.filter(r => !r.ok);
    app.innerHTML = `${bar({ title: 'Тест · ' + title })}<div class="study"><div class="card done">
      <div class="score">${pct}%</div><h2>${pct >= 90 ? 'Превосходно!' : pct >= 70 ? 'Хороший результат' : 'Есть над чем поработать'}</h2>
      <p class="muted">Правильно ${ok} из ${qs.length}</p>
      <div class="stack" style="margin-top:14px">
        ${wrong.length ? `<button class="btn primary" data-a="learnWrong">Заучить ошибки · ${wrong.length}</button>` : ''}
        <button class="btn" data-a="again">Новый тест</button><button class="btn ghost" data-a="back">Готово</button></div></div>
      <ul class="review">${qs.map(r => `<li class="${r.ok ? '' : 'bad'}"><div class="q">${esc(r.q)}${r.type === 'tf' ? ' — ' + esc(r.cand) : ''}</div>
        <div class="a">${r.ok ? '✓ ' : '✗ '}Ваш ответ: ${esc(r.user || '—')}${r.ok ? '' : ` · Правильно: <b>${esc(r.type === 'tf' ? (r.truth ? 'Верно' : 'Неверно') + ' (' + r.a + ')' : r.a)}</b>`}</div></li>`).join('')}</ul></div>`;
    bind({
      learnWrong: () => { nav[nav.length - 1] = makeQuiz(title, uniqById(wrong.map(r => r.w)), ['mc', 'write']); draw(); },
      again: () => { phase = 'setup'; v(); },
    });
  }
  return v;
}

// ---------- Подбор ----------
function makeMatch(title, list, key) {
  let tiles, sel = null, left, t0, penalty, timer, finished;
  const bestKey = key + '|' + S.dir;
  function init() {
    const seenT = new Set(), seenD = new Set(), pick = [];
    for (const w of shuffle(list)) {
      const a = norm(w.t), b = norm(w.d);
      if (seenT.has(a) || seenD.has(b)) continue;
      seenT.add(a); seenD.add(b); pick.push(w);
      if (pick.length >= 6) break;
    }
    tiles = shuffle(pick.flatMap((w, k) => [{ k, text: w.t, w }, { k, text: w.d, w }])).map((t, idx) => ({ ...t, idx, gone: false }));
    left = pick.length; t0 = 0; penalty = 0; finished = false; sel = null;
  }
  const v = () => {
    if (!tiles) init();
    if (finished) return end();
    app.innerHTML = `${bar({ title: 'Подбор · ' + title })}<div class="study">
      <div class="timer" id="tm">0.0</div>
      <p class="muted small center" style="margin-top:-6px">Соедините слово с переводом</p>
      <div class="mgrid">${tiles.map(t => `<button class="tile ${t.text.length > 28 ? 'sm' : ''} ${t.gone ? 'gone' : ''}" data-a="tile" data-i="${t.idx}">${esc(t.text)}</button>`).join('')}</div></div>`;
    if (!t0) t0 = performance.now();
    clearInterval(timer);
    const my = viewSeq;
    timer = setInterval(() => {
      const el = document.getElementById('tm');
      if (my !== viewSeq || !el) return clearInterval(timer);
      el.textContent = ((performance.now() - t0) / 1000 + penalty).toFixed(1);
    }, 100);
    bind({ tile: el => tap(+el.dataset.i, el) });
  };
  function tap(idx, el) {
    const t = tiles[idx];
    if (t.gone) return;
    if (!isRu(t.text)) speak(t.text, 'en');
    if (sel == null) { sel = idx; el.classList.add('sel'); return; }
    const prevEl = app.querySelector(`[data-i="${sel}"]`), p = tiles[sel];
    if (sel === idx) { sel = null; el.classList.remove('sel'); return; }
    sel = null;
    prevEl.classList.remove('sel');
    if (p.k === t.k) {
      p.gone = t.gone = true; prevEl.classList.add('gone'); el.classList.add('gone');
      if (--left === 0) {
        clearInterval(timer);
        const time = (performance.now() - t0) / 1000 + penalty;
        finished = { time, prev: META.best[bestKey] };
        if (!META.best[bestKey] || time < META.best[bestKey]) { META.best[bestKey] = time; saveM(); }
        later(end, 350);
      }
    } else {
      penalty += 1;
      [prevEl, el].forEach(x => { x.classList.add('bad'); setTimeout(() => x.classList.remove('bad'), 400); });
    }
  }
  function end() {
    const { time, prev } = finished;
    const record = !prev || time < prev;
    app.innerHTML = `${bar({ title: 'Подбор · ' + title })}<div class="study"><div class="card done">
      <div class="emoji">${record ? '🏆' : '⏱️'}</div>
      <div class="score">${time.toFixed(1)} c</div>
      <h2>${record ? (prev ? 'Новый рекорд!' : 'Готово!') : 'Готово!'}</h2>
      <p class="muted">${prev ? `Лучшее время: ${Math.min(prev, time).toFixed(1)} c` : 'Это ваш первый результат'}${penalty ? ` · штраф +${penalty} c` : ''}</p>
      <div class="stack" style="margin-top:14px"><button class="btn primary" data-a="again">Играть снова</button><button class="btn ghost" data-a="back">Готово</button></div></div></div>`;
    bind({ again: () => { tiles = null; v(); } });
    onKey = e => { if (e.key === 'Enter') { tiles = null; v(); } };
  }
  return v;
}

// ---------- Настройки ----------
function viewSettings() {
  const vs = voices().filter(v => /^en/i.test(v.lang));
  const seg = (name, val, label) => `<button class="${String(S[name]) === String(val) ? 'on' : ''}" data-a="opt" data-o="${name}" data-v="${val}">${label}</button>`;
  app.innerHTML = `${bar({ title: 'Настройки' })}<main class="wrap">
    <div class="card">
      <h2>Google Таблица</h2>
      <label class="lbl" for="surl">URL скрипта таблицы</label>
      <input id="surl" type="url" placeholder="https://script.google.com/macros/s/…/exec" value="${esc(S.script)}" autocomplete="off">
      <label class="lbl" for="stok">Секретный ключ (если задали в скрипте)</label>
      <input id="stok" type="password" value="${esc(S.token)}" autocomplete="off">
      <div class="row" style="margin-top:12px"><button class="btn primary" data-a="savescript">Сохранить</button>
        ${S.script ? `<button class="btn" data-a="sync">${I.sync} Синхронизировать</button><button class="btn" data-a="addword">${I.plus} Добавить слово</button>` : ''}</div>
      <p class="muted small">${esc(syncInfo())}</p>
      ${META.lastError ? `<p class="err">${esc(META.lastError)}</p>` : ''}
      <details><summary>Как подключить</summary>${SETUP_STEPS}
        <p class="muted small">Какие листы учить, задаётся в начале скрипта: <code>const SHEETS = ['Слова для приложения'];</code>. Ваш прогресс по датам хранится на скрытом листе <code>_progress</code>, а статус — в колонке «Статус».</p></details>
      <details><summary>Как работают статусы</summary>
        <ul>
          <li><b>не знаю</b> — ошиблись или нажали «ещё учу». Слово повторяется сразу.</li>
          <li><b>повторить</b> — ответили верно. Дальше слово приходит на повторение через 1, 3, 7, 14 и 30 дней.</li>
          <li><b>выучил</b> — верно ответили на всех повторениях, включая последнее через 30 дней. Любая ошибка возвращает к «не знаю».</li>
          <li>Выученные слова раз в 2 недели приходят на проверку. Ошибка — снова «повторить».</li>
          <li>Если поменять статус прямо в таблице, приложение примет его при синхронизации.</li>
        </ul></details>
    </div>

    <div class="card">
      <h2>Занятия</h2>
      <label class="lbl">Слов за одно «Заучивание» / «Письмо»</label>
      <div class="seg">${[10, 15, 20, 30, 50].map(n => seg('session', n, n)).join('')}</div>
      <label class="switch">Перемешивать карточки <input type="checkbox" data-s="shuffle" ${S.shuffle ? 'checked' : ''}></label>
      <label class="switch">Автоматически озвучивать английские слова <input type="checkbox" data-s="autoSpeak" ${S.autoSpeak ? 'checked' : ''}></label>
      <label class="switch">Синхронизировать автоматически <input type="checkbox" data-s="autoSync" ${S.autoSync ? 'checked' : ''}></label>
      <label class="lbl" for="voice">Голос</label>
      <select id="voice"><option value="">Автоматически (en-US)</option>${vs.map(v => `<option value="${esc(v.voiceURI)}" ${v.voiceURI === S.voice ? 'selected' : ''}>${esc(v.name)} — ${esc(v.lang)}</option>`).join('')}</select>
      <label class="lbl" for="rate">Скорость речи: <span id="rv">${S.rate}</span></label>
      <div class="row"><input id="rate" class="grow" type="range" min="0.5" max="1.3" step="0.05" value="${S.rate}"><button class="btn" data-a="testvoice">${I.speak} Проверить</button></div>
      <label class="lbl">Тема</label>
      <div class="seg">${seg('theme', 'auto', 'Как в системе')}${seg('theme', 'light', 'Светлая')}${seg('theme', 'dark', 'Тёмная')}</div>
    </div>

    <div class="card">
      <h2>Данные</h2>
      <p class="muted small">Всё хранится в таблице, на устройстве — копия для работы без интернета.</p>
      <div class="row"><button class="btn" data-a="export">Сохранить копию в файл</button>
        <label class="btn">Загрузить копию<input type="file" id="imp" accept=".json,application/json" hidden></label></div>
      <div class="row" style="margin-top:10px"><button class="btn danger" data-a="wipe">Отключить и очистить это устройство</button></div>
    </div>
    <p class="foot">Мои слова · версия ${APP_VERSION}</p>
  </main>`;

  app.querySelectorAll('input[data-s]').forEach(c => c.onchange = () => { S[c.dataset.s] = c.checked; saveS(); });
  document.getElementById('voice').onchange = e => { S.voice = e.target.value; saveS(); };
  document.getElementById('rate').oninput = e => { S.rate = +e.target.value; document.getElementById('rv').textContent = S.rate; saveS(); };
  document.getElementById('imp').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const j = JSON.parse(await f.text());
      if (j.progress) mergeProgress(j.progress);
      if (Array.isArray(j.words) && j.words.length && !WORDS.length) { WORDS = j.words; saveW(); }
      toast('Копия загружена'); schedulePush();
    } catch (err) { toast('Не удалось прочитать файл'); }
  };
  bind({
    opt: el => { const n = el.dataset.o; S[n] = n === 'session' ? +el.dataset.v : el.dataset.v; saveS(); if (n === 'theme') applyTheme(); viewSettings(); },
    sync: () => sync(),
    savescript: () => saveScript(document.getElementById('surl').value, document.getElementById('stok').value),
    addword: () => go(viewAddWord),
    copycode: copyCode,
    testvoice: () => speak('Practice makes perfect.', 'en'),
    export: () => {
      const blob = new Blob([JSON.stringify({ app: 'moi-slova', v: APP_VERSION, date: new Date().toISOString(), progress: P, words: WORDS }, null, 1)], { type: 'application/json' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
      a.download = `moi-slova-${new Date().toISOString().slice(0, 10)}.json`; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    },
    wipe: () => {
      if (!confirm('Отключить таблицу и удалить данные с этого устройства? Таблица и прогресс в ней не пострадают.')) return;
      ['settings', 'words', 'progress', 'meta'].forEach(k => localStorage.removeItem(K[k]));
      location.reload();
    },
  });
}
viewSettings.refreshable = true;

function viewAddWord() {
  const tabs = META.tabs.length ? META.tabs : [...setsMap().keys()];
  app.innerHTML = `${bar({ title: 'Новое слово' })}<main class="wrap"><form class="card" id="f" autocomplete="off">
    <label class="lbl" for="t">Слово (англ.)</label><input id="t" type="text" required autocapitalize="off" lang="en">
    <label class="lbl" for="d">Перевод</label><input id="d" type="text" required>
    ${tabs.length > 1 ? `<label class="lbl" for="sh">Лист</label><select id="sh">${tabs.map(t => `<option ${t === S.lastTab ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>`
      : `<input id="sh" type="hidden" value="${esc(tabs[0] || '')}">`}
    <button class="btn primary big" type="submit" style="margin-top:16px">Добавить в таблицу</button></form></main>`;
  document.getElementById('t').focus();
  bind({});
  document.getElementById('f').onsubmit = async e => {
    e.preventDefault();
    const t = document.getElementById('t').value.trim(), d = document.getElementById('d').value.trim();
    const sheet = document.getElementById('sh').value;
    if (!t || !d) return;
    if (!sheet) return toast('Сначала синхронизируйтесь с таблицей');
    const btn = e.target.querySelector('button[type=submit]'); btn.disabled = true;
    try {
      await scriptCall({ action: 'add', sheet, rows: [[t, d]] });
      WORDS.push({ id: norm(t, true), t, d, x: '', s: sheet, st: ST.none }); saveW();
      S.lastTab = sheet; saveS();
      toast(`«${t}» добавлено`);
      e.target.reset(); document.getElementById('sh').value = sheet; document.getElementById('t').focus();
    } catch (err) { toast('Не удалось добавить: ' + err.message, 5000); }
    btn.disabled = false;
  };
}

// ---------- start ----------
function applyTheme() {
  if (S.theme === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.dataset.theme = S.theme;
}
applyTheme();
try { speechSynthesis.onvoiceschanged = () => { if (nav[nav.length - 1] === viewSettings) viewSettings(); }; } catch (e) {}
nav.push(viewHome);
history.replaceState({ n: 1 }, '');
draw();
if (S.autoSync && S.script) sync({ silent: true });
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
