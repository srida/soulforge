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
import { CombatManager, MAX_COMBAT_TICKS } from '../../logic/CombatManager.js';
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
  summonOptionsStatus as _summonOptionsStatus,
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
  let _summonOptionMenuEl = null;        // set while the summon_options choice pill menu is open

  // ── Shell ────────────────────────────────────────────────────────────────

  container.innerHTML = `
    <div class="gs-topbar">
      <button class="gs-menu-btn" id="btn-back">
        <svg width="15" height="15" viewBox="0 0 16 16" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" fill="none">
          <line x1="3" y1="5" x2="13" y2="5"></line>
          <line x1="3" y1="8" x2="13" y2="8"></line>
          <line x1="3" y1="11" x2="13" y2="11"></line>
        </svg>
      </button>
      <div class="gs-title-group">
        <span class="gs-title" id="phase-label">PRÉPARATION</span>
        <span class="gs-round-badge" id="gs-round-badge">TOUR 1</span>
      </div>
      <div class="gs-hud">
        <div style="text-align:right">
          <div class="gs-hud-hp-row" style="justify-content:flex-end">
            <span class="gs-hud-dot player"></span>
            <span class="gs-hud-val player" id="hud-player">1000</span>
          </div>
          <div class="gs-hud-label-row" style="justify-content:flex-end">
            <span class="gs-hud-label">VOUS</span>
            <span class="gs-hud-mult player" id="hud-player-mult" style="display:none">×1.0</span>
          </div>
        </div>
        <div class="gs-hud-round-badge">
          <span class="gs-hud-round" id="hud-round">1 / 5</span>
          <span class="gs-hud-round-label">MANCHE</span>
        </div>
        <div>
          <div class="gs-hud-hp-row">
            <span class="gs-hud-val enemy" id="hud-enemy">1000</span>
            <span class="gs-hud-dot enemy"></span>
          </div>
          <div class="gs-hud-label-row">
            <span class="gs-hud-mult enemy" id="hud-enemy-mult" style="display:none">×1.0</span>
            <span class="gs-hud-label enemy">ADV.</span>
          </div>
        </div>
      </div>
    </div>
    <div class="game-layout">
      <div class="gs-synergy-row">
        <span class="gs-synergy-label">SYNERGIES ACTIVES</span>
        <div class="attribute-panel" id="attribute-panel"></div>
        <div id="slot-indicator" class="gs-slot-indicator" style="display:none"></div>
        <div id="board-indicator" class="board-ind" style="display:none"></div>
      </div>
      <div class="game3d-wrap" id="board-area">
        <div class="game3d-3d" id="board3d-mount"></div>
      </div>
      <div class="phase-controls">
        <div class="gs-graveyard" id="graveyard-area" style="display:none">
          <div class="gs-graveyard-label-col">
            <span class="gs-graveyard-label">CIMETIÈRE</span>
          </div>
          <div class="graveyard-units" id="graveyard-units"></div>
        </div>
        <div id="hand-area"></div>
        <div class="prep-timer" id="combat-timer" style="display:none"></div>
        <button class="btn btn-primary btn-full gs-combat-btn" id="btn-combat">⚔ LANCER LE COMBAT</button>
        <div class="combat-speed-controls" id="speed-controls" style="display:none">
          <span class="speed-label">VITESSE</span>
          <div class="speed-seg-wrap">
            <button class="speed-btn active" data-speed="1">×1</button>
            <button class="speed-btn" data-speed="2">×2</button>
            <button class="speed-btn" data-speed="4">×4</button>
          </div>
          <div style="flex:1"></div>
          <span class="speed-auto-label">La résolution se joue automatiquement</span>
          <button class="gs-pause-btn" id="btn-pause">
            <span class="gs-pause-icon">⏸</span>
            <span class="gs-pause-text">Pause</span>
          </button>
        </div>
      </div>
    </div>
  `;

  const handArea      = container.querySelector('#hand-area');
  const btnCombat     = container.querySelector('#btn-combat');
  const phaseLabel    = container.querySelector('#phase-label');
  const roundBadge    = container.querySelector('#gs-round-badge');
  const combatTimerEl = container.querySelector('#combat-timer');
  let prepTimerEl = null; // created after hand UI is set up

  const PREP_DURATION_S = 60;
  const COMBAT_TIMEOUT_S = 60; // mirrors CombatManager's MAX_COMBAT_TICKS (60s of ticks at speed ×1)
  let _prepInterval = null;

  function _updateCombatTimer(combat) {
    const remaining = Math.ceil(COMBAT_TIMEOUT_S * combat.remainingTicks() / MAX_COMBAT_TICKS);
    combatTimerEl.textContent = `⏱ ${remaining}s`;
  }

  function _stopPrepTimer() {
    if (_prepInterval) clearInterval(_prepInterval);
    _prepInterval = null;
    if (prepTimerEl) prepTimerEl.style.display = 'none';
  }

  function _startPrepTimer() {
    _stopPrepTimer();
    if (!prepTimerEl) return;
    let remaining = PREP_DURATION_S;
    prepTimerEl.style.display = 'flex';
    prepTimerEl.querySelector('.gs-timer-val').textContent = `${remaining}s`;
    _prepInterval = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        _stopPrepTimer();
        if (gameState.phase === Phase.PREPARATION) runCombat();
        return;
      }
      if (prepTimerEl) prepTimerEl.querySelector('.gs-timer-val').textContent = `${remaining}s`;
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

  // ── Pause menu ────────────────────────────────────────────────────────────

  let _pauseStep = 'main'; // 'main' | 'abandon'
  let _musicVol  = parseInt(localStorage.getItem('sf_music_vol') ?? '70', 10);
  let _sfxVol    = parseInt(localStorage.getItem('sf_sfx_vol')   ?? '85', 10);
  let _animOn    = localStorage.getItem('sf_anim_on') !== 'false';

  const pauseOverlay = document.createElement('div');
  pauseOverlay.className = 'pause-overlay';
  pauseOverlay.style.display = 'none';
  container.appendChild(pauseOverlay);

  function _pauseSliderHtml(id, val) {
    return `
      <div class="pause-slider-track" data-slider="${id}" style="touch-action:none">
        <div class="pause-slider-fill" id="pm-fill-${id}" style="width:${val}%"></div>
        <div class="pause-slider-thumb" id="pm-thumb-${id}" style="left:calc(${val}% - 9px)"></div>
      </div>`;
  }

  function _renderPauseMenu() {
    if (_pauseStep === 'abandon') {
      pauseOverlay.innerHTML = `
        <div class="pause-modal pause-modal--abandon">
          <div class="pause-modal-accent"></div>
          <div class="pause-abandon-body">
            <div class="pause-abandon-icon">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#e07090" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" fill="rgba(232,84,110,.1)"></path>
                <line x1="12" y1="9" x2="12" y2="13"></line>
                <circle cx="12" cy="17" r="1" fill="#e07090" stroke="none"></circle>
              </svg>
            </div>
            <div>
              <div class="pause-abandon-title">ABANDONNER LA PARTIE ?</div>
              <div class="pause-abandon-text">Cette action est irréversible. La manche en cours sera perdue.</div>
            </div>
            <div class="pause-abandon-actions">
              <button class="pause-confirm-btn" id="pm-confirm-abandon">
                <svg width="15" height="15" viewBox="0 0 18 18" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M12 2.5H6a1 1 0 00-1 1v11a1 1 0 001 1h6"></path>
                  <path d="M15.5 9H9M12.5 6l3 3-3 3"></path>
                </svg>
                CONFIRMER L'ABANDON
              </button>
              <div class="pause-cancel-btn" id="pm-cancel-abandon">ANNULER</div>
            </div>
          </div>
        </div>`;

      pauseOverlay.querySelector('#pm-confirm-abandon').addEventListener('pointerdown', () => {
        _closePauseMenu();
        navigate('main_menu');
      });
      pauseOverlay.querySelector('#pm-cancel-abandon').addEventListener('pointerdown', () => {
        _pauseStep = 'main';
        _renderPauseMenu();
      });
      return;
    }

    // Main menu
    pauseOverlay.innerHTML = `
      <div class="pause-modal">
        <div class="pause-modal-accent"></div>
        <div class="pause-modal-header">
          <div class="pause-modal-title-group">
            <div class="pause-modal-icon">
              <svg width="21" height="21" viewBox="0 0 22 22" fill="none">
                <rect x="4" y="3" width="5" height="16" rx="2.5" fill="rgba(167,139,250,.14)" stroke="#a78bfa" stroke-width="1.6"></rect>
                <rect x="13" y="3" width="5" height="16" rx="2.5" fill="rgba(167,139,250,.14)" stroke="#a78bfa" stroke-width="1.6"></rect>
              </svg>
            </div>
            <div>
              <div class="pause-modal-title">PAUSE</div>
              <div class="pause-modal-subtitle">MENU IN-GAME</div>
            </div>
          </div>
          <div class="pause-modal-close" id="pm-close">
            <svg width="12" height="12" viewBox="0 0 14 14" stroke="#7c7596" stroke-width="2.2" stroke-linecap="round" fill="none">
              <line x1="2" y1="2" x2="12" y2="12"></line><line x1="12" y1="2" x2="2" y2="12"></line>
            </svg>
          </div>
        </div>
        <div class="pause-modal-body">
          <button class="pause-resume-btn" id="pm-resume">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="white"><polygon points="3,2 12,7 3,12"></polygon></svg>
            REPRENDRE LA PARTIE
          </button>

          <div class="pause-section-sep"></div>
          <div class="pause-section-label">PARAMÈTRES</div>

          <div class="pause-setting-row">
            <div class="pause-setting-icon">
              <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="#a78bfa" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M4 7H2.5a.5.5 0 00-.5.5v5a.5.5 0 00.5.5H4l5 4V3L4 7z" fill="rgba(167,139,250,.12)"></path>
                <path d="M13 7a5 5 0 010 6"></path>
                <path d="M15.5 4.5a9 9 0 010 11" stroke="rgba(167,139,250,.38)" stroke-width="1.2"></path>
              </svg>
            </div>
            <div class="pause-setting-content">
              <div class="pause-setting-label-row">
                <span class="pause-setting-name">Musique</span>
                <span class="pause-setting-val" id="pm-music-val">${_musicVol}%</span>
              </div>
              ${_pauseSliderHtml('music', _musicVol)}
            </div>
          </div>

          <div class="pause-setting-row">
            <div class="pause-setting-icon">
              <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="#a78bfa" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M4 7H2.5a.5.5 0 00-.5.5v5a.5.5 0 00.5.5H4l5 4V3L4 7z" fill="rgba(167,139,250,.12)"></path>
                <path d="M13 7a5 5 0 010 6"></path>
              </svg>
            </div>
            <div class="pause-setting-content">
              <div class="pause-setting-label-row">
                <span class="pause-setting-name">Effets sonores</span>
                <span class="pause-setting-val" id="pm-sfx-val">${_sfxVol}%</span>
              </div>
              ${_pauseSliderHtml('sfx', _sfxVol)}
            </div>
          </div>

          <div class="pause-setting-row">
            <div class="pause-setting-icon">
              <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="#a78bfa" stroke-width="1.5" stroke-linecap="round">
                <circle cx="10" cy="10" r="7" fill="rgba(167,139,250,.08)"></circle>
                <path d="M10 6v5l2.5 2.5"></path>
              </svg>
            </div>
            <div class="pause-setting-content">
              <div class="pause-toggle-row">
                <div class="pause-toggle-info">
                  <div class="pause-setting-name">Animations de combat</div>
                  <div class="pause-toggle-sub">Désactiver pour améliorer les perfs</div>
                </div>
                <div class="pause-toggle ${_animOn ? 'on' : 'off'}" id="pm-anim-toggle">
                  <div class="pause-toggle-dot"></div>
                </div>
              </div>
            </div>
          </div>

          <div class="pause-danger-sep"></div>

          <button class="pause-abandon-btn" id="pm-abandon">
            <svg width="16" height="16" viewBox="0 0 18 18" fill="none" stroke="#e07090" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 2.5H6a1 1 0 00-1 1v11a1 1 0 001 1h6"></path>
              <path d="M15.5 9H9M12.5 6l3 3-3 3"></path>
            </svg>
            ABANDONNER LA PARTIE
          </button>
        </div>
      </div>`;

    pauseOverlay.querySelector('#pm-resume').addEventListener('pointerdown', _closePauseMenu);
    pauseOverlay.querySelector('#pm-close').addEventListener('pointerdown', _closePauseMenu);
    pauseOverlay.querySelector('#pm-abandon').addEventListener('pointerdown', () => {
      _pauseStep = 'abandon';
      _renderPauseMenu();
    });
    pauseOverlay.querySelector('#pm-anim-toggle').addEventListener('pointerdown', () => {
      _animOn = !_animOn;
      localStorage.setItem('sf_anim_on', _animOn);
      const toggle = pauseOverlay.querySelector('#pm-anim-toggle');
      toggle.className = `pause-toggle ${_animOn ? 'on' : 'off'}`;
    });

    _bindSlider('music', v => {
      _musicVol = v;
      localStorage.setItem('sf_music_vol', v);
      const el = pauseOverlay.querySelector('#pm-music-val');
      if (el) el.textContent = `${v}%`;
    });
    _bindSlider('sfx', v => {
      _sfxVol = v;
      localStorage.setItem('sf_sfx_vol', v);
      const el = pauseOverlay.querySelector('#pm-sfx-val');
      if (el) el.textContent = `${v}%`;
    });
  }

  function _bindSlider(id, onChange) {
    const track = pauseOverlay.querySelector(`[data-slider="${id}"]`);
    if (!track) return;
    const fill  = pauseOverlay.querySelector(`#pm-fill-${id}`);
    const thumb = pauseOverlay.querySelector(`#pm-thumb-${id}`);

    function setVal(clientX) {
      const rect = track.getBoundingClientRect();
      const pct  = Math.round(Math.max(0, Math.min(100, (clientX - rect.left) / rect.width * 100)));
      fill.style.width  = `${pct}%`;
      thumb.style.left  = `calc(${pct}% - 9px)`;
      onChange(pct);
    }

    track.addEventListener('pointerdown', e => {
      track.setPointerCapture(e.pointerId);
      setVal(e.clientX);
      track.addEventListener('pointermove', onMove);
      track.addEventListener('pointerup', onUp, { once: true });
    });

    function onMove(e) { setVal(e.clientX); }
    function onUp()    { track.removeEventListener('pointermove', onMove); }
  }

  function _openPauseMenu() {
    _pauseStep = 'main';
    _renderPauseMenu();
    pauseOverlay.style.display = 'flex';
  }

  function _closePauseMenu() {
    pauseOverlay.style.display = 'none';
  }

  container.querySelector('#btn-back').addEventListener('click', _openPauseMenu);

  _activeUnmount = () => {
    board3D.destroy();
    _stopPrepTimer();
    _closePauseMenu();
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

  // Timer injected into hand row (right side)
  prepTimerEl = document.createElement('div');
  prepTimerEl.id = 'prep-timer';
  prepTimerEl.className = 'gs-timer';
  prepTimerEl.style.display = 'none';
  prepTimerEl.innerHTML = '<span class="gs-timer-val">60s</span><span class="gs-timer-label">RESTANT</span>';
  handArea.appendChild(prepTimerEl);

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
    _closeSummonOptionMenu();
    selectedMaterials = [];
    selectedBoardPos = null;
    board3D.setSelectedPos(null);

    if (card && InvocationManager.hasSummonOptions(card)) {
      const statuses = _summonOptionsStatus(card, board, graveyard, gameState.player_board_slots) || [];
      const playable = statuses.filter(s => s.ok);
      if (playable.length > 1) {
        // Several alternatives are playable at once — let the player choose before entering
        // material-selection mode for one specific summon_type/cost.
        selectedCard = null;
        board3D.clearHighlight();
        board3D.clearMaterialHighlight();
        _openSummonOptionMenu(card, playable);
        return;
      }
      // Exactly one playable option (or none, to surface the right error on placement) — skip the menu.
      const chosen = playable[0] ?? statuses[0];
      card = chosen ? _effectiveCardForOption(card, chosen.index) : card;
    }

    selectedCard = card;
    if (card) {
      board3D.setHighlight(_validCells(card));
      board3D.setMaterialCandidates([..._materialCandidateCells(card, [], board), ..._transformTargetCells(card, board)]);
    } else {
      board3D.clearHighlight();
      board3D.clearMaterialHighlight();
    }
    _refreshGraveyard();
  }

  // Builds a plain card-shaped object carrying one summon_options alternative's summon_type/cost,
  // so the rest of the placement/material pipeline can treat it like any classic card.
  function _effectiveCardForOption(card, idx) {
    const opt = card.summon_options[idx];
    const { summon_options, ...rest } = card;
    return { ...rest, summon_type: opt.summon_type, cost: opt.cost };
  }

  const _SUMMON_TYPE_LABELS = { normal: 'Normal', sacrifice: 'Sacrifice', fusion: 'Fusion', heritage: 'Heritage', transformation: 'Transformation' };

  function _openSummonOptionMenu(card, options) {
    const menu = document.createElement('div');
    menu.className = 'summon-option-banner';
    menu.innerHTML = `
      <div class="summon-option-title">${card.name} — Choisissez le mode d'invocation</div>
      <div class="summon-option-pills">
        ${options.map(o => `<button type="button" class="summon-option-pill" data-idx="${o.index}">${_SUMMON_TYPE_LABELS[o.summon_type] || o.summon_type}</button>`).join('')}
      </div>
    `;
    container.appendChild(menu);
    _summonOptionMenuEl = menu;
    menu.querySelectorAll('.summon-option-pill').forEach(btn => {
      btn.addEventListener('pointerdown', e => {
        e.stopPropagation();
        const idx = +btn.dataset.idx;
        _closeSummonOptionMenu();
        const effCard = _effectiveCardForOption(card, idx);
        selectedCard = effCard;
        board3D.setHighlight(_validCells(effCard));
        board3D.setMaterialCandidates([..._materialCandidateCells(effCard, [], board), ..._transformTargetCells(effCard, board)]);
        _refreshGraveyard();
      });
    });
  }

  function _closeSummonOptionMenu() {
    if (_summonOptionMenuEl) { _summonOptionMenuEl.remove(); _summonOptionMenuEl = null; }
  }

  function handleCellTap(pos) {
    if (_shoppingUnitCallback || _shoppingGraveyardCallback || _summonOptionMenuEl) return;
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
    if (_summonOptionMenuEl) return;
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
    el.innerHTML = `<span class="gs-slot-diamond"></span><span class="gs-slot-label">Unités placées</span><span class="gs-slot-val">${occupied}<span class="gs-slot-max"> / ${gameState.player_board_slots}</span></span>`;
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
        + `<span class="attribute-chip-name">${attr.name}</span>`
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
    container.querySelector('#hud-player').textContent = `${gameState.player_hp}`;
    container.querySelector('#hud-enemy').textContent  = `${gameState.enemy_hp}`;
    container.querySelector('#hud-round').textContent  = `${gameState.round} / 5`;
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
    phaseLabel.textContent = '⚠ ' + msg;
    phaseLabel.classList.add('gs-error');
    setTimeout(() => {
      phaseLabel.textContent = prev;
      phaseLabel.classList.remove('gs-error');
    }, 2000);
  }

  // ── Board terrain ─────────────────────────────────────────────────────────

  let _currentBoardData = null;

  function _showBoardIndicator(boardData) {
    _currentBoardData = boardData;
    const el = container.querySelector('#board-indicator');
    if (!el || !boardData) return;
    const thumb = boardData._has_illustration
      ? `<img src="/illustrations/${boardData.id}" style="width:26px;height:26px;object-fit:cover;border-radius:6px;flex-shrink:0;border:1px solid rgba(95,182,214,.4)" alt="">`
      : `<span style="font-size:18px;flex-shrink:0;line-height:1">🗺️</span>`;
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

    phaseLabel.textContent = 'PRÉPARATION';
    phaseLabel.classList.remove('gs-error');
    if (roundBadge) roundBadge.textContent = `TOUR ${gameState.round}`;
    btnCombat.textContent = '⚔ LANCER LE COMBAT';
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

    _closeSummonOptionMenu();
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
    _closeSummonOptionMenu();
    selectedCard = null;
    selectedBoardPos = null;
    selectedMaterials = [];
    handUI.deselect();
    board3D.clearHighlight();
    board3D.clearMaterialHighlight();
    graveyard = [];
    enemyGraveyard = [];
    btnCombat.disabled = true;
    phaseLabel.textContent = 'COMBAT';
    phaseLabel.classList.remove('gs-error');

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
    combatTimerEl.style.display = '';
    _updateCombatTimer(combat);

    // Wire speed buttons (once per combat) — réutilise la vitesse choisie au tour précédent
    const animator = new CombatAnimator3D(combat, board3D, {
      onFinished: () => _finishCombat(combat, playerUnits, attributeManager),
      onStep: (events) => {
        if (events.some(e => e.type === 'stat_change')) _flashAttributeChips();
        _updateCombatTimer(combat);
      },
    });
    animator.setSpeed(combatSpeed);
    speedControls.querySelectorAll('.speed-btn[data-speed]')
      .forEach(b => b.classList.toggle('active', +b.dataset.speed === combatSpeed));

    const btnPause = speedControls.querySelector('#btn-pause');
    const pauseIcon = btnPause.querySelector('.gs-pause-icon');
    const pauseLabel = btnPause.querySelector('.gs-pause-text');
    let isPaused = false;
    btnPause.addEventListener('click', () => {
      isPaused = !isPaused;
      if (isPaused) {
        animator.pause();
        if (pauseIcon) pauseIcon.textContent = '▶';
        if (pauseLabel) pauseLabel.textContent = 'Reprendre';
        btnPause.classList.add('active');
      } else {
        animator.resume();
        if (pauseIcon) pauseIcon.textContent = '⏸';
        if (pauseLabel) pauseLabel.textContent = 'Pause';
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
    // Veterancy: a unit still active at the end of combat gains a point.
    for (const u of [...playerSurvivors, ...enemySurvivors]) u.veterancy_points++;
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
      combatTimerEl.style.display = 'none';
      const sc = container.querySelector('#speed-controls');
      sc.style.display = 'none';
      const bp = sc.querySelector('#btn-pause');
      if (bp) {
        const pi = bp.querySelector('.gs-pause-icon');
        const pl = bp.querySelector('.gs-pause-text');
        if (pi) pi.textContent = '⏸';
        if (pl) pl.textContent = 'Pause';
        bp.classList.remove('active');
      }
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
      <div class="shopping-modal">
        <div class="shopping-modal-bg"></div>
        <div class="shopping-top-bar"></div>
        <div class="shopping-shine"></div>
        <div class="shopping-inner">
          <div class="shopping-header">
            <div class="shopping-title-row">
              <span class="shopping-sparkle">✦</span>
              <span class="shopping-title">PHASE SHOPPING</span>
              <span class="shopping-sparkle">✦</span>
            </div>
            <div class="shopping-subtitle">Choisissez une magie</div>
          </div>
          <div class="shopping-timer">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <circle cx="9" cy="9" r="7.5" stroke="#a78bfa" stroke-width="1.5"></circle>
              <polyline points="9,5 9,9 12,11" stroke="#a78bfa" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"></polyline>
            </svg>
            <span class="shopping-timer-num" id="shopping-timer-num">${SHOPPING_DURATION_S}<span>s</span></span>
          </div>
          <div class="shopping-magies-row">
            ${offered.map((m, i) => `
              <div class="shopping-magie-card" data-idx="${i}">
                <div class="shopping-magie-card-hover"></div>
                <div class="shopping-magie-illus">
                  ${m._has_illustration
                    ? `<img src="/illustrations/${m.id}" alt="" loading="lazy">`
                    : `<div class="shopping-magie-illus-placeholder">
                        <div class="shopping-magie-illus-icon">✨</div>
                        <div class="shopping-magie-illus-label">ART MAGIE</div>
                      </div>`}
                </div>
                <div class="shopping-magie-body">
                  <div class="shopping-magie-name">${m.name}</div>
                  <div class="shopping-magie-effect">${magieEffectLabel(m)}</div>
                </div>
                <div class="shopping-magie-bar"></div>
              </div>
            `).join('')}
          </div>
          <div class="shopping-skip">
            <button class="shopping-skip-btn" id="shopping-skip-btn">Passer cette phase →</button>
          </div>
        </div>
      </div>
    `;
    container.appendChild(overlay);

    const timerEl = overlay.querySelector('#shopping-timer-num');
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
      timerEl.innerHTML = `${remaining}<span>s</span>`;
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

    overlay.querySelector('#shopping-skip-btn').addEventListener('pointerdown', e => {
      e.stopPropagation();
      clearInterval(shoppingInterval);
      overlay.remove();
      gameState.nextRound();
      startPreparation();
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

  const _CHEVRON_SVG = color =>
    `<svg width="9" height="9" viewBox="0 0 9 9" fill="none" stroke="${color}" stroke-width="1.6" stroke-linecap="round"><polyline points="2,3.5 4.5,6 7,3.5"/></svg>`;

  const _ARROW_RIGHT =
    `<svg class="end-round-btn-arrow" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="5,3 9,7 5,11"/></svg>`;

  const _ARROW_LEFT =
    `<svg class="end-round-btn-arrow end-round-btn-arrow--left" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><polyline points="9,3 5,7 9,11"/></svg>`;

  function _breakdownTotal(side, atk, damageMultiplierBonus = 0) {
    const mult = side === 'player' ? gameState.player_unit_multiplier : gameState.enemy_unit_multiplier;
    const bonus = side === 'player' ? (damageMultiplierBonus || 0) : 0;
    return Math.round(atk * (mult * gameState.round + bonus));
  }

  function _breakdownBodyHtml(side, atk, survivors, damageMultiplierBonus, isVictory) {
    const mult = side === 'player' ? gameState.player_unit_multiplier : gameState.enemy_unit_multiplier;
    const bonus = side === 'player' ? (damageMultiplierBonus || 0) : 0;
    const total = Math.round(atk * (mult * gameState.round + bonus));
    const sign = isVictory ? '+' : '−';
    const dc = isVictory ? '--victory' : '--defeat';

    const units = survivors
      .map(u => ({ name: CardDatabase.getCard(u.card_id)?.name, atk: u.atk }))
      .filter(u => u.name)
      .map(u => `
        <div class="end-round-bd-unit">
          <div class="end-round-bd-avatar"></div>
          <span class="end-round-bd-name">${u.name}</span>
          <span class="end-round-bd-dmg end-round-bd-dmg${dc}">${sign}${u.atk}</span>
        </div>`).join('');

    return `
      <div class="end-round-bd-body">
        <div class="end-round-bd-section">UNITÉS SURVIVANTES</div>
        <div class="end-round-bd-units">${units}</div>
        <div class="end-round-bd-divider"></div>
        <div class="end-round-bd-rows">
          <div class="end-round-bd-row">
            <span class="end-round-bd-row-key">ATK des survivants</span>
            <span class="end-round-bd-row-val">${atk}</span>
          </div>
          <div class="end-round-bd-row">
            <span class="end-round-bd-row-key">Multiplicateur d'unités</span>
            <span class="end-round-bd-row-val">×${mult}</span>
          </div>
          <div class="end-round-bd-row">
            <span class="end-round-bd-row-key">Multiplicateur de tour</span>
            <span class="end-round-bd-row-val">×${gameState.round}</span>
          </div>
          ${bonus ? `
          <div class="end-round-bd-row">
            <span class="end-round-bd-row-key">Bonus d'attribut</span>
            <span class="end-round-bd-row-val">+${bonus}</span>
          </div>` : ''}
          <div class="end-round-bd-divider" style="margin:8px 0;"></div>
          <div class="end-round-bd-total end-round-bd-total${dc}">
            <span class="end-round-bd-total-key">TOTAL</span>
            <span class="end-round-bd-total-val end-round-bd-total-val${dc}">
              ${sign}${total}&thinsp;<span class="end-round-bd-total-pv end-round-bd-total-pv${dc}">PV</span>
            </span>
          </div>
        </div>
      </div>`;
  }

  function _showEndRound(winner, playerSurvivorsAtk = 0, enemySurvivorsAtk = 0, playerSurvivors = [], enemySurvivors = [], damageMultiplierBonus = 0) {
    _updateHUD();
    const isOver = gameState.isGameOver();
    const btnLabel = isOver ? 'RÉSULTAT FINAL' : 'TOUR SUIVANT';

    let panelHtml;

    if (winner === 'player') {
      const total = _breakdownTotal('player', playerSurvivorsAtk, damageMultiplierBonus);
      const body  = _breakdownBodyHtml('player', playerSurvivorsAtk, playerSurvivors, damageMultiplierBonus, true);
      panelHtml = `
        <div class="end-round-panel end-round-panel--victory">
          <div class="end-round-bg end-round-bg--victory"></div>
          <div class="end-round-accent end-round-accent--victory"></div>
          <div class="end-round-inner">
            <div class="end-round-header">
              <div class="end-round-icon end-round-icon--victory">⚡</div>
              <div class="end-round-title end-round-title--victory">VICTOIRE DU ROUND</div>
            </div>
            <div class="end-round-hps">
              <div class="end-round-hp-pill end-round-hp-pill--player-win">
                <span class="end-round-hp-dot end-round-hp-dot--player"></span>
                <span class="end-round-hp-val end-round-hp-val--player">${gameState.player_hp}</span>
                <span class="end-round-hp-lbl end-round-hp-lbl--player">PV</span>
              </div>
              <span class="end-round-vs">VS</span>
              <div class="end-round-hp-pill end-round-hp-pill--enemy-dim">
                <span class="end-round-hp-val end-round-hp-val--enemy-dim">${gameState.enemy_hp}</span>
                <span class="end-round-hp-lbl end-round-hp-lbl--enemy-dim">PV</span>
                <span class="end-round-hp-dot end-round-hp-dot--enemy-dim"></span>
              </div>
            </div>
            <details class="end-round-breakdown end-round-breakdown--victory">
              <summary>
                <div class="end-round-bd-chevron">${_CHEVRON_SVG('#7fe6b6')}</div>
                <span class="end-round-bd-label">Détail des dégâts infligés</span>
                <span class="end-round-bd-badge end-round-bd-badge--victory">+${total} PV</span>
              </summary>
              ${body}
            </details>
            <button class="end-round-btn" id="btn-next">
              <div class="end-round-btn-shine"></div>
              <span class="end-round-btn-label">${btnLabel}</span>
              ${_ARROW_RIGHT}
            </button>
          </div>
        </div>`;

    } else if (winner === 'enemy') {
      const total = _breakdownTotal('enemy', enemySurvivorsAtk, 0);
      const body  = _breakdownBodyHtml('enemy', enemySurvivorsAtk, enemySurvivors, 0, false);
      panelHtml = `
        <div class="end-round-panel end-round-panel--defeat">
          <div class="end-round-bg end-round-bg--defeat"></div>
          <div class="end-round-accent end-round-accent--defeat"></div>
          <div class="end-round-inner">
            <div class="end-round-header">
              <div class="end-round-icon end-round-icon--defeat">💀</div>
              <div class="end-round-title end-round-title--defeat">DÉFAITE DU ROUND</div>
            </div>
            <div class="end-round-hps">
              <div class="end-round-hp-pill end-round-hp-pill--player">
                <span class="end-round-hp-dot end-round-hp-dot--player"></span>
                <span class="end-round-hp-val end-round-hp-val--player">${gameState.player_hp}</span>
                <span class="end-round-hp-lbl end-round-hp-lbl--player">PV</span>
              </div>
              <span class="end-round-vs">VS</span>
              <div class="end-round-hp-pill end-round-hp-pill--enemy">
                <span class="end-round-hp-val end-round-hp-val--enemy">${gameState.enemy_hp}</span>
                <span class="end-round-hp-lbl end-round-hp-lbl--enemy">PV</span>
                <span class="end-round-hp-dot end-round-hp-dot--enemy"></span>
              </div>
            </div>
            <details class="end-round-breakdown end-round-breakdown--defeat">
              <summary>
                <div class="end-round-bd-chevron">${_CHEVRON_SVG('#a78bfa')}</div>
                <span class="end-round-bd-label">Détail des dégâts infligés</span>
                <span class="end-round-bd-badge end-round-bd-badge--defeat">−${total} PV</span>
              </summary>
              ${body}
            </details>
            <button class="end-round-btn" id="btn-next">
              <div class="end-round-btn-shine"></div>
              <span class="end-round-btn-label">${btnLabel}</span>
              ${_ARROW_RIGHT}
            </button>
          </div>
        </div>`;

    } else {
      // draw / timeout — aucun damage à afficher
      panelHtml = `
        <div class="end-round-panel">
          <div class="end-round-bg end-round-bg--draw"></div>
          <div class="end-round-accent end-round-accent--draw"></div>
          <div class="end-round-inner">
            <div class="end-round-header">
              <div class="end-round-icon end-round-icon--draw">⚖️</div>
              <div class="end-round-title">ÉGALITÉ</div>
            </div>
            <div class="end-round-hps">
              <div class="end-round-hp-pill end-round-hp-pill--player">
                <span class="end-round-hp-dot end-round-hp-dot--player"></span>
                <span class="end-round-hp-val end-round-hp-val--player">${gameState.player_hp}</span>
                <span class="end-round-hp-lbl end-round-hp-lbl--player">PV</span>
              </div>
              <span class="end-round-vs">VS</span>
              <div class="end-round-hp-pill end-round-hp-pill--enemy-dim">
                <span class="end-round-hp-val end-round-hp-val--enemy-dim">${gameState.enemy_hp}</span>
                <span class="end-round-hp-lbl end-round-hp-lbl--enemy-dim">PV</span>
                <span class="end-round-hp-dot end-round-hp-dot--enemy-dim"></span>
              </div>
            </div>
            <button class="end-round-btn" id="btn-next">
              <div class="end-round-btn-shine"></div>
              <span class="end-round-btn-label">${btnLabel}</span>
              ${_ARROW_RIGHT}
            </button>
          </div>
        </div>`;
    }

    const overlay = document.createElement('div');
    overlay.className = 'end-round-overlay';
    overlay.innerHTML = panelHtml;
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

    let panelHtml;

    if (winner === 'player') {
      panelHtml = `
        <div class="end-round-panel end-round-panel--gameover-victory">
          <div class="end-round-bg end-round-bg--gameover-victory"></div>
          <div class="end-round-accent end-round-accent--gameover-victory"></div>
          <div class="end-round-inner end-round-inner--gameover">
            <div class="end-round-header">
              <div class="end-round-icon end-round-icon--victory end-round-icon--gameover">🏆</div>
              <div class="end-round-title end-round-title--victory end-round-title--gameover">VICTOIRE</div>
              <div class="end-round-sub end-round-sub--victory">FIN DE PARTIE</div>
            </div>
            <div class="end-round-hps">
              <div class="end-round-hp-pill end-round-hp-pill--player-win end-round-hp-pill--gameover">
                <span class="end-round-hp-dot end-round-hp-dot--player"></span>
                <span class="end-round-hp-val end-round-hp-val--player end-round-hp-val--gameover">${gameState.player_hp}</span>
                <span class="end-round-hp-lbl end-round-hp-lbl--player">PV</span>
              </div>
              <span class="end-round-vs">VS</span>
              <div class="end-round-hp-pill end-round-hp-pill--enemy-dim end-round-hp-pill--gameover">
                <span class="end-round-hp-val end-round-hp-val--enemy-dim end-round-hp-val--gameover">${gameState.enemy_hp}</span>
                <span class="end-round-hp-lbl end-round-hp-lbl--enemy-dim">PV</span>
                <span class="end-round-hp-dot end-round-hp-dot--enemy-dim"></span>
              </div>
            </div>
            <button class="end-round-btn end-round-btn--gameover-victory" id="btn-menu">
              <div class="end-round-btn-shine"></div>
              ${_ARROW_LEFT}
              <span class="end-round-btn-label">MENU PRINCIPAL</span>
            </button>
          </div>
        </div>`;

    } else if (winner === 'enemy') {
      panelHtml = `
        <div class="end-round-panel end-round-panel--gameover-defeat">
          <div class="end-round-bg end-round-bg--gameover-defeat"></div>
          <div class="end-round-accent end-round-accent--gameover-defeat"></div>
          <div class="end-round-inner end-round-inner--gameover">
            <div class="end-round-header">
              <div class="end-round-icon end-round-icon--defeat end-round-icon--gameover">💀</div>
              <div class="end-round-title end-round-title--defeat end-round-title--gameover">DÉFAITE</div>
              <div class="end-round-sub">FIN DE PARTIE</div>
            </div>
            <div class="end-round-hps">
              <div class="end-round-hp-pill end-round-hp-pill--player-dead end-round-hp-pill--gameover">
                <span class="end-round-hp-dot end-round-hp-dot--player-dead"></span>
                <span class="end-round-hp-val end-round-hp-val--player-dead end-round-hp-val--gameover">${gameState.player_hp}</span>
                <span class="end-round-hp-lbl end-round-hp-lbl--player-dead">PV</span>
              </div>
              <span class="end-round-vs">VS</span>
              <div class="end-round-hp-pill end-round-hp-pill--enemy-win end-round-hp-pill--gameover">
                <span class="end-round-hp-val end-round-hp-val--enemy end-round-hp-val--gameover">${gameState.enemy_hp}</span>
                <span class="end-round-hp-lbl end-round-hp-lbl--enemy">PV</span>
                <span class="end-round-hp-dot end-round-hp-dot--enemy"></span>
              </div>
            </div>
            <button class="end-round-btn end-round-btn--gameover-defeat" id="btn-menu">
              <div class="end-round-btn-shine"></div>
              ${_ARROW_LEFT}
              <span class="end-round-btn-label">MENU PRINCIPAL</span>
            </button>
          </div>
        </div>`;

    } else {
      panelHtml = `
        <div class="end-round-panel">
          <div class="end-round-bg end-round-bg--draw"></div>
          <div class="end-round-accent end-round-accent--draw"></div>
          <div class="end-round-inner end-round-inner--gameover">
            <div class="end-round-header">
              <div class="end-round-icon end-round-icon--draw end-round-icon--gameover">⚖️</div>
              <div class="end-round-title end-round-title--gameover">ÉGALITÉ</div>
              <div class="end-round-sub" style="color:#5d5878;">FIN DE PARTIE</div>
            </div>
            <div class="end-round-hps">
              <div class="end-round-hp-pill end-round-hp-pill--player end-round-hp-pill--gameover">
                <span class="end-round-hp-dot end-round-hp-dot--player"></span>
                <span class="end-round-hp-val end-round-hp-val--player end-round-hp-val--gameover">${gameState.player_hp}</span>
                <span class="end-round-hp-lbl end-round-hp-lbl--player">PV</span>
              </div>
              <span class="end-round-vs">VS</span>
              <div class="end-round-hp-pill end-round-hp-pill--enemy-dim end-round-hp-pill--gameover">
                <span class="end-round-hp-val end-round-hp-val--enemy-dim end-round-hp-val--gameover">${gameState.enemy_hp}</span>
                <span class="end-round-hp-lbl end-round-hp-lbl--enemy-dim">PV</span>
                <span class="end-round-hp-dot end-round-hp-dot--enemy-dim"></span>
              </div>
            </div>
            <button class="end-round-btn" id="btn-menu">
              <div class="end-round-btn-shine"></div>
              ${_ARROW_LEFT}
              <span class="end-round-btn-label">MENU PRINCIPAL</span>
            </button>
          </div>
        </div>`;
    }

    const overlay = document.createElement('div');
    overlay.className = 'end-round-overlay';
    overlay.innerHTML = panelHtml;
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
    _closeSummonOptionMenu();
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
