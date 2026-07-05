import { navigate } from '../../main.js';
import * as AuthClient from '../../data/AuthClient.js';
import * as DeckRepository from '../../data/DeckRepository.js';

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export async function mount(container) {
  // Connexion obligatoire : on utilise la session déjà résolue au bootstrap.
  // Si aucune session (ex : expirée en cours de route), on renvoie au login.
  let user = AuthClient.getUser();
  if (!user) {
    try { user = await AuthClient.me(); } catch { /* serveur online indispo */ }
  }
  if (!user) { navigate('auth'); return; }

  const accountBar = `<div class="main-menu-account-bar">
       <button class="main-menu-account" id="btn-profile" title="Mon profil">
         <span class="main-menu-account-av">${esc(user.avatar || (user.username[0] || '?').toUpperCase())}</span>
         <span class="main-menu-account-name">${esc(user.username)}</span>
       </button>
       <button class="main-menu-logout" id="btn-logout" title="Se déconnecter" aria-label="Se déconnecter">⎋</button>
     </div>`;

  container.innerHTML = `
    <div class="main-menu">
      <button class="btn btn-icon main-menu-fullscreen" id="btn-fullscreen" title="Plein écran">⛶</button>
      ${accountBar}
      <div class="main-menu-hero">
        <img src="/game/logo.png" class="main-menu-logo" alt="Soulforge">
        <h1 class="main-menu-title">Soulforge</h1>
        <p class="main-menu-subtitle">Auto-Chess × Tactiques × Cartes à invoquer</p>
        <p class="main-menu-season">Saison 1</p>
      </div>
      <div class="main-menu-actions">
        <button class="btn main-menu-cta btn-full" id="btn-game3d">⚔ Jouer</button>
        <button class="btn btn-secondary btn-full" id="btn-tournament">🏆 Mode Tournoi</button>
        <button class="btn btn-secondary btn-full" id="btn-friends">👥 Mes amis</button>
        <button class="btn btn-secondary btn-full" id="btn-testbench3d">TestBench (dev)</button>
        <button class="btn btn-secondary btn-full" id="btn-admin">Administration</button>
      </div>
      <p class="main-menu-watermark">Soulforge v0.1 · Vertical Slice</p>
    </div>
  `;

  container.querySelector('#btn-testbench3d').addEventListener('click', () => navigate('testbench3d'));
  container.querySelector('#btn-game3d').addEventListener('click', () => navigate('deck_selector', { target: 'game3d' }));
  container.querySelector('#btn-tournament').addEventListener('click', () => navigate('tournament'));
  container.querySelector('#btn-admin').addEventListener('click', () => { window.location.href = '/admin'; });
  container.querySelector('#btn-profile')?.addEventListener('click', () => navigate('profile'));
  container.querySelector('#btn-friends')?.addEventListener('click', () => navigate('friends'));
  container.querySelector('#btn-logout')?.addEventListener('click', async () => {
    try { await DeckRepository.flushSync(); } catch { /* ignore */ }
    try { await AuthClient.logout(); } catch { /* ignore */ }
    DeckRepository.handleLogout();
    navigate('auth'); // connexion obligatoire → retour au login
  });

  const fsBtn = container.querySelector('#btn-fullscreen');
  if (document.documentElement.requestFullscreen) {
    const updateFsIcon = () => {
      fsBtn.textContent = document.fullscreenElement ? '✕' : '⛶';
      fsBtn.title = document.fullscreenElement ? 'Quitter le plein écran' : 'Plein écran';
    };
    fsBtn.addEventListener('click', () => {
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else {
        document.documentElement.requestFullscreen().catch(() => {});
      }
    });
    document.addEventListener('fullscreenchange', updateFsIcon);
    updateFsIcon();
  } else {
    fsBtn.style.display = 'none';
  }
}
