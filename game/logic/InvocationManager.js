import { Unit } from './Unit.js';

/**
 * Validates and executes summons for all 5 types.
 *
 * hand: Card[] (mutable — cards are spliced out on summon)
 * board: Board
 */

// Transformation is always 1-for-1 (replaces its target in place), so it never counts against the slot limit.
// A free_transformation (no target consumed) takes a brand new cell, so it must count like a normal summon.
export function exceedsBoardSlots(card, selectedMaterials, board, graveyard, playerBoardSlots) {
  if (card.summon_type === 'transformation' && !card._free_transformation) return false;
  const materialsOnBoard = selectedMaterials.filter(u => !graveyard.includes(u)).length;
  const afterPlace = board.getLivingUnitsOnSide('player').length - materialsOnBoard + 1;
  return afterPlace > playerBoardSlots;
}

export function canSummon(card, pos, board, hand, graveyard = []) {
  if (!board.isInBounds(pos)) return fail('Position hors limites');
  if (!board.isPlayerCell(pos)) return fail('Placement uniquement sur le côté joueur (rangées 0–3)');
  // La transformation place la carte sur la case de la cible (déjà occupée)
  if (card.summon_type !== 'transformation' && board.isOccupied(pos)) return fail('Case occupée');

  switch (card.summon_type) {
    case 'normal':
      return ok();

    case 'sacrifice': {
      const needed = card.cost?.sacrifice ?? 0;
      if (needed === 0) return ok();
      const total = _sumMaterialValue(board.getLivingUnitsOnSide('player')) + _sumMaterialValue(graveyard);
      if (total < needed) return fail(`Requiert ${needed} unité(s) sur le terrain ou au cimetière`);
      return ok();
    }

    case 'fusion': {
      const materials = card.cost?.materials ?? [];
      if (materials.length === 0) return ok();
      const playerUnits = board.getUnitsOnSide('player');
      for (const matId of materials) {
        const onBoard = playerUnits.find(u => _matchesMaterial(u, matId) && u.isAlive());
        const inGrave = graveyard.find(u => _matchesMaterial(u, matId));
        if (!onBoard && !inGrave)
          return fail(`Matériau manquant sur le terrain ou au cimetière : ${matId}`);
      }
      return ok();
    }

    case 'heritage': {
      const required = card.cost?.materials ?? [];
      const sacrifice = card.cost?.sacrifice ?? 0;
      const allUnits = [...board.getUnitsOnSide('player'), ...graveyard];
      // sacrifice = total material slots to consume; materials = constraints among those units
      if (_sumMaterialValue(allUnits) < sacrifice)
        return fail(`Requiert ${sacrifice} unité(s) sur le terrain ou au cimetière`);
      // Check each material requirement can be matched by some available unit
      const pool = [...allUnits];
      for (const matId of required) {
        const idx = pool.findIndex(u => _matchesMaterial(u, matId));
        if (idx === -1) return fail(`Matériau Heritage manquant : ${matId}`);
        pool.splice(idx, 1);
      }
      return ok();
    }

    case 'transformation': {
      if (card._free_transformation) {
        if (board.isOccupied(pos)) return fail('Case occupée');
        return ok();
      }
      const targetId = card.cost?.materials?.[0];
      if (!targetId) return fail('Pas de cible de transformation définie');
      const onBoard = board.getUnitsOnSide('player').find(u => _matchesMaterial(u, targetId) && u.isAlive());
      const inGrave = graveyard.find(u => _matchesMaterial(u, targetId));
      if (!onBoard && !inGrave) return fail(`Requiert ${targetId} sur le terrain ou au cimetière`);
      return ok();
    }

    default:
      return fail(`Type d'invocation inconnu : ${card.summon_type}`);
  }
}

/**
 * Execute the summon. Assumes canSummon() returned ok.
 * @param {Object} card  - card data object
 * @param {{col,row}} pos - target cell on player board
 * @param {Board} board
 * @param {Card[]} hand  - mutable hand array
 * @param {Card[][]} sacrificeTargets - for sacrifice/heritage: which board units to remove
 *        (if null, removes the first N living player units)
 * @returns {Unit}
 */
