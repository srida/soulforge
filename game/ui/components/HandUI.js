import * as Tooltip from './Tooltip.js';

const TIER_COLORS = {
  1: { edge:'#46d39a', ink:'#7ef0c0', glow:'rgba(70,211,154,.55)',  art:'linear-gradient(155deg,#1f4a3a,#0e231d)', dark:'#0e231d' },
  2: { edge:'#5fb4e8', ink:'#9ad2f6', glow:'rgba(95,180,232,.55)',  art:'linear-gradient(155deg,#1f3a52,#0e1d2c)', dark:'#0e1d2c' },
  3: { edge:'#a78bfa', ink:'#cdbcff', glow:'rgba(167,139,250,.55)', art:'linear-gradient(155deg,#352663,#181230)', dark:'#181230' },
  4: { edge:'#e8a850', ink:'#f0c48a', glow:'rgba(232,168,80,.55)',  art:'linear-gradient(155deg,#5a3f1c,#2c1d0d)', dark:'#2c1d0d' },
  5: { edge:'#e85a6e', ink:'#f5a0ad', glow:'rgba(232,90,110,.55)',  art:'linear-gradient(155deg,#5a1f2c,#2c0e15)', dark:'#2c0e15' },
};

function _lockSvg() {
  return `<svg width="58%" height="58%" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.52)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;
}

function _redrawSvg() {
  return `<svg width="55%" height="55%" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.45)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 .49-4.5L1 10"/></svg>`;
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

export class HandUI {
  constructor(container, { onSelect, powerDb = null, attributeDb = null, cardDb = null, isPlayable = null } = {}) {
    this._container = container;
    this._onSelect = onSelect;
    this._powerDb = powerDb;
    this._attributeDb = attributeDb;
    this._cardDb = cardDb;
    this._isPlayable = isPlayable;
    this._hand = [];
    this._selectedIdx = null;
    this._selectedEl  = null; // direct element reference — immune to DOM index shifts after removals
    this._grouped = false; // when true, duplicate card_id entries render as a single card with a ×N badge
    this._sortedByTier = false; // when true, cards are displayed ordered by tier ascending
  }

  setHand(cards) {
    this._hand = cards;
    this._selectedIdx = null;
    this._selectedEl  = null;
    this._render();
  }

  isGrouped() { return this._grouped; }

  setGrouped(grouped) {
    if (this._grouped === grouped) return;
    this._grouped = grouped;
    this._selectedIdx = null;
    this._selectedEl  = null;
    this._onSelect?.(null);
    this._render();
  }

  isSortedByTier() { return this._sortedByTier; }

  setSortedByTier(sorted) {
    if (this._sortedByTier === sorted) return;
    this._sortedByTier = sorted;
    this._selectedIdx = null;
    this._selectedEl  = null;
    this._onSelect?.(null);
    this._render();
  }

  getSelected() {
    return this._selectedIdx !== null ? this._hand[this._selectedIdx] : null;
  }

  getSelectedIdx() { return this._selectedIdx; }

  // Remove the currently selected card from hand (after placement).
  // The external `hand` array is already spliced by InvocationManager before this is called.
  removeSelected() {
    if (this._selectedIdx === null) return;
    if (this._selectedEl) {
      if (this._grouped && !this._selectedEl._repCard?._no_group) {
        // The consumed card object is already gone from this._hand (spliced by the caller) —
        // only its id survives on the button. If duplicates remain, shrink the ×N badge and
        // repoint the button at a surviving duplicate instead of removing it.
        const cardId = this._selectedEl._repCard?.id;
        const remaining = this._hand.filter(c => c.id === cardId && !c._no_group);
        if (remaining.length > 0) {
          this._selectedEl._repCard = remaining[0];
          const countEl = this._selectedEl.querySelector('.hand-card-count');
          if (remaining.length > 1) {
            if (countEl) countEl.textContent = `×${remaining.length}`;
            else this._selectedEl.insertAdjacentHTML('beforeend', `<span class="hand-card-count">×${remaining.length}</span>`);
          } else {
            countEl?.remove();
            // Downgrade: remove stacked visual when only 1 copy remains
            this._selectedEl.classList.remove('hand-card--grouped');
            const wrap = this._selectedEl.closest('.hand-card-stack-wrap');
            if (wrap) wrap.replaceWith(this._selectedEl);
          }
        } else {
          (this._selectedEl.closest('.hand-card-stack-wrap') ?? this._selectedEl).remove();
        }
      } else {
        // Remove by stored element reference — DOM indices shift after each removal so
        // elems[this._selectedIdx] would point to the wrong element on 2nd+ plays.
        (this._selectedEl.closest('.hand-card-stack-wrap') ?? this._selectedEl).remove();
      }
    }
    this._selectedIdx = null;
    this._selectedEl  = null;
    this._onSelect?.(null);
    // Refresh only dim/selected classes — no img rebuild
    this._updateSelection();
  }

