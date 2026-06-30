import { navigate } from '../../main.js';
import * as CardDatabase from '../../data/CardDatabase.js';
import * as DeckRepository from '../../data/DeckRepository.js';
import * as PowerDatabase from '../../data/PowerDatabase.js';
import * as AttributeDatabase from '../../data/AttributeDatabase.js';
import * as Tooltip from '../components/Tooltip.js';

const DECK_COLORS = [
  '#7c5cff', '#e85a6e', '#46d39a', '#5fb4e8',
  '#e8a850', '#c084fc',
  '#facc15', '#f0f0f0', '#0f0f1a', '#92400e',
];

const DECK_MIN = 20;

const TIER_DEFS = [
  { t:1, tint:'rgba(70,211,154,.14)',  border:'rgba(70,211,154,.30)',  ink:'#7ef0c0', chipBg:'rgba(70,211,154,.10)',  edge:'#46d39a' },
  { t:2, tint:'rgba(95,180,232,.14)',  border:'rgba(95,180,232,.30)',  ink:'#9ad2f6', chipBg:'rgba(95,180,232,.10)',  edge:'#5fb4e8' },
  { t:3, tint:'rgba(167,139,250,.16)', border:'rgba(167,139,250,.32)', ink:'#cdbcff', chipBg:'rgba(167,139,250,.12)', edge:'#a78bfa' },
  { t:4, tint:'rgba(232,168,80,.14)',  border:'rgba(232,168,80,.32)',  ink:'#f0c48a', chipBg:'rgba(232,168,80,.10)',  edge:'#e8a850' },
  { t:5, tint:'rgba(232,90,110,.14)',  border:'rgba(232,90,110,.32)',  ink:'#f5a0ad', chipBg:'rgba(232,90,110,.10)',  edge:'#e85a6e' },
];

const TIER_COLORS = {
  1: { edge:'#46d39a', ink:'#7ef0c0', glow:'rgba(70,211,154,.55)',  art:'linear-gradient(155deg,#1f4a3a,#0e231d)' },
  2: { edge:'#5fb4e8', ink:'#9ad2f6', glow:'rgba(95,180,232,.55)',  art:'linear-gradient(155deg,#1f3a52,#0e1d2c)' },
  3: { edge:'#a78bfa', ink:'#cdbcff', glow:'rgba(167,139,250,.55)', art:'linear-gradient(155deg,#352663,#181230)' },
  4: { edge:'#e8a850', ink:'#f0c48a', glow:'rgba(232,168,80,.55)',  art:'linear-gradient(155deg,#5a3f1c,#2c1d0d)' },
  5: { edge:'#e85a6e', ink:'#f5a0ad', glow:'rgba(232,90,110,.55)',  art:'linear-gradient(155deg,#5a1f2c,#2c0e15)' },
};

const SUMMON_LABELS = { normal:'Normal', sacrifice:'Sacrifice', fusion:'Fusion', heritage:'Héritage', transformation:'Transformation' };
const AVATAR_COLORS  = ['#7c5cff','#a06bff','#5f54d4','#8b38d4','#6d28d9','#9333ea','#c084fc','#a78bfa'];