export function summon(card, pos, board, hand, sacrificeTargets = null, handIdx = null) {
  const unit = new Unit(card, 'player');

  switch (card.summon_type) {
    case 'normal':
      _removeFromHand(hand, card.id, handIdx);
      break;

    case 'sacrifice': {
      _removeFromHand(hand, card.id, handIdx);
      const needed = card.cost?.sacrifice ?? 0;
      const toRemove = sacrificeTargets
        ? _takeByMaterialValue(sacrificeTargets, needed)
        : _takeByMaterialValue(board.getLivingUnitsOnSide('player'), needed);
      for (const u of toRemove) board.removeUnit(u);
      unit.material_value = card._original_sacrifice ?? needed;
      _transferShoppingBonuses(unit, toRemove);
      break;
    }

    case 'fusion': {
      _removeFromHand(hand, card.id, handIdx);
      const consumed = [];
      if (sacrificeTargets && sacrificeTargets.length > 0) {
        for (const u of sacrificeTargets) { board.removeUnit(u); consumed.push(u); }
      } else {
        // AI fallback: auto-select matching units
        const fusionUnits = board.getUnitsOnSide('player');
        for (const matId of (card.cost?.materials ?? [])) {
          const mat = fusionUnits.find(u => _matchesMaterial(u, matId) && u.isAlive());
          if (mat) { board.removeUnit(mat); consumed.push(mat); }
        }
      }
      unit.material_value = (card.cost?.materials ?? []).length || 1;
      unit.represented_ids = [...new Set([card.id, ...consumed.flatMap(u => u.represented_ids)])];
      _transferShoppingBonuses(unit, consumed);
      break;
    }

    case 'heritage': {
      _removeFromHand(hand, card.id, handIdx);
      let consumed;
      if (sacrificeTargets && sacrificeTargets.length > 0) {
        consumed = sacrificeTargets;
        for (const u of sacrificeTargets) board.removeUnit(u);
      } else {
        // AI fallback: pick required materials first, fill remaining slots with any unit
        const sacrifice = card.cost?.sacrifice ?? 0;
        const pool = board.getLivingUnitsOnSide('player').slice();
        const toConsume = [];
        for (const matId of (card.cost?.materials ?? [])) {
          const idx = pool.findIndex(u => _matchesMaterial(u, matId));
          if (idx !== -1) { toConsume.push(pool[idx]); pool.splice(idx, 1); }
        }
        let remaining = sacrifice - toConsume.reduce((s, u) => s + (u.material_value ?? 1), 0);
        for (const u of pool) {
          if (remaining <= 0) break;
          toConsume.push(u);
          remaining -= (u.material_value ?? 1);
        }
        for (const u of toConsume) board.removeUnit(u);
        consumed = toConsume;
      }
      unit.material_value = card.cost?.sacrifice || 1;
      unit.represented_ids = [...new Set([card.id, ...consumed.flatMap(u => u.represented_ids)])];
      _transferShoppingBonuses(unit, consumed);
      break;
    }

    case 'transformation': {
      _removeFromHand(hand, card.id, handIdx);
      if (!card._free_transformation) {
        const targetId = card.cost?.materials?.[0];
        // Prefer the explicitly-passed unit (fixes same-name ambiguity)
        const targetUnit = sacrificeTargets?.find(u => _matchesMaterial(u, targetId) && u.isAlive())
          ?? board.getUnitsOnSide('player').find(u => _matchesMaterial(u, targetId) && u.isAlive());
        if (targetUnit) {
          pos = { ...targetUnit.position };
          unit.represented_ids = [...new Set([card.id, ...targetUnit.represented_ids])];
          board.removeUnit(targetUnit);
          _transferShoppingBonuses(unit, [targetUnit]);
        }
      }
      break;
    }
  }

  board.placeUnit(unit, pos);
  return unit;
}

// Carries permanent Shopping Phase stat bonuses (stat_bonus/stat_modifier magies) from
// consumed/replaced units onto the resulting composite unit, summing positive contributions only.
function _transferShoppingBonuses(unit, consumedUnits) {
  const summed = {};
  for (const u of consumedUnits) {
    const bonus = u._shopping_bonus;
    if (!bonus) continue;
    for (const [stat, value] of Object.entries(bonus)) {
      if (value > 0) summed[stat] = (summed[stat] || 0) + value;
    }
  }
  const entries = Object.entries(summed);
  if (entries.length === 0) return;
  unit._shopping_bonus = unit._shopping_bonus || {};
  for (const [stat, value] of entries) {
    unit._base[stat] = (unit._base[stat] ?? 0) + value;
    unit._shopping_bonus[stat] = (unit._shopping_bonus[stat] || 0) + value;
  }
  unit._recomputeStats();
}

function _removeFromHand(hand, cardId, atIdx = null) {
  const idx = (atIdx !== null && hand[atIdx]?.id === cardId)
    ? atIdx
    : hand.findIndex(c => c.id === cardId);
  if (idx !== -1) hand.splice(idx, 1);
}

function ok()         { return { ok: true,  reason: '' }; }
function fail(reason) { return { ok: false, reason }; }

// A material requirement matches either a specific card ID or an attribute ID.
// Transformation results count as the original monster (represented_ids).
export function matchesMaterial(unit, matId) {
  if (matId.startsWith('ARCH_')) return unit.attributes?.includes(matId) ?? false;
  return unit.represented_ids?.includes(matId) ?? unit.card_id === matId;
}
const _matchesMaterial = matchesMaterial;

// Total material "slots" represented by a list of units.
export function sumMaterialValue(units) {
  return units.reduce((sum, u) => sum + (u.material_value ?? 1), 0);
}
const _sumMaterialValue = sumMaterialValue;

// Take units one by one until their combined material_value reaches `needed`.
function _takeByMaterialValue(units, needed) {
  const taken = [];
  let total = 0;
  for (const u of units) {
    if (total >= needed) break;
    taken.push(u);
    total += (u.material_value ?? 1);
  }
  return taken;
}
