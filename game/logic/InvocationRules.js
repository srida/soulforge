import { matchesMaterial, materialLineageLegit, materialLineageMatches, sumMaterialValue, canSummon, exceedsBoardSlots, resolveTransformationTarget } from './InvocationManager.js';

export function needsMaterials(card, board = null, graveyard = []) {
  if (card.summon_type === 'sacrifice') return (card.cost?.sacrifice ?? 0) > 0;
  if (card.summon_type === 'fusion')   return (card.cost?.materials?.length ?? 0) > 0;
  if (card.summon_type === 'heritage')   return (card.cost?.materials?.length ?? 0) > 0 || (card.cost?.sacrifice ?? 0) > 0;
  if (card.summon_type === 'transformation') {
    if (card._free_transformation) return false;
    // Only needs explicit material selection when the target isn't alive on the board
    const targetId = card.cost?.materials?.[0];
    if (!targetId || !board) return false;
    return !board.getLivingUnitsOnSide('player').find(u => materialLineageMatches(u, targetId, [targetId]));
  }
  return false;
}

export function materialsComplete(card, mats) {
  if (card.summon_type === 'sacrifice') {
    return sumMaterialValue(mats) >= (card.cost?.sacrifice ?? 0);
  }
  if (card.summon_type === 'fusion') {
    const required = card.cost?.materials ?? [];
    if (!mats.every(u => materialLineageLegit(u, required))) return false;
    const coveredIds = mats.flatMap(u => u.represented_ids ?? [u.card_id]);
    return required.every(id => coveredIds.includes(id));
  }
  if (card.summon_type === 'heritage') {
    const required = card.cost?.materials ?? [];
    const sacrifice = card.cost?.sacrifice ?? 0;
    // Need exactly `sacrifice` material slots total, all material constraints satisfied among them
    return sumMaterialValue(mats) >= sacrifice && getUncoveredRequirements(required, mats).length === 0;
  }
  if (card.summon_type === 'transformation') {
    const targetId = card.cost?.materials?.[0];
    if (!targetId) return true;
    return mats.some(u => materialLineageMatches(u, targetId, [targetId]));
  }
  return true;
}

// Returns the position of the on-board unit a transformation will replace (tap-to-transform target).
export function transformTargetCells(card, board) {
  if (card.summon_type !== 'transformation' || card._free_transformation) return [];
  const targetId = card.cost?.materials?.[0];
  if (!targetId) return [];
  const target = resolveTransformationTarget(card, board);
  return target ? [{ ...target.position }] : [];
}

// Returns positions of units that can still be selected as material for the given card.
export function materialCandidateCells(card, alreadySelected, board) {
  if (!needsMaterials(card)) return [];
  const units = board.getLivingUnitsOnSide('player');
  const selected = new Set(alreadySelected);

  if (card.summon_type === 'sacrifice') {
    const needed = card.cost?.sacrifice ?? 0;
    if (sumMaterialValue(alreadySelected) >= needed) return [];
    return units.filter(u => !selected.has(u)).map(u => ({ ...u.position }));
  }

  if (card.summon_type === 'fusion') {
    const required = card.cost?.materials ?? [];
    const coveredIds = alreadySelected.flatMap(u => u.represented_ids ?? [u.card_id]);
    const stillNeeded = required.filter(id => !coveredIds.includes(id));
    if (stillNeeded.length === 0) return [];
    return units.filter(u => !selected.has(u) && materialLineageLegit(u, required) && stillNeeded.some(id => matchesMaterial(u, id))).map(u => ({ ...u.position }));
  }

  if (card.summon_type === 'heritage') {
    const required = card.cost?.materials ?? [];
    const sacrifice = card.cost?.sacrifice ?? 0;
    if (sumMaterialValue(alreadySelected) >= sacrifice) return [];
    const uncovered = getUncoveredRequirements(required, alreadySelected);
    const remainingSlots = sacrifice - sumMaterialValue(alreadySelected);
    // If remaining slots == uncovered requirements, only allow units matching those requirements
    if (uncovered.length > 0 && uncovered.length === remainingSlots) {
      return units
        .filter(u => !selected.has(u) && uncovered.some(matId => matchesMaterial(u, matId)))
        .map(u => ({ ...u.position }));
    }
    // Free slots available — any unit is acceptable
    return units.filter(u => !selected.has(u)).map(u => ({ ...u.position }));
  }

  return [];
}

// Returns graveyard units that are valid material candidates for the card
export function materialCandidateGraveyard(card, alreadySelected, graveyard, board) {
  if (!graveyard.length) return [];
  const selected = new Set(alreadySelected);
  const avail = graveyard.filter(u => !selected.has(u));

  if (card.summon_type === 'sacrifice') {
    const needed = card.cost?.sacrifice ?? 0;
    if (sumMaterialValue(alreadySelected) >= needed) return [];
    return avail;
  }

  if (card.summon_type === 'fusion') {
    const required = card.cost?.materials ?? [];
    const coveredIds = alreadySelected.flatMap(u => u.represented_ids ?? [u.card_id]);
    const stillNeeded = required.filter(id => !coveredIds.includes(id));
    if (stillNeeded.length === 0) return [];
    return avail.filter(u => materialLineageLegit(u, required) && stillNeeded.some(id => matchesMaterial(u, id)));
  }

  if (card.summon_type === 'heritage') {
    const required = card.cost?.materials ?? [];
    const sacrifice = card.cost?.sacrifice ?? 0;
    if (sumMaterialValue(alreadySelected) >= sacrifice) return [];
    const uncovered = getUncoveredRequirements(required, alreadySelected);
    const remainingSlots = sacrifice - sumMaterialValue(alreadySelected);
    if (uncovered.length > 0 && uncovered.length === remainingSlots)
      return avail.filter(u => uncovered.some(matId => matchesMaterial(u, matId)));
    return avail;
  }

  if (card.summon_type === 'transformation') {
    const targetId = card.cost?.materials?.[0];
    if (!targetId) return [];
    // Only when there's no board target does the graveyard one become usable
    if (board.getLivingUnitsOnSide('player').find(u => materialLineageMatches(u, targetId, [targetId]))) return [];
    return avail.filter(u => materialLineageMatches(u, targetId, [targetId]));
  }

  return [];
}

