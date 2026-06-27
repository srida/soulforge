import { STAT_NAMES } from '../../logic/MagieEffect.js';

let _el = null;

function _ensure() {
  if (_el) return;
  _el = document.createElement('div');
  _el.className = 'tooltip-popup';
  _el.hidden = true;
  document.body.appendChild(_el);
  document.addEventListener('pointerdown', e => {
    if (_el && !_el.hidden && !_el.contains(e.target)) _el.hidden = true;
  }, { capture: true });
}

export function show(html, anchorEl) {
  _ensure();
  _el.innerHTML = html;
  _el.hidden = false;
  _reposition(anchorEl);
}

export function showAtRect(html, rect) {
  _ensure();
  _el.innerHTML = html;
  _el.hidden = false;
  _repositionFromRect(rect);
}

export function hide() {
  if (_el) _el.hidden = true;
}

export function toggle(html, anchorEl) {
  _ensure();
  if (!_el.hidden) { hide(); return; }
  show(html, anchorEl);
}

function _reposition(anchor) {
  if (!anchor) return;
  _repositionFromRect(anchor.getBoundingClientRect());
}

function _repositionFromRect(r) {
  const vw = window.innerWidth;
  const W = 220;
  let left = r.left + r.width / 2 - W / 2;
  left = Math.max(8, Math.min(left, vw - W - 8));
  _el.style.left = left + 'px';
  _el.style.width = W + 'px';
  // offsetHeight triggers a synchronous reflow, giving the real height without needing rAF
  const h = _el.offsetHeight || 160;
  const top = r.top - h - 8 > 0 ? r.top - h - 8 : r.bottom + 8;
  _el.style.top = top + 'px';
}

// Builds tooltip HTML from a card data object
export function cardHtml(card, powerDb = null, attributeDb = null, cardDb = null) {
  const summonLabels = { normal: 'Normal', sacrifice: 'Sacrifice', fusion: 'Fusion', heritage: 'Heritage', transformation: 'Transformation' };
  const attributeNames = (card.attributes || []).map(id => attributeDb?.getAttribute(id)?.name ?? id);
  const power = card.power?.id && powerDb ? powerDb.getPower(card.power.id) : null;

  const costLinesFor = (cost) => {
    const lines = [];
    if (cost?.sacrifice) lines.push(`Sacrifice : ${cost.sacrifice}`);
    if (cost?.materials?.length) {
      const matNames = cost.materials.map(id => {
        if (id.startsWith('ARCH_')) return attributeDb?.getAttribute(id)?.name ?? id;
        return cardDb?.getCard(id)?.name ?? id;
      });
      lines.push(`Matériaux : ${matNames.join(', ')}`);
    }
    return lines;
  };

  const hasOptions = Array.isArray(card.summon_options) && card.summon_options.length > 0;
  const costLines = hasOptions ? [] : costLinesFor(card.cost);

  const optionsHtml = hasOptions ? `
    <div class="tip-summon-options">
      ${card.summon_options.map(opt => {
        const lines = costLinesFor(opt.cost);
        return `<div class="tip-summon-option">
          <span class="tip-summon-option-type">${esc(summonLabels[opt.summon_type] || opt.summon_type)}</span>
          ${lines.length ? `<span class="tip-summon-option-cost">${lines.map(esc).join(' · ')}</span>` : ''}
        </div>`;
      }).join('')}
    </div>
  ` : '';

  return `
    <div class="tip-header">
      <span class="tip-name">${esc(card.name)}</span>
      <span class="badge badge-tier${card.tier}">T${card.tier}</span>
    </div>
    <div class="tip-type">${hasOptions ? 'Invocation multiple' : esc(summonLabels[card.summon_type] || card.summon_type)}</div>
    <div class="tip-stats">
      <span title="ATK">⚔ ${card.stats.atk}</span>
      <span title="HP">♥ ${card.stats.hp}</span>
      <span title="ATK speed">⚡ ${card.stats.attack_speed}</span>
      <span title="Range">↔ ${card.stats.range}</span>
      <span title="SPD">🏃 ${card.stats.movement_speed}</span>
    </div>
    ${attributeNames.length ? `<div class="tip-attributes">${attributeNames.map(n => `<span class="badge">${esc(n)}</span>`).join('')}</div>` : ''}
    ${power ? `<div class="tip-power">✨ ${esc(power.name || card.power.id)}</div>` : ''}
    ${costLines.length ? `<div class="tip-cost">${costLines.map(l => `<span>${esc(l)}</span>`).join('')}</div>` : ''}
    ${optionsHtml}
  `;
}

