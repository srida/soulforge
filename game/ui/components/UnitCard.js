export function createUnitEl(unit, { selected = false, materialSelected = false } = {}) {
  const el = document.createElement('div');
  el.className = 'unit-card'
    + ` unit-${unit.side}`
    + (selected ? ' selected' : '')
    + (materialSelected ? ' material-selected' : '')
    + (unit.is_neutralized ? ' neutralized' : '');
  el.dataset.uid = unit.uid;
  el.innerHTML = _inner(unit);
  return el;
}

// Update only the variable parts (HP/power bars, status icons) without touching the <img>
export function updateUnitEl(el, unit) {
  el.classList.toggle('neutralized', unit.is_neutralized);

  const hpPct = Math.round((unit.current_hp / unit.max_hp) * 100);
  const hpColor = hpPct > 60 ? 'var(--green)' : hpPct > 25 ? '#f59e0b' : 'var(--red)';

  const hpFill = el.querySelector('.unit-hp-fill');
  if (hpFill) {
    hpFill.style.width = hpPct + '%';
    hpFill.style.background = hpColor;
  }

  const pwrPct = unit.power_id
    ? Math.min(100, Math.round((unit.power_gauge / unit.power_speed) * 100))
    : 0;
  const pwrFill = el.querySelector('.unit-pwr-fill');
  if (pwrFill) pwrFill.style.width = pwrPct + '%';

  const statusEl = el.querySelector('.unit-status-icons');
  if (statusEl) statusEl.innerHTML = _statusIcons(unit);
}

function _inner(unit) {
  const hpPct = Math.round((unit.current_hp / unit.max_hp) * 100);
  const hpColor = hpPct > 60 ? 'var(--green)' : hpPct > 25 ? '#f59e0b' : 'var(--red)';
  const pwrPct = unit.power_id
    ? Math.min(100, Math.round((unit.power_gauge / unit.power_speed) * 100))
    : 0;
  const stars = '★'.repeat(unit.tier);

  return `
    <img class="unit-art" src="/illustrations/${unit.card_id}" alt="${esc(unit.name)}">
    <div class="unit-tier-badge badge-tier${unit.tier}">
      <span class="unit-tier-num">T${unit.tier}</span>
      <span class="unit-tier-stars">${stars}</span>
    </div>
    <div class="unit-status-icons">${_statusIcons(unit)}</div>
    <div class="unit-bars">
      <div class="unit-team-hex"></div>
      <div class="unit-bars-stack">
        <div class="unit-pwr-bar"><div class="unit-pwr-fill" style="width:${pwrPct}%"></div></div>
        <div class="unit-hp-bar"><div class="unit-hp-fill" style="width:${hpPct}%;background:${hpColor}"></div></div>
      </div>
    </div>
  `.trim();
}

function _statusIcons(unit) {
  let html = '';
  if ((unit.shield ?? 0) > 0)
    html += `<span class="status-icon si-shield">🛡 ${unit.shield}</span>`;
  if (unit.dot_effects?.length > 0)
    html += `<span class="status-icon si-poison">☠</span>`;
  if ((unit.paralysis_remaining ?? 0) > 0)
    html += `<span class="status-icon si-paralysis">⚡</span>`;
  if (unit.is_power_blocked)
    html += `<span class="status-icon si-block">🔇</span>`;
  return html;
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
