const STORAGE_KEY = 'soulforge_decks';
const ACTIVE_KEY = 'soulforge_active_deck';
const PENDING_EDIT_KEY = 'soulforge_pending_edit';
const META_KEY = 'soulforge_deck_meta';

function load() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}

function save(decks) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(decks));
}

function loadMeta() {
  try { return JSON.parse(localStorage.getItem(META_KEY) || '{}'); } catch { return {}; }
}

function saveMeta(meta) {
  localStorage.setItem(META_KEY, JSON.stringify(meta));
}

function _deleteMeta(name) {
  const meta = loadMeta();
  delete meta[name];
  saveMeta(meta);
}

export function getDeckColor(name) {
  return loadMeta()[name]?.color ?? null;
}

export function setDeckColor(name, color) {
  const meta = loadMeta();
  meta[name] = { ...(meta[name] || {}), color };
  saveMeta(meta);
}

export function getDeckTags(name) {
  return loadMeta()[name]?.tags ?? [];
}

export function setDeckTags(name, tags) {
  const meta = loadMeta();
  meta[name] = { ...(meta[name] || {}), tags };
  saveMeta(meta);
}

// Sauvegarde un deck. Structure : { "1": ["ID", ...], "2": [...], ... }
export function saveDeck(name, deckData) {
  const decks = load();
  decks[name] = deckData;
  save(decks);
}

export function loadDeck(name) {
  return load()[name] ?? null;
}

export function deleteDeck(name) {
  const decks = load();
  delete decks[name];
  save(decks);
  _deleteMeta(name);
  if (getActiveDeck() === name) localStorage.removeItem(ACTIVE_KEY);
}

export function renameDeck(oldName, newName) {
  const decks = load();
  if (!decks[oldName]) throw new Error(`Deck "${oldName}" introuvable`);
  if (decks[newName]) throw new Error(`Un deck "${newName}" existe déjà`);
  decks[newName] = decks[oldName];
  delete decks[oldName];
  save(decks);
  const meta = loadMeta();
  if (meta[oldName]) { meta[newName] = meta[oldName]; delete meta[oldName]; saveMeta(meta); }
  if (getActiveDeck() === oldName) setActiveDeck(newName);
}

export function listDecks() {
  return Object.keys(load());
}

export function deckExists(name) {
  return name in load();
}

// Trouve un nom de deck libre en partant de `baseName` (ajoute " (2)", " (3)", ... si besoin)
export function findFreeName(baseName) {
  const decks = load();
  if (!(baseName in decks)) return baseName;
  let i = 2;
  while (`${baseName} (${i})` in decks) i++;
  return `${baseName} (${i})`;
}

export function setActiveDeck(name) {
  localStorage.setItem(ACTIVE_KEY, name);
}

export function getActiveDeck() {
  return localStorage.getItem(ACTIVE_KEY) ?? null;
}

export function hasActiveDeck() {
  const name = getActiveDeck();
  return name !== null && deckExists(name);
}

// Utilisé par DeckSelector pour ouvrir DeckBuilder en mode édition
export function setPendingEdit(deckName) {
  sessionStorage.setItem(PENDING_EDIT_KEY, deckName);
}

export function consumePendingEdit() {
  const name = sessionStorage.getItem(PENDING_EDIT_KEY) ?? null;
  sessionStorage.removeItem(PENDING_EDIT_KEY);
  return name;
}