// Builds tooltip HTML from a live Unit object
export function unitHtml(unit, powerDb = null, attributeDb = null, cardDb = null) {
  const attributeNames = (unit.attributes || []).map(id => attributeDb?.getAttribute(id)?.name ?? id);
  const powerName = unit.power_id
    ? (powerDb?.getPower(unit.power_id)?.name ?? unit.power_id)
    : null;
  return `
    <div class="tip-header">
      <span class="tip-name">${esc(unit.name)}</span>
      <span class="badge badge-tier${unit.tier}">T${unit.tier}</span>
    </div>
    <div class="tip-stats">
      <span>⚔ ${unit.atk}</span>
      <span>♥ ${unit.current_hp}/${unit.max_hp}</span>
      <span>⚡ ${unit.attack_speed}</span>
      <span>↔ ${unit.range}</span>
      <span title="Vitesse de déplacement">🏃 ${unit.movement_speed}</span>
      <span title="Initiative">🎯 ${unit.initiative}</span>
    </div>
    ${attributeNames.length ? `<div class="tip-attributes">${attributeNames.map(n => `<span class="badge">${esc(n)}</span>`).join('')}</div>` : ''}
    ${unit.shield > 0 ? `<div class="tip-power">🛡 Shield : ${unit.shield}</div>` : ''}
    ${powerName ? `<div class="tip-power">✨ ${esc(powerName)} ${unit.power_gauge}/${unit.power_speed}</div>` : ''}
    ${_lineageHtml(unit, cardDb)}
    ${_shoppingBonusHtml(unit)}
  `;
}

// represented_ids tracks the lineage of fusion/heritage/transformation materials this
// unit also counts as. Shown only when it goes beyond the unit's own card.
function _lineageHtml(unit, cardDb) {
  const ids = (unit.represented_ids || []).filter(id => id !== unit.card_id);
  if (!ids.length) return '';
  const names = ids.map(id => cardDb?.getCard(id)?.name ?? id);
  return `<div class="tip-power" title="Compte aussi comme ces cartes pour les invocations fusion/heritage">🧬 ${names.map(esc).join(', ')}</div>`;
}

// Shopping Phase magies grant permanent stat bonuses that carry over through fusion/heritage/
// transformation chains (see _shopping_bonus tracking in MagieEffect.js / InvocationManager.js).
function _shoppingBonusHtml(unit) {
  const bonus = unit._shopping_bonus;
  if (!bonus) return '';
  const parts = Object.entries(bonus)
    .filter(([, value]) => value)
    .map(([stat, value]) => `${value > 0 ? '+' : ''}${value} ${STAT_NAMES[stat] || stat}`);
  if (!parts.length) return '';
  return `<div class="tip-power">🎁 Bonus Shopping : ${parts.map(esc).join(', ')}</div>`;
}

// Builds tooltip HTML for an attribute synergy chip
export function attributeHtml(attr, count, activeThreshold, cardDb = null) {
  const medalColors = { bronze: '#cd7f32', silver: '#b0b8c8', gold: '#f0c040', platinum: '#e5e4e2' };
  const medalNames  = { bronze: 'Bronze',  silver: 'Argent',  gold: 'Or',      platinum: 'Platine' };
  const rows = (attr.thresholds ?? []).map(t => {
    const isActive = activeThreshold && t.count <= activeThreshold.count;
    const color = isActive ? (medalColors[t.medal] ?? 'var(--accent)') : 'var(--muted)';
    const desc  = _describeEffects(t.effects, cardDb);
    return `<div style="color:${color};font-size:11px;padding:2px 0">${isActive ? '●' : '○'} ${t.count} (${esc(medalNames[t.medal] ?? t.medal)}) — ${esc(desc)}</div>`;
  }).join('');
  return `
    <div class="tip-header">
      <span style="font-size:18px;line-height:1">${attr.icon ?? ''}</span>
      <span class="tip-name">${esc(attr.name)}</span>
      <span style="font-size:11px;color:var(--muted)">${count} présent${count > 1 ? 's' : ''}</span>
    </div>
    <div style="margin-top:6px">${rows || '<span style="color:var(--muted);font-size:11px">Aucun palier</span>'}</div>
  `;
}

