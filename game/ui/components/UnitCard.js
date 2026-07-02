const TIER_CFG = {
  1: { edge:'#46d39a', dim:'rgba(70,211,154,.28)',  ink:'#7ef0c0', glow:'rgba(70,211,154,.55)', art:'linear-gradient(145deg,#163825 0%,#060e09 100%)', diamond:'rgba(70,211,154,.14)' },
  2: { edge:'#5fb4e8', dim:'rgba(95,180,232,.28)',  ink:'#9ad2f6', glow:'rgba(95,180,232,.55)', art:'linear-gradient(145deg,#0f2840 0%,#050c18 100%)', diamond:'rgba(95,180,232,.14)' },
  3: { edge:'#a78bfa', dim:'rgba(167,139,250,.28)', ink:'#cdbcff', glow:'rgba(167,139,250,.55)', art:'linear-gradient(145deg,#231455 0%,#090520 100%)', diamond:'rgba(167,139,250,.14)' },
  4: { edge:'#e8a850', dim:'rgba(232,168,80,.28)',  ink:'#f0c48a', glow:'rgba(232,168,80,.55)',  art:'linear-gradient(145deg,#3a2206 0%,#120801 100%)', diamond:'rgba(232,168,80,.14)' },
  5: { edge:'#e85a6e', dim:'rgba(232,90,110,.28)',  ink:'#f5a0ad', glow:'rgba(232,90,110,.55)', art:'linear-gradient(145deg,#3a0f1a 0%,#120508 100%)', diamond:'rgba(232,90,110,.14)' },
};

const EFFECT_CFG = {
  shield:      { bg:'rgba(40,30,8,.72)',  edge:'rgba(240,196,90,.85)',  glow:'rgba(232,168,80,.65)',  ink:'#f6da82' },
  burn:        { bg:'rgba(42,14,6,.72)',  edge:'rgba(255,110,55,.85)',  glow:'rgba(255,90,40,.65)',   ink:'#ff8a4a' },
  paralysis:   { bg:'rgba(38,34,6,.72)',  edge:'rgba(245,210,40,.85)',  glow:'rgba(240,200,40,.65)',  ink:'#ffe066' },
  poison:      { bg:'rgba(10,34,8,.72)',  edge:'rgba(110,220,80,.85)',  glow:'rgba(100,210,70,.65)',  ink:'#9de87a' },
  confusion:   { bg:'rgba(28,10,42,.72)', edge:'rgba(190,100,250,.85)', glow:'rgba(180,90,240,.65)', ink:'#d08aff' },
  provocation: { bg:'rgba(42,12,6,.72)',  edge:'rgba(255,88,55,.85)',   glow:'rgba(240,72,42,.65)',   ink:'#ff8068' },
  malus:       { bg:'rgba(40,12,18,.7)',  edge:'rgba(232,90,110,.85)',  glow:'rgba(232,90,110,.6)',   ink:'#ff8a9c' },
};

export function createUnitEl(unit, { selected = false, materialSelected = false } = {}) {
  const tier = unit.tier ?? 2;
  const t = TIER_CFG[tier] ?? TIER_CFG[2];

  const el = document.createElement('div');
  el.className = 'unit-card'
    + ` unit-${unit.side}`
    + (selected ? ' selected' : '')
    + (materialSelected ? ' material-selected' : '')
    + (unit.is_neutralized ? ' neutralized' : '');
  el.dataset.uid = unit.uid;

  el.style.setProperty('--uc-edge',     t.edge);
  el.style.setProperty('--uc-edge-dim', t.dim);
  el.style.setProperty('--uc-glow',     t.glow);
  el.style.setProperty('--uc-ink',      t.ink);
  el.style.setProperty('--uc-art',      t.art);
  el.style.setProperty('--uc-diamond',  t.diamond);

  el.innerHTML = _inner(unit);
  _updateMedallion(el, unit);
  _updateVet(el, unit);
  return el;
}

export function updateUnitEl(el, unit) {
  el.classList.toggle('neutralized', unit.is_neutralized);

  const hpPct = unit.max_hp > 0 ? Math.round((unit.current_hp / unit.max_hp) * 100) : 0;
  const hpFill = el.querySelector('.unit-hp-fill');
  if (hpFill) hpFill.style.width = hpPct + '%';

  const pwrPct = unit.power_id
    ? Math.min(100, Math.round((unit.power_gauge / unit.power_speed) * 100))
    : 0;
  const pwrFill = el.querySelector('.unit-pwr-fill');
  if (pwrFill) pwrFill.style.width = pwrPct + '%';

  _updateMedallion(el, unit);
  _updateVet(el, unit);
}

