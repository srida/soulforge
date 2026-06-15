import { navigate } from '../../main.js';

export async function mount(container) {
  container.innerHTML = `
    <div class="main-menu">
      <button class="btn btn-icon main-menu-fullscreen" id="btn-fullscreen" title="Plein écran">⛶</button>
      <div class="main-menu-hero">
        <img src="/game/logo.png" class="main-menu-logo" alt="Soulforge">
        <h1 class="main-menu-title">Soulforge</h1>
        <p class="main-menu-subtitle">Auto-Chess × Tactiques × Cartes à invoquer</p>
      </div>
      <div class="main-menu-actions">
        <button class="btn btn-primary btn-full" id="btn-play">Jouer</button>
        <button class="btn btn-secondary btn-full" id="btn-testbench">TestBench (dev)</button>
        <button class="btn btn-secondary btn-full" id="btn-poc3d">POC 3D (dev)</button>
        <button class="btn btn-secondary btn-full" id="btn-game3d">Jouer (3D — dev)</button>
        <a href="/admin" class="main-menu-admin-link">Administration</a>
      </div>
    </div>
  `;

  container.querySelector('#btn-play').addEventListener('click', () => navigate('deck_selector'));
  container.querySelector('#btn-testbench').addEventListener('click', () => navigate('testbench'));
  container.querySelector('#btn-poc3d').addEventListener('click', () => navigate('poc3d'));
  container.querySelector('#btn-game3d').addEventListener('click', () => navigate('deck_selector', { target: 'game3d' }));

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