  deselect() {
    this._selectedIdx = null;
    this._selectedEl  = null;
    this._updateSelection();
    this._onSelect?.(null);
  }

  _updateSelection() {
    const selectedCard = this._selectedIdx !== null ? this._hand[this._selectedIdx] : null;
    this._container.querySelectorAll('.hand-card').forEach(el => {
      el.classList.toggle('selected', el._repCard === selectedCard);
      if (this._isPlayable) {
        const playable = this._isPlayable(el._repCard);
        const wasDim = el.classList.contains('dim');
        el.classList.toggle('dim', !playable);
        if (wasDim !== !playable) _syncPlayabilityEl(el, playable, el._repCard);
      }
    });
  }

  _render() {
    this._container.innerHTML = '';
    if (this._hand.length === 0) {
      this._container.innerHTML = '<p class="hand-empty">Main vide</p>';
      return;
    }

    let groups = this._grouped ? _groupByCardId(this._hand) : this._hand.map(card => [card]);
    if (this._sortedByTier) groups = [...groups].sort((a, b) => a[0].tier - b[0].tier);

    groups.forEach(group => {
      const card = group[0];
      const el = document.createElement('button');
      const playable = this._isPlayable ? this._isPlayable(card) : true;
      const isGrouped = group.length > 1;
      el.className = 'hand-card'
        + (isGrouped ? ' hand-card--grouped' : '')
        + (this._selectedIdx !== null && this._hand[this._selectedIdx] === card ? ' selected' : '')
        + (!playable ? ' dim' : '');
      el._repCard = card; // representative card object — resolved dynamically on click/removal

      const T = TIER_COLORS[card.tier] || TIER_COLORS[2];
      const varHost = isGrouped ? (() => {
        const wrap = document.createElement('div');
        wrap.className = 'hand-card-stack-wrap';
        return wrap;
      })() : el;
      varHost.style.setProperty('--hc-edge', T.edge);
      varHost.style.setProperty('--hc-ink', T.ink);
      varHost.style.setProperty('--hc-glow', T.glow);
      varHost.style.setProperty('--hc-art', T.art);
      if (isGrouped) {
        varHost.style.setProperty('--hc-edge-mid', T.edge + 'bb');
        varHost.style.setProperty('--hc-edge-low', T.edge + '80');
      }

      const summon = card.summon_type ?? 'normal';
      const isMulti = Array.isArray(card.summon_options) && card.summon_options.length > 0;
      const hasIcon = summon !== 'normal' || isMulti;
      const sacrificeCost = summon === 'sacrifice' ? (card.cost?.sacrifice ?? 0) : 0;

      el.innerHTML = `
        <img class="hand-card-img" src="/illustrations/${card.id}" alt="${esc(card.name)}" loading="lazy">
        ${!playable ? '<div class="hand-card-dim-overlay"></div>' : '<div class="hand-card-foil"></div>'}
        <div class="hand-card-edge-glow"></div>
        ${!playable ? `<div class="hand-card-lock">${_lockSvg()}</div>` : ''}
        <div class="hand-card-footer"><span class="hand-card-name">${esc(card.name)}</span></div>
        <div class="hand-card-tier-badge">T${card.tier}</div>
        ${!playable
          ? `<div class="hand-card-summon-icon">${_redrawSvg()}</div>`
          : (hasIcon ? `<div class="hand-card-summon-icon">${isMulti ? card.summon_options.map(o => _summonSvg(o.summon_type, T.ink)).join('') : _summonSvg(summon, T.ink)}</div>` : '')
        }
        ${isGrouped ? `<span class="hand-card-count">×${group.length}</span>` : ''}
      `;

      let longPressTimer;
      el.addEventListener('pointerdown', e => {
        e.stopPropagation();
        Tooltip.hide();
        const currentCard = el._repCard;
        const rect = el.getBoundingClientRect();
        longPressTimer = setTimeout(() => {
          Tooltip.showAtRect(Tooltip.cardHtml(currentCard, this._powerDb, this._attributeDb, this._cardDb), rect);
        }, 500);
        // Resolve the real index in `this._hand` from the (possibly updated) representative
        // card object — robust to DOM/array desync after partial group consumption.
        const realIdx = this._hand.indexOf(currentCard);
        if (this._selectedIdx === realIdx) {
          this._selectedIdx = null;
          this._selectedEl  = null;
          this._onSelect?.(null);
        } else {
          this._selectedIdx = realIdx;
          this._selectedEl  = el;
          this._onSelect?.(currentCard);
        }
        // Update classes only — do NOT call _render() which would detach el
        // and prevent pointerup from clearing longPressTimer on the right element
        this._updateSelection();
      });
      el.addEventListener('pointerup',     () => clearTimeout(longPressTimer));
      el.addEventListener('pointercancel', () => clearTimeout(longPressTimer));

      if (isGrouped) {
        varHost.appendChild(el);
        this._container.appendChild(varHost);
      } else {
        this._container.appendChild(el);
      }
    });
  }
}