// Builds tooltip HTML for a board (terrain)
export function boardHtml(board, attributeDb = null) {
  const e = board.effect;
  const STAT_LBL = { atk: 'ATK', hp: 'HP', movement_speed: 'Déplacement', attack_speed: "Vit. attaque", initiative: 'Initiative', range: 'Portée' };
  const TYPE_LBL = { stat_bonus: 'Bonus de stat', stat_modifier: 'Modificateur', shield: 'Bouclier', draw_bonus: 'Pioche +' };

  let effectHtml = `<div style="color:var(--muted);font-size:11px">Aucun effet</div>`;
  if (e) {
    const typeLbl = TYPE_LBL[e.type] || e.type;
    const valStr  = e.type === 'stat_modifier' ? `×${e.value}` : (e.value >= 0 ? `+${e.value}` : `${e.value}`);
    const statLine = e.stat
      ? `<span style="color:var(--accent)">${STAT_LBL[e.stat] || e.stat}</span> ${valStr}`
      : valStr;
    let tgtLine;
    if (!e.target_attributes?.length) {
      tgtLine = 'Toutes les unités (les 2 joueurs)';
    } else if (attributeDb) {
      tgtLine = e.target_attributes
        .map(id => { const a = attributeDb.getAttribute(id); return a ? `${a.icon ?? ''} ${a.name}` : id; })
        .join(', ');
    } else {
      tgtLine = `${e.target_attributes.length} attribut${e.target_attributes.length > 1 ? 's' : ''} ciblé${e.target_attributes.length > 1 ? 's' : ''}`;
    }
    effectHtml = `
      <div style="font-size:11px;font-weight:600">${esc(typeLbl)}</div>
      <div style="font-size:13px;margin-top:2px">${statLine}</div>
      <div style="font-size:10px;color:var(--muted);margin-top:3px">${esc(tgtLine)}</div>`;
  }

  const thumb = board._has_illustration
    ? `<img src="/illustrations/${board.id}" style="width:100%;border-radius:4px;margin-bottom:8px;max-height:90px;object-fit:cover;display:block">`
    : '';

  return `
    <div style="display:flex;flex-direction:column;gap:2px;max-width:200px">
      ${thumb}
      <div style="font-weight:700;font-size:13px;margin-bottom:6px">🗺️ ${esc(board.name)}</div>
      <div style="background:rgba(255,255,255,.05);border-radius:6px;padding:8px">${effectHtml}</div>
    </div>`;
}

function _describeEffects(effects, cardDb) {
  return (effects ?? []).map(e => {
    switch (e.type) {
      case 'stat_bonus':       return `+${e.value} ${_statLabel(e.stat)} à toutes les unités`;
      case 'stat_modifier':    return `+${e.value} ${_statLabel(e.stat)} par neutralisation`;
      case 'draw_bonus':       return `+${e.value} carte${e.value > 1 ? 's' : ''} par tour`;
      case 'guaranteed_draw':  return `Pioche garantie${e.category ? ` : 1 carte ${e.category}` : ''}`;
      case 'revive':           return `Réanime une unité (${Math.round((e.hp_ratio ?? .5) * 100)}% PV)`;
      case 'shield':           return `Bouclier +${e.value} PV`;
      case 'board_slot_bonus': return `+${e.value} emplacement${e.value > 1 ? 's' : ''}`;
      default:                 return e.type;
    }
  }).join(', ');
}

function _statLabel(stat) {
  return ({ atk: 'ATK', hp: 'HP', attack_speed: "vitesse d'attaque", movement_speed: 'vitesse' })[stat] ?? stat;
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
