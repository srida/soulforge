import { navigate } from '../../main.js';
import * as CardDatabase from '../../data/CardDatabase.js';
import * as DeckRepository from '../../data/DeckRepository.js';
import * as PowerDatabase from '../../data/PowerDatabase.js';
import * as AttributeDatabase from '../../data/AttributeDatabase.js';
import * as Tooltip from '../components/Tooltip.js';

const TIER_COLOR = ['', 'tier1', 'tier2', 'tier3', 'tier4', 'tier5'];
const SUMMON_TYPES = ['normal', 'sacrifice', 'fusion', 'heritage', 'transformation'];
const DECK_MIN = 20; // minimum total cards across all tiers

export async function mount(container, params = {}) {
  await Promise.all([CardDatabase.init(), PowerDatabase.init(), AttributeDatabase.init()]);

  // Mode "deck public" (admin) : édite un deck stocké côté serveur via /api/decks/:id
  const publicDeckId = params.publicDeckId || null;
  let publicDeck = null;

  // Edit mode: params.deckName has priority, then consumePendingEdit()
  const pendingName = publicDeckId ? null : DeckRepository.consumePendingEdit();
  const editName    = params.deckName || pendingName || null;

  // State
  let deckName       = editName || '';
  let activeTier     = 1;
  let searchQuery    = '';
  let summonFilter   = '';
  let attributeFilter = '';
  const deckMin      = publicDeckId ? 0 : DECK_MIN;

  // deckData[t] = Card[] (objects, duplicates allowed)
  const deckData = { 1: [], 2: [], 3: [], 4: [], 5: [] };

  // Load existing deck when editing
  if (publicDeckId) {
    const decks = await fetch('/api/decks').then(r => r.json()).catch(() => []);
    publicDeck = Array.isArray(decks) && decks.find(d => d.id === publicDeckId);
    if (publicDeck) {
      deckName = publicDeck.name || '';
      for (let t = 1; t <= 5; t++) {
        deckData[t] = (publicDeck.deck?.[String(t)] ?? []).map(id => CardDatabase.getCard(id)).filter(Boolean);
      }
    }
  } else if (editName) {
    const saved = DeckRepository.loadDeck(editName);
    if (saved) {
      for (let t = 1; t <= 5; t++) {
        deckData[t] = (saved[String(t)] ?? []).map(id => CardDatabase.getCard(id)).filter(Boolean);
      }
    }
  }

  // Max slots per tier = min(8, pool_size) — no per-tier minimum, total must reach DECK_MIN
  const tierMax = {};
  for (let t = 1; t <= 5; t++) {
    tierMax[t] = Math.min(8, CardDatabase.getCardsByTier(t).length);
  }

  // ── Render shell ──────────────────────────────────────────────────────────

  container.innerHTML = `
    <div class="topbar">
      <button class="topbar-back" id="btn-back">←</button>
      <input class="deck-name-input" id="deck-name" type="text"
        placeholder="Nom du deck…" value="${esc(deckName)}" maxlength="32">
      <button class="btn btn-primary" id="btn-save" disabled>Sauvegarder</button>
    </div>
    <div class="deck-builder-layout">
      <div class="deck-slots-panel">
        <p class="tier-hint" id="deck-total-hint">${publicDeckId ? '0 cartes · max 8 par tier' : '0/20 cartes · max 8 par tier'}</p>
        <div class="deck-tiers" id="deck-tiers"></div>
      </div>
      <div class="card-browser-panel">
        <div class="summon-filter-bar" id="summon-filters">
          <button class="filter-pill active" data-type="">Tous</button>
          ${SUMMON_TYPES.map(t => `<button class="filter-pill" data-type="${t}">${cap(t)}</button>`).join('')}
        </div>
        <select class="attribute-select" id="attribute-select">
          <option value="">Tous les attributs</option>
          ${AttributeDatabase.getAllAttributes()
            .slice().sort((a, b) => a.name.localeCompare(b.name, 'fr'))
            .map(a => `<option value="${esc(a.id)}">${esc(a.icon ?? '')} ${esc(a.name)}</option>`)
            .join('')}
        </select>
        <input class="search-input" id="search" type="search" placeholder="Rechercher…">
        <div class="card-grid" id="card-grid"></div>
      </div>
    </div>
  `;

  const btnSave    = container.querySelector('#btn-save');
  const nameInput  = container.querySelector('#deck-name');
  const searchInput = container.querySelector('#search');
  const tiersEl   = container.querySelector('#deck-tiers');
  const cardGrid   = container.querySelector('#card-grid');

  // ── Tier panel ────────────────────────────────────────────────────────────

  function renderTiers() {
    tiersEl.innerHTML = [1, 2, 3, 4, 5].map(t => {
      const req    = tierMax[t];
      const filled = deckData[t];
      const isAct  = t === activeTier;
      return `
        <div class="tier-row${isAct ? ' active' : ''}" data-tier="${t}">
          <span class="tier-label badge badge-${TIER_COLOR[t]}">
            T${t}&nbsp;<span class="tier-count">${filled.length}/${req}</span>
          </span>
          <div class="tier-slots">
            ${filled.map((card, idx) => `
              <div class="deck-slot filled" title="${esc(card.name)}">
                <img src="/illustrations/${card.id}" alt="${esc(card.name)}" loading="lazy">
                <button class="slot-remove" data-tier="${t}" data-idx="${idx}">×</button>
              </div>`).join('')}
            ${Array(Math.max(0, req - filled.length)).fill('<div class="deck-slot empty"></div>').join('')}
          </div>
        </div>`;
    }).join('');

    // Tier row click → set active tier
    tiersEl.querySelectorAll('.tier-row').forEach(row => {
      row.addEventListener('click', e => {
        if (e.target.closest('.slot-remove')) return;
        activeTier = parseInt(row.dataset.tier, 10);
        renderTiers();
        renderBrowser();
      });
    });

    // Remove card from slot
    tiersEl.querySelectorAll('.slot-remove').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const t   = parseInt(btn.dataset.tier, 10);
        const idx = parseInt(btn.dataset.idx, 10);
        deckData[t].splice(idx, 1);
        renderTiers();
        renderBrowser();
        updateSave();
      });
    });
  }

  // ── Card browser ──────────────────────────────────────────────────────────

  function renderBrowser() {
    const pool  = CardDatabase.getCardsByTier(activeTier);
    const query = searchQuery.toLowerCase().trim();

    const filtered = pool.filter(c => {
      if (summonFilter && c.summon_type !== summonFilter) return false;
      if (attributeFilter && !(c.attributes ?? []).includes(attributeFilter)) return false;
      if (query && !c.name.toLowerCase().includes(query)) return false;
      return true;
    });

    // Count copies already picked for this tier
    const countInTier = {};
    for (const c of deckData[activeTier]) {
      countInTier[c.id] = (countInTier[c.id] || 0) + 1;
    }

    const req    = tierMax[activeTier];
    const isFull = deckData[activeTier].length >= req;

    if (filtered.length === 0) {
      cardGrid.innerHTML = `<p class="loading-text">Aucune carte trouvée.</p>`;
      return;
    }

    cardGrid.innerHTML = '';
    for (const c of filtered) {
      const count = countInTier[c.id] || 0;
      const btn = document.createElement('button');
      btn.className = 'card-item hand-card' + (isFull ? ' full' : '');
      btn.dataset.id = c.id;

      const T = TIER_COLORS[c.tier] || TIER_COLORS[2];
      btn.style.setProperty('--hc-edge', T.edge);
      btn.style.setProperty('--hc-ink', T.ink);
      btn.style.setProperty('--hc-glow', T.glow);
      btn.style.setProperty('--hc-art', T.art);

      const summon = c.summon_type ?? 'normal';
      const hasIcon = summon !== 'normal' && !Array.isArray(c.summon_options);
      const sacrificeCost = summon === 'sacrifice' ? (c.cost?.sacrifice ?? 0) : 0;

      btn.innerHTML = `
        <img class="hand-card-img" src="/illustrations/${c.id}" alt="${esc(c.name)}" loading="lazy" draggable="false">
        <div class="hand-card-edge-glow"></div>
        <div class="hand-card-footer"><span class="hand-card-name">${esc(c.name)}</span></div>
        <div class="hand-card-tier-badge">T${c.tier}</div>
        ${hasIcon ? `<div class="hand-card-summon-icon">${_summonSvg(summon, T.ink)}${sacrificeCost > 0 ? `<span class="hand-card-summon-count">×${sacrificeCost}</span>` : ''}</div>` : ''}
        ${count > 0 ? `<span class="card-count">×${count}</span>` : ''}
      `;

      // Long press → tooltip
      let longPressTimer;
      btn.addEventListener('pointerdown', e => {
        longPressTimer = setTimeout(() => {
          Tooltip.showAtRect(Tooltip.cardHtml(c, PowerDatabase, AttributeDatabase, CardDatabase), btn.getBoundingClientRect());
        }, 500);
      });
      btn.addEventListener('pointerup',     () => clearTimeout(longPressTimer));
      btn.addEventListener('pointercancel', () => clearTimeout(longPressTimer));

      if (!isFull) {
        btn.addEventListener('click', () => {
          clearTimeout(longPressTimer);
          Tooltip.hide();
          const card = CardDatabase.getCard(btn.dataset.id);
          if (!card) return;
          if (deckData[activeTier].length >= tierMax[activeTier]) return;
          deckData[activeTier].push(card);
          renderTiers();
          renderBrowser();
          updateSave();
        });
      }
      cardGrid.appendChild(btn);
    }
  }

  // ── Save validation ───────────────────────────────────────────────────────

  function updateSave() {
    const hasName   = nameInput.value.trim().length > 0;
    const total     = [1, 2, 3, 4, 5].reduce((s, t) => s + deckData[t].length, 0);
    const tierValid = [1, 2, 3, 4, 5].every(t => deckData[t].length <= tierMax[t]);
    const hint = container.querySelector('#deck-total-hint');
    if (hint) {
      hint.textContent = publicDeckId
        ? `${total} cartes · max 8 par tier`
        : `${total}/${DECK_MIN} cartes · max 8 par tier`;
    }
    btnSave.disabled = !(hasName && total >= deckMin && tierValid);
  }

  // ── Events ────────────────────────────────────────────────────────────────

  container.querySelector('#btn-back').addEventListener('click', () => {
    if (publicDeckId && window.parent !== window) {
      window.parent.postMessage({ type: 'soulforge-deckbuilder-close' }, '*');
      return;
    }
    navigate('deck_selector');
  });

  nameInput.addEventListener('input', () => {
    deckName = nameInput.value;
    updateSave();
  });

  searchInput.addEventListener('input', () => {
    searchQuery = searchInput.value;
    renderBrowser();
  });

  container.querySelector('#attribute-select').addEventListener('change', e => {
    attributeFilter = e.target.value;
    renderBrowser();
  });

  container.querySelector('#summon-filters').addEventListener('click', e => {
    const pill = e.target.closest('.filter-pill');
    if (!pill) return;
    summonFilter = pill.dataset.type;
    container.querySelectorAll('.filter-pill').forEach(p =>
      p.classList.toggle('active', p.dataset.type === summonFilter));
    renderBrowser();
  });

  btnSave.addEventListener('click', async () => {
    const name = nameInput.value.trim();
    if (!name) return;

    const toSave = {};
    for (let t = 1; t <= 5; t++) {
      toSave[String(t)] = deckData[t].map(c => c.id);
    }

    if (publicDeckId) {
      const res = await fetch(`/api/decks/${publicDeckId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: publicDeckId, name, deck: toSave }),
      }).then(r => r.json()).catch(e => ({ error: e.message }));
      if (res.error) { alert(res.error); return; }
      if (window.parent !== window) {
        window.parent.postMessage({ type: 'soulforge-deckbuilder-saved' }, '*');
        return;
      }
      navigate('deck_selector');
      return;
    }

    // Warn if overwriting a different deck
    if (DeckRepository.deckExists(name) && name !== editName) {
      if (!confirm(`Un deck "${name}" existe déjà. Écraser ?`)) return;
    }

    // Rename: delete old key
    if (editName && editName !== name && DeckRepository.deckExists(editName)) {
      DeckRepository.deleteDeck(editName);
    }

    DeckRepository.saveDeck(name, toSave);
    navigate('deck_selector');
  });

  // ── Initial render ────────────────────────────────────────────────────────

  renderTiers();
  renderBrowser();
  updateSave();
}

const TIER_COLORS = {
  1: { edge:'#46d39a', ink:'#7ef0c0', glow:'rgba(70,211,154,.55)',  art:'linear-gradient(155deg,#1f4a3a,#0e231d)' },
  2: { edge:'#5fb4e8', ink:'#9ad2f6', glow:'rgba(95,180,232,.55)',  art:'linear-gradient(155deg,#1f3a52,#0e1d2c)' },
  3: { edge:'#a78bfa', ink:'#cdbcff', glow:'rgba(167,139,250,.55)', art:'linear-gradient(155deg,#352663,#181230)' },
  4: { edge:'#e8a850', ink:'#f0c48a', glow:'rgba(232,168,80,.55)',  art:'linear-gradient(155deg,#5a3f1c,#2c1d0d)' },
  5: { edge:'#e85a6e', ink:'#f5a0ad', glow:'rgba(232,90,110,.55)',  art:'linear-gradient(155deg,#5a1f2c,#2c0e15)' },
};

function _summonSvg(type, ink) {
  const a = `width="55%" height="55%" viewBox="0 0 24 24" fill="none" stroke="${ink}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"`;
  if (type === 'sacrifice')
    return `<svg ${a}><path d="M12 3c1.6 3 3.6 4.3 3.6 7.6a3.6 3.6 0 0 1-7.2 0c0-1.7.9-2.9 1.7-3.7.2 1.5 1.1 2.1 2 2.3C12.7 8.2 11.4 5.7 12 3z"/></svg>`;
  if (type === 'fusion')
    return `<svg ${a}><circle cx="9.5" cy="12" r="5"/><circle cx="14.5" cy="12" r="5"/></svg>`;
  if (type === 'heritage')
    return `<svg ${a}><path d="M5 18h14"/><path d="M5 18V8.5l3.4 3 3.6-6 3.6 6 3.4-3V18"/></svg>`;
  if (type === 'transformation')
    return `<svg ${a}><path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20 4v4h-4"/></svg>`;
  return '';
}

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function cap(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
