import { navigate } from '../../main.js';
import * as DeckRepository from '../../data/DeckRepository.js';
import * as PublicDeckDatabase from '../../data/PublicDeckDatabase.js';

const BACK_SVG = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3L5 8l5 5"/></svg>`;
const EDIT_SVG = `<svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="#f0dba0" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 2.5l2 2L4 12H2v-2L9.5 2.5z"/></svg>`;
const DEL_SVG  = `<svg width="12" height="13" viewBox="0 0 12 14" fill="none" stroke="#e8546e" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1 3h10M4 3V2h4v1M2 3l.7 9h6.6L10 3"/><line x1="4.5" y1="6" x2="4.5" y2="10"/><line x1="7.5" y1="6" x2="7.5" y2="10"/></svg>`;
const COPY_SVG = `<svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="#9ec3ff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="5" width="7" height="8" rx="1.5"/><path d="M9 5V3.5A1.5 1.5 0 0 0 7.5 2H2.5A1.5 1.5 0 0 0 1 3.5V8.5A1.5 1.5 0 0 0 2.5 10H4"/></svg>`;

function avatarIndex(name) {
  return Math.abs((name || '?').charCodeAt(0)) % 6;
}

function countCards(name) {
  const deck = DeckRepository.loadDeck(name);
  if (!deck) return 0;
  return Object.values(deck).reduce((n, arr) => n + (Array.isArray(arr) ? arr.length : 0), 0);
}

function deckCard(opts) {
  const { name, isSelected, isActive, showActions, showCopy, dataAttr } = opts;
  const av = avatarIndex(name);
  const letter = esc(name[0].toUpperCase());
  const count  = countCards(name);
  const deckColor = DeckRepository.getDeckColor?.(name);
  const avatarStyle = deckColor
    ? `style="background:linear-gradient(135deg,${deckColor},${deckColor}99)"`
    : `data-av="${av}"`;
  return `
    <div class="ds-card${isSelected ? ' selected' : ''}" ${dataAttr}>
      <div class="ds-card-sheen"></div>
      <div class="ds-accent-bar"></div>
      <div class="ds-card-inner">
        <div class="ds-avatar" ${avatarStyle}>${letter}</div>
        <div class="ds-card-body">
          <div class="ds-card-title">
            <span class="ds-card-name">${esc(name)}</span>
            ${isActive ? '<span class="ds-badge-active">ACTIF</span>' : ''}
          </div>
          <div class="ds-card-meta">${count} cartes</div>
        </div>
        ${showActions ? `
        <div class="ds-card-actions">
          <button class="ds-action-btn ds-action-edit btn-edit" data-name="${esc(name)}">${EDIT_SVG}</button>
          <button class="ds-action-btn ds-action-del btn-del" data-name="${esc(name)}">${DEL_SVG}</button>
        </div>` : ''}
        ${showCopy ? `
        <div class="ds-card-actions">
          <button class="ds-action-btn ds-action-copy btn-copy" data-name="${esc(name)}">${COPY_SVG}</button>
        </div>` : ''}
      </div>
    </div>`;
}

function onTap(el, handler) {
  let startX = 0, startY = 0, moved = false;
  el.addEventListener('pointerdown', e => { startX = e.clientX; startY = e.clientY; moved = false; });
  el.addEventListener('pointermove', e => {
    if (Math.abs(e.clientX - startX) > 10 || Math.abs(e.clientY - startY) > 10) moved = true;
  });
  el.addEventListener('pointerup', e => { if (!moved) handler(e); });
}

