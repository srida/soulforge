// SQLite layer for the online features (accounts, sessions, friends).
// Single file DB stored on the Railway volume (DATA_DIR). Synchronous API,
// cohérent avec le style synchrone du reste du serveur (readJson/writeJson).
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_FILE = path.join(DATA_DIR, 'soulforge.db');
const db = new Database(DB_FILE);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// --- Migrations (idempotentes) ---
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE,
    username      TEXT NOT NULL UNIQUE,
    username_lc   TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    avatar        TEXT,
    created_at    INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

  CREATE TABLE IF NOT EXISTS friendships (
    id           TEXT PRIMARY KEY,
    requester_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    addressee_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status       TEXT NOT NULL DEFAULT 'pending',
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL,
    UNIQUE(requester_id, addressee_id)
  );
  CREATE INDEX IF NOT EXISTS idx_friend_requester ON friendships(requester_id);
  CREATE INDEX IF NOT EXISTS idx_friend_addressee ON friendships(addressee_id);

  -- Un "deck book" par joueur : blob JSON { decks, meta, active } miroir du
  -- DeckRepository côté client. Le client pousse/récupère l'ensemble d'un bloc.
  CREATE TABLE IF NOT EXISTS deck_books (
    user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    data       TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
`);

// Ajout additif de colonne (ALTER TABLE ADD COLUMN échoue si déjà présente,
// donc on vérifie via PRAGMA avant — CREATE TABLE IF NOT EXISTS ne suffit
// pas pour les colonnes ajoutées après coup à une table existante).
const userColumns = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
if (!userColumns.includes('is_admin')) {
  db.exec('ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0');
}

// --- Prepared statements ---
const stmt = {
  insertUser: db.prepare(`
    INSERT INTO users (id, email, username, username_lc, password_hash, avatar, created_at)
    VALUES (@id, @email, @username, @username_lc, @password_hash, @avatar, @created_at)
  `),
  userById: db.prepare('SELECT * FROM users WHERE id = ?'),
  userByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
  userByUsernameLc: db.prepare('SELECT * FROM users WHERE username_lc = ?'),
  updateProfile: db.prepare('UPDATE users SET username = @username, username_lc = @username_lc, avatar = @avatar WHERE id = @id'),
  setUserAdmin: db.prepare('UPDATE users SET is_admin = ? WHERE id = ?'),
  searchUsers: db.prepare(`
    SELECT id, username, avatar FROM users
    WHERE username_lc LIKE ? AND id != ?
    ORDER BY username_lc LIMIT 20
  `),

  insertSession: db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'),
  sessionByToken: db.prepare('SELECT * FROM sessions WHERE token = ?'),
  deleteSession: db.prepare('DELETE FROM sessions WHERE token = ?'),
  deleteExpiredSessions: db.prepare('DELETE FROM sessions WHERE expires_at < ?'),

  insertFriendship: db.prepare(`
    INSERT INTO friendships (id, requester_id, addressee_id, status, created_at, updated_at)
    VALUES (@id, @requester_id, @addressee_id, @status, @created_at, @updated_at)
  `),
  friendshipById: db.prepare('SELECT * FROM friendships WHERE id = ?'),
  // Cherche une relation existante entre deux users, dans un sens ou l'autre.
  friendshipBetween: db.prepare(`
    SELECT * FROM friendships
    WHERE (requester_id = @a AND addressee_id = @b)
       OR (requester_id = @b AND addressee_id = @a)
  `),
  updateFriendshipStatus: db.prepare('UPDATE friendships SET status = @status, updated_at = @updated_at WHERE id = @id'),
  deleteFriendship: db.prepare('DELETE FROM friendships WHERE id = ?'),
  // Amitiés acceptées impliquant l'utilisateur, avec le profil de l'"autre".
  acceptedFriends: db.prepare(`
    SELECT u.id, u.username, u.avatar, f.id AS friendship_id
    FROM friendships f
    JOIN users u ON u.id = CASE WHEN f.requester_id = @uid THEN f.addressee_id ELSE f.requester_id END
    WHERE f.status = 'accepted' AND (f.requester_id = @uid OR f.addressee_id = @uid)
    ORDER BY u.username_lc
  `),
  incomingRequests: db.prepare(`
    SELECT f.id AS friendship_id, u.id, u.username, u.avatar, f.created_at
    FROM friendships f
    JOIN users u ON u.id = f.requester_id
    WHERE f.status = 'pending' AND f.addressee_id = ?
    ORDER BY f.created_at DESC
  `),
  outgoingRequests: db.prepare(`
    SELECT f.id AS friendship_id, u.id, u.username, u.avatar, f.created_at
    FROM friendships f
    JOIN users u ON u.id = f.addressee_id
    WHERE f.status = 'pending' AND f.requester_id = ?
    ORDER BY f.created_at DESC
  `),

  deckBookByUser: db.prepare('SELECT data FROM deck_books WHERE user_id = ?'),
  upsertDeckBook: db.prepare(`
    INSERT INTO deck_books (user_id, data, updated_at) VALUES (@user_id, @data, @updated_at)
    ON CONFLICT(user_id) DO UPDATE SET data = @data, updated_at = @updated_at
  `),
};

module.exports = { db, stmt, DB_FILE };
