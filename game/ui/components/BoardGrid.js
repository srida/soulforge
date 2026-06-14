import { createUnitEl, updateUnitEl } from './UnitCard.js';
import * as Tooltip from './Tooltip.js';

const COLS = 5;

export class BoardGrid {
  constructor(container, { rows = 4, onCellTap, onUnitTap, onUnitDrag, onUnitLongPress = null, showEnemySide = false, powerDb = null, attributeDb = null } = {}) {
    this._container = container;
    this._displayRows = rows;
    this._onCellTap = onCellTap;
    this._onUnitTap = onUnitTap;
    this._onUnitDrag = onUnitDrag;
    this._onUnitLongPress = onUnitLongPress;
    this._showEnemySide = showEnemySide;
    this._powerDb = powerDb;
    this._attributeDb = attributeDb;
    this._board = null;
    this._highlighted = new Set();         // "col,row" — valid placement cells (blue)
    this._materialCandidates = new Set();  // "col,row" — selectable material units (yellow border)
    this._materialSelected = new Set();    // "col,row" — selected material units (yellow solid)
    this._blockedCells = new Set();        // "col,row" — impassable board cells
    this._selectedPos = null;              // { col, row } | null
    this._el = null;
    this._frozen = false;
    this._build();
  }

  setBoard(board) { this._board = board; }

  setBlockedCells(cells) {
    this._blockedCells = new Set((cells || []).map(c => `${c.col},${c.row}`));
    if (!this._frozen) this.refresh();
  }

  setHighlight(cells) {
    this._highlighted = new Set(cells.map(p => `${p.col},${p.row}`));
    this.refresh();
  }

  clearHighlight() {
    this._highlighted = new Set();
    this._selectedPos = null;
    this.refresh();
  }

  setMaterialCandidates(cells) {
    this._materialCandidates = new Set(cells.map(p => `${p.col},${p.row}`));
    this.refresh();
  }

  setMaterialSelected(cells) {
    this._materialSelected = new Set(cells.map(p => `${p.col},${p.row}`));
    this.refresh();
  }

  clearMaterialHighlight() {
    this._materialCandidates = new Set();
    this._materialSelected = new Set();
    this.refresh();
  }

  setSelectedPos(pos) {
    this._selectedPos = pos ? { ...pos } : null;
  }

  expand(rows) {
    this._displayRows = rows;
    this._build();
    this.refresh();
  }

  // Expand to 11-row combat view, render all units, then freeze DOM updates.
  enterCombatMode() {
    this._frozen = false;
    this._displayRows = 11;
    this._highlighted = new Set();
    this._materialCandidates = new Set();
    this._materialSelected = new Set();
    this._selectedPos = null;
    this._build();
    this.refresh();
    this._frozen = true;
    this._el.classList.add('combat-mode');
  }

  // Return to 4-row prep view and unfreeze.
  exitCombatMode() {
    this._frozen = false;
    this._displayRows = 4;
    this._el.classList.remove('combat-mode');
    this._build();
    this.refresh();
  }

  // Returns the underlying grid DOM element (needed by CombatAnimator).
  gridEl() { return this._el; }

  refresh() {
    if (this._frozen) return;
    if (!this._el) return;
    this._el.querySelectorAll('.board-cell').forEach(cell => {
      const col = +cell.dataset.col;
      const row = +cell.dataset.row;
      const key = `${col},${row}`;
      const unit = this._board?.getUnit({ col, row });
      const isSel     = this._selectedPos?.col === col && this._selectedPos?.row === row;
      const isHl      = this._highlighted.has(key);
      const isMatCand = this._materialCandidates.has(key);
      const isMatSel  = this._materialSelected.has(key);

      const isBlocked = this._blockedCells.has(key);
      cell.className = 'board-cell'
        + (isHl      ? ' highlighted' : '')
        + (isSel     ? ' selected-cell' : '')
        + (isMatCand ? ' material-candidate' : '')
        + (isMatSel  ? ' material-selected-cell' : '')
        + (unit      ? ' occupied' : '')
        + (isBlocked ? ' blocked-cell' : '');

      if (this._displayRows === 11 && row === 7) cell.classList.add('enemy-front');
      if (this._displayRows === 11 && row === 3) cell.classList.add('player-front');
      if (this._displayRows === 11 && row >= 4 && row <= 6) cell.classList.add('neutral-zone');

      const existingUnitEl = cell.querySelector('.unit-card');

      if (!unit) {
        if (existingUnitEl) cell.innerHTML = '';
        return;
      }

      // Same unit already rendered: only update CSS classes, avoid rebuilding the img
      if (existingUnitEl && existingUnitEl.dataset.uid === String(unit.uid)) {
        existingUnitEl.className = 'unit-card unit-' + unit.side
          + (isSel    ? ' selected' : '')
          + (isMatSel ? ' material-selected' : '')
          + (unit.is_neutralized ? ' neutralized' : '');
        updateUnitEl(existingUnitEl, unit);
        return;
      }

      // New or different unit: full rebuild
      cell.innerHTML = '';
      const uEl = createUnitEl(unit, { selected: isSel, materialSelected: isMatSel });
      this._attachUnit(uEl, unit, { col, row });
      cell.appendChild(uEl);
    });
  }