export async function mount(container, params = {}) {
  const target = params.target || 'game3d';
  const activeDeck = DeckRepository.getActiveDeck();
  let selectedPlayer = activeDeck || null;
  let selectedPublic = null;
  let selectedEnemy  = null;
  let activeTab = 'private';

  await PublicDeckDatabase.init();

  function renderStep1() {
    const savedScroll = container.querySelector('#ds-list')?.scrollTop ?? 0;
    const names = DeckRepository.listDecks();
    const publicDecks = PublicDeckDatabase.getAllDecks();
    const hasSelection = activeTab === 'private' ? !!selectedPlayer : !!selectedPublic;

    container.innerHTML = `
      <div class="topbar">
        <button class="topbar-back" id="btn-back">${BACK_SVG}</button>
        <span class="topbar-title">MES DECKS</span>
        ${activeTab === 'private'
          ? `<button class="btn btn-primary" id="btn-create" style="padding:0 14px;min-height:36px;font-size:13px;">+ Nouveau</button>`
          : ''}
      </div>
      <div class="ds-tabs">
        <button class="ds-tab ${activeTab === 'private' ? 'active' : ''}" id="tab-private">Mes Decks</button>
        <button class="ds-tab ${activeTab === 'public'  ? 'active' : ''}" id="tab-public">Decks Publics</button>
      </div>
      <div class="ds-list" id="ds-list"></div>
      <div class="ds-footer">
        <button class="ds-cta" id="btn-play" ${hasSelection ? '' : 'disabled'}>
          <span>⚔ JOUER AVEC CE DECK</span>
          <span class="ds-cta-icon">▸</span>
        </button>
      </div>
    `;

    const list = container.querySelector('#ds-list');

    if (activeTab === 'private') {
      if (names.length === 0) {
        list.innerHTML = `
          <div class="ds-empty">
            <div class="ds-empty-icon">🃏</div>
            <div class="ds-empty-text">Aucun deck sauvegardé</div>
            <div class="ds-empty-sub">Crée un deck pour commencer à jouer.</div>
          </div>`;
      } else {
        list.innerHTML = names.map(name => deckCard({
          name,
          isSelected: name === selectedPlayer,
          isActive:   name === activeDeck,
          showActions: true,
          dataAttr: `data-name="${esc(name)}"`,
        })).join('');

        list.querySelectorAll('.ds-card').forEach(el => {
          onTap(el, e => {
            if (e.target.closest('.ds-card-actions')) return;
            selectedPlayer = el.dataset.name;
            renderStep1();
          });
        });

        list.querySelectorAll('.btn-edit').forEach(btn => {
          btn.addEventListener('click', () => {
            DeckRepository.setPendingEdit(btn.dataset.name);
            navigate('deck_builder');
          });
        });

        list.querySelectorAll('.btn-del').forEach(btn => {
          btn.addEventListener('click', () => {
            if (!confirm(`Supprimer le deck "${btn.dataset.name}" ?`)) return;
            if (selectedPlayer === btn.dataset.name) selectedPlayer = null;
            DeckRepository.deleteDeck(btn.dataset.name);
            renderStep1();
          });
        });
      }
    } else {
      if (publicDecks.length === 0) {
        list.innerHTML = `
          <div class="ds-empty">
            <div class="ds-empty-icon">🌐</div>
            <div class="ds-empty-text">Aucun deck public</div>
            <div class="ds-empty-sub">Les decks publics sont gérés depuis l'admin.</div>
          </div>`;
      } else {
        list.innerHTML = publicDecks.map(d => deckCard({
          name: d.name,
          isSelected: selectedPublic?.id === d.id,
          isActive: false,
          showCopy: true,
          dataAttr: `data-id="${esc(d.id)}"`,
        })).join('');

        list.querySelectorAll('.ds-card').forEach(el => {
          onTap(el, e => {
            if (e.target.closest('.ds-card-actions')) return;
            selectedPublic = publicDecks.find(d => d.id === el.dataset.id);
            renderStep1();
          });
        });

        list.querySelectorAll('.btn-copy').forEach(btn => {
          btn.addEventListener('click', () => {
            const deck = publicDecks.find(d => d.name === btn.dataset.name);
            if (!deck) return;
            const newName = DeckRepository.findFreeName(deck.name);
            DeckRepository.saveDeck(newName, deck.deck);
            alert(`Deck copié vers "${newName}" dans Mes decks.`);
          });
        });
      }
    }

    if (savedScroll > 0) {
      const listEl = container.querySelector('#ds-list');
      if (listEl) listEl.scrollTop = savedScroll;
    }

    container.querySelector('#btn-back').addEventListener('click', () => navigate('main_menu'));
    container.querySelector('#btn-create')?.addEventListener('click', () => navigate('deck_builder'));

    container.querySelector('#tab-private').addEventListener('click', () => {
      if (activeTab === 'private') return;
      activeTab = 'private'; selectedPublic = null;
      renderStep1();
    });
    container.querySelector('#tab-public').addEventListener('click', () => {
      if (activeTab === 'public') return;
      activeTab = 'public'; selectedPlayer = null;
      renderStep1();
    });

    container.querySelector('#btn-play').addEventListener('click', () => {
      if (activeTab === 'private') {
        if (!selectedPlayer) return;
        DeckRepository.setActiveDeck(selectedPlayer);
        renderStep2();
      } else {
        if (!selectedPublic) return;
        DeckRepository.saveDeck(selectedPublic.name, selectedPublic.deck);
        DeckRepository.setActiveDeck(selectedPublic.name);
        renderStep2();
      }
    });
  }

  function renderStep2() {
    const names = DeckRepository.listDecks();

    const randomCard = `
      <div class="ds-card${selectedEnemy === '__random__' ? ' selected' : ''}" data-name="__random__">
        <div class="ds-card-sheen"></div>
        <div class="ds-accent-bar"></div>
        <div class="ds-card-inner">
          <div class="ds-avatar" data-av="0">?</div>
          <div class="ds-card-body">
            <div class="ds-card-title">
              <span class="ds-card-name">Aléatoire</span>
              <span class="badge">Surprise</span>
            </div>
          </div>
        </div>
      </div>`;

    container.innerHTML = `
      <div class="topbar">
        <button class="topbar-back" id="btn-back">${BACK_SVG}</button>
        <span class="topbar-title">Deck ennemi</span>
      </div>
      <div class="ds-list" id="ds-list">
        ${randomCard}
        ${names.map(name => deckCard({
          name,
          isSelected: selectedEnemy === name,
          isActive: false,
          dataAttr: `data-name="${esc(name)}"`,
        })).join('')}
      </div>
      <div class="ds-footer">
        <button class="ds-cta" id="btn-confirm" ${selectedEnemy ? '' : 'disabled'}>
          <span>Confirmer</span>
        </button>
      </div>
    `;

    container.querySelector('#btn-back').addEventListener('click', renderStep1);

    container.querySelectorAll('.ds-card').forEach(el => {
      onTap(el, () => {
        selectedEnemy = el.dataset.name;
        renderStep2();
      });
    });

    container.querySelector('#btn-confirm').addEventListener('click', () => {
      if (!selectedEnemy) return;
      const enemyDeckName = selectedEnemy === '__random__'
        ? names[Math.floor(Math.random() * names.length)]
        : selectedEnemy;
      navigate(target, { deckName: selectedPlayer, enemyDeckName });
    });
  }

  renderStep1();
}

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
