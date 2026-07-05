// Explorateur SQLite read-only pour le mode administration.
// Monté sous /api/admin/db AVEC requireAuth (basic-auth admin) dans server.js —
// indispensable car les GET sous /api sont publics par défaut.
const express = require('express');
const { db } = require('../db');

const router = express.Router();

// Colonnes sensibles jamais renvoyées en clair.
const REDACT = new Set(['password_hash']);
const TRUNCATE = { token: 12 }; // token de session : préfixe seulement
const MAX_CELL = 300;           // tronque les longues valeurs (ex: deck_books.data)

function listTables() {
  return db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  ).all().map(r => r.name);
}

function redactValue(col, val) {
  if (val === null || val === undefined) return null;
  if (REDACT.has(col)) return '••••••';
  let s = typeof val === 'string' ? val : String(val);
  if (TRUNCATE[col] && s.length > TRUNCATE[col]) return s.slice(0, TRUNCATE[col]) + '…';
  if (s.length > MAX_CELL) return s.slice(0, MAX_CELL) + `… (+${s.length - MAX_CELL})`;
  return s;
}

// Liste des tables + nombre de lignes.
router.get('/tables', (req, res) => {
  try {
    const tables = listTables().map(name => ({
      name,
      count: db.prepare(`SELECT COUNT(*) AS c FROM "${name}"`).get().c,
    }));
    res.json({ tables });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Lignes d'une table (pagination), colonnes sensibles rédigées.
router.get('/table/:name', (req, res) => {
  try {
    const name = req.params.name;
    if (!listTables().includes(name)) return res.status(404).json({ error: 'Table inconnue' });

    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 500);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    const columns = db.prepare(`PRAGMA table_info("${name}")`).all().map(c => c.name);
    const total = db.prepare(`SELECT COUNT(*) AS c FROM "${name}"`).get().c;
    const rawRows = db.prepare(`SELECT * FROM "${name}" LIMIT ? OFFSET ?`).all(limit, offset);

    const rows = rawRows.map(row => {
      const out = {};
      for (const col of columns) out[col] = redactValue(col, row[col]);
      return out;
    });

    res.json({ name, columns, rows, total, limit, offset });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
