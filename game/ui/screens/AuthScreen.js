import { navigate } from '../../main.js';
import * as AuthClient from '../../data/AuthClient.js';
import * as DeckRepository from '../../data/DeckRepository.js';

const BACK_SVG = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3L5 8l5 5"/></svg>`;

let mode = 'login'; // 'login' | 'register'

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export async function mount(container, params = {}) {
  if (params.mode === 'register' || params.mode === 'login') mode = params.mode;

  function render() {
    const isLogin = mode === 'login';
    container.innerHTML = `
      <div class="topbar">
        <button class="topbar-back" id="btn-back">${BACK_SVG}</button>
        <span class="topbar-title">${isLogin ? 'CONNEXION' : 'INSCRIPTION'}</span>
        <span style="width:var(--touch-target)"></span>
      </div>
      <div class="auth-screen">
        <form class="auth-card" id="auth-form" novalidate>
          <div class="auth-tabs">
            <button type="button" class="auth-tab ${isLogin ? 'active' : ''}" data-mode="login">Se connecter</button>
            <button type="button" class="auth-tab ${!isLogin ? 'active' : ''}" data-mode="register">Créer un compte</button>
          </div>

          <label class="auth-field">
            <span class="auth-label">E-mail</span>
            <input class="auth-input" type="email" name="email" autocomplete="email" inputmode="email" placeholder="toi@exemple.com" required>
          </label>

          ${isLogin ? '' : `
          <label class="auth-field">
            <span class="auth-label">Pseudo</span>
            <input class="auth-input" type="text" name="username" autocomplete="username" placeholder="3 à 20 caractères" required>
            <span class="auth-hint">Visible par tes amis. Lettres, chiffres et _.</span>
          </label>`}

          <label class="auth-field">
            <span class="auth-label">Mot de passe</span>
            <input class="auth-input" type="password" name="password" autocomplete="${isLogin ? 'current-password' : 'new-password'}" placeholder="${isLogin ? 'Ton mot de passe' : '8 caractères minimum'}" required>
          </label>

          <div class="auth-error" id="auth-error" hidden></div>

          <button type="submit" class="btn btn-primary btn-full auth-submit" id="auth-submit">
            ${isLogin ? 'Se connecter' : 'Créer mon compte'}
          </button>
        </form>
      </div>
    `;

    const form = container.querySelector('#auth-form');
    const errBox = container.querySelector('#auth-error');
    const submitBtn = container.querySelector('#auth-submit');

    const showError = (msg) => { errBox.textContent = msg; errBox.hidden = false; };
    const clearError = () => { errBox.hidden = true; };

    container.querySelector('#btn-back').addEventListener('click', () => navigate('main_menu'));
    container.querySelectorAll('.auth-tab').forEach(tab => {
      tab.addEventListener('click', () => { mode = tab.dataset.mode; render(); });
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearError();
      const data = Object.fromEntries(new FormData(form));
      submitBtn.disabled = true;
      submitBtn.textContent = 'Un instant…';
      try {
        if (mode === 'login') {
          await AuthClient.login({ email: data.email, password: data.password });
        } else {
          await AuthClient.register({ email: data.email, username: data.username, password: data.password });
        }
        // Synchronise les decks du compte (migration one-shot au 1er login).
        await DeckRepository.pull();
        navigate('main_menu');
      } catch (err) {
        showError(err.message || 'Une erreur est survenue.');
        const field = err.field && form.querySelector(`[name="${err.field}"]`);
        if (field) field.focus();
        submitBtn.disabled = false;
        submitBtn.textContent = mode === 'login' ? 'Se connecter' : 'Créer mon compte';
      }
    });
  }

  render();
}