  _build() {
    this._container.innerHTML = '';
    this._el = document.createElement('div');
    this._el.className = 'board-grid';
    this._el.style.setProperty('--board-rows', this._displayRows);
    this._container.appendChild(this._el);

    // Render rows top-to-bottom: high row index at top
    const maxRow = this._displayRows - 1;
    for (let row = maxRow; row >= 0; row--) {
      if (this._displayRows === 11 && (row === 6 || row === 3)) {
        const sep = document.createElement('div');
        sep.className = 'combat-separator';
        this._el.appendChild(sep);
      }
      for (let col = 0; col < COLS; col++) {
        const cell = document.createElement('div');
        cell.className = 'board-cell';
        cell.dataset.col = col;
        cell.dataset.row = row;

        cell.addEventListener('pointerdown', e => {
          if (e.target.closest('.unit-card')) return;
          if (this._blockedCells.has(`${col},${row}`)) return;
          this._onCellTap?.({ col, row });
        });

        this._el.appendChild(cell);
      }
    }
  }

  _attachUnit(el, unit, pos) {
    let startX, startY, dragging = false, ghost = null, longPressTimer;
    let dragW = 0, dragH = 0;

    el.addEventListener('dragstart', e => e.preventDefault());

    el.addEventListener('pointerdown', e => {
      e.stopPropagation();
      startX = e.clientX;
      startY = e.clientY;
      dragging = false;
      longPressTimer = setTimeout(() => {
        if (this._onUnitLongPress) this._onUnitLongPress(unit, pos, el);
        else Tooltip.show(Tooltip.unitHtml(unit, this._powerDb, this._attributeDb), el);
      }, 500);

      // Track move/up on document so events are received regardless of where the pointer goes
      const onMove = (ev) => {
        if (!dragging && Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) > 10) {
          dragging = true;
          clearTimeout(longPressTimer);
          const rect = el.getBoundingClientRect();
          dragW = rect.width;
          dragH = rect.height;
          ghost = el.cloneNode(true);
          ghost.style.cssText = `position:fixed;pointer-events:none;opacity:0.75;z-index:100;`
            + `width:${dragW}px;height:${dragH}px;border-radius:var(--radius-sm);`
            + `left:${ev.clientX - dragW / 2}px;top:${ev.clientY - dragH / 2}px;`;
          document.body.appendChild(ghost);
        }
        if (dragging && ghost) {
          ghost.style.left = (ev.clientX - dragW / 2) + 'px';
          ghost.style.top  = (ev.clientY - dragH / 2) + 'px';
        }
      };

      const cleanup = () => {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        document.removeEventListener('pointercancel', onCancel);
      };

      const onUp = (ev) => {
        cleanup();
        clearTimeout(longPressTimer);
        if (ghost) { ghost.remove(); ghost = null; }
        if (dragging) {
          dragging = false;
          const els = document.elementsFromPoint(ev.clientX, ev.clientY);
          const cellEl = els.find(x => x.classList.contains('board-cell'));
          if (cellEl) this._onUnitDrag?.(unit, pos, { col: +cellEl.dataset.col, row: +cellEl.dataset.row });
        } else {
          this._onUnitTap?.(unit, pos, el);
        }
      };

      const onCancel = () => {
        cleanup();
        clearTimeout(longPressTimer);
        if (ghost) { ghost.remove(); ghost = null; }
        dragging = false;
      };

      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
      document.addEventListener('pointercancel', onCancel);
    });
  }
}
