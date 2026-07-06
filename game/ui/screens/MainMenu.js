import { navigate } from '../../main.js';
import * as AuthClient from '../../data/AuthClient.js';
import * as DeckRepository from '../../data/DeckRepository.js';

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Placeholder data — will be backed by real API in the online phase
const SEASON   = { name: 'La Forge des Âmes', num: 3, days: 42 };
const STATS    = { level: 24, xp: 3200, xpMax: 5000, rank: 'Diamant II', pdl: 64, wins: 68, games: 142, lb: '#8.4k', gold: 1240, gems: 80 };
const PASS     = { level: 24, xp: 480, xpMax: 1000 };
const MISSIONS = [
  { done: true,  label: 'Jouer 1 partie classée', progress: 1, total: 1,  reward: '+50',  gem: false },
  { done: false, label: 'Gagner 3 parties',        progress: 1, total: 3,  reward: '+120', gem: false },
  { done: false, label: 'Invoquer 10 cartes',      progress: 6, total: 10, reward: '◆ 5', gem: true  },
];

function avatarContent(avatar) {
  if (!avatar) return '';
  if (/^(https?:|data:)/i.test(avatar)) {
    return `<img class="mm-avatar-img" src="${esc(avatar)}" alt="">`;
  }
  return `<span class="mm-avatar-text">${esc(avatar)}</span>`;
}

function friendAvatarContent(avatar) {
  if (!avatar) return '';
  if (/^(https?:|data:)/i.test(avatar)) {
    return `<img class="mm-friend-av-img" src="${esc(avatar)}" alt="">`;
  }
  return `<span class="mm-friend-av-text">${esc(avatar)}</span>`;
}

