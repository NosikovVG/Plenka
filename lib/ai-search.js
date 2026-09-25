/* ==========================================================================
   ai-search.js — модуль умного поиска по лекалам
   Работает локально в браузере, ничего не отправляет на сервер.
   Модель грузится с Hugging Face при первом запуске и кешируется.
   ========================================================================== */

let _pipeline = null;
let _getRecords = null;
const _modelId = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';

/* --- IndexedDB для индекса (эмбеддингов) --- */
const AI_DB = 'ai_embeddings_db';
const AI_STORE = 'embeddings';

function _idbOpen() {
  return new Promise((res, rej) => {
    const req = indexedDB.open(AI_DB, 1);
    req.onupgradeneeded = () => {
      const idb = req.result;
      if (!idb.objectStoreNames.contains(AI_STORE)) idb.createObjectStore(AI_STORE);
    };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}
async function _idbGet(key) {
  const idb = await _idbOpen();
  return new Promise((res, rej) => {
    const tx = idb.transaction(AI_STORE, 'readonly');
    const req = tx.objectStore(AI_STORE).get(key);
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}
async function _idbSet(key, val) {
  const idb = await _idbOpen();
  return new Promise((res, rej) => {
    const tx = idb.transaction(AI_STORE, 'readwrite');
    tx.objectStore(AI_STORE).put(val, key);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

/* --- Инициализация --- */
export async function init(opts) {
  opts = opts || {};
  const { onProgress, onIndexProgress, libPath, getRecords } = opts;
  _getRecords = getRecords || (() => []);

  // Динамический импорт библиотеки
  const lib = await import(
  libPath
    ? new URL(libPath, import.meta.url).href
    : new URL('./transformers.min.js', import.meta.url).href
);
  const { pipeline, env } = lib;

  // Модель берём удалённо с Hugging Face
  env.allowLocalModels = false;
  env.allowRemoteModels = true;
  env.remoteHost = 'https://huggingface.co';
  env.useBrowserCache = true;

  // Грузим pipeline
  _pipeline = await pipeline('feature-extraction', _modelId, {
    quantized: true,
    progress_callback: (p) => {
      if (onProgress && p) {
        if (p.status === 'progress' && p.total) {
          onProgress(Math.min(1, p.loaded / p.total));
        }
      }
    }
  });
  if (onProgress) onProgress(1);

  // Сразу строим индекс
  await buildIndex(onIndexProgress);
  return true;
}

/* --- Утилиты --- */
async function _embed(text) {
  if (!_pipeline) throw new Error('Модель не загружена');
  const out = await _pipeline(text, { pooling: 'mean', normalize: true });
  return Array.from(out.data);
}

function _recordToText(rec) {
  return [
    rec.marka || '',
    rec.model || '',
    rec.artikul || '',
    rec.raspolozhenie || '',
    rec.tip_plenki || ''
  ].filter(Boolean).join(' · ');
}

function _cosine(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function _hashRecords(records) {
  return records
    .map(r => `${r.id}:${r.marka || ''}:${r.model || ''}:${r.artikul || ''}`)
    .join('|');
}

/* --- Построение индекса --- */
export async function buildIndex(onProgress) {
  const records = _getRecords ? _getRecords() : [];
  if (!records.length) return [];

  const hash = _hashRecords(records);
  const cached = await _idbGet('index');

  if (cached && cached.hash === hash && Array.isArray(cached.entries)) {
    return cached.entries;
  }

  const entries = [];
  const total = records.length;
  for (let i = 0; i < total; i++) {
    const text = _recordToText(records[i]);
    const vec = await _embed(text);
    entries.push({ id: records[i].id, vec });
    if (onProgress && i % 5 === 0) onProgress((i + 1) / total);
  }

  await _idbSet('index', { hash, entries, createdAt: Date.now() });
  if (onProgress) onProgress(1);
  return entries;
}

/* --- Поиск --- */
export async function search(query, limit) {
  if (!_pipeline) throw new Error('Модель не загружена');
  const q = String(query || '').trim();
  if (!q) return [];

  const entries = await buildIndex();
  if (!entries.length) return [];

  const qVec = await _embed(q);
  const scored = entries.map(e => ({ id: e.id, score: _cosine(qVec, e.vec) }));
  scored.sort((a, b) => b.score - a.score);
   console.log('[AI-search] Запрос:', q, '| записей:', entries.length, '| топ:', scored.slice(0,5).map(s => Number(s.score).toFixed(3)));

  const lim = limit || 40;
  return scored.slice(0, lim).filter(s => s.score > 0.25);
}

/* --- Сброс индекса --- */
export async function resetIndex() {
  await _idbSet('index', null);
}