// Surgically updates lock/overlay/foil/summon-icon when a card's playability changes mid-turn.
function _syncPlayabilityEl(el, playable, card) {
  const T = TIER_COLORS[card.tier] || TIER_COLORS[2];
  const summon = card.summon_type ?? 'normal';
  const isMulti = Array.isArray(card.summon_options) && card.summon_options.length > 0;
  const hasIcon = summon !== 'normal' || isMulti;
  const sacrificeCost = summon === 'sacrifice' ? (card.cost?.sacrifice ?? 0) : 0;

  const overlay = el.querySelector('.hand-card-dim-overlay');
  const foil    = el.querySelector('.hand-card-foil');
  const edge    = el.querySelector('.hand-card-edge-glow');
  if (playable) {
    overlay?.remove();
    if (!foil && edge) edge.insertAdjacentHTML('beforebegin', '<div class="hand-card-foil"></div>');
  } else {
    foil?.remove();
    if (!overlay && edge) edge.insertAdjacentHTML('beforebegin', '<div class="hand-card-dim-overlay"></div>');
  }

  const lock = el.querySelector('.hand-card-lock');
  if (playable) {
    lock?.remove();
  } else if (!lock) {
    el.insertAdjacentHTML('beforeend', `<div class="hand-card-lock">${_lockSvg()}</div>`);
  }

  let icon = el.querySelector('.hand-card-summon-icon');
  if (playable) {
    if (hasIcon) {
      const html = isMulti ? card.summon_options.map(o => _summonSvg(o.summon_type, T.ink)).join('') : _summonSvg(summon, T.ink);
      if (!icon) el.insertAdjacentHTML('beforeend', `<div class="hand-card-summon-icon">${html}</div>`);
      else icon.innerHTML = html;
    } else {
      icon?.remove();
    }
  } else {
    if (!icon) el.insertAdjacentHTML('beforeend', `<div class="hand-card-summon-icon">${_redrawSvg()}</div>`);
    else icon.innerHTML = _redrawSvg();
  }
}

// Groups hand cards by card_id, preserving first-occurrence order.
// Cards flagged `_no_group` (e.g. instance-specific bonus from a magie effect such as
// "Bourse des âmes" / "Ristourne" reducing this exact card's sacrifice cost) are never
// merged into a group — grouping them would hide the bonus and let the wrong instance be played.
function _groupByCardId(hand) {
  const groups = [];
  const byId = new Map();
  for (const card of hand) {
    if (card._no_group) { groups.push([card]); continue; }
    const group = byId.get(card.id);
    if (group) group.push(card);
    else { const g = [card]; byId.set(card.id, g); groups.push(g); }
  }
  return groups;
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