export async function mount(container, params = {}) {
  await Promise.all([CardDatabase.init(), PowerDatabase.init(), AttributeDatabase.init()]);

  const publicDeckId = params.publicDeckId || null;
  let   publicDeck   = null;
  const pendingName  = publicDeckId ? null : DeckRepository.consumePendingEdit();
  const editName     = params.deckName || pendingName || null;

  let deckName       = editName || '';
  let deckColor      = DeckRepository.getDeckColor?.(editName || '') ?? null;
  let searchQuery    = '';
  let summonFilter   = '';
  let attributeFilter = '';
  const deckMin      = publicDeckId ? 0 : DECK_MIN;

  const deckData = { 1:[], 2:[], 3:[], 4:[], 5:[] };

  if (publicDeckId) {
    const decks = await fetch('/api/decks').then(r => r.json()).catch(() => []);
    publicDeck = Array.isArray(decks) && decks.find(d => d.id === publicDeckId);
    if (publicDeck) {
      deckName = publicDeck.name || '';
      for (let t = 1; t <= 5; t++)
        deckData[t] = (publicDeck.deck?.[String(t)] ?? []).map(id => CardDatabase.getCard(id)).filter(Boolean);
    }
  } else if (editName) {
    const saved = DeckRepository.loadDeck(editName);
    if (saved) {
      for (let t = 1; t <= 5; t++)
        deckData[t] = (saved[String(t)] ?? []).map(id => CardDatabase.getCard(id)).filter(Boolean);
    }
  }

  const tierMax = {};
  for (let t = 1; t <= 5; t++) tierMax[t] = Math.min(8, CardDatabase.getCardsByTier(t).length);

  // ── Shell ────────────────────────────────────────────────────────────────

  container.innerHTML = `
    <div class="db-topbar">
      <button class="db-back-btn" id="db-back" aria-label="Retour">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4 L6 10 L12 16"/></svg>
      </button>
      <div class="db-name-wrap">
        <div class="db-avatar" id="db-avatar"></div>
        <input class="db-name-input" id="db-name" type="text" placeholder="Nom du deck…" value="${esc(deckName)}" maxlength="32">
      </div>
      <div class="db-color-swatches" id="db-color-swatches">
        ${DECK_COLORS.map(c => `<button class="db-color-dot" data-color="${c}" style="background:${c}" aria-label="Couleur ${c}"></button>`).join('')}
        <button class="db-color-dot db-color-dot--none" data-color="" aria-label="Aucune couleur">✕</button>
      </div>
      <div class="db-meta">
        <div class="db-tags" id="db-tags-d"></div>
        <div class="db-count-row">
          <span class="db-count-num" id="db-count-d">0</span>
          <span class="db-count-label">/ 20 cartes</span>
          <span class="db-count-sep"></span>
          <span class="db-count-label">max 8/tier</span>
        </div>
      </div>
      <button class="db-save-btn" id="db-save" disabled>
        <svg width="16" height="16" viewBox="0 0 18 18" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3 H12 L15 6 V15 H3 Z"/><path d="M6 3 V7 H11"/><path d="M6 15 V11 H12 V15"/></svg>
        <span class="db-save-label">SAUVER</span>
      </button>
    </div>
    <div class="db-mobile-meta">
      <div class="db-tags" id="db-tags-m"></div>
      <span class="db-count-label" id="db-count-m"></span>
    </div>
    <div class="db-layout">
      <div class="db-left">
        <div class="db-left-header">
          <span class="db-section-label">COMPOSITION · PAR TIER</span>
          <span class="db-autosave"><span class="db-autosave-dot"></span>auto-sauvegarde</span>
        </div>
        <div class="db-tiers" id="db-tiers"></div>
      </div>
      <div class="db-right">
        <span class="db-section-label" style="flex-shrink:0">BIBLIOTHÈQUE DE CARTES</span>
        <div class="db-type-pills" id="db-type-pills">
          <button class="db-type-pill active" data-type="">Tous</button>
          ${Object.entries(SUMMON_LABELS).map(([k,v]) =>
            `<button class="db-type-pill" data-type="${k}">${v}</button>`
          ).join('')}
        </div>
        <select class="db-attr-sel" id="db-attr">
          <option value="">Tous les attributs</option>
          ${AttributeDatabase.getAllAttributes()
            .slice().sort((a, b) => a.name.localeCompare(b.name, 'fr'))
            .map(a => `<option value="${esc(a.id)}">${esc(a.icon ?? '')} ${esc(a.name)}</option>`)
            .join('')}
        </select>
        <div class="db-search-wrap">
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="#6b6385" stroke-width="1.8" stroke-linecap="round"><circle cx="7" cy="7" r="4.4"/><line x1="10.4" y1="10.4" x2="14" y2="14"/></svg>
          <input type="search" id="db-search" placeholder="Rechercher une carte…">
        </div>
        <div class="db-lib-grid" id="db-lib"></div>
      </div>
    </div>
  `;

  const btnSave  = container.querySelector('#db-save');
  const nameInput = container.querySelector('#db-name');
  const avatarEl  = container.querySelector('#db-avatar');
  const tiersEl   = container.querySelector('#db-tiers');
  const libEl     = container.querySelector('#db-lib');

  // ── Avatar ────────────────────────────────────────────────────────────────
  function avatarColor(name) {
    let code = 0;
    for (const c of name) code += c.charCodeAt(0);
    return AVATAR_COLORS[code % AVATAR_COLORS.length];
  }
  function updateAvatar() {
    const name = nameInput.value.trim();
    const base = deckColor ?? (name ? avatarColor(name) : '#a78bfa');
    avatarEl.style.background = `linear-gradient(135deg,${base},${base}99)`;
    avatarEl.textContent = name ? name.charAt(0).toUpperCase() : '?';
    // Sync active swatch
    container.querySelectorAll('.db-color-dot').forEach(dot => {
      dot.classList.toggle('active', dot.dataset.color === (deckColor ?? ''));
    });
  }

  // ── Tags ──────────────────────────────────────────────────────────────────
  function computeTags() {
    const all = [1,2,3,4,5].flatMap(t => deckData[t]);
    const attrCounts = {};
    for (const card of all)
      for (const id of (card.attributes ?? []))
        attrCounts[id] = (attrCounts[id] || 0) + 1;

    const tierCounts = {};
    for (const card of all) tierCounts[card.tier] = (tierCounts[card.tier] || 0) + 1;

    const dominant = Object.entries(attrCounts)
      .filter(([,n]) => n >= 2)
      .sort((a,b) => b[1]-a[1])
      .slice(0, 2)
      .map(([id]) => AttributeDatabase.getAttribute(id)?.name ?? id);

    const tags = [...dominant];
    const highTier = (tierCounts[4]||0) + (tierCounts[5]||0);
    const lowTier  = (tierCounts[1]||0) + (tierCounts[2]||0);
    if (highTier >= 2) tags.push('Agressif');
    else if (lowTier >= 5) tags.push('Contrôle');
    return tags.slice(0, 3);
  }

  // ── Meta update ───────────────────────────────────────────────────────────
  function updateMeta() {
    const total = [1,2,3,4,5].reduce((s,t) => s + deckData[t].length, 0);
    const hasName = nameInput.value.trim().length > 0;
    const tierOk  = [1,2,3,4,5].every(t => deckData[t].length <= tierMax[t]);
    btnSave.disabled = !(hasName && total >= deckMin && tierOk);

    container.querySelector('#db-count-d').textContent = total;
    const mLabel = container.querySelector('#db-count-m');
    if (mLabel) mLabel.textContent = `${total}/20 cartes · max 8 par tier`;

    const tagsHtml = computeTags().map(t => `<span class="db-tag">${esc(t)}</span>`).join('');
    container.querySelectorAll('.db-tags').forEach(el => el.innerHTML = tagsHtml);

    updateAvatar();
  }

  // ── Tier composition panel ────────────────────────────────────────────────
  function renderTiers() {
    tiersEl.innerHTML = TIER_DEFS.map(def => {
      const cards = deckData[def.t];
      const T = TIER_COLORS[def.t];
      const slotsHtml = Array(8).fill(null).map((_, i) => {
        const card = cards[i];
        if (card) {
          const summon   = card.summon_type ?? 'normal';
          const hasIcon  = summon !== 'normal' && !Array.isArray(card.summon_options);
          const sacCost  = summon === 'sacrifice' ? (card.cost?.sacrifice ?? 0) : 0;
          return `<div class="db-slot filled"
            style="--db-edge:${def.edge};--hc-edge:${T.edge};--hc-ink:${T.ink};--hc-glow:${T.glow};--hc-art:${T.art}">
            <img class="hand-card-img" src="/illustrations/${card.id}" alt="${esc(card.name)}" loading="lazy">
            <div class="hand-card-foil"></div>
            <div class="hand-card-edge-glow"></div>
            <div class="hand-card-footer"><span class="hand-card-name">${esc(card.name)}</span></div>
            <div class="hand-card-tier-badge">T${card.tier}</div>
            ${hasIcon ? `<div class="hand-card-summon-icon">${_summonSvg(summon, T.ink)}${sacCost > 0 ? `<span class="hand-card-summon-count">×${sacCost}</span>` : ''}</div>` : ''}
            <button class="db-slot-remove" data-tier="${def.t}" data-idx="${i}" aria-label="Retirer">×</button>
          </div>`;
        }
        return `<div class="db-slot empty"><div class="db-slot-diamond"></div></div>`;
      }).join('');

      return `<div class="db-tier-block" style="--tier-tint:${def.tint};--tier-bd:${def.border};--tier-chip-bg:${def.chipBg};--tier-ink:${def.ink}">
        <div class="db-tier-inner">
          <div class="db-tier-chip">
            <span class="db-tier-id">${def.t}</span>
            <span class="db-tier-filled">${cards.length}/8</span>
          </div>
          <div class="db-tier-slots">${slotsHtml}</div>
        </div>
      </div>`;
    }).join('');

    tiersEl.querySelectorAll('.db-slot-remove').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        deckData[parseInt(btn.dataset.tier, 10)].splice(parseInt(btn.dataset.idx, 10), 1);
        renderTiers();
        renderLibrary();
        updateMeta();
      });
    });
  }

  // ── Library ───────────────────────────────────────────────────────────────
  const ALL_CARDS = CardDatabase.getAllCards()
    .slice().sort((a, b) => a.tier !== b.tier ? a.tier - b.tier : a.name.localeCompare(b.name, 'fr'));

  function renderLibrary() {
    const query = searchQuery.toLowerCase().trim();

    const filtered = ALL_CARDS.filter(c => {
      if (summonFilter && c.summon_type !== summonFilter) return false;
      if (attributeFilter && !(c.attributes ?? []).includes(attributeFilter)) return false;
      if (query && !c.name.toLowerCase().includes(query)) return false;
      return true;
    });

    if (filtered.length === 0) {
      libEl.innerHTML = `<p class="db-empty">Aucune carte trouvée.</p>`;
      return;
    }

    libEl.innerHTML = '';
    for (const c of filtered) {
      const T      = TIER_COLORS[c.tier];
      const isFull = deckData[c.tier].length >= tierMax[c.tier];
      const summon = c.summon_type ?? 'normal';
      const hasIcon  = summon !== 'normal' && !Array.isArray(c.summon_options);
      const sacCost  = summon === 'sacrifice' ? (c.cost?.sacrifice ?? 0) : 0;

      const btn = document.createElement('button');
      btn.className = 'card-item db-lib-card' + (isFull ? ' tier-full' : '');
      btn.dataset.id = c.id;
      btn.style.setProperty('--hc-edge', T.edge);
      btn.style.setProperty('--hc-ink',  T.ink);
      btn.style.setProperty('--hc-glow', T.glow);
      btn.style.setProperty('--hc-art',  T.art);

      btn.innerHTML = `
        <div class="tb-card-img-wrap">
          <img src="/illustrations/${c.id}" alt="${esc(c.name)}" loading="lazy">
          <div class="hand-card-tier-badge">T${c.tier}</div>
          ${hasIcon ? `<div class="hand-card-summon-icon">${_summonSvg(summon, T.ink)}${sacCost > 0 ? `<span class="hand-card-summon-count">×${sacCost}</span>` : ''}</div>` : ''}
        </div>
        <span class="hand-card-name">${esc(c.name)}</span>
      `;

      let longPress;
      btn.addEventListener('pointerdown', () => {
        longPress = setTimeout(() => {
          Tooltip.showAtRect(Tooltip.cardHtml(c, PowerDatabase, AttributeDatabase, CardDatabase), btn.getBoundingClientRect());
        }, 500);
      });
      btn.addEventListener('pointerup',     () => clearTimeout(longPress));
      btn.addEventListener('pointercancel', () => clearTimeout(longPress));

      btn.addEventListener('click', () => {
        clearTimeout(longPress);
        Tooltip.hide();
        if (deckData[c.tier].length >= tierMax[c.tier]) return;
        deckData[c.tier].push(c);
        renderTiers();
        renderLibrary();
        updateMeta();
      });

      libEl.appendChild(btn);
    }
  }

  // ── Events ────────────────────────────────────────────────────────────────
  container.querySelector('#db-back').addEventListener('click', () => {
    if (publicDeckId && window.parent !== window) {
      window.parent.postMessage({ type: 'soulforge-deckbuilder-close' }, '*');
      return;
    }
    navigate('deck_selector');
  });

  nameInput.addEventListener('input', () => { deckName = nameInput.value; updateMeta(); });

  container.querySelector('#db-color-swatches').addEventListener('click', e => {
    const dot = e.target.closest('.db-color-dot');
    if (!dot) return;
    deckColor = dot.dataset.color || null;
    updateAvatar();
  });

  container.querySelector('#db-search').addEventListener('input', e => {
    searchQuery = e.target.value;
    renderLibrary();
  });

  container.querySelector('#db-attr').addEventListener('change', e => {
    attributeFilter = e.target.value;
    renderLibrary();
  });

  container.querySelector('#db-type-pills').addEventListener('click', e => {
    const pill = e.target.closest('.db-type-pill');
    if (!pill) return;
    summonFilter = pill.dataset.type;
    container.querySelectorAll('.db-type-pill').forEach(p =>
      p.classList.toggle('active', p.dataset.type === summonFilter));
    renderLibrary();
  });

  btnSave.addEventListener('click', async () => {
    const name = nameInput.value.trim();
    if (!name) return;

    const toSave = {};
    for (let t = 1; t <= 5; t++) toSave[String(t)] = deckData[t].map(c => c.id);

    if (publicDeckId) {
      const res = await fetch(`/api/decks/${publicDeckId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: publicDeckId, name, deck: toSave }),
      }).then(r => r.json()).catch(e => ({ error: e.message }));
      if (res.error) { alert(res.error); return; }
      if (window.parent !== window) { window.parent.postMessage({ type: 'soulforge-deckbuilder-saved' }, '*'); return; }
      navigate('deck_selector');
      return;
    }

    if (DeckRepository.deckExists(name) && name !== editName) {
      if (!confirm(`Un deck "${name}" existe déjà. Écraser ?`)) return;
    }
    if (editName && editName !== name && DeckRepository.deckExists(editName)) DeckRepository.deleteDeck(editName);
    DeckRepository.saveDeck(name, toSave);
    if (deckColor) DeckRepository.setDeckColor(name, deckColor);
    navigate('deck_selector');
  });

  // ── Init ──────────────────────────────────────────────────────────────────
  updateAvatar();
  renderTiers();
  renderLibrary();
  updateMeta();
}

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
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
