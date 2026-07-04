import { navigate } from '../../main.js';
import * as CardDatabase from '../../data/CardDatabase.js';
import * as AttributeDatabase from '../../data/AttributeDatabase.js';
import * as DeckRepository from '../../data/DeckRepository.js';
import * as Tournament from '../../logic/Tournament.js';

const BACK_SVG = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3L5 8l5 5"/></svg>`;

// Survives across navigate() calls (main.js caches the imported module), so the
// bracket state is preserved when we bounce out to game3d and back for each game.
let _tournament = null;
let _drawNotice = false; // set when the last played game was a draw (must be replayed)

const ROUND_NAMES = ['Quarts de finale', 'Demi-finales', 'Finale'];

export function unmount() {}

export async function mount(container, params = {}) {
  await Promise.all([CardDatabase.init(), AttributeDatabase.init()]);
  const deps = { attributeList: AttributeDatabase.getAllAttributes(), cardDb: CardDatabase };

  if (params.resumeMatchId) {
    _handleGameResult(params.resumeMatchId, params.gameWinner, deps);
  }

  if (!_tournament) {
    _renderSetup(container);
  } else {
    _renderBracket(container, deps);
  }
}

function _handleGameResult(matchId, gameWinner, deps) {
  if (!_tournament) return;
  const match = _tournament.rounds.flat().find(m => m.id === matchId);
  if (!match || match.winner) return;

  if (gameWinner === 'draw') {
    _drawNotice = true;
    return;
  }
  _drawNotice = false;

  const playerSlot = match.players.findIndex(p => p.isPlayer);
  const opponentSlot = 1 - playerSlot;
  const winnerSlot = gameWinner === 'player' ? playerSlot : opponentSlot;
  Tournament.recordGameResult(match, winnerSlot);

  if (match.winner) {
    // The player's match was the only one left unresolved this round (AI vs AI
    // matches are resolved instantly when the round starts) — the round is
    // therefore complete as soon as this match ends.
    if (!Tournament.isTournamentComplete(_tournament)) {
      const nextRound = Tournament.buildNextRound(_tournament);
      Tournament.resolveAiMatches(nextRound, deps);
    }
  }
}

function _renderSetup(container) {
  const names = DeckRepository.listDecks();
  let selected = names[0] || null;

  function render() {
    container.innerHTML = `
      <div class="topbar">
        <button class="topbar-back" id="btn-back">${BACK_SVG}</button>
        <span class="topbar-title">MODE TOURNOI</span>
      </div>
      <div class="ds-list" id="ds-list">
        ${names.length === 0 ? `
          <div class="ds-empty">
            <div class="ds-empty-icon">🃏</div>
            <div class="ds-empty-text">Aucun deck sauvegardé</div>
            <div class="ds-empty-sub">Crée un deck avant de lancer un tournoi.</div>
          </div>` : names.map(name => `
          <div class="ds-card${name === selected ? ' selected' : ''}" data-name="${_esc(name)}">
            <div class="ds-card-sheen"></div>
            <div class="ds-accent-bar"></div>
            <div class="ds-card-inner">
              <div class="ds-avatar" data-av="0">${_esc(name[0]?.toUpperCase() || '?')}</div>
              <div class="ds-card-body">
                <div class="ds-card-title"><span class="ds-card-name">${_esc(name)}</span></div>
              </div>
            </div>
          </div>`).join('')}
      </div>
      <div class="ds-footer">
        <button class="ds-cta" id="btn-start" ${selected ? '' : 'disabled'}>
          <span>⚔ LANCER LE TOURNOI (8 joueurs)</span>
        </button>
      </div>
    `;

    container.querySelector('#btn-back').addEventListener('click', () => navigate('main_menu'));
    container.querySelectorAll('.ds-card').forEach(el => {
      el.addEventListener('click', () => { selected = el.dataset.name; render(); });
    });
    container.querySelector('#btn-start')?.addEventListener('click', async () => {
      _drawNotice = false;
      _tournament = await Tournament.createTournament(selected);
      const deps = { attributeList: AttributeDatabase.getAllAttributes(), cardDb: CardDatabase };
      Tournament.resolveAiMatches(_tournament.rounds[0], deps);
      _renderBracket(container, deps);
    });
  }

  render();
}

