import { navigate } from '../../main.js';
import * as CardDatabase from '../../data/CardDatabase.js';
import * as DeckRepository from '../../data/DeckRepository.js';
import * as PowerDatabase from '../../data/PowerDatabase.js';
import * as AttributeDatabase from '../../data/AttributeDatabase.js';
import * as BoardDatabase from '../../data/BoardDatabase.js';
import * as MagieDatabase from '../../data/MagieDatabase.js';
import { applyEffect as applyMagieEffect, needsUnitTarget, needsGraveyardTarget, effectLabel as magieEffectLabel } from '../../logic/MagieEffect.js';
import { applyEffect as applyBoardEffect } from '../../logic/BoardEffect.js';
import { Unit } from '../../logic/Unit.js';
import { Board } from '../../logic/Board.js';
import { GameState, Phase } from '../../logic/GameState.js';
import { EnemyAI } from '../../logic/EnemyAI.js';
import { AttributeManager } from '../../logic/AttributeManager.js';
import { CombatManager } from '../../logic/CombatManager.js';
import * as InvocationManager from '../../logic/InvocationManager.js';
import { matchesMaterial as _matchesMaterial } from '../../logic/InvocationManager.js';
import {
  needsMaterials as _needsMaterials,
  materialsComplete as _materialsComplete,
  transformTargetCells as _transformTargetCells,
  materialCandidateCells as _materialCandidateCells,
  materialCandidateGraveyard as _materialCandidateGraveyardRule,
  isPlayable as _isPlayable,
  validCells as _validCellsRule,
} from '../../logic/InvocationRules.js';
import { tiersForRound as _tiersForRound, drawHand as _drawHand } from '../../logic/Draw.js';
import { createBoard3D } from '../components/Board3D.js';
import { HandUI } from '../components/HandUI.js';
import { CombatAnimator3D } from '../components/CombatAnimator3D.js';
import { createUnitEl } from '../components/UnitCard.js';
import * as Tooltip from '../components/Tooltip.js';

const HAND_SIZE = 5;

let _activeUnmount = null;

export function unmount() {
  if (_activeUnmount) _activeUnmount();
  _activeUnmount = null;
}

