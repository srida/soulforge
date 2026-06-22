import * as Tooltip from './Tooltip.js';
import { costHint as _costHint } from '../../data/CardDatabase.js';

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
          } else if (countEl) {
            countEl.remove();
          }
        } else {
          this._selectedEl.remove();
        }
      } else {
        // Remove by stored element reference — DOM indices shift after each removal so
        // elems[this._selectedIdx] would point to the wrong element on 2nd+ plays.
        this._selectedEl.remove();
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
      if (this._isPlayable) el.classList.toggle('dim', !this._isPlayable(el._repCard));
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
      el.className = 'hand-card'
        + (this._selectedIdx !== null && this._hand[this._selectedIdx] === card ? ' selected' : '')
        + (!playable ? ' dim' : '');
      el._repCard = card; // representative card object — resolved dynamically on click/removal

      const costHint = _costHint(card);
      el.innerHTML = `
        <img src="/illustrations/${card.id}" alt="${esc(card.name)}" loading="lazy">
        <span class="hand-card-name">${esc(card.name)}</span>
        <span class="badge badge-tier${card.tier} hand-card-tier">T${card.tier}</span>
        ${costHint ? `<span class="hand-card-cost">${costHint}</span>` : ''}
        ${group.length > 1 ? `<span class="hand-card-count">×${group.length}</span>` : ''}
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

      this._container.appendChild(el);
    });
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
