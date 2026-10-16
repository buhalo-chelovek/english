/**
 * «Мои слова» — синхронизация приложения с этой Google Таблицей.
 *
 * Установка: «Расширения» → «Apps Script» → вставить этот код → «Начать развёртывание» →
 * «Новое развёртывание» → «Веб-приложение» («Запуск от имени: Я», «У кого есть доступ: Все»).
 * URL, заканчивающийся на /exec, вставьте в приложение.
 *
 * - слова берутся с листов из SHEETS: A — английский, B — перевод, колонка «Статус» (или C);
 * - приложение записывает статус: «не знаю», «повторить», «выучил»;
 * - даты повторений хранятся на скрытом листе _progress (руками его трогать не нужно).
 */

// Какие листы учить. Пустой список [] — все листы, кроме скрытых и начинающихся с «_».
const SHEETS = ['Слова для приложения'];

// Необязательно: придумайте секрет и укажите его же в настройках приложения.
const TOKEN = '';

const PROGRESS_SHEET = '_progress';

function doGet(e) {
  if (!authorized_(e.parameter.token)) return json_({ error: 'Неверный секретный ключ' });
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const out = { sheets: [], progress: {} };
  wordSheets_(ss).forEach(function (sh) {
    out.sheets.push({ name: sh.getName(), values: sh.getDataRange().getDisplayValues() });
  });
  const p = ss.getSheetByName(PROGRESS_SHEET);
  if (p) out.progress = readProgress_(p);
  return json_(out);
}

function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return json_({ error: 'Плохой запрос' }); }
  if (!authorized_(body.token)) return json_({ error: 'Неверный секретный ключ' });
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    if (body.action === 'update') return json_(update_(body.items || {}));
    if (body.action === 'add') return json_(addWords_(body.sheet, body.rows || []));
    return json_({ error: 'Неизвестное действие' });
  } finally {
    lock.releaseLock();
  }
}

function authorized_(token) {
  return !TOKEN || token === TOKEN;
}

function wordSheets_(ss) {
  if (SHEETS.length) {
    return SHEETS.map(function (n) { return ss.getSheetByName(n); }).filter(Boolean);
  }
  return ss.getSheets().filter(function (sh) {
    return sh.getName().charAt(0) !== '_' && !sh.isSheetHidden();
  });
}

function readProgress_(sh) {
  const values = sh.getDataRange().getValues();
  const p = {};
  for (let i = 1; i < values.length; i++) {
    if (!values[i][0]) continue;
    try { p[values[i][0]] = JSON.parse(values[i][1]); } catch (err) {}
  }
  return p;
}

// Сохраняет прогресс (побеждает более свежая запись) и пишет статус в лист со словами.
function update_(items) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(PROGRESS_SHEET);
  if (!sh) {
    sh = ss.insertSheet(PROGRESS_SHEET);
    sh.getRange('A:B').setNumberFormat('@');
    sh.getRange(1, 1, 1, 2).setValues([['id', 'data']]);
    sh.hideSheet();
  }
  const values = sh.getDataRange().getValues().map(function (r) { return [String(r[0]), String(r[1])]; });
  const index = {};
  values.forEach(function (r, i) { if (i) index[r[0]] = i; });
  const accepted = [];
  Object.keys(items).forEach(function (id) {
    const rec = items[id];
    const s = JSON.stringify(rec);
    if (index[id] != null) {
      let old = null;
      try { old = JSON.parse(values[index[id]][1]); } catch (err) {}
      if (old && (old.u || 0) > (rec.u || 0)) return;
      values[index[id]][1] = s;
    } else {
      index[id] = values.length;
      values.push([id, s]);
    }
    accepted.push(rec);
  });
  sh.getRange(1, 1, values.length, 2).setNumberFormat('@').setValues(values);
  return { ok: true, saved: accepted.length, statuses: writeStatuses_(ss, accepted) };
}

function writeStatuses_(ss, recs) {
  const bySheet = {};
  recs.forEach(function (r) {
    if (r.t && r.sh && typeof r.st === 'string') (bySheet[r.sh] = bySheet[r.sh] || []).push(r);
  });
  let n = 0;
  Object.keys(bySheet).forEach(function (name) {
    const sh = ss.getSheetByName(name);
    if (!sh) return;
    const values = sh.getDataRange().getDisplayValues();
    const col = statusColumn_(values[0]);
    const rows = {};
    values.forEach(function (r, i) {
      const k = key_(r[0]);
      if (k) (rows[k] = rows[k] || []).push(i);
    });
    bySheet[name].forEach(function (r) {
      (rows[key_(r.t)] || []).forEach(function (i) {
        if ((values[i][col] || '') !== r.st) { sh.getRange(i + 1, col + 1).setValue(r.st); n++; }
      });
    });
  });
  return n;
}

function statusColumn_(header) {
  for (let i = 0; i < header.length; i++) {
    if (/^(статус|status)/i.test(String(header[i]).trim())) return i;
  }
  return 2; // колонка C
}

function key_(s) {
  return String(s || '').trim().toLowerCase();
}

function addWords_(sheetName, rows) {
  if (!rows.length) return { ok: true, added: 0 };
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(sheetName) || ss.insertSheet(sheetName);
  rows.forEach(function (r) { sh.appendRow([r[0], r[1]]); });
  return { ok: true, added: rows.length };
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