function _renderBracket(container, deps) {
  const roundIdx = _tournament.currentRoundIndex;
  const round = _tournament.rounds[roundIdx];
  const playerMatch = Tournament.findPlayerMatch(_tournament);
  const complete = Tournament.isTournamentComplete(_tournament);
  const champion = complete ? Tournament.getChampion(_tournament) : null;

  container.innerHTML = `
    <div class="topbar">
      <button class="topbar-back" id="btn-back">${BACK_SVG}</button>
      <span class="topbar-title">TOURNOI — ${_esc(ROUND_NAMES[roundIdx] || `Round ${roundIdx + 1}`)}</span>
    </div>
    <div class="ds-list" id="tourney-list" style="padding-bottom:16px;">
      ${complete ? `
        <div class="ds-empty">
          <div class="ds-empty-icon">${champion?.isPlayer ? '🏆' : '💀'}</div>
          <div class="ds-empty-text">${champion?.isPlayer ? 'Vous êtes CHAMPION !' : `${_esc(champion?.name || 'Un adversaire')} remporte le tournoi`}</div>
        </div>
      ` : _tournament.rounds.map((r, i) => _roundHtml(r, i)).join('')}
    </div>
    <div class="ds-footer">
      ${complete
        ? `<button class="ds-cta" id="btn-menu"><span>MENU PRINCIPAL</span></button>`
        : playerMatch
          ? `<button class="ds-cta" id="btn-play"><span>⚔ ${_drawNotice ? 'REJOUER LA MANCHE (égalité)' : 'JOUER MON MATCH'}</span></button>`
          : `<div class="ds-empty-sub" style="text-align:center;padding:8px;">Vous avez été éliminé du tournoi.</div>`
      }
    </div>
  `;

  container.querySelector('#btn-back').addEventListener('click', () => navigate('main_menu'));
  container.querySelector('#btn-menu')?.addEventListener('click', () => { _tournament = null; navigate('main_menu'); });
  container.querySelector('#btn-play')?.addEventListener('click', () => {
    const match = playerMatch;
    const playerSlot = match.players.findIndex(p => p.isPlayer);
    const opponent = match.players[1 - playerSlot];
    navigate('game3d', {
      deckName: _tournament.playerDeckName,
      enemyDeckRaw: opponent.deck,
      tournamentMatch: { id: match.id },
    });
  });

  if (!playerMatch && !complete) {
    // Player was eliminated but AI matches keep resolving in the background
    // until the bracket produces a champion — do it now so the screen isn't stuck.
    if (Tournament.isRoundComplete(round)) {
      const nextRound = Tournament.buildNextRound(_tournament);
      Tournament.resolveAiMatches(nextRound, deps);
      _renderBracket(container, deps);
    }
  }
}

function _roundHtml(round, idx) {
  return `
    <div class="tourney-round">
      <div class="gs-synergy-label" style="margin:10px 0 6px;">${_esc(ROUND_NAMES[idx] || `Round ${idx + 1}`)}</div>
      ${round.map(m => _matchHtml(m)).join('')}
    </div>`;
}

function _matchHtml(match) {
  const [a, b] = match.players;
  const aWon = match.winner === a;
  const bWon = match.winner === b;
  return `
    <div class="ds-card" style="cursor:default;">
      <div class="ds-card-inner" style="justify-content:space-between;">
        <span class="ds-card-name" style="${aWon ? 'color:#7fe6b6;' : (match.winner ? 'opacity:.5;' : '')}">${a.isPlayer ? '★ ' : ''}${_esc(a.name)}</span>
        <span class="ds-card-meta">${match.wins[0]} – ${match.wins[1]}</span>
        <span class="ds-card-name" style="${bWon ? 'color:#7fe6b6;' : (match.winner ? 'opacity:.5;' : '')}">${b.isPlayer ? '★ ' : ''}${_esc(b.name)}</span>
      </div>
    </div>`;
}

function _esc(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