// Returns true if the card can potentially be played given the current board state.
// Used to grey out unplayable cards in hand. Intentionally lenient: doesn't check
// for empty cells when materials will be freed by the summon itself.
export function isPlayable(card, board, graveyard = [], maxSlots = Infinity) {
  if (card.summon_type === 'normal') {
    if (board.getLivingUnitsOnSide('player').length >= maxSlots) return false;
    if (board.getLivingUnitsOnSide('player').some(u => u.card_id === card.id)) return false; // doublon
    return hasEmptyPlayerCell(board);
  }
  if (card.summon_type === 'sacrifice') {
    const needed = card.cost?.sacrifice ?? 0;
    if (needed === 0) return hasEmptyPlayerCell(board);
    return sumMaterialValue(board.getLivingUnitsOnSide('player')) + sumMaterialValue(graveyard) >= needed;
  }
  if (card.summon_type === 'fusion') {
    const materials = card.cost?.materials ?? [];
    if (materials.length === 0) return hasEmptyPlayerCell(board);
    const units = board.getUnitsOnSide('player');
    return materials.every(id =>
      units.find(u => matchesMaterial(u, id) && u.isAlive() && materialLineageLegit(u, materials)) ||
      graveyard.find(u => matchesMaterial(u, id) && materialLineageLegit(u, materials))
    );
  }
  if (card.summon_type === 'heritage') {
    const required = card.cost?.materials ?? [];
    const sacrifice = card.cost?.sacrifice ?? 0;
    const allUnits = [...board.getUnitsOnSide('player'), ...graveyard];
    if (sumMaterialValue(allUnits) < sacrifice) return false;
    return getUncoveredRequirements(required, allUnits).length === 0;
  }
  if (card.summon_type === 'transformation') {
    if (card._free_transformation) return hasEmptyPlayerCell(board);
    const targetId = card.cost?.materials?.[0];
    if (!targetId) return false;
    return !!board.getUnitsOnSide('player').find(u => materialLineageMatches(u, targetId, [targetId]) && u.isAlive()) ||
           !!graveyard.find(u => materialLineageMatches(u, targetId, [targetId]));
  }
  return hasEmptyPlayerCell(board);
}

// Material helpers — a requirement can be a card ID (CORE_*) or an attribute ID (ARCH_*).
// Transformation results count as the original monster (represented_ids).
// Returns the subset of `required` not yet covered by `selectedUnits` (greedy, order-stable).
export function getUncoveredRequirements(required, selectedUnits) {
  const pool = [...selectedUnits];
  return required.filter(matId => {
    const idx = pool.findIndex(u => matchesMaterial(u, matId));
    if (idx !== -1) { pool.splice(idx, 1); return false; }
    return true;
  });
}

export function hasEmptyPlayerCell(board) {
  for (let r = 0; r <= 3; r++)
    for (let c = 0; c < 5; c++)
      if (!board.isOccupied({ col: c, row: r })) return true;
  return false;
}

// Returns the set of board cells where `card` can currently be placed, given the
// in-progress material selection. Mirrors canSummon()'s rules per summon type.
export function validCells(card, { board, hand, graveyard, selectedMaterials, playerBoardSlots }) {
  // Don't show placement cells until required materials are selected
  if (needsMaterials(card, board, graveyard) && !materialsComplete(card, selectedMaterials)) return [];

  if (exceedsBoardSlots(card, selectedMaterials, board, graveyard, playerBoardSlots)) return [];

  // For transformation with free flag → any empty player cell
  if (card.summon_type === 'transformation' && card._free_transformation) {
    const cells = [];
    for (let r = 0; r <= 3; r++)
      for (let c = 0; c < 5; c++)
        if (!board.isOccupied({ col: c, row: r })) cells.push({ col: c, row: r });
    return cells;
  }

  // For transformation:
  if (card.summon_type === 'transformation') {
    const targetId = card.cost?.materials?.[0];
    const boardTarget = resolveTransformationTarget(card, board);
    if (boardTarget) return [{ ...boardTarget.position }];
    // Graveyard target selected → show all empty player cells
    const graveTarget = selectedMaterials.find(u => materialLineageMatches(u, targetId, [targetId]) && graveyard.includes(u));
    if (graveTarget) {
      const cells = [];
      for (let r = 0; r <= 3; r++)
        for (let c = 0; c < 5; c++)
          if (!board.isOccupied({ col: c, row: r })) cells.push({ col: c, row: r });
      return cells;
    }
    return [];
  }

  // Only board materials free cells (graveyard units have no board position)
  const willBeFreed = new Set(
    selectedMaterials
      .filter(u => !graveyard.includes(u))
      .map(u => `${u.position.col},${u.position.row}`)
  );

  const cells = [];
  for (let r = 0; r <= 3; r++)
    for (let c = 0; c < 5; c++) {
      const pos = { col: c, row: r };
      if (willBeFreed.has(`${c},${r}`)) {
        cells.push(pos);  // freed by material consumption
      } else if (canSummon(card, pos, board, hand, graveyard, selectedMaterials).ok) {
        cells.push(pos);
      }
    }
  return cells;
}
