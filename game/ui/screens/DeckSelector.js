import { navigate } from '../../main.js';
import * as DeckRepository from '../../data/DeckRepository.js';
import * as PublicDeckDatabase from '../../data/PublicDeckDatabase.js';

export async function mount(container, params = {}) {
  const target = params.target || 'game';
  let selectedPlayer = null;       // nom du deck privé sélectionné
  let selectedPublic = null;       // deck public sélectionné { id, name, deck }
  let selectedEnemy  = null;
  let activeTab = 'private';       // 'private' | 'public'

  await PublicDeckDatabase.init();

  // ── Step 1 : player deck selection ──────────────────────────────────────

  function renderStep1() {
    const names  = DeckRepository.listDecks();
    const active = DeckRepository.getActiveDeck();
    const publicDecks = PublicDeckDatabase.getAllDecks();

    const hasSelection = activeTab === 'private' ? !!selectedPlayer : !!selectedPublic;
    const selectionLabel = activeTab === 'private' ? selectedPlayer : selectedPublic?.name;

    container.innerHTML = `
      <div class="topbar">
        <button class="topbar-back" id="btn-back">←</button>
        <span class="topbar-title">Mes Decks</span>
        ${activeTab === 'private' ? '<button class="btn btn-primary" id="btn-create">+ Nouveau</button>' : ''}
      </div>
      <div class="deck-tabs">
        <button class="deck-tab ${activeTab === 'private' ? 'active' : ''}" id="tab-private">Mes decks</button>
        <button class="deck-tab ${activeTab === 'public' ? 'active' : ''}" id="tab-public">Decks publics</button>
      </div>
      <div class="screen-content">
        <div class="deck-list" id="deck-list"></div>
      </div>
      <div class="deck-selector-footer">
        <button class="btn btn-primary btn-full" id="btn-play" ${hasSelection ? '' : 'disabled'}>
          ${hasSelection ? `Jouer avec "${selectionLabel}"` : 'Jouer avec ce deck'}
        </button>
      </div>
    `;

    const deckList = container.querySelector('#deck-list');
    const btnPlay  = container.querySelector('#btn-play');

    if (activeTab === 'private') {
      if (names.length === 0) {
        deckList.innerHTML = `
          <div class="empty-state">
            <p class="empty-icon">🃏</p>
            <p class="empty-text">Aucun deck sauvegardé.</p>
            <p class="empty-sub">Crée un deck pour commencer à jouer.</p>
          </div>`;
      } else {
        deckList.innerHTML = names.map(name => `
          <div class="deck-item${selectedPlayer === name ? ' selected' : ''}" data-name="${esc(name)}">
            <div class="deck-item-info">
              <span class="deck-item-name">${esc(name)}</span>
              ${name === active ? '<span class="badge badge-active">Actif</span>' : ''}
            </div>
            <div class="deck-item-actions">
              <button class="btn btn-icon btn-edit" data-name="${esc(name)}" title="Éditer">✏️</button>
              <button class="btn btn-icon btn-del"  data-name="${esc(name)}" title="Supprimer">🗑</button>
            </div>
          </div>`).join('');

        deckList.querySelectorAll('.deck-item').forEach(el => {
          el.addEventListener('click', e => {
            if (e.target.closest('.deck-item-actions')) return;
            selectedPlayer = el.dataset.name;
            renderStep1();
          });
        });

        deckList.querySelectorAll('.btn-edit').forEach(btn => {
          btn.addEventListener('click', () => {
            DeckRepository.setPendingEdit(btn.dataset.name);
            navigate('deck_builder');
          });
        });

        deckList.querySelectorAll('.btn-del').forEach(btn => {
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
        deckList.innerHTML = `
          <div class="empty-state">
            <p class="empty-icon">🌐</p>
            <p class="empty-text">Aucun deck public disponible.</p>
            <p class="empty-sub">Les decks publics sont gérés depuis l'admin.</p>
          </div>`;
      } else {
        deckList.innerHTML = publicDecks.map(d => `
          <div class="deck-item${selectedPublic?.id === d.id ? ' selected' : ''}" data-id="${esc(d.id)}">
            <div class="deck-item-info">
              <span class="deck-item-name">${esc(d.name)}</span>
            </div>
            <div class="deck-item-actions">
              <button class="btn btn-icon btn-copy" data-id="${esc(d.id)}" title="Copier vers mes decks">📋</button>
            </div>
          </div>`).join('');

        deckList.querySelectorAll('.deck-item').forEach(el => {
          el.addEventListener('click', e => {
            if (e.target.closest('.deck-item-actions')) return;
            selectedPublic = publicDecks.find(d => d.id === el.dataset.id);
            renderStep1();
          });
        });

        deckList.querySelectorAll('.btn-copy').forEach(btn => {
          btn.addEventListener('click', () => {
            const deck = publicDecks.find(d => d.id === btn.dataset.id);
            if (!deck) return;
            const newName = DeckRepository.findFreeName(deck.name);
            DeckRepository.saveDeck(newName, deck.deck);
            alert(`Deck copié vers "${newName}" dans Mes decks.`);
          });
        });
      }
    }

    container.querySelector('#btn-back').addEventListener('click', () => navigate('main_menu'));
    container.querySelector('#btn-create')?.addEventListener('click', () => navigate('deck_builder'));

    container.querySelector('#tab-private').addEventListener('click', () => {
      if (activeTab === 'private') return;
      activeTab = 'private';
      selectedPublic = null;
      renderStep1();
    });
    container.querySelector('#tab-public').addEventListener('click', () => {
      if (activeTab === 'public') return;
      activeTab = 'public';
      selectedPlayer = null;
      renderStep1();
    });

    btnPlay.addEventListener('click', () => {
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

  // ── Step 2 : enemy deck selection ────────────────────────────────────────

  function renderStep2() {
    const names = DeckRepository.listDecks();

    container.innerHTML = `
      <div class="topbar">
        <button class="topbar-back" id="btn-back">←</button>
        <span class="topbar-title">Deck ennemi</span>
      </div>
      <div class="screen-content">
        <div class="deck-list" id="deck-list">
          <div class="deck-item${selectedEnemy === '__random__' ? ' selected' : ''}" data-name="__random__">
            <div class="deck-item-info">
              <span class="deck-item-name">Aléatoire</span>
              <span class="badge">Surprise</span>
            </div>
          </div>
          ${names.map(name => `
            <div class="deck-item${selectedEnemy === name ? ' selected' : ''}" data-name="${esc(name)}">
              <div class="deck-item-info">
                <span class="deck-item-name">${esc(name)}</span>
              </div>
            </div>`).join('')}
        </div>
      </div>
      <div class="deck-selector-footer">
        <button class="btn btn-primary btn-full" id="btn-confirm" ${selectedEnemy ? '' : 'disabled'}>
          Confirmer
        </button>
      </div>
    `;

    container.querySelector('#btn-back').addEventListener('click', renderStep1);

    container.querySelector('#deck-list').querySelectorAll('.deck-item').forEach(el => {
      el.addEventListener('click', () => {
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