export async function mount(container) {
  let user = AuthClient.getUser();
  if (!user) {
    try { user = await AuthClient.me(); } catch { /* offline */ }
  }
  if (!user) { navigate('auth'); return; }

  let friends = [];
  let requests = { incoming: [], outgoing: [] };
  try {
    [friends, requests] = await Promise.all([
      AuthClient.getFriends().catch(() => []),
      AuthClient.getRequests().catch(() => ({ incoming: [], outgoing: [] })),
    ]);
  } catch { /* offline */ }

  const s = STATS;
  const isAdmin = user.is_admin;
  const passXpPct = Math.round(PASS.xp / PASS.xpMax * 100);
  const xpPct     = Math.round(s.xp / s.xpMax * 100);
  const pendingCount = requests.incoming.length;

  const incomingRows = requests.incoming.map(r => `
    <div class="mm-friend">
      <div class="mm-friend-av">
        ${friendAvatarContent(r.avatar)}
        <span class="mm-friend-dot" style="background:var(--sf-team-red)"></span>
      </div>
      <div class="mm-friend-info">
        <div class="mm-friend-name">${esc(r.username)}<span class="mm-friend-tag"> #${esc(String(r.tag))}</span></div>
        <div class="mm-friend-sub">Demande d'ami</div>
      </div>
      <div class="mm-req-btns">
        <button class="mm-req-accept" data-req-accept="${esc(r.friendship_id)}">✓</button>
        <button class="mm-req-decline" data-req-decline="${esc(r.friendship_id)}">✕</button>
      </div>
    </div>
  `).join('');

  const friendRows = friends.length
    ? friends.map(f => `
      <div class="mm-friend">
        <div class="mm-friend-av">
          ${friendAvatarContent(f.avatar)}
          <span class="mm-friend-dot"></span>
        </div>
        <div class="mm-friend-info">
          <div class="mm-friend-name">${esc(f.username)}<span class="mm-friend-tag"> #${esc(String(f.tag))}</span></div>
          <div class="mm-friend-sub">Ami</div>
        </div>
        <div class="mm-friend-rank"></div>
      </div>
    `).join('')
    : '<div class="mm-no-friends">Aucun ami pour le moment.</div>';

  const friendsSep = (incomingRows && friends.length) ? '<div class="mm-req-sep"></div>' : '';

  const missionRows = MISSIONS.map(m => {
    const pct = Math.round(m.progress / m.total * 100);
    return `
      <div class="mm-mission">
        <span class="mm-mission-check${m.done ? ' done' : ''}">${m.done ? '✓' : ''}</span>
        <div class="mm-mission-info">
          <div class="mm-mission-label">${esc(m.label)}</div>
          <div class="mm-mission-bar"><div class="mm-mission-fill${m.done ? ' done' : ''}" style="width:${pct}%"></div></div>
        </div>
        <span class="mm-mission-reward ${m.gem ? 'gem' : 'gold'}">${esc(m.reward)}</span>
      </div>
    `;
  }).join('');

  const passRewards = `
    <div class="mm-pass-reward mm-pass-reward-unlocked">★</div>
    <div class="mm-pass-reward mm-pass-reward-gem"><span class="mm-gem-icon"></span></div>
    <div class="mm-pass-reward mm-pass-reward-locked">${PASS.level + 1}</div>
    <div class="mm-pass-reward mm-pass-reward-locked">${PASS.level + 2}</div>
  `;

  const passPanel = `
    <div class="mm-pass-head">
      <span class="mm-pass-title">PASSE DE SAISON</span>
      <span class="mm-pass-tier">Palier ${PASS.level}</span>
    </div>
    <div class="mm-pass-prog-label"><span>Vers palier ${PASS.level + 1}</span><span>${PASS.xp} / ${PASS.xpMax}</span></div>
    <div class="mm-bar-track"><div class="mm-bar-fill" style="width:${passXpPct}%"></div></div>
    <div class="mm-pass-rewards">${passRewards}</div>
  `;

  const devBar = isAdmin ? `
    <div class="mm-dev-bar">
      <span class="mm-dev-tag">DEV</span>
      <div class="mm-dev-btns">
        <button class="mm-dev-btn" data-action="testbench3d">TestBench 3D</button>
        <button class="mm-dev-btn" data-action="admin">Administration</button>
      </div>
    </div>
  ` : '';

  const devBarInline = isAdmin ? `
    <div class="mm-dev-bar mm-dev-bar-inline">
      <span class="mm-dev-tag">DEV</span>
      <div class="mm-dev-sep"></div>
      <button class="mm-dev-btn" data-action="testbench3d">TestBench 3D</button>
      <button class="mm-dev-btn" data-action="admin">Administration</button>
    </div>
  ` : '';

  container.innerHTML = `
    <div class="mm-root">

      <!-- Mobile header -->
      <div class="mm-header">
        <button class="mm-avatar-btn" data-action="profile">
          <div class="mm-avatar-circle">
            ${avatarContent(user.avatar)}
            <div class="mm-avatar-level">${s.level}</div>
          </div>
          <div class="mm-header-identity">
            <div class="mm-header-name">${esc(user.username)}</div>
            <div class="mm-header-rank"><span class="mm-rank-gem"></span>${esc(s.rank)}</div>
          </div>
        </button>
        <div class="mm-currency-group">
          <div class="mm-currency-chip mm-currency-gold">
            <span class="mm-coin"></span>${s.gold.toLocaleString('fr-FR')}
          </div>
          <div class="mm-currency-chip mm-currency-gem">
            <span class="mm-gem-icon"></span>${s.gems}
          </div>
        </div>
      </div>

      <!-- Desktop header -->
      <header class="mm-desktop-header">
        <div class="mm-desktop-header-left">
          <img src="/game/logo.png" class="mm-logo-img" alt="Soulforge">
          <div class="mm-desktop-title">SOULFORGE</div>
          <div class="mm-desktop-subtitle">Auto-Battler × Tactiques × Deckbuilding</div>
        </div>
        <div class="mm-desktop-header-right">
          ${devBarInline}
          <div class="mm-currency-group">
            <div class="mm-currency-chip mm-currency-gold">
              <span class="mm-coin"></span>${s.gold.toLocaleString('fr-FR')}
              <button class="mm-currency-add" aria-label="Acheter">+</button>
            </div>
            <div class="mm-currency-chip mm-currency-gem">
              <span class="mm-gem-icon"></span>${s.gems}
              <button class="mm-currency-add mm-currency-add-gem" aria-label="Acheter">+</button>
            </div>
          </div>
          <button class="mm-profile-btn" data-action="profile">
            <div class="mm-avatar-circle">
              ${avatarContent(user.avatar)}
            </div>
            <div>
              <div class="mm-header-name">${esc(user.username)}</div>
              <div class="mm-header-rank"><span class="mm-rank-gem"></span>${esc(s.rank)} · ${s.pdl} PdL</div>
            </div>
          </button>
          <button class="mm-icon-btn" data-action="settings" title="Réglages" aria-label="Réglages">
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round">
              <line x1="4" y1="6" x2="18" y2="6"/><circle cx="14" cy="6" r="2.6" fill="var(--sf-void-2)"/>
              <line x1="4" y1="11" x2="18" y2="11"/><circle cx="8" cy="11" r="2.6" fill="var(--sf-void-2)"/>
              <line x1="4" y1="16" x2="18" y2="16"/><circle cx="15" cy="16" r="2.6" fill="var(--sf-void-2)"/>
            </svg>
          </button>
          <button class="mm-icon-btn mm-logout-btn" data-action="logout" title="Se déconnecter" aria-label="Se déconnecter">⎋</button>
        </div>
      </header>

      <!-- Main grid -->
      <div class="mm-grid">

        <!-- LEFT: profile (desktop only) -->
        <aside class="mm-col-left">
          <div class="mm-profile-card">
            <div class="mm-profile-banner">
              <span class="mm-profile-banner-lbl">BANNIÈRE DE PROFIL</span>
              <div class="mm-profile-avatar-wrap">
                <div class="mm-avatar-circle mm-avatar-lg">
                  ${avatarContent(user.avatar)}
                  <div class="mm-avatar-level">${s.level}</div>
                </div>
              </div>
            </div>
            <div class="mm-profile-body">
              <div class="mm-profile-name">${esc(user.username)}</div>
              <div class="mm-profile-rank-row">
                <span class="mm-rank-gem-lg"></span>
                <span class="mm-profile-rank-name">${esc(s.rank)}</span>
                <span class="mm-profile-pdl">· ${s.pdl} PdL</span>
              </div>
              <div class="mm-xp-label"><span>Niveau ${s.level}</span><span>${s.xp.toLocaleString('fr-FR')} / ${s.xpMax.toLocaleString('fr-FR')} XP</span></div>
              <div class="mm-bar-track"><div class="mm-bar-fill" style="width:${xpPct}%"></div></div>
              <div class="mm-profile-stats">
                <div><div class="mm-stat-val">${s.wins}%</div><div class="mm-stat-lbl">Victoires</div></div>
                <div><div class="mm-stat-val">${s.games}</div><div class="mm-stat-lbl">Parties</div></div>
                <div><div class="mm-stat-val">${s.lb}</div><div class="mm-stat-lbl">Classt.</div></div>
              </div>
              <button class="mm-profile-action" data-action="profile">Voir le profil</button>
              <button class="mm-profile-action mm-boutique-action" data-action="boutique">
                <span class="mm-gem-icon"></span>Boutique
              </button>
            </div>
          </div>
        </aside>

        <!-- CENTER: main content -->
        <main class="mm-col-center">
          <!-- Season banner -->
          <div class="mm-season-banner">
            <div class="mm-season-lines"></div>
            <img src="/game/logo.png" class="mm-season-logo" alt="">
            <div class="mm-season-body">
              <span class="mm-season-badge">SAISON ${SEASON.num} · EN COURS</span>
              <div class="mm-season-title">${esc(SEASON.name)}</div>
              <div class="mm-season-sub">Nouveau pass · ${SEASON.days} jours restants · récompenses inédites</div>
            </div>
            <button class="mm-season-details">Détails ▸</button>
          </div>

          <!-- Mode tabs -->
          <div class="mm-tabs-row">
            <div class="mm-tabs" id="mm-tabs">
              <button class="mm-tab active" data-mode="ranked">CLASSÉ</button>
              <button class="mm-tab" data-mode="normal">NORMAL</button>
            </div>
            <div class="mm-online-count">
              <span class="mm-online-dot"></span>8 421 joueurs en ligne
            </div>
          </div>

          <!-- Big play button -->
          <button class="mm-play-btn" id="mm-play" data-action="play">
            <div class="mm-play-sheen"></div>
            <div class="mm-play-icon">▶</div>
            <div class="mm-play-body">
              <div class="mm-play-title">JOUER EN LIGNE</div>
              <div class="mm-play-sub" id="mm-play-sub">File classée · ~12 s · 1 v 1</div>
            </div>
            <div class="mm-play-arrow">▸</div>
          </button>

          <!-- Solo + Tournoi + Deck -->
          <div class="mm-cards-row">
            <button class="mm-card" data-action="solo">
              <div class="mm-card-icon mm-card-icon-play">▶</div>
              <div class="mm-card-title">Jouer solo</div>
              <div class="mm-card-sub">vs IA · entraînement · puzzles tactiques</div>
            </button>
            <button class="mm-card" data-action="tournament">
              <div class="mm-card-icon mm-card-icon-play">🏆</div>
              <div class="mm-card-title">Tournoi</div>
              <div class="mm-card-sub">Mode Mêlée · bracket 8 joueurs</div>
            </button>
            <button class="mm-card" data-action="decks">
              <div class="mm-card-icon mm-card-icon-deck">
                <span class="mm-deck-card mm-deck-card-1"></span>
                <span class="mm-deck-card mm-deck-card-2"></span>
              </div>
              <div class="mm-card-title">Deck-building</div>
              <div class="mm-card-sub">Composer &amp; invoquer</div>
            </button>
          </div>

          <!-- Boutique tile (mobile only) -->
          <div class="mm-boutique-tile mm-mobile-only">
            <div class="mm-boutique-left">
              <span class="mm-gem-icon mm-gem-glow"></span>
              <div>
                <div class="mm-boutique-title">Boutique</div>
                <div class="mm-boutique-sub">2 offres limitées</div>
              </div>
            </div>
            <span class="mm-boutique-badge">NOUVEAU</span>
          </div>

          <!-- Pass panel (mobile only) -->
          <div class="mm-pass-panel mm-mobile-only">${passPanel}</div>

          <!-- Dev (mobile only) -->
          <div class="mm-mobile-only">${devBar}</div>
        </main>

        <!-- RIGHT: panels (desktop only) -->
        <aside class="mm-col-right">
          <div class="mm-panel mm-pass-panel">${passPanel}</div>
          <div class="mm-panel mm-missions-panel">
            <div class="mm-panel-head">
              <span class="mm-panel-title">MISSIONS DU JOUR</span>
              <span class="mm-missions-timer">06:12:44</span>
            </div>
            <div class="mm-missions">${missionRows}</div>
          </div>
          <div class="mm-panel mm-friends-panel">
            <div class="mm-panel-head">
              <span class="mm-panel-title">AMIS · ${friends.length}${pendingCount ? ` · <span style="color:var(--sf-team-red)">${pendingCount} demande${pendingCount > 1 ? 's' : ''}</span>` : ''}</span>
              <button class="mm-invite-btn" data-action="friends">+ Inviter</button>
            </div>
            <div class="mm-friends">
              ${incomingRows}
              ${friendsSep}
              ${friendRows}
            </div>
            <div class="mm-logout-row">
              <div class="mm-watermark">v0.7.2</div>
            </div>
          </div>
          ${devBar}
        </aside>
      </div>

      <!-- Mobile bottom nav -->
      <nav class="mm-bottom-nav">
        <button class="mm-bottom-tab active" data-action="home">
          <span class="mm-bottom-icon-home active"></span>
          <span>Accueil</span>
        </button>
        <button class="mm-bottom-tab" data-action="friends" style="position:relative">
          <span class="mm-bottom-icon-friends">
            <span class="mm-friend-dot"></span>
          </span>
          ${pendingCount ? '<span class="mm-notif-badge"></span>' : ''}
          <span>Amis${pendingCount ? ` · ${pendingCount}` : ''}</span>
        </button>
        <button class="mm-bottom-tab" data-action="boutique">
          <span class="mm-gem-icon"></span>
          <span>Boutique</span>
        </button>
        <button class="mm-bottom-tab" data-action="settings">
          <svg width="18" height="18" viewBox="0 0 22 22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round">
            <line x1="4" y1="6" x2="18" y2="6"/><circle cx="14" cy="6" r="2.6" fill="transparent"/>
            <line x1="4" y1="11" x2="18" y2="11"/><circle cx="8" cy="11" r="2.6" fill="transparent"/>
            <line x1="4" y1="16" x2="18" y2="16"/><circle cx="15" cy="16" r="2.6" fill="transparent"/>
          </svg>
          <span>Réglages</span>
        </button>
      </nav>

      <!-- Fullscreen (mobile overlay) -->
      <button class="mm-fs-btn" id="btn-fullscreen" title="Plein écran">⛶</button>
    </div>
  `;

  // ── Mode tabs ──
  const tabsEl = container.querySelector('#mm-tabs');
  const playSub = container.querySelector('#mm-play-sub');
  const MODES = {
    ranked: { sub: 'File classée · ~12 s · 1 v 1' },
    normal: { sub: 'Partie normale · 1 v 1' },
  };
  let currentMode = 'ranked';
  tabsEl?.addEventListener('click', e => {
    const tab = e.target.closest('.mm-tab');
    if (!tab) return;
    tabsEl.querySelectorAll('.mm-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    currentMode = tab.dataset.mode;
    if (playSub) playSub.textContent = MODES[currentMode].sub;
  });

  // ── Event delegation ──
  container.addEventListener('click', async e => {
    const el = e.target.closest('[data-action]');
    const acceptBtn = e.target.closest('[data-req-accept]');
    const declineBtn = e.target.closest('[data-req-decline]');

    if (acceptBtn) {
      const id = acceptBtn.dataset.reqAccept;
      try { await AuthClient.acceptRequest(id); } catch { /* ignore */ }
      mount(container);
      return;
    }
    if (declineBtn) {
      const id = declineBtn.dataset.reqDecline;
      try { await AuthClient.declineRequest(id); } catch { /* ignore */ }
      mount(container);
      return;
    }

    if (!el) return;
    switch (el.dataset.action) {
      case 'play':
        navigate('deck_selector', { target: 'online_lobby' });
        break;
      case 'solo':
        navigate('deck_selector', { target: 'game3d' });
        break;
      case 'decks':      navigate('deck_selector', { target: 'game3d' }); break;
      case 'tournament': navigate('tournament'); break;
      case 'profile':    navigate('profile'); break;
      case 'friends':    navigate('friends'); break;
      case 'testbench3d': navigate('testbench3d'); break;
      case 'admin':      window.location.href = '/admin'; break;
      case 'boutique':   break; // coming soon
      case 'settings':   break; // coming soon
      case 'home':       break; // already here
      case 'logout':     _logout(); break;
    }
  });

  async function _logout() {
    try { await DeckRepository.flushSync(); } catch { /* ignore */ }
    try { await AuthClient.logout(); } catch { /* ignore */ }
    DeckRepository.handleLogout();
    navigate('auth');
  }

  // ── Fullscreen ──
  const fsBtn = container.querySelector('#btn-fullscreen');
  if (document.documentElement.requestFullscreen) {
    const updateFsIcon = () => {
      fsBtn.textContent = document.fullscreenElement ? '✕' : '⛶';
      fsBtn.title = document.fullscreenElement ? 'Quitter le plein écran' : 'Plein écran';
    };
    fsBtn.addEventListener('click', () => {
      document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen().catch(() => {});
    });
    document.addEventListener('fullscreenchange', updateFsIcon);
    updateFsIcon();
  } else {
    fsBtn.style.display = 'none';
  }
}