export async function mount(container, params = {}) {
  await Promise.all([CardDatabase.init(), PowerDatabase.init(), AttributeDatabase.init(), BoardDatabase.init(), MagieDatabase.init()]);

  const deckName = params.deckName || DeckRepository.getActiveDeck();
  if (!deckName) { navigate('deck_selector'); return; }
  const rawDeck = DeckRepository.loadDeck(deckName);
  if (!rawDeck) { navigate('deck_selector'); return; }

  const enemyDeckName = params.enemyDeckName;
  const rawEnemyDeck  = (enemyDeckName && DeckRepository.loadDeck(enemyDeckName)) || rawDeck;

  // Precompute per-tier card arrays from the deck
  const cardsByTier = {};
  for (let t = 1; t <= 5; t++) {
    cardsByTier[t] = (rawDeck[String(t)] ?? []).map(id => CardDatabase.getCard(id)).filter(Boolean);
  }

  // Game objects
  const gameState = new GameState();
  const board = new Board();
  const enemyAI = new EnemyAI(rawEnemyDeck, CardDatabase);
  let hand = [];
  let graveyard = [];
  let enemyUnits    = [];
  let enemyHand     = [];
  let enemyGraveyard = [];
  let combatSpeed = 1; // persists across rounds (Tour suivant ne doit pas réinitialiser la vitesse choisie)
  let _graveyardElMap = new Map(); // uid → DOM element (smart diff to avoid img rebuilds)
  let selectedCard = null;
  let selectedBoardPos = null;
  let selectedMaterials = [];  // Unit[] — board or graveyard units selected as material/tribute
  let _shoppingUnitCallback = null;      // set during shopping unit-selection mode
  let _shoppingGraveyardCallback = null; // set during shopping graveyard-selection mode

  // ── Shell ────────────────────────────────────────────────────────────────

  container.innerHTML = `
    <div class="topbar">
      <button class="topbar-back" id="btn-back">←</button>
      <span class="topbar-title" id="phase-label">Préparation</span>
      <div class="game-hud">
        <span class="hud-hp player" id="hud-player">♥ 1000</span>
        <span class="hud-mult player" id="hud-player-mult" style="display:none">×1.0</span>
        <span class="hud-round" id="hud-round">1/5</span>
        <span class="hud-mult enemy" id="hud-enemy-mult" style="display:none">×1.0</span>
        <span class="hud-hp enemy" id="hud-enemy">♥ 1000</span>
      </div>
    </div>
    <div class="game-layout">
      <div class="game-header-row">
        <div class="attribute-panel" id="attribute-panel"></div>
        <div id="slot-indicator" class="board-ind" style="display:none"></div>
        <div id="board-indicator" class="board-ind" style="display:none"></div>
      </div>
      <div class="game3d-wrap" id="board-area">
        <div class="game3d-3d" id="board3d-mount"></div>
      </div>
      <div class="graveyard-area" id="graveyard-area" style="display:none">
        <span class="graveyard-label">Cimetière</span>
        <div class="graveyard-units" id="graveyard-units"></div>
      </div>
      <div class="hand-area" id="hand-area"></div>
      <div class="phase-controls">
        <div class="prep-timer" id="prep-timer" style="display:none"></div>
        <button class="btn btn-primary btn-full" id="btn-combat">Lancer le combat</button>
        <div class="combat-speed-controls" id="speed-controls" style="display:none">
          <span class="speed-label">Vitesse</span>
          <button class="btn btn-secondary speed-btn active" data-speed="1">×1</button>
          <button class="btn btn-secondary speed-btn" data-speed="2">×2</button>
          <button class="btn btn-secondary speed-btn" data-speed="4">×4</button>
          <div style="flex:1"></div>
          <button class="btn btn-secondary speed-btn" id="btn-pause">⏸</button>
        </div>
      </div>
    </div>
  `;

  const handArea   = container.querySelector('#hand-area');
  const btnCombat  = container.querySelector('#btn-combat');
  const phaseLabel = container.querySelector('#phase-label');
  const prepTimerEl = container.querySelector('#prep-timer');

  const PREP_DURATION_S = 60;
  let _prepInterval = null;

  function _stopPrepTimer() {
    if (_prepInterval) clearInterval(_prepInterval);
    _prepInterval = null;
    prepTimerEl.style.display = 'none';
  }

  function _startPrepTimer() {
    _stopPrepTimer();
    let remaining = PREP_DURATION_S;
    prepTimerEl.style.display = '';
    prepTimerEl.textContent = `⏱ ${remaining}s`;
    _prepInterval = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        _stopPrepTimer();
        if (gameState.phase === Phase.PREPARATION) runCombat();
        return;
      }
      prepTimerEl.textContent = `⏱ ${remaining}s`;
    }, 1000);
  }

  // ── Components ───────────────────────────────────────────────────────────

  const board3D = await createBoard3D(container.querySelector('#board3d-mount'), {
    onCellTap: handleCellTap,
    onUnitTap: handleUnitTap,
    onUnitDrag: handleUnitDrag,
    onUnitLongPress: (unit, pos, rect) => Tooltip.showAtRect(Tooltip.unitHtml(unit, PowerDatabase, AttributeDatabase, CardDatabase), rect),
    powerDb: PowerDatabase,
    attributeDb: AttributeDatabase,
  });
  board3D.setBoard(board);
  window.__b3 = board3D;

  container.querySelector('#btn-back').addEventListener('click', () => {
    navigate('main_menu');
  }, { once: true });

  _activeUnmount = () => {
    board3D.destroy();
    _stopPrepTimer();
  };

  // Board indicator tap → tooltip
  container.querySelector('#board-indicator').addEventListener('pointerdown', e => {
    e.stopPropagation();
    if (_currentBoardData) Tooltip.show(Tooltip.boardHtml(_currentBoardData, AttributeDatabase), container.querySelector('#board-indicator'));
  });

  handArea.className = 'hand-ui-wrap';
  const handToolbar = document.createElement('div');
  handToolbar.className = 'hand-toolbar';
  const handGroupBtn = document.createElement('button');
  handGroupBtn.className = 'btn btn-icon hand-group-toggle';
  handGroupBtn.title = 'Grouper les cartes identiques';
  handGroupBtn.textContent = '☰';
  const handSortBtn = document.createElement('button');
  handSortBtn.className = 'btn btn-icon hand-sort-toggle';
  handSortBtn.title = 'Trier par tier';
  handSortBtn.textContent = '⇅';
  const handInner = document.createElement('div');
  handInner.className = 'hand-ui';
  handToolbar.appendChild(handGroupBtn);
  handToolbar.appendChild(handSortBtn);
  handArea.appendChild(handToolbar);
  handArea.appendChild(handInner);

  const handUI = new HandUI(handInner, {
    onSelect: handleCardSelect,
    powerDb: PowerDatabase,
    attributeDb: AttributeDatabase,
    cardDb: CardDatabase,
    isPlayable: (card) => _isPlayable(card, board, graveyard, gameState.player_board_slots),
  });

  handGroupBtn.addEventListener('click', () => {
    const grouped = !handUI.isGrouped();
    handUI.setGrouped(grouped);
    handGroupBtn.classList.toggle('active', grouped);
  });

  handSortBtn.addEventListener('click', () => {
    const sorted = !handUI.isSortedByTier();
    handUI.setSortedByTier(sorted);
    handSortBtn.classList.toggle('active', sorted);
  });

  // ── Interaction ──────────────────────────────────────────────────────────

  function handleCardSelect(card) {
    selectedCard = card;
    selectedMaterials = [];
    selectedBoardPos = null;
    board3D.setSelectedPos(null);
    if (card) {
      board3D.setHighlight(_validCells(card));
      board3D.setMaterialCandidates([..._materialCandidateCells(card, [], board), ..._transformTargetCells(card, board)]);
    } else {
      board3D.clearHighlight();
      board3D.clearMaterialHighlight();
    }
    _refreshGraveyard();
  }

  function handleCellTap(pos) {
    if (_shoppingUnitCallback || _shoppingGraveyardCallback) return;
    Tooltip.hide();
    if (selectedCard) {
      if (_needsMaterials(selectedCard, board, graveyard) && !_materialsComplete(selectedCard, selectedMaterials)) {
        _flashError('Sélectionne les matériaux d\'abord');
        return;
      }
      _tryPlace(selectedCard, pos);
    } else if (selectedBoardPos) {
      _tryMove(pos);
    }
  }

  function handleUnitTap(unit, pos) {
    Tooltip.hide();
    if (_shoppingUnitCallback) {
      if (unit.side === 'player') _shoppingUnitCallback(unit);
      return;
    }
    if (unit.side !== 'player') return;

    // Material selection mode: a card requiring board materials is selected
    if (selectedCard && _needsMaterials(selectedCard, board, graveyard)) {
      const idx = selectedMaterials.indexOf(unit);
      if (idx !== -1) {
        // Deselect this material
        selectedMaterials.splice(idx, 1);
      } else {
        // Only add if this unit is a valid candidate
        const candidates = _materialCandidateCells(selectedCard, selectedMaterials, board);
        if (candidates.some(p => p.col === pos.col && p.row === pos.row)) {
          selectedMaterials.push(unit);
        }
      }
      _refreshMaterialHighlight();
      return;
    }

    // Transformation: tapping the target unit triggers the summon directly
    if (selectedCard && selectedCard.summon_type === 'transformation' && !selectedCard._free_transformation) {
      const targetId = selectedCard.cost?.materials?.[0];
      if (_matchesMaterial(unit, targetId) && unit.isAlive()) {
        // Pass the specific unit so InvocationManager uses the right one (fixes same-name ambiguity)
        selectedMaterials = [unit];
        _tryPlace(selectedCard, pos);
      }
      return;
    }

    // Deselect hand card if one is selected (non-material card)
    if (selectedCard) {
      selectedCard = null;
      handUI.deselect();
      board3D.clearHighlight();
      board3D.clearMaterialHighlight();
      return;
    }

    // Toggle unit repositioning selection
    if (selectedBoardPos?.col === pos.col && selectedBoardPos?.row === pos.row) {
      selectedBoardPos = null;
      board3D.setSelectedPos(null);
      board3D.clearHighlight();
      return;
    }

    selectedBoardPos = pos;
    board3D.setSelectedPos(pos);
    const empty = [];
    for (let r = 0; r <= 3; r++)
      for (let c = 0; c < 5; c++)
        if (!board.isOccupied({ col: c, row: r })) empty.push({ col: c, row: r });
    board3D.setHighlight(empty);
  }

  function _tryPlace(card, pos) {
    const result = InvocationManager.canSummon(card, pos, board, hand, graveyard, selectedMaterials);
    if (!result.ok) { _flashError(result.reason); return; }

    if (InvocationManager.exceedsBoardSlots(card, selectedMaterials, board, graveyard, gameState.player_board_slots)) {
      _flashError(`Maximum ${gameState.player_board_slots} unités sur le terrain`);
      return;
    }
    const selIdx = handUI.getSelectedIdx();
    InvocationManager.summon(card, pos, board, hand, selectedMaterials.length > 0 ? selectedMaterials : null, selIdx);
    // Remove consumed graveyard units
    for (const u of selectedMaterials) {
      const gi = graveyard.indexOf(u);
      if (gi !== -1) graveyard.splice(gi, 1);
    }
    selectedCard = null;
    selectedMaterials = [];
    // Remove just the placed card element — no full hand rebuild (avoids image flicker)
    handUI.removeSelected();
    board3D.clearHighlight();
    board3D.clearMaterialHighlight();
    board3D.refresh();
    _updateHUD();
    _refreshGraveyard();
    _refreshAttributePanel();
  }

  function handleUnitDrag(unit, fromPos, toPos) {
    if (_shoppingUnitCallback || _shoppingGraveyardCallback) return;
    if (gameState.phase !== Phase.PREPARATION) return;
    if (unit.side !== 'player') return;
    if (toPos.col === fromPos.col && toPos.row === fromPos.row) return;
    if (!board.isPlayerCell(toPos)) return;

    const targetUnit = board.getUnit(toPos);
    if (targetUnit && targetUnit.side !== 'player') return;

    board.removeUnit(unit);
    if (targetUnit) {
      board.removeUnit(targetUnit);
      board.placeUnit(targetUnit, fromPos);
      targetUnit.initial_position = { ...fromPos };
    }
    board.placeUnit(unit, toPos);
    unit.initial_position = { ...toPos };

    selectedCard = null;
    selectedBoardPos = null;
    selectedMaterials = [];
    handUI.deselect();
    board3D.clearHighlight();
    board3D.clearMaterialHighlight();
    board3D.setSelectedPos(null);
    board3D.refresh();
    _refreshAttributePanel();
  }

  function _tryMove(to) {
    if (!selectedBoardPos) return;
    if (board.isOccupied(to)) { _flashError('Case occupée'); return; }
    if (!board.isPlayerCell(to)) return;
    const unit = board.getUnit(selectedBoardPos);
    if (!unit) { selectedBoardPos = null; board3D.clearHighlight(); return; }
    board.moveUnit(unit, to);
    // Update initial_position so unit returns here after combat
    unit.initial_position = { ...to };
    selectedBoardPos = null;
    board3D.setSelectedPos(null);
    board3D.clearHighlight();
    board3D.refresh();
    _refreshAttributePanel();
  }

  function _validCells(card) {
    return _validCellsRule(card, { board, hand, graveyard, selectedMaterials, playerBoardSlots: gameState.player_board_slots });
  }

  function _refreshMaterialHighlight() {
    board3D.setHighlight(_validCells(selectedCard));
    board3D.setMaterialCandidates(_materialCandidateCells(selectedCard, selectedMaterials, board));
    // Only board units have grid positions — graveyard units are highlighted in their own panel
    board3D.setMaterialSelected(selectedMaterials.filter(u => !graveyard.includes(u)).map(u => ({ ...u.position })));
    _refreshGraveyard();
  }

  // ── Graveyard ─────────────────────────────────────────────────────────────

  // Returns graveyard units that are valid material candidates for the card
  function _materialCandidateGraveyard(card, alreadySelected) {
    return _materialCandidateGraveyardRule(card, alreadySelected, graveyard, board);
  }

  function _updateSlotIndicator() {
    const el = container.querySelector('#slot-indicator');
    if (!el) return;
    const occupied = board.getLivingUnitsOnSide('player').length;
    el.innerHTML = `<span style="font-size:18px;flex-shrink:0;line-height:1">🧩</span><span class="board-ind-name">${occupied}/${gameState.player_board_slots}</span>`;
    el.style.display = 'flex';
  }

  function _hideSlotIndicator() {
    const el = container.querySelector('#slot-indicator');
    if (el) el.style.display = 'none';
  }

  function _refreshAttributePanel() {
    const panel = container.querySelector('#attribute-panel');
    if (!panel) return;
    const units = board.getLivingUnitsOnSide('player');
    if (units.length === 0) { panel.innerHTML = ''; _updateSlotIndicator(); return; }
    const attributeList = AttributeDatabase.getAllAttributes();
    const mgr = new AttributeManager(attributeList, units, []);
    const synergies = mgr.getActiveSynergies(units);
    panel.innerHTML = synergies.map(({ attr, count, activeThreshold, nextThreshold }) => {
      const isActive = !!activeThreshold;
      const label = nextThreshold ? `${count}/${nextThreshold.count}` : `${count}`;
      return `<button class="attribute-chip${isActive ? ' attr-active' : ''}" data-attr-id="${attr.id}" title="${attr.name}">`
        + `<span class="attribute-chip-icon">${attr.icon ?? '?'}</span>`
        + `<span class="attribute-chip-count">${label}</span>`
        + `</button>`;
    }).join('');
    panel.querySelectorAll('.attribute-chip').forEach(chip => {
      chip.addEventListener('pointerdown', e => {
        e.stopPropagation();
        const attrId = chip.dataset.attrId;
        const s = synergies.find(x => x.attr.id === attrId);
        if (!s) return;
        Tooltip.toggle(Tooltip.attributeHtml(s.attr, s.count, s.activeThreshold, CardDatabase), chip);
      });
    });
    _updateSlotIndicator();
  }

  function _flashAttributeChips() {
    const panel = container.querySelector('#attribute-panel');
    if (!panel) return;
    panel.querySelectorAll('.attribute-chip.attr-active').forEach(chip => {
      chip.classList.remove('attr-flash');
      void chip.offsetWidth;
      chip.classList.add('attr-flash');
      chip.addEventListener('animationend', () => chip.classList.remove('attr-flash'), { once: true });
    });
  }

  function _refreshGraveyard() {
    const graveyardArea    = container.querySelector('#graveyard-area');
    const graveyardUnitsEl = container.querySelector('#graveyard-units');

    if (graveyard.length === 0) {
      graveyardArea.style.display = 'none';
      _graveyardElMap.clear();
      graveyardUnitsEl.innerHTML = '';
      return;
    }
    graveyardArea.style.display = '';

    const candidates  = new Set(selectedCard ? _materialCandidateGraveyard(selectedCard, selectedMaterials) : []);
    const selectedSet = new Set(selectedMaterials.filter(u => graveyard.includes(u)));
    const graveyardUidSet = new Set(graveyard.map(u => u.uid));

    // Remove elements whose unit is no longer in graveyard
    for (const [uid, el] of _graveyardElMap) {
      if (!graveyardUidSet.has(uid)) {
        el.remove();
        _graveyardElMap.delete(uid);
      }
    }

    // Add / update elements, preserving DOM order
    for (const unit of graveyard) {
      let el = _graveyardElMap.get(unit.uid);
      if (!el) {
        el = createUnitEl(unit, { materialSelected: selectedSet.has(unit) });
        el.classList.toggle('material-candidate', candidates.has(unit));

        let startX, startY, moved = false, longPressTimer;
        el.addEventListener('pointerdown', e => {
          e.stopPropagation();
          startX = e.clientX; startY = e.clientY; moved = false;
          longPressTimer = setTimeout(() => Tooltip.show(Tooltip.unitHtml(unit, PowerDatabase, AttributeDatabase, CardDatabase), el), 500);
          const onMove = ev => {
            if (Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) > 10) moved = true;
          };
          const onUp = () => {
            clearTimeout(longPressTimer);
            document.removeEventListener('pointermove', onMove);
            document.removeEventListener('pointerup', onUp);
            document.removeEventListener('pointercancel', onUp);
            if (!moved) handleGraveyardUnitTap(unit);
          };
          document.addEventListener('pointermove', onMove);
          document.addEventListener('pointerup', onUp);
          document.addEventListener('pointercancel', onUp);
        });
        _graveyardElMap.set(unit.uid, el);
      } else {
        // Smart update: only toggle CSS classes, never rebuild the <img>
        el.classList.toggle('material-selected',  selectedSet.has(unit));
        el.classList.toggle('material-candidate', candidates.has(unit));
        el.classList.toggle('neutralized', unit.is_neutralized);
      }
      // Append to maintain correct order (no-op if already at right position)
      graveyardUnitsEl.appendChild(el);
    }
  }

  function handleGraveyardUnitTap(unit) {
    Tooltip.hide();
    if (_shoppingGraveyardCallback) {
      _shoppingGraveyardCallback(unit);
      return;
    }
    if (selectedCard && _needsMaterials(selectedCard, board, graveyard)) {
      const candidates = _materialCandidateGraveyard(selectedCard, selectedMaterials);
      const idx = selectedMaterials.indexOf(unit);
      if (idx !== -1) {
        selectedMaterials.splice(idx, 1);
      } else if (candidates.includes(unit)) {
        selectedMaterials.push(unit);
      }
      _refreshMaterialHighlight();
      return;
    }
  }

  // ── HUD ──────────────────────────────────────────────────────────────────

  function _updateHUD() {
    container.querySelector('#hud-player').textContent = `♥ ${gameState.player_hp}`;
    container.querySelector('#hud-enemy').textContent  = `♥ ${gameState.enemy_hp}`;
    container.querySelector('#hud-round').textContent  = `${gameState.round}/5`;
  }

  function _showCombatMultipliers() {
    const pm = container.querySelector('#hud-player-mult');
    const em = container.querySelector('#hud-enemy-mult');
    pm.textContent = `×${gameState.player_multiplier.toFixed(1)}`;
    em.textContent = `×${gameState.enemy_multiplier.toFixed(1)}`;
    pm.style.display = '';
    em.style.display = '';
  }

  function _hideCombatMultipliers() {
    container.querySelector('#hud-player-mult').style.display = 'none';
    container.querySelector('#hud-enemy-mult').style.display = 'none';
  }

  function _flashError(msg) {
    const prev = phaseLabel.textContent;
    const prevColor = phaseLabel.style.color;
    phaseLabel.textContent = '⚠ ' + msg;
    phaseLabel.style.color = 'var(--red)';
    setTimeout(() => { phaseLabel.textContent = prev; phaseLabel.style.color = prevColor; }, 2000);
  }

  // ── Board terrain ─────────────────────────────────────────────────────────

  let _currentBoardData = null;

  function _showBoardIndicator(boardData) {
    _currentBoardData = boardData;
    const el = container.querySelector('#board-indicator');
    if (!el || !boardData) return;
    const thumb = boardData._has_illustration
      ? `<img src="/illustrations/${boardData.id}" style="width:28px;height:28px;object-fit:cover;border-radius:3px;flex-shrink:0" alt="">`
      : `<span style="font-size:20px;flex-shrink:0;line-height:1">🗺️</span>`;
    el.innerHTML = `${thumb}<span class="board-ind-name">${boardData.name}</span>`;
    el.style.display = 'flex';
  }

  function _hideBoardIndicator() {
    const el = container.querySelector('#board-indicator');
    if (el) el.style.display = 'none';
    _currentBoardData = null;
  }

  function _applyBoardEffect(effect, playerUnits, enemyUnits) {
    applyBoardEffect(effect, { playerUnits, enemyUnits, gameState });
  }

  // ── Preparation ──────────────────────────────────────────────────────────

  function startPreparation() {
    // Clear board terrain from previous combat
    board.clearBlockedCells();
    board3D.setBlockedCells([]);
    _hideBoardIndicator();

    phaseLabel.textContent = `Prépa — Tour ${gameState.round}`;
    phaseLabel.style.color = '';
    btnCombat.textContent = 'Lancer le combat';
    btnCombat.disabled = false;

    // Guaranteed draws occupy slots within the normal hand (not extra cards)
    const guaranteedDraws = gameState.player_guaranteed_draws.splice(0);
    const extraDraws = gameState.player_extra_draws;
    gameState.player_extra_draws = 0; // consumed — re-earned each round from attributes
    // La main est conservée entre les tours (taille illimitée) — on ajoute la pioche du tour
    const randomCount = Math.max(0, HAND_SIZE + extraDraws - guaranteedDraws.length);
    hand = [...hand, ..._drawHand(cardsByTier, gameState.round, randomCount)];

    // Guaranteed draws bypass round-tier restrictions — search the full deck (all tiers),
    // matching the requested e.tier exactly when specified (magie guaranteed_draw)
    const fullPool = Object.values(cardsByTier).flat();
    for (const draw of guaranteedDraws) {
      const matches = fullPool.filter(c =>
        (!draw.tier      || c.tier === draw.tier) &&
        (!draw.attribute || c.attributes?.includes(draw.attribute)) &&
        (!draw.category  || c.summon_type === draw.category)
      );
      if (matches.length > 0) {
        // Clone so duplicate card_ids in hand are distinct instances (see Draw.js)
        hand.push({ ...matches[Math.floor(Math.random() * matches.length)] });
      } else {
        // Fallback: relax tier, then any card from full pool
        const fallback = fullPool.filter(c =>
          (!draw.attribute || c.attributes?.includes(draw.attribute)) &&
          (!draw.category  || c.summon_type === draw.category)
        );
        if (fallback.length > 0) hand.push({ ...fallback[Math.floor(Math.random() * fallback.length)] });
        else if (fullPool.length > 0) hand.push({ ...fullPool[Math.floor(Math.random() * fullPool.length)] });
      }
    }

    // Apply deferred hand modifiers (from magie effects chosen last round)
    if (gameState.player_hand_modifiers.length) {
      const modifiers = gameState.player_hand_modifiers.splice(0);
      for (const mod of modifiers) {
        if (mod.type === 'reduce_sacrifice_cost') {
          const idx = hand.findIndex(c => c.summon_type === 'sacrifice' && (c.cost?.sacrifice ?? 0) > 0);
          if (idx !== -1) {
          const original = hand[idx]._original_sacrifice ?? hand[idx].cost?.sacrifice ?? 0;
          hand[idx] = { ...hand[idx], _original_sacrifice: original, _no_group: true, cost: { ...hand[idx].cost, sacrifice: Math.max(0, original - (mod.value || 1)) } };
        }
        } else if (mod.type === 'free_transformation') {
          const idx = hand.findIndex(c => c.summon_type === 'transformation');
          if (idx !== -1) hand[idx] = { ...hand[idx], _free_transformation: true, _no_group: true };
        } else if (mod.type === 'remove_heritage_material') {
          const idx = hand.findIndex(c => c.summon_type === 'heritage' && (c.cost?.materials?.length ?? 0) > 0);
          if (idx !== -1) hand[idx] = { ...hand[idx], _no_group: true, cost: { ...hand[idx].cost, materials: [] } };
        }
      }
    }

    handUI.setHand(hand);

    // Enemy draws and fills empty slots (survivors stay, graveyard available as material)
    enemyAI.drawHand(gameState.round);
    enemyAI.placeFromHand(board, gameState.enemy_board_slots, enemyGraveyard);
    enemyAI.rearrangeUnits(board, gameState.enemy_board_slots);
    enemyUnits = board.getLivingUnitsOnSide('enemy'); // board is the source of truth
    enemyHand  = enemyAI.getHand();

    selectedCard = null;
    selectedBoardPos = null;
    selectedMaterials = [];
    board3D.clearHighlight();
    board3D.clearMaterialHighlight();
    board3D.refresh();
    _updateHUD();
    _refreshGraveyard();
    _refreshAttributePanel();
    _startPrepTimer();
  }

  // ── Combat ───────────────────────────────────────────────────────────────

  function runCombat() {
    _stopPrepTimer();
    selectedCard = null;
    selectedBoardPos = null;
    selectedMaterials = [];
    handUI.deselect();
    board3D.clearHighlight();
    board3D.clearMaterialHighlight();
    graveyard = [];
    enemyGraveyard = [];
    btnCombat.disabled = true;
    phaseLabel.textContent = `Combat — Tour ${gameState.round}`;
    phaseLabel.style.color = '';

    // ── Board selection ───────────────────────────────────────────────────
    const boardData = BoardDatabase.getRandomBoard();
    board.setBlockedCells(boardData?.blocked_cells || []);
    board3D.setBlockedCells(boardData?.blocked_cells || []);
    _hideSlotIndicator();
    _showBoardIndicator(boardData);

    // Player units + attributes
    const playerUnits = board.getLivingUnitsOnSide('player');

    // Multipliers based on units present on the board at start of combat
    gameState.startCombat(playerUnits.length, enemyUnits.length);
    _showCombatMultipliers();

    const attributeList = AttributeDatabase.getAllAttributes();
    const attributeManager = new AttributeManager(attributeList, playerUnits, enemyUnits);
    attributeManager.applyStartOfCombat();

    // Apply board effects to all units (after attribute bonuses)
    if (boardData?.effect) _applyBoardEffect(boardData.effect, playerUnits, enemyUnits);

    setTimeout(() => _flashAttributeChips(), 120);

    const combat = new CombatManager(board, playerUnits, enemyUnits, attributeManager);

    // Switch to combat UI
    board3D.enterCombatMode();
    handArea.style.display = 'none';
    container.querySelector('#graveyard-area').style.display = 'none';
    btnCombat.style.display = 'none';
    const speedControls = container.querySelector('#speed-controls');
    speedControls.style.display = '';

    // Wire speed buttons (once per combat) — réutilise la vitesse choisie au tour précédent
    const animator = new CombatAnimator3D(combat, board3D, {
      onFinished: () => _finishCombat(combat, playerUnits, attributeManager),
      onStep: (events) => {
        if (events.some(e => e.type === 'stat_change')) _flashAttributeChips();
      },
    });
    animator.setSpeed(combatSpeed);
    speedControls.querySelectorAll('.speed-btn[data-speed]')
      .forEach(b => b.classList.toggle('active', +b.dataset.speed === combatSpeed));

    const btnPause = speedControls.querySelector('#btn-pause');
    let isPaused = false;
    btnPause.addEventListener('click', () => {
      isPaused = !isPaused;
      if (isPaused) {
        animator.pause();
        btnPause.textContent = '▶';
        btnPause.classList.add('active');
      } else {
        animator.resume();
        btnPause.textContent = '⏸';
        btnPause.classList.remove('active');
      }
    });

    speedControls.querySelectorAll('.speed-btn[data-speed]').forEach(btn => {
      btn.addEventListener('click', () => {
        combatSpeed = +btn.dataset.speed;
        animator.setSpeed(combatSpeed);
        speedControls.querySelectorAll('.speed-btn[data-speed]')
          .forEach(b => b.classList.toggle('active', b === btn));
      }, { once: false });
    });

    animator.start();
  }

  function _finishCombat(combat, playerUnits, attributeManager) {
    // Post-combat attribute effects
    const playerNeutralized = playerUnits.filter(u => u.is_neutralized);
    const enemyNeutralized  = enemyUnits.filter(u => u.is_neutralized);
    const attributeResult = attributeManager.applyEndOfCombat(playerNeutralized, enemyNeutralized);
    const hasAttrEffects = attributeResult.revived.length > 0
      || attributeResult.draw_bonus > 0
      || attributeResult.guaranteed_draws.length > 0
      || attributeResult.board_slot_bonus > 0;
    if (hasAttrEffects) _flashAttributeChips();

    const winner = combat.winner ?? 'draw';
    const playerSurvivors = playerUnits.filter(u => !u.is_neutralized);
    const enemySurvivors  = enemyUnits.filter(u => !u.is_neutralized);
    const playerSurvivorsAtk = playerSurvivors.reduce((s, u) => s + u.atk, 0);
    const enemySurvivorsAtk  = enemySurvivors.reduce((s, u) => s + u.atk, 0);
    gameState.applyEndOfCombat(winner, playerSurvivorsAtk, enemySurvivorsAtk, attributeResult);

    // Remove dead enemy units; surviving ones stay on board
    for (const u of enemyUnits) {
      if (u.is_neutralized) board.removeUnit(u);
    }
    enemyGraveyard = enemyUnits.filter(u => u.is_neutralized);
    enemyUnits = enemyUnits.filter(u => !u.is_neutralized);
    enemyHand  = [];

    // Reset combat stat bonuses on surviving enemy units (prevents stacking across rounds)
    for (const u of enemyUnits) u.resetCombatStats();

    // Enemy survivors return to their initial_position
    {
      const toReposition = enemyUnits.filter(u =>
        u.initial_position &&
        (u.position.col !== u.initial_position.col || u.position.row !== u.initial_position.row)
      );
      for (const u of toReposition) board.removeUnit(u);
      for (const u of toReposition) {
        // initial_position can be occupied by another survivor that drifted there
        // during combat — fall back to any free enemy cell rather than losing the unit.
        const dest = !board.isOccupied(u.initial_position) ? u.initial_position : board.firstEmptyEnemyCell();
        if (dest) board.moveUnit(u, dest);
      }
    }

    // Remove neutralized player units from the board
    for (const u of playerUnits) {
      if (u.is_neutralized) board.removeUnit(u);
    }

    // Re-place revived units
    for (const u of attributeResult.revived) {
      u.is_neutralized = false;
      const target = u.initial_position && !board.isOccupied(u.initial_position)
        ? u.initial_position
        : board.firstEmptyPlayerCell();
      if (target) {
        try { board.placeUnit(u, target); } catch (_) { u.is_neutralized = true; /* no free slot — revive fails, back to graveyard */ }
      } else {
        u.is_neutralized = true; // no free slot — revive fails, back to graveyard
      }
    }

    // Units still neutralized → graveyard for next preparation
    graveyard = playerUnits.filter(u => u.is_neutralized);

    // Reset combat stat bonuses on all surviving player units so they don't stack between rounds
    for (const u of board.getLivingUnitsOnSide('player')) {
      u.resetCombatStats();
    }

    // Survivors return to initial_position
    {
      const toReposition = board.getLivingUnitsOnSide('player').filter(u =>
        u.initial_position &&
        (u.position.col !== u.initial_position.col || u.position.row !== u.initial_position.row)
      );
      for (const u of toReposition) board.removeUnit(u);
      for (const u of toReposition) {
        // initial_position can be occupied by another survivor that drifted there
        // during combat — fall back to any free player cell rather than losing the unit.
        const dest = !board.isOccupied(u.initial_position) ? u.initial_position : board.firstEmptyPlayerCell();
        if (dest) board.moveUnit(u, dest);
      }
    }

    // Laisse les animations de combat (mort, repositionnement) se terminer
    // visuellement avant de recentrer la caméra et d'afficher la pop-up de résultat.
    setTimeout(() => {
      _hideCombatMultipliers();
      board3D.exitCombatMode();
      handArea.style.display = '';
      const sc = container.querySelector('#speed-controls');
      sc.style.display = 'none';
      const bp = sc.querySelector('#btn-pause');
      if (bp) { bp.textContent = '⏸'; bp.classList.remove('active'); }
      btnCombat.style.display = '';

      _showEndRound(winner, playerSurvivorsAtk, enemySurvivorsAtk, playerSurvivors, enemySurvivors, attributeResult.damage_multiplier_bonus);
    }, 1000);
  }

  // ── Shopping phase ───────────────────────────────────────────────────────

  const SHOPPING_DURATION_S = 15;

  function _startShopping(winner) {
    const offered = MagieDatabase.getRandomMagies(3);
    if (!offered.length) { gameState.nextRound(); startPreparation(); return; }

    const overlay = document.createElement('div');
    overlay.className = 'shopping-overlay';
    overlay.innerHTML = `
      <div class="shopping-title">✨ Phase Shopping</div>
      <div class="shopping-subtitle">Choisissez une magie</div>
      <div class="shopping-timer" id="shopping-timer">⏱ ${SHOPPING_DURATION_S}s</div>
      <div class="shopping-magies-row">
        ${offered.map((m, i) => `
          <div class="shopping-magie-card" data-idx="${i}">
            <div class="shopping-magie-illus">
              ${m._has_illustration
                ? `<img src="/illustrations/${m.id}" alt="" loading="lazy">`
                : '✨'}
            </div>
            <div class="shopping-magie-name">${m.name}</div>
            <div class="shopping-magie-effect">${magieEffectLabel(m)}</div>
          </div>
        `).join('')}
      </div>
    `;
    container.appendChild(overlay);

    const timerEl = overlay.querySelector('#shopping-timer');
    let remaining = SHOPPING_DURATION_S;
    const shoppingInterval = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        clearInterval(shoppingInterval);
        if (!overlay.isConnected) return;
        const chosen = offered[Math.floor(Math.random() * offered.length)];
        overlay.remove();
        _applyChosenMagie(chosen, winner);
        return;
      }
      timerEl.textContent = `⏱ ${remaining}s`;
    }, 1000);

    overlay.querySelectorAll('.shopping-magie-card').forEach(card => {
      card.addEventListener('pointerdown', e => {
        e.stopPropagation();
        clearInterval(shoppingInterval);
        const chosen = offered[+card.dataset.idx];
        overlay.remove();
        _applyChosenMagie(chosen, winner);
      });
    });
  }

  function _applyChosenMagie(magie, winner) {
    const _proceed = () => { gameState.nextRound(); startPreparation(); };

    if (needsUnitTarget(magie)) {
      const isDefuse = magie.effect?.type === 'defuse_fusion';
      const isDestroy = magie.effect?.type === 'destroy_unit';
      const targets = isDefuse
        ? board.getLivingUnitsOnSide('player').filter(u => {
            const c = CardDatabase.getCard(u.card_id);
            return c?.summon_type === 'fusion' && (c.cost?.materials?.length ?? 0) > 0;
          })
        : board.getLivingUnitsOnSide('player');
      if (!targets.length) { _proceed(); return; }
      board3D.setHighlight(targets.map(u => u.position).filter(Boolean));
      const banner = _showShoppingBanner(`✨ ${magie.name} — Touchez une unité sur votre terrain`);
      _shoppingUnitCallback = (unit) => {
        if (!targets.includes(unit)) return;
        _shoppingUnitCallback = null;
        banner.remove();
        board3D.clearHighlight();
        if (isDefuse) {
          _defuseFusion(unit);
        } else if (isDestroy) {
          _destroyUnit(unit);
        } else {
          applyMagieEffect(magie, { gameState, targetUnit: unit });
          board3D.refresh();
        }
        _proceed();
      };
    } else if (needsGraveyardTarget(magie)) {
      if (!graveyard.length) { _proceed(); return; }
      const deadUnits = [...graveyard];
      container.querySelector('#graveyard-area').style.display = '';
      _refreshGraveyard();
      const banner = _showShoppingBanner(`✨ ${magie.name} — Touchez une unité dans le cimetière`);
      _shoppingGraveyardCallback = (unit) => {
        if (!deadUnits.includes(unit)) return;
        _shoppingGraveyardCallback = null;
        banner.remove();
        applyMagieEffect(magie, { gameState, targetUnit: unit });
        const target = unit.initial_position && !board.isOccupied(unit.initial_position)
          ? unit.initial_position : board.firstEmptyPlayerCell();
        if (target) {
          try { board.placeUnit(unit, target); } catch (_) {}
        }
        graveyard = graveyard.filter(u => u.uid !== unit.uid);
        board3D.refresh();
        _refreshGraveyard();
        _proceed();
      };
    } else {
      applyMagieEffect(magie, { gameState });
      _proceed();
    }
  }

  function _showShoppingBanner(text) {
    const banner = document.createElement('div');
    banner.className = 'shopping-select-banner';
    banner.textContent = text;
    container.appendChild(banner);
    return banner;
  }

  function _defuseFusion(fusionUnit) {
    const fusionCard = CardDatabase.getCard(fusionUnit.card_id);
    const materials = fusionCard?.cost?.materials ?? [];
    board.removeUnit(fusionUnit);
    for (const matId of materials) {
      const matCard = CardDatabase.getCard(matId);
      if (!matCard) continue;
      const matUnit = new Unit(matCard, 'player');
      const currentCount = board.getLivingUnitsOnSide('player').length;
      if (currentCount < gameState.player_board_slots) {
        let emptyCell = null;
        outer: for (let r = 0; r <= 3; r++)
          for (let c = 0; c < 5; c++)
            if (!board.isOccupied({ col: c, row: r })) { emptyCell = { col: c, row: r }; break outer; }
        if (emptyCell) {
          matUnit.initial_position = { ...emptyCell };
          board.placeUnit(matUnit, emptyCell);
        } else {
          matUnit.is_neutralized = true;
          graveyard.push(matUnit);
        }
      } else {
        matUnit.is_neutralized = true;
        graveyard.push(matUnit);
      }
    }
    board3D.refresh();
    _refreshGraveyard();
    _refreshAttributePanel();
  }

  function _destroyUnit(unit) {
    board.removeUnit(unit);
    unit.is_neutralized = true;
    graveyard.push(unit);
    board3D.refresh();
    _refreshGraveyard();
    _refreshAttributePanel();
  }

  // ── End of round overlay ─────────────────────────────────────────────────

  function _damageBreakdownHtml(winner, playerSurvivorsAtk, enemySurvivorsAtk, playerSurvivors = [], enemySurvivors = [], damageMultiplierBonus = 0) {
    if (winner !== 'player' && winner !== 'enemy') return '';
    const atk = winner === 'player' ? playerSurvivorsAtk : enemySurvivorsAtk;
    const survivors = winner === 'player' ? playerSurvivors : enemySurvivors;
    const unitMultiplier = winner === 'player' ? gameState.player_unit_multiplier : gameState.enemy_unit_multiplier;
    const bonus = winner === 'player' ? (damageMultiplierBonus || 0) : 0;
    const total = Math.round(atk * (unitMultiplier * gameState.round + bonus));
    const unitRows = survivors
      .map(u => ({ name: CardDatabase.getCard(u.card_id)?.name, atk: u.atk }))
      .filter(u => u.name)
      .map(u => `
        <div class="end-round-breakdown-row end-round-breakdown-unit">
          <span>${u.name}</span><span>${u.atk}</span>
        </div>`)
      .join('');
    return `
      <details class="end-round-breakdown">
        <summary><span class="end-round-breakdown-arrow">▶</span>Détail des dégâts infligés</summary>
        ${unitRows}
        <div class="end-round-breakdown-row end-round-breakdown-subtotal">
          <span>ATK des survivants</span><span>${atk}</span>
        </div>
        <div class="end-round-breakdown-row">
          <span>Multiplicateur d'unités</span><span>×${unitMultiplier}</span>
        </div>
        <div class="end-round-breakdown-row">
          <span>Multiplicateur de tour</span><span>×${gameState.round}</span>
        </div>
        ${bonus ? `
        <div class="end-round-breakdown-row">
          <span>Bonus d'attribut</span><span>+${bonus}</span>
        </div>` : ''}
        <div class="end-round-breakdown-row end-round-breakdown-total">
          <span>Total</span><span>${total}</span>
        </div>
      </details>
    `;
  }

  function _showEndRound(winner, playerSurvivorsAtk = 0, enemySurvivorsAtk = 0, playerSurvivors = [], enemySurvivors = [], damageMultiplierBonus = 0) {
    _updateHUD();
    const msgMap = { player: '🏆 Victoire du round !', enemy: '💀 Défaite du round', draw: '⚖ Égalité' };
    const isOver = gameState.isGameOver();

    const overlay = document.createElement('div');
    overlay.className = 'end-round-overlay';
    overlay.innerHTML = `
      <div class="end-round-panel">
        <p class="end-round-result">${msgMap[winner] || '⚖ Fin'}</p>
        <div class="end-round-hps">
          <span class="hud-hp player">♥ ${gameState.player_hp}</span>
          <span style="color:var(--muted)">vs</span>
          <span class="hud-hp enemy">♥ ${gameState.enemy_hp}</span>
        </div>
        ${_damageBreakdownHtml(winner, playerSurvivorsAtk, enemySurvivorsAtk, playerSurvivors, enemySurvivors, damageMultiplierBonus)}
        <button class="btn btn-primary" id="btn-next">
          ${isOver ? 'Résultat final' : 'Tour suivant'}
        </button>
      </div>
    `;
    container.appendChild(overlay);
    overlay.querySelector('#btn-next').addEventListener('click', () => {
      overlay.remove();
      if (isOver) {
        _showGameOver();
      } else {
        _startShopping(winner);
      }
    });
  }

  function _showGameOver() {
    _updateHUD();
    const winner = gameState.getWinner();
    const msgMap = { player: '🏆 Victoire !', enemy: '💀 Défaite', draw: '⚖ Égalité' };
    const overlay = document.createElement('div');
    overlay.className = 'end-round-overlay';
    overlay.innerHTML = `
      <div class="end-round-panel">
        <p class="end-round-result" style="font-size:2rem">${msgMap[winner] || '—'}</p>
        <div class="end-round-hps">
          <span class="hud-hp player">♥ ${gameState.player_hp}</span>
          <span style="color:var(--muted)">vs</span>
          <span class="hud-hp enemy">♥ ${gameState.enemy_hp}</span>
        </div>
        <button class="btn btn-primary" id="btn-menu">Menu principal</button>
      </div>
    `;
    container.appendChild(overlay);
    overlay.querySelector('#btn-menu').addEventListener('click', () => navigate('main_menu'));
  }

  // ── Events ───────────────────────────────────────────────────────────────

  // Use pointerdown (not click) so the event fires reliably on iOS Safari
  btnCombat.addEventListener('pointerdown', e => {
    e.stopPropagation();
    if (gameState.phase === Phase.PREPARATION) runCombat();
  });

  // Tap outside hand/board/graveyard → deselect everything
  // Exclude .phase-controls so tapping the combat button doesn't trigger deselect
  container.querySelector('.game-layout').addEventListener('pointerdown', e => {
    if (e.target.closest('#board-area') || e.target.closest('#hand-area') ||
        e.target.closest('#graveyard-area') || e.target.closest('.phase-controls')) return;
    selectedCard = null;
    selectedBoardPos = null;
    selectedMaterials = [];
    handUI.deselect();
    board3D.clearHighlight();
    board3D.clearMaterialHighlight();
    Tooltip.hide();
  });

  // ── Start ────────────────────────────────────────────────────────────────

  startPreparation();
}
