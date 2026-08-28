// Camada de persistência. Financiamentos completos (com tabela de
// amortizações extras e status de parcelas pagas) vão para o IndexedDB,
// que lida bem com esse volume de dados estruturados. A única exceção é
// a preferência de tema (claro/escuro), simples o bastante para localStorage.

const DB_NAME = 'financingSimulatorDB';
const DB_VERSION = 1;
const STORE = 'financings';

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

function tx(storeMode) {
  return openDB().then((db) => db.transaction(STORE, storeMode).objectStore(STORE));
}

export function generateId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return `f-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function getAllFinancings() {
  const store = await tx('readonly');
  return new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
    req.onerror = () => reject(req.error);
  });
}

export async function getFinancing(id) {
  const store = await tx('readonly');
  return new Promise((resolve, reject) => {
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function saveFinancing(financing) {
  const now = new Date().toISOString();
  const toSave = {
    ...financing,
    id: financing.id || generateId(),
    createdAt: financing.createdAt || now,
    updatedAt: now,
  };
  const store = await tx('readwrite');
  return new Promise((resolve, reject) => {
    const req = store.put(toSave);
    req.onsuccess = () => resolve(toSave);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteFinancing(id) {
  const store = await tx('readwrite');
  return new Promise((resolve, reject) => {
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function duplicateFinancing(id) {
  const original = await getFinancing(id);
  if (!original) return null;
  const now = new Date().toISOString();
  const copy = {
    ...original,
    id: generateId(),
    nome: `${original.nome} (cópia)`,
    parcelasPagas: {},
    createdAt: now,
    updatedAt: now,
  };
  const store = await tx('readwrite');
  return new Promise((resolve, reject) => {
    const req = store.put(copy);
    req.onsuccess = () => resolve(copy);
    req.onerror = () => reject(req.error);
  });
}

export async function exportAllAsJSON() {
  const all = await getAllFinancings();
  return JSON.stringify({ version: DB_VERSION, exportedAt: new Date().toISOString(), financings: all }, null, 2);
}

export async function importFromJSON(jsonText) {
  const parsed = JSON.parse(jsonText);
  const list = Array.isArray(parsed) ? parsed : parsed.financings;
  if (!Array.isArray(list)) throw new Error('Arquivo de backup inválido.');
  const store = await tx('readwrite');
  await Promise.all(
    list.map(
      (item) =>
        new Promise((resolve, reject) => {
          const req = store.put(item);
          req.onsuccess = () => resolve();
          req.onerror = () => reject(req.error);
        })
    )
  );
  return list.length;
}

// Preferência de tema: simples o bastante para não justificar IndexedDB.
const THEME_KEY = 'financingSimulator.theme';

export function getThemePreference() {
  return localStorage.getItem(THEME_KEY);
}

export function setThemePreference(theme) {
  localStorage.setItem(THEME_KEY, theme);
}