function _inner(unit) {
  const tier  = unit.tier ?? 2;
  const hpPct = unit.max_hp > 0 ? Math.round((unit.current_hp / unit.max_hp) * 100) : 0;
  const pwrPct = unit.power_id
    ? Math.min(100, Math.round((unit.power_gauge / unit.power_speed) * 100))
    : 0;
  const stars = '★'.repeat(tier);

  const pwrBar = unit.power_id
    ? `<div class="unit-pwr-bar"><div class="unit-pwr-fill" style="width:${pwrPct}%"></div></div>`
    : '';

  return `
    <img class="unit-art" src="/illustrations/${unit.card_id}" alt="${esc(unit.name)}">
    <div class="unit-foil"></div>
    <div class="unit-top-edge"></div>
    <div class="unit-bottom-scrim"></div>

    <div class="unit-vet-badge" style="display:none"></div>
    <div class="unit-medallion" style="display:none"></div>
    <div class="unit-bars">
      <div class="unit-team-hex-wrap">
        <div class="unit-team-hex"><div class="unit-team-hex-inner"></div></div>
      </div>
      <div class="unit-bars-stack">
        ${pwrBar}
        <div class="unit-hp-bar"><div class="unit-hp-fill" style="width:${hpPct}%"></div></div>
      </div>
    </div>
  `.trim();
}

function _primaryBuff(unit) {
  if ((unit.shield ?? 0) > 0)              return 'shield';
  if (unit.burn_stacks?.length > 0)        return 'burn';
  if (unit.dot_effects?.length > 0)        return 'poison';
  if ((unit.paralysis_remaining ?? 0) > 0) return 'paralysis';
  if ((unit.confusion_remaining ?? 0) > 0) return 'confusion';
  if ((unit.taunt_remaining ?? 0) > 0)     return 'provocation';
  if (unit.is_power_blocked)               return 'malus';
  return null;
}

function _effectIconSvg(effect, ink) {
  const base = `width="62%" height="62%" viewBox="0 0 24 24" fill="none" stroke="${ink}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"`;
  switch (effect) {
    case 'shield':
      return `<svg ${base}><path d="M12 3L4 6.5v5.5c0 5 3.5 8.5 8 10 4.5-1.5 8-5 8-10V6.5L12 3z"/></svg>`;
    case 'burn':
      return `<svg ${base}><path d="M12 2c0 4-4 5.5-4 9.5a4 4 0 008 0C16 7.5 12 2 12 2z"/><path d="M10.5 15c.8-1.5 1.5-2.5 1.5-4.5" stroke-width="1.5"/></svg>`;
    case 'paralysis':
      return `<svg ${base}><path d="M13 2L5 13h6l-2 9 10-11h-6L13 2z"/></svg>`;
    case 'poison':
      return `<svg ${base}><path d="M12 3C12 3 6 10 6 15a6 6 0 0012 0C18 10 12 3 12 3z"/><circle cx="9.5" cy="15.5" r="1.2" fill="${ink}" stroke="none"/><circle cx="14.5" cy="15.5" r="1.2" fill="${ink}" stroke="none"/></svg>`;
    case 'confusion':
      return `<svg ${base}><path d="M9.5 9a2.5 2.5 0 015 0c0 2-2.5 3-2.5 5"/><circle cx="12" cy="18" r="1.3" fill="${ink}" stroke="none"/></svg>`;
    case 'provocation':
      return `<svg ${base}><circle cx="12" cy="12" r="8"/><line x1="12" y1="8" x2="12" y2="13"/><circle cx="12" cy="16.5" r="1.3" fill="${ink}" stroke="none"/></svg>`;
    default:
      return `<svg ${base}><path d="M5 11.5l7 6 7-6"/><path d="M5 6l7 6 7-6"/></svg>`;
  }
}

function _updateMedallion(el, unit) {
  const medallion = el.querySelector('.unit-medallion');
  if (!medallion) return;

  const buff = _primaryBuff(unit);
  if (!buff) { medallion.style.display = 'none'; return; }

  const spec = EFFECT_CFG[buff] ?? EFFECT_CFG.malus;
  const shieldVal = buff === 'shield' ? (unit.shield ?? 0) : 0;
  const valHtml = (buff === 'shield' && shieldVal > 0)
    ? `<span class="unit-medallion-val">${Math.round(shieldVal)}</span>`
    : '';

  medallion.style.cssText = [
    `display:flex`,
    `background:${spec.bg}`,
    `border-color:${spec.edge}`,
    `box-shadow:0 0 10px -2px ${spec.glow}`,
  ].join(';');
  medallion.innerHTML = `<div class="unit-medallion-inner">${_effectIconSvg(buff, spec.ink)}${valHtml}</div>`;
}

function _updateVet(el, unit) {
  const vet = el.querySelector('.unit-vet-badge');
  if (!vet) return;
  const pts = unit.veterancy_points ?? 0;
  if (pts >= 2) {
    vet.style.display = 'flex';
    vet.textContent = `⭐ ${pts}`;
  } else {
    vet.style.display = 'none';
  }
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
