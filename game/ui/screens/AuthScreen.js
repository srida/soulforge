import { navigate } from '../../main.js';
import * as AuthClient from '../../data/AuthClient.js';
import * as DeckRepository from '../../data/DeckRepository.js';

let mode = 'login'; // 'login' | 'register'
let gameVersion = null;

async function loadVersion() {
  if (gameVersion) return gameVersion;
  try {
    const res = await fetch('/api/version');
    if (res.ok) { const d = await res.json(); gameVersion = d.version; }
  } catch { /* ignore */ }
  return gameVersion;
}

export async function mount(container, params = {}) {
  if (params.mode === 'register' || params.mode === 'login') mode = params.mode;
  const version = await loadVersion();
  render(container, version);
}

export function unmount() {}

function render(container, version) {
  const isLogin = mode === 'login';
  const versionLabel = version ? `v${version}` : 'v?';

  container.innerHTML = `
    <div class="auth-new">
      <!-- scanline overlay -->
      <div class="auth-new-scanline" aria-hidden="true"></div>

      <!-- mobile brand (hidden on desktop) -->
      <div class="auth-new-brand">
        <img class="auth-new-logo" src="/game/logo.png" alt="Soulforge logo">
        <div class="auth-new-wordmark">SOULFORGE</div>
        <div class="auth-new-tagline">Auto-Chess × Tactiques × Deck building</div>
        <div class="auth-new-brand-version">${versionLabel}</div>
      </div>

      <!-- desktop hero (hidden on mobile) -->
      <div class="auth-new-hero" aria-hidden="true">
        <div class="auth-new-hero-inner">
          <div class="auth-new-hero-title">SOULFORGE</div>
          <div class="auth-new-hero-badge">SAISON 3 · BATTLE CITY</div>
          <div class="auth-new-hero-headline">Invoque. Compose.<br>Domine l'arène.</div>
          <div class="auth-new-hero-desc">Mêle l'auto-chess, la tactique au tour par tour et l'invocation de cartes dans un même affrontement 1v1. Ta forge t'attend.</div>
        </div>
        <div class="auth-new-hero-version">${versionLabel}</div>
      </div>

      <!-- form panel -->
      <div class="auth-new-panel">
        <div class="auth-new-panel-head">
          <div class="auth-new-panel-title">${isLogin ? 'Connexion' : 'Forge ton héros'}</div>
          <div class="auth-new-panel-sub">${isLogin ? 'Reprends ta partie là où tu l\'as laissée.' : 'Crée ton compte et rejoins la forge.'}</div>
        </div>

        <form class="auth-new-form" id="auth-form" novalidate>
          ${isLogin ? `
          <label class="auth-new-field">
            <span class="auth-new-label">IDENTIFIANT</span>
            <input class="auth-new-input" type="email" name="email" autocomplete="email" inputmode="email" placeholder="Pseudo ou e-mail" required>
          </label>
          ` : `
          <label class="auth-new-field">
            <span class="auth-new-label">E-MAIL</span>
            <input class="auth-new-input" type="email" name="email" autocomplete="email" inputmode="email" placeholder="toi@exemple.com" required>
          </label>
          <label class="auth-new-field">
            <span class="auth-new-label">PSEUDO</span>
            <input class="auth-new-input" type="text" name="username" autocomplete="username" placeholder="3 à 20 caractères" required>
            <span class="auth-new-hint">Lettres, chiffres et _. Visible par tes amis.</span>
          </label>
          `}

          <label class="auth-new-field">
            <div class="auth-new-label-row">
              <span class="auth-new-label">MOT DE PASSE</span>
              ${isLogin ? '<span class="auth-new-forgot">Mot de passe oublié ?</span>' : ''}
            </div>
            <input class="auth-new-input" type="password" name="password" autocomplete="${isLogin ? 'current-password' : 'new-password'}" placeholder="••••••••" required>
            ${!isLogin ? '<span class="auth-new-hint">8 caractères minimum.</span>' : ''}
          </label>

          ${isLogin ? `
          <label class="auth-new-remember">
            <span class="auth-new-checkbox" id="remember-box" role="checkbox" aria-checked="false" tabindex="0">✓</span>
            <span class="auth-new-remember-text">Rester connecté sur cet appareil</span>
          </label>
          ` : ''}

          <div class="auth-new-error" id="auth-error" hidden></div>

          <button type="submit" class="auth-new-cta" id="auth-submit">
            <div class="auth-new-cta-sheen" aria-hidden="true"></div>
            <span class="auth-new-cta-label">${isLogin ? 'ENTRER DANS LA FORGE' : 'FORGER MON HÉROS'}</span>
            <span class="auth-new-cta-arrow">▸</span>
          </button>

          <div class="auth-new-divider">
            <div class="auth-new-divider-line"></div>
            <span class="auth-new-divider-text">OU CONTINUER AVEC</span>
            <div class="auth-new-divider-line"></div>
          </div>

          <div class="auth-new-social">
            <button type="button" class="auth-new-social-btn" disabled>
              <span class="auth-new-social-icon auth-new-social-icon--google"></span>
              Google
            </button>
            <button type="button" class="auth-new-social-btn" disabled>
              <span class="auth-new-social-icon auth-new-social-icon--apple"></span>
              Apple
            </button>
          </div>
        </form>

        <div class="auth-new-footer">
          ${isLogin
            ? 'Pas encore de compte ? <button type="button" class="auth-new-link" id="switch-mode">Forger un héros</button>'
            : 'Déjà de retour ? <button type="button" class="auth-new-link" id="switch-mode">Se connecter</button>'}
        </div>
      </div>
    </div>
  `;

  const form = container.querySelector('#auth-form');
  const errBox = container.querySelector('#auth-error');
  const submitBtn = container.querySelector('#auth-submit');
  const submitLabel = container.querySelector('.auth-new-cta-label');

  const showError = (msg) => { errBox.textContent = msg; errBox.hidden = false; };
  const clearError = () => { errBox.hidden = true; };

  container.querySelector('#switch-mode')?.addEventListener('click', () => {
    mode = isLogin ? 'register' : 'login';
    render(container, version);
  });

  // Remember-me checkbox toggle
  let rememberMe = false;
  const rememberBox = container.querySelector('#remember-box');
  if (rememberBox) {
    const toggle = () => {
      rememberMe = !rememberMe;
      rememberBox.setAttribute('aria-checked', String(rememberMe));
      rememberBox.classList.toggle('auth-new-checkbox--checked', rememberMe);
    };
    rememberBox.addEventListener('click', toggle);
    rememberBox.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(); } });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearError();
    const data = Object.fromEntries(new FormData(form));
    submitBtn.disabled = true;
    submitLabel.textContent = 'Un instant…';
    try {
      if (mode === 'login') {
        await AuthClient.login({ email: data.email, password: data.password, rememberMe });
      } else {
        await AuthClient.register({ email: data.email, username: data.username, password: data.password });
      }
      await DeckRepository.pull();
      navigate('main_menu');
    } catch (err) {
      showError(err.message || 'Une erreur est survenue.');
      const field = err.field && form.querySelector(`[name="${err.field}"]`);
      if (field) field.focus();
      submitBtn.disabled = false;
      submitLabel.textContent = isLogin ? 'ENTRER DANS LA FORGE' : 'FORGER MON HÉROS';
    }
  });
}
