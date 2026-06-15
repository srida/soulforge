# CLAUDE.md — Soulforge (Web)

## Project Overview

Port web d'un Auto-Battler inspiré de :

- Teamfight Tactics
- Auto Chess
- Marvel Snap

Migré depuis Godot 4.5.1. Gameplay-complete pour le premier vertical slice.

**Stack :** Vanilla JS ES modules, Express.js, Railway. Zéro bundler, zéro framework.

La philosophie du projet :

- Data-driven gameplay
- Mobile-first UX
- Simple mais tactiquement profond
- Séparation stricte logique / visuel

---

## Current State

Terminé :

- Phases 1–6 complètes (Foundation → Combat visuel)
- Boucle de jeu complète sur 5 tours
- Tous les systèmes d'invocation
- Système de pouvoirs
- Attributs
- Pathfinding + ligne de vue (Bresenham)
- IA ennemie
- DeckBuilder + DeckSelector + MainMenu
- Board UI + Préparation
- Combat animé (requestAnimationFrame)
- Support mobile (Pointer Events)
- **Système de terrains (boards)** — cases bloquées, LOS, effets de terrain
- **Système de magies + Phase Shopping** — choix d'une magie parmi 3 après chaque combat (sauf dernier tour)
- **Phase 7 — Polish mobile** : safe areas iOS (`env(safe-area-inset-*)`), PWA (`manifest.json`, bouton plein écran), avertissement orientation paysage, audit des touch targets (44px min)

---

## Déploiement

```
npm start          # port 3742 local
```

Railway auto-deploy sur push `master`.
Repo : `https://github.com/srida/my-auto-battler`

---

## Routes Express

| Route | Accès | Description |
|---|---|---|
| `GET /` | Public | Jeu (SPA) |
| `GET /admin` | Auth basique | Card Manager |
| `GET /api/cards` | Public | 253 cartes |
| `GET /api/attributes` | Public | Attributs |
| `GET /api/powers` | Public | Pouvoirs |
| `GET /api/boards` | Public | Terrains de combat |
| `GET /api/magies` | Public | Magies (Phase Shopping) |
| `POST/PUT/DELETE /api/*` | Auth | Écriture admin |
| `GET /illustrations/:id` | Public | Art des cartes (PNG sans extension) |
| `POST /api/cards/import` | Auth | Import en masse (mode skip/replace) |
| `POST /api/cards/:id/illustration` | Auth | Upload illustration (URL ou base64) |
| `POST /api/attributes/import` | Auth | Import attributs en masse |
| `POST /api/powers/import` | Auth | Import pouvoirs en masse |
| `GET /api/export` | Auth | Export complet avec checksums illustrations |

---

## Architecture

Principe fondamental : **logique ≠ visuel**. Les classes `logic/` ne touchent jamais le DOM.

```
game/
├── main.js                  ← Router SPA, bootstrap, swap d'écrans
├── game.css                 ← Variables CSS, design system
├── data/
│   ├── CardDatabase.js      ← fetch /api/cards, cache mémoire
│   ├── AttributeDatabase.js ← fetch /api/attributes
│   ├── PowerDatabase.js     ← fetch /api/powers
│   ├── BoardDatabase.js     ← fetch /api/boards, cache mémoire
│   ├── MagieDatabase.js     ← fetch /api/magies, cache mémoire
│   └── DeckRepository.js   ← localStorage (same interface as Godot)
├── logic/
│   ├── Unit.js              ← État runtime d'une unité
│   ├── Board.js             ← Source de vérité des positions (grille 5×11)
│   ├── GameState.js         ← Phases, tours, HP, multiplicateurs
│   ├── CombatManager.js     ← Boucle de combat, step() → events[]
│   ├── InvocationManager.js ← Validation + exécution des 5 types de summon
│   ├── AttributeManager.js  ← Comptage attributs + application des bonus
│   ├── MagieEffect.js       ← Effets des magies (Phase Shopping)
│   ├── PathFinder.js        ← BFS sur la grille
│   └── EnemyAI.js           ← Placement IA, calcul multiplicateur
└── ui/
    ├── screens/
    │   ├── MainMenu.js
    │   ├── DeckSelector.js
    │   ├── DeckBuilder.js
    │   ├── GameScreen.js
    │   └── TestBench.js      ← Mode développeur
    └── components/
        ├── BoardGrid.js      ← CSS Grid 5×11, gestion des cases
        ├── UnitCard.js       ← Affichage unité, HP bar, power gauge
        ├── HandUI.js         ← Main du joueur, scroll horizontal
        ├── Tooltip.js        ← Instance unique globale, tap-to-show
        └── CombatAnimator.js ← requestAnimationFrame, consomme CombatManager.step()
```

---

## Data Layer

Chaque database expose `init()` async. Les données sont cachées en mémoire après le premier fetch.

```js
await CardDatabase.init()       // charge /api/cards
CardDatabase.getCard(id)
CardDatabase.getCardsByTier(tier)
CardDatabase.getAllCards()
CardDatabase.buildDeckFromIds(ids)

await AttributeDatabase.init()
AttributeDatabase.getAttribute(id)
AttributeDatabase.getAttributes()    // Dictionary

await PowerDatabase.init()
PowerDatabase.getPower(id)

await BoardDatabase.init()
BoardDatabase.getBoard(id)
BoardDatabase.getAllBoards()
BoardDatabase.getRandomBoard()   // utilisé par GameScreen à chaque round de combat

await MagieDatabase.init()
MagieDatabase.getAllMagies()
MagieDatabase.getRandomMagies(count = 3)   // utilisé par la Phase Shopping

DeckRepository.saveDeck(name, deck)
DeckRepository.loadDeck(name)
DeckRepository.deleteDeck(name)
DeckRepository.renameDeck(oldName, newName)
DeckRepository.deckExists(name)
DeckRepository.getActiveDeck()
DeckRepository.setActiveDeck(name)
DeckRepository.hasDeck(name)
DeckRepository.listDecks()
DeckRepository.setPendingEdit(name)      // stocke en sessionStorage
DeckRepository.consumePendingEdit()      // lit ET efface le pendingEdit
```

**DeckRepository** persiste en `localStorage`. Structure d'un deck :
```json
{ "1": ["CORE_001", ...], "2": [...], "3": [...], "4": [...], "5": [...] }
```

---

## CombatManager — Pattern headless

`CombatManager` ne contient aucune manipulation DOM.

`step()` retourne un tableau d'événements :

```js
{ type: 'move',        unit, from, to }
{ type: 'attack',      attacker, target, damage }
{ type: 'power',       unit, targets, power_id, extra: {...} }
{ type: 'dot',         unit, damage }               // pulse de poison
{ type: 'stat_change', unit, stat, value }          // effet attribut during_combat
{ type: 'death',       unit }
{ type: 'combat_end',  winner }
```

`CombatAnimator` consomme ces événements via `requestAnimationFrame` et applique les animations CSS.

Le timing est géré par `CombatAnimator`, jamais par `CombatManager`. Pas de `setTimeout` dans la logique.

**Timing :** `BASE_TICK_MS = 180` — intervalle de base entre les steps. Vitesse effective : `BASE_TICK_MS / speed` (speed = 1 | 2 | 4).

---

## Navigation SPA

`main.js` gère le swap d'écrans via un routeur minimaliste :

```
MainMenu → DeckSelector → DeckBuilder → GameScreen
MainMenu → TestBench (dev)
```

Les écrans sont des classes JS qui exposent `mount(container)` et `unmount()`.

Communication inter-écrans via `DeckRepository.setPendingEdit(name)` pour le mode édition du DeckBuilder.

---

## Core Game Loop

Chaque partie dure 5 tours.

Pour chaque tour :

1. Préparation (30 secondes — placement des cartes)
2. Combat (auto-résolu, animé)
3. Fin de combat (dégâts aux HP, nettoyage)
4. Phase Shopping (sauf dernier tour) — choix d'une magie parmi 3
5. Tour suivant

Fin de partie :
- Tour 5 terminé
- OU un joueur atteint 0 HP

**HP des joueurs : 1000.**

À la fin de la phase de combat :
```js
damage = sum(unit.atk for unit of survivingEnemyUnits) × multiplier
```

---

## Draw System

Pioche de 5 cartes au début de chaque tour.

Le pool dépend du tour :

| Tour | Tiers disponibles |
|---|---|
| 1 | Tier 1 |
| 2 | Tier 1, 2 |
| 3 | Tier 1, 2, 3 |
| 4 | Tier 2, 3, 4 |
| 5+ | Tier 3, 4, 5 |

Les cartes non jouées sont défaussées à la fin de la phase de préparation.

**Pioches garanties** (issues des effets d'attribut `guaranteed_draw`) :
Ordre de priorité de résolution : Transformation > Heritage > Fusion > Pioche normale.

---

## Damage Multiplier

Le multiplicateur est calculé au lancement du combat, en fonction du nombre d'unités présentes sur le terrain de chaque côté :

| Unités sur le terrain | Multiplicateur |
|---|---|
| ≥ 5 | 1.0 |
| 4 | 1.2 |
| 3 | 1.5 |
| 2 | 2.0 |
| 0–1 | 3.0 |

Appliqué symétriquement (calculé indépendamment pour chaque côté). Tension risk/reward : un board peu rempli encaisse moins de dégâts entrants mais en infligera davantage en cas de victoire.

Implémenté dans `GameState.js` :
```js
gameState.startCombat(playerUnitCount, enemyUnitCount)  // calcule player_multiplier / enemy_multiplier
gameState.player_multiplier
gameState.enemy_multiplier
```

Calculé dans `GameScreen.js` (`runCombat()`, via `board.getLivingUnitsOnSide()`) et `EnemyAI.computeMultiplier()`.

---

## Phase Shopping

Après la phase de combat (et l'écran de résultat de fin de round), le joueur se voit proposer **3 magies aléatoires** avant de passer au tour suivant.

**Sautée** :
- Sur le dernier tour / fin de partie (`gameState.isGameOver()`)
- Si aucune magie n'est disponible (`MagieDatabase.getAllMagies()` vide)

Implémentée entièrement dans `GameScreen.js` (pas d'écran/composant séparé) :

```js
_showEndRound(winner)        // affiche le résultat du round, bouton "Tour suivant" / "Résultat final"
_startShopping(winner)        // tire 3 magies via MagieDatabase.getRandomMagies(3)
_applyChosenMagie(magie, winner)
_showShoppingBanner(text)
_defuseFusion(fusionUnit)
```

### Flux

1. Overlay plein écran `.shopping-overlay` : titre "✨ Phase Shopping", sous-titre "Choisissez une magie", 3 cartes `.shopping-magie-card` (illustration ou icône ✨ par défaut, nom, description via `MagieEffect.effectLabel`).
2. Tap sur une carte → choix définitif (les 2 autres sont perdues).
3. Selon le type d'effet de la magie choisie :
   - **Cible une unité du board joueur** (`needsUnitTarget`) → highlight des unités valides + bandeau "Touchez une unité sur votre terrain", attente via `_shoppingUnitCallback`.
     - Cas `defuse_fusion` : ne cible que les unités Fusion vivantes ayant des matériaux (`card.summon_type === 'fusion' && cost.materials.length > 0`) → `_defuseFusion(unit)`.
   - **Cible le cimetière** (`needsGraveyardTarget`, effet `revive`) → ouverture de la zone cimetière, bandeau "Touchez une unité dans le cimetière", attente via `_shoppingGraveyardCallback`. L'unité réanimée revient à `initial_position` (ou première case vide côté joueur) et quitte le cimetière.
   - **Effet global** (`draw_bonus`, `player_hp_bonus`, `board_slot_bonus`, `guaranteed_draw`, `reduce_sacrifice_cost`, `free_transformation`, `remove_heritage_material`) → `applyMagieEffect(magie, { gameState })` appliqué immédiatement, sans ciblage.
4. Une fois résolu → `gameState.nextRound()` puis `startPreparation()`.

`_defuseFusion(fusionUnit)` retire l'unité Fusion du board, recrée chaque matériau de `card.cost.materials` comme nouvelle unité (placée sur une case vide côté joueur si un slot est disponible, sinon envoyée au cimetière, neutralisée).

---

## Magies

Système de cartes magiques tirées pendant la Phase Shopping. Chargées depuis `/api/magies`.

### Modèle de données

`initial-data/magies.json` :

```json
{
  "id": "MAGIC_001",
  "name": "Pot de Cupidité",
  "effect": {
    "type": "draw_bonus",
    "value": 2
  }
}
```

- `id` — identifiant unique (`MAGIC_NNN` dans les données initiales, `MAGIE_NNN` auto-généré par l'admin)
- `name`
- `effect` — `{ type, ...paramètres }` ou `null`
- `_has_illustration` (calculé côté serveur, non persisté)

### MagieDatabase

`game/data/MagieDatabase.js` — même pattern que `CardDatabase` / `PowerDatabase` / `BoardDatabase` :

```js
await MagieDatabase.init()              // fetch /api/magies, cache mémoire
MagieDatabase.getAllMagies()
MagieDatabase.getRandomMagies(count = 3) // tirage sans remise
```

### Types d'effets (`game/logic/MagieEffect.js`)

`effectLabel(magie)` génère la description affichée, `applyEffect(magie, { gameState, targetUnit })` applique l'effet.

| `type` | Champs | Effet |
|---|---|---|
| `stat_bonus` | `stat`, `value` | Bonus additif **permanent** sur `targetUnit._base[stat]` (min 1) + `_recomputeStats()`. Si `stat === 'hp'`, augmente aussi `current_hp`. |
| `stat_modifier` | `stat`, `value` | Multiplicateur **permanent** : `_base[stat] += round(_base[stat] * (value - 1))` + `_recomputeStats()`. |
| `heal` | `value` | `targetUnit.heal(value)` |
| `shield` | `value` | `targetUnit.applyShield(value)` |
| `revive` | `value` (% PV max) | Unité du **cimetière** : `is_neutralized = false`, `current_hp = round(max_hp * value/100)`. |
| `player_hp_bonus` | `value` | `gameState.player_hp = min(player_hp + value, 1000)` |
| `board_slot_bonus` | `value` | `gameState.player_board_slots += (value \|\| 1)` — slots permanents |
| `draw_bonus` | `value` | `gameState.player_extra_draws += (value \|\| 1)` — pioches supplémentaires ce tour |
| `guaranteed_draw` | `tier` | `gameState.player_guaranteed_draws.push({ tier })` |
| `defuse_fusion` | — | No-op dans `applyEffect` ; géré par `GameScreen._defuseFusion()`. |
| `reduce_sacrifice_cost` | `value` (déf. 1) | `gameState.player_hand_modifiers.push({ type: 'reduce_sacrifice_cost', value })` — réduit le coût en sacrifices d'une carte Sacrifice en main |
| `free_transformation` | — | `gameState.player_hand_modifiers.push({ type: 'free_transformation' })` — invoque une Transformation sans son monstre cible |
| `remove_heritage_material` | — | `gameState.player_hand_modifiers.push({ type: 'remove_heritage_material' })` — retire le matériel Heritage obligatoire |

**Helpers de routage** :
- `needsUnitTarget(magie)` → `stat_bonus`, `stat_modifier`, `shield`, `heal`, `defuse_fusion` (cible une unité du board joueur)
- `needsGraveyardTarget(magie)` → `revive` uniquement (cible une unité du cimetière)
- Tous les autres types sont des effets globaux appliqués immédiatement.

Les `player_hand_modifiers` (`reduce_sacrifice_cost`, `free_transformation`, `remove_heritage_material`) sont consommés au tour suivant (différé).

### Admin panel

Onglet "Magies" dans `admin.html` : CRUD complet, sélecteur `effect.type` avec champs conditionnels (`stat`, `value`, `tier`), import JSON en masse, gestion d'illustration. ID auto-généré au format `MAGIE_<next>`.

### Routes API

| Route | Accès | Description |
|---|---|---|
| `GET /api/magies` | Public | Liste toutes les magies |
| `POST /api/magies` | Auth | Créer une magie |
| `POST /api/magies/import` | Auth | Import en masse (mode skip/replace) |
| `PUT /api/magies/:id` | Auth | Modifier une magie |
| `DELETE /api/magies/:id` | Auth | Supprimer une magie |
| `POST /api/magies/:id/illustration` | Auth | Upload illustration |
| `DELETE /api/magies/:id/illustration` | Auth | Supprimer illustration |

Incluses dans `GET /api/export` avec checksums illustrations.

---

## Board

Taille : 5 colonnes × 11 rangées

Joueur : rangées 0–3
Zone neutre : rangées 4–6 (inoccupables en préparation)
Ennemi : rangées 7–10

Maximum d'unités sur le board : **5** (6 avec certaines synergies d'attribut).

Pendant la préparation :
- Joueur voit uniquement son côté
- Ennemis masqués (classe CSS `.hidden`)

Pendant le combat :
- Board entier visible
- Les deux côtés affichés

**`Board.js` est la source de vérité.**

Ne jamais déduire une position depuis un élément DOM.

Toujours faire confiance à :
```js
unit.position
board.grid
```

**Structure interne :** `grid[col][row]` — stockage en ordre col-major.

```js
board.grid[2][0]  // unité en colonne 2, rangée 0 (milieu haut, côté joueur)
```

### Cases bloquées

`Board.js` maintient un Set interne `_blockedCells` de clés `"col,row"`.

```js
board.setBlockedCells(cells)   // cells: [{col, row}, ...]
board.clearBlockedCells()
board.isBlocked(pos)           // → bool
```

`getNeighbors(pos)` exclut automatiquement les cases bloquées — le BFS les contourne donc sans modification.

Les cases bloquées sont réinitialisées entre deux combats (`startPreparation()` dans GameScreen).

---

## Board Terrain (Terrains de combat)

Chaque combat tire aléatoirement un terrain depuis `BoardDatabase`. Le terrain est actif uniquement pendant la phase de combat.

### Modèle de données

```json
{
  "id": "BOARD_001",
  "name": "Désert Maudit",
  "_has_illustration": true,
  "blocked_cells": [{ "col": 2, "row": 5 }],
  "effect": {
    "type": "stat_bonus",
    "stat": "atk",
    "value": 10,
    "target_attributes": ["ARCH_DRAGON"]
  }
}
```

`effect` peut être `null` (aucun effet). `target_attributes` vide = toutes les unités des deux joueurs.

### Types d'effets supportés

| `type` | Description |
|---|---|
| `stat_bonus` | Bonus additif permanent sur une stat (`stat`, `value`) |
| `stat_modifier` | Multiplicateur de stat — converti en additif via `unit._base[stat] × (value - 1)` |
| `shield` | Bouclier initial (`value`) |
| `draw_bonus` | Pioche supplémentaire (`value` cartes) — GameScreen uniquement |

Les effets sont appliqués via `applyStatBonus()` / `applyShield()`, donc nettoyés automatiquement par `resetCombatStats()` en fin de combat.

### Ligne de vue (LOS)

`PathFinder.js` expose :

```js
hasLineOfSight(board, from, to) → bool   // Bresenham sur _blockedCells
canAttack(attacker, target, board)       // isInAttackRange() && hasLineOfSight()
findAttackTarget(unit, enemies, board)   // préfère les cibles avec LOS
```

**Règles LOS :**
- Si aucune case bloquée (`_blockedCells.size === 0`) → LOS toujours `true`
- Une case bloquée sur la ligne entre attaquant et cible → LOS `false`
- Une unité sans LOS sur sa cible **continue à se déplacer** vers elle (le check `canAttack` dans la boucle de mouvement force la progression)

### Flux dans GameScreen

```
runCombat()
  → BoardDatabase.getRandomBoard()
  → board.setBlockedCells(boardData.blocked_cells)
  → grid.setBlockedCells(boardData.blocked_cells)   // rendu CSS .blocked-cell
  → _showBoardIndicator(boardData)                   // chip thumbnail+nom
  → _applyBoardEffect(effect, playerUnits, enemyUnits)

startPreparation()
  → board.clearBlockedCells()
  → grid.setBlockedCells([])
  → _hideBoardIndicator()
```

### Indicateur de terrain (UI)

Pendant le combat, un chip compact s'affiche **à droite des chips d'attribut** sur la même rangée (`game-header-row`). Il montre la miniature d'illustration et le nom du terrain. Un tap ouvre le tooltip complet (effet + attributs ciblés par nom).

```js
// GameScreen.js
_showBoardIndicator(boardData)   // stocke dans _currentBoardData, affiche le chip
_hideBoardIndicator()

// Tooltip.js
Tooltip.boardHtml(board, attributeDb)  // attributeDb optionnel — résout les noms d'attribut
```

### TestBench

TestBench expose un sélecteur de terrain manuel (dropdown `🗺️`) dans la colonne board. Sélectionner un terrain :
1. Affiche les cases bloquées sur la grille immédiatement
2. Active un bouton ℹ pour voir le tooltip du terrain
3. Applique les effets au lancement du combat
4. Les effets sont annulés (`resetCombatStats`) à l'arrêt du combat

---

## Unit Model

Propriétés runtime :

```js
atk
max_hp
current_hp

shield

power_gauge

dot_effects       // []
paralysis_ticks
attack_speed_modifier

position          // { col, row }
initial_position

is_neutralized
```

Les unités persistent entre les tours.

Unités détruites : retirées définitivement.

Survivants : retournent à `initial_position` après le combat.

---

## Graveyard (Cimetière)

Les unités neutralisées entrent dans `graveyard[]` (joueur) ou `enemyGraveyard[]` (ennemi).

Rôle pendant la phase de préparation :
- Disponibles comme matériaux d'invocation (sacrifice, fusion, heritage, transformation)
- Une unité venant du cimetière **ne consomme pas de slot de board** lors d'une transformation (elle est déjà hors jeu)
- Supprimées définitivement au lancement du combat si non consommées

---

## End of Combat Rules

**Fin du combat → fin de la phase de préparation suivante :**

Unités neutralisées :
- Restent sur le board après le combat
- Restent disponibles toute la phase de préparation suivante
- Peuvent être utilisées comme matériaux d'invocation (sacrifice, fusion, heritage)
- Sont définitivement retirées au lancement du combat suivant si non consommées

Survivantes :
- Retournent à `initial_position`
- La grille est reconstruite

**À la fin du combat, les dégâts sont appliqués :**
```js
// winner = 'player' → l'ennemi prend des dégâts
enemy_hp -= round(sum(survivingPlayerUnits.atk) × player_multiplier)

// winner = 'enemy' → le joueur prend des dégâts
player_hp -= round(sum(survivingEnemyUnits.atk) × enemy_multiplier)

// draw → aucun dégât
```

`applyEndOfCombat(winner, playerSurvivorsAtk, enemySurvivorsAtk, attributeResult)`
— reçoit la somme d'ATK, pas un nombre d'unités.

Effets des pouvoirs : prennent fin à la fin du combat (sauf indication contraire).

Ne jamais modifier un tableau pendant son itération :

```js
for (const unit of [...units]) {
```

---

## Summoning System

### Normal

Placement direct.

---

### Tribute (Sacrifice)

```json
{ "summon_type": "sacrifice" }
```

Consomme des unités alliées.

---

### Fusion

Requiert des matériaux spécifiques.

Consomme les matériaux.

---

### Heritage

Requiert :
- Matériau Heritage
- Tributs supplémentaires

---

### Transformation

Requiert une unité spécifique déjà en jeu.

La remplace. Conserve la position du monstre d'origine.

---

**Chaînage :** une invocation peut être immédiatement suivie d'une autre (sacrifice, fusion, heritage, transformation) tant que les conditions sont remplies.

`InvocationManager` expose :
```js
canSummon(cardId, pos, board, hand) → { ok: bool, reason: string }
summon(cardId, pos, board, hand)    → Unit | null
```

### Représentation des unités composites

Chaque `Unit` porte deux propriétés utilisées par `_matchesMaterial` / `canSummon` :

- **`represented_ids`** (`string[]`, init. `[card.id]`) — IDs de cartes que l'unité « représente » pour le matching de matériaux fusion/heritage/transformation. Une **Transformation** hérite des `represented_ids` du monstre d'origine remplacé (`[card.id, ...targetUnit.represented_ids]`) : elle compte donc comme le monstre d'origine pour une fusion/heritage ultérieure qui le requiert.
- **`material_value`** (`number`, init. `1`) — nombre de « slots » de matériau que l'unité représente si elle est elle-même consommée par un sacrifice/heritage ultérieur. Fixé lors de `summon()` :
  - Fusion → `card.cost.materials.length` (ou 1)
  - Heritage → `card.cost.sacrifice` (ou 1)
  - Sacrifice → `card.cost.sacrifice`
  - Normal / Transformation → reste à `1`

Les coûts `sacrifice`/`heritage` (`canSummon`, `_isPlayable`, sélection de matériaux dans `GameScreen`) sont vérifiés via la **somme des `material_value`** des unités sélectionnées, pas via leur nombre.

---

## Attributs

Chargés depuis `/api/attributes`.

Un monstre peut posséder un ou plusieurs attributs. Un seul palier d'attribut est actif à la fois (le plus élevé atteint).

Effets supportés :

- `stat_bonus`
- `stat_modifier`
- `draw_bonus`
- `guaranteed_draw`
- `revive`
- `shield`
- `board_slot_bonus`

### Timings

Les effets se déclenchent à trois moments précis :

- `start_of_combat` — bonus initiaux (stats, boucliers, slots de board)
- `during_combat` — effets réactifs aux événements (ex: neutralisation)
- `end_of_combat` — effets différés (pioches garanties, réanimation)

### Réinitialisation

Tous les bonus d'attribut sont réinitialisés à la fin de chaque combat.

Les effets `start_of_combat` sont recalculés au prochain combat en fonction des unités présentes au lancement. Le bonus de slot (ex: Yeux Bleus +1) n'est actif que si les unités déclenchant le palier sont toujours en vie.

`AttributeManager.computeBonuses(units, attributeDb)` — appelé au début de chaque combat.

### Détails d'implémentation

- **Comptage des liens (thresholds)** : seules les unités **distinctes** (par `card_id`) sont comptées — deux exemplaires de la même carte ne comptent que pour 1 dans le décompte d'attribut (`_countAttribute`, et le décompte `end_of_combat`).
- `stat_bonus` avec champ `value_per` : la valeur est multipliée par le nombre d'unités **ennemies** portant cet attribut (bonus contextuel)
- `shield` : la valeur est multipliée par le nombre d'unités **alliées vivantes** au moment du déclenchement
- Les seuils `during_combat` sont **verrouillés au début du combat** — les morts en cours de combat ne désactivent pas les effets déjà actifs
- `reapplyBonuses(unit)` : ré-applique les bonus `start_of_combat` après un `POWER_DEBUFF` (qui réinitialise les stats de la cible)
- `getActiveSynergies(units)` → `[{attr, count, activeThreshold, nextThreshold}]` — utilisé par le panneau d'attributs de l'UI

---

## Powers

Chargés depuis `/api/powers`.

Une unité peut avoir : zéro ou un pouvoir.

La jauge se charge avec le temps. Quand elle est pleine :
- Le pouvoir s'active
- Remplace l'attaque normale
- La jauge se réinitialise

Pouvoirs implémentés :

`POWER_HEAL` — soigne l'allié avec le moins de HP

`POWER_SHIELD` — applique un bouclier

`POWER_SUPER_ATTACK` — dégâts lourds sur une cible

`POWER_AOE_ATTACK` — dégâts à tous les ennemis en vie

`POWER_POISON` — applique un effet DOT (`dot_effects`)

`POWER_PARALYSIS` — réduit la vitesse d'attaque temporairement (`attack_speed_modifier`, `paralysis_ticks`)

`POWER_PUSH` — pousse la cible de X cases (respecte les limites du board et les cases occupées)

`POWER_DEBUFF` — réinitialise tous les bonus de stats sur la cible (`resetCombatStats` + `recomputeStats`)

`POWER_BLOCK` — empêche l'utilisation du pouvoir

**Règles importantes :**
- Un pouvoir ne se déclenche jamais pendant la phase de préparation
- Les effets de pouvoir prennent fin à la fin du combat (sauf indication contraire dans la définition du pouvoir)

---

## Combat Rules

Chaque unité :

1. Cherche une cible
2. Se déplace si nécessaire
3. Attaque si à portée

### Ciblage

Priorité à la **ligne de front ennemie** : la rangée ennemie la plus avancée vers le joueur (rangée avec la valeur Y la plus basse côté joueur, la plus haute côté ennemi).

Parmi les candidats de cette rangée :
1. Priorité à l'unité la plus proche (distance de Manhattan)
2. En cas d'égalité de distance : priorité à l'unité avec le moins de HP

Aucun hasard. Le combat est entièrement déterministe.

### Ligne de vue (LOS)

Une unité ne peut attaquer que si elle a **ligne de vue** sur sa cible (algorithme de Bresenham sur les cases bloquées du terrain). `findAttackTarget` préfère les cibles avec LOS ; si aucune n'est accessible en LOS, l'unité continue à se déplacer vers la cible la plus proche jusqu'à obtenir LOS.

```js
canAttack(attacker, target, board) = isInAttackRange() && hasLineOfSight()
```

### Initiative et ordre de jeu

Au début de chaque step, les unités sont triées par :
1. `initiative` décroissante (haute initiative = agit en premier)
2. En cas d'égalité : `attack_speed` décroissante (vitesse d'attaque la plus haute = agit en premier)

### Portée des attaques

Toutes les unités utilisent la **distance de Manhattan** — `|dx| + |dy|` (4 directions cardinales uniquement, pas de diagonales).

```js
isInAttackRange(attacker, target) → manhattanDistance(pos, target.pos) <= attacker.range
```

---

## Movement

Pathfinding BFS implémenté dans `PathFinder.js`.

Les unités ne peuvent pas se chevaucher.

Exception : les unités neutralisées peuvent temporairement rester jusqu'au nettoyage.

Les **cases bloquées** (terrain) sont exclues par `Board.getNeighbors()` — le BFS les contourne automatiquement sans modification dans PathFinder.

L'occupancy du board doit toujours être mise à jour lors d'un déplacement :

```js
board.moveUnit(unit, to)  // met à jour grid + unit.position ensemble
```

---

## EnemyAI — Stratégie de placement

L'IA place les unités en deux passes :
1. Cartes normales en premier (libèrent les matériaux potentiels)
2. Cartes à invocation spéciale (peuvent consommer les unités posées)

Arrangement post-placement (`rearrangeUnits`) :
- Unités mêlée (range ≤ 1) → rangées 7–8 (front)
- Unités à distance (range > 1) → rangées 9–10 (back)
- Ordre de colonnes : `[2, 1, 3, 0, 4]` (centre vers bords)
- HP le plus élevé → rangée la plus avancée dans chaque groupe
- Maximum 3 unités par rangée, débordement vers la rangée suivante

---

## Combat UI Indicators

Pendant la phase de combat, chaque `UnitCard` affiche des indicateurs visuels :

**Jauges de cooldown circulaires** (au-dessus de la HP bar) :
- Rouge : cooldown d'attaque
- Vert : cooldown de mouvement
- Jaune : jauge de pouvoir
- Masquées si le cooldown est au maximum (pas encore entamé)

**HP bar** : masquée si HP = 100%

**Shield bar** : masquée si shield = 0

**Icônes de statut** (à côté de l'unité) :
- Empoisonnée
- Paralysée
- Pouvoir bloqué

**Panneau d'attributs** : s'affiche en haut du board dès que des monstres sont présents. Tap sur l'icône d'un attribut → tooltip avec le palier actif et l'effet.

**Indicateur de slots** : en phase de préparation, affiche les emplacements libres sur le terrain. Remplacé par le **multiplicateur de dégâts** au lancement du combat.

---

## Tooltip System

Mobile-first. Pas de dépendance au hover.

Comportement :

- Tap carte → afficher
- Tap unité → afficher
- Tap ailleurs → masquer

Instance globale unique (`Tooltip.js`).

Contenu : nom, stats, pouvoir, attributs, coût d'invocation.

---

## Drag & Drop

Repositionnement d'unités pendant la préparation.

Implémenté avec Pointer Events API :
- `pointerdown`, `pointermove`, `pointerup`
- Unifie click et touch

Validation `board.isOccupied(pos)` avant le drop.

---

## DeckBuilder

- Maximum par tier : `min(8, pool_size)` cartes
- Minimum pour sauvegarder : **20 cartes au total** (réparties librement entre les tiers, aucun minimum par tier)

Validation bloquante : le deck ne peut être sauvegardé que si le nom est renseigné et que le total ≥ 20.

Mode édition : déclenché via `DeckRepository.setPendingEdit(deckName)` avant de naviguer vers DeckBuilder.

---

## TestBench

Écran développeur accessible depuis `MainMenu` (bouton TestBench).

Différences avec `GameScreen` :
- Placement libre pour les deux équipes (pas de règles d'invocation, pas de main, pas de deck)
- Filtre par `summon_type` dans le browser de cartes
- Suppression d'une unité par clic droit (ou long press mobile)
- Pas de tours, pas de HP joueur, pas de multiplicateur
- Board inspector : overlay live avec stats de toutes les unités pendant le combat
- Unités ennemies masquées visuellement en phase de préparation post-combat
- Bouton Pause pour le combat
- **Sélecteur de terrain** : dropdown `🗺️` pour choisir un board manuellement — cases bloquées visibles immédiatement, effets appliqués au lancement du combat, bouton ℹ pour afficher le tooltip du terrain

---

## Mode 3D (dev)

Variante expérimentale du board en Three.js (rendu WebGL + CSS3D), accessible uniquement depuis `MainMenu` (boutons "POC 3D (dev)" et "Jouer (3D — dev)"). Réservée au développement, non destinée aux joueurs.

**Three.js** chargé via CDN (`jsdelivr`), déclaré dans une `importmap` (`index.html`) :

```html
<script type="importmap">
  { "imports": { "three": "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js" } }
</script>
```

`CSS3DRenderer` / `CSS3DObject` sont importés directement depuis le CDN (`examples/jsm/renderers/CSS3DRenderer.js`) dans `Board3D.js` et `Poc3D.js`.

### Routes (`game/main.js`)

```js
poc3d:  () => import('./ui/screens/Poc3D.js'),
game3d: () => import('./ui/screens/GameScreen3D.js'),
```

### `game/ui/screens/Poc3D.js`

Proof of concept : board 5×8 vue du dessus, tuiles WebGL + cartes en CSS3D (réutilise `UnitCard.js` sans modification), main via `HandUI`. Sert de bac à sable indépendant de `GameScreen`.

### `game/ui/components/Board3D.js`

Équivalent 3D de `BoardGrid.js` — **même API publique** (`setBoard`, `setHighlight`, `refresh`, `enterCombatMode`, ...) + accesseurs additionnels consommés par `CombatAnimator3D`. Grille 5×11 (mêmes conventions que `Board.js` : joueur rangées 0–3, neutre 4–6, ennemi 7–10).

- Tuiles = mesh WebGL (`THREE.Scene`), unités = `CSS3DObject` enveloppant les éléments DOM produits par `createUnitEl`/`updateUnitEl` (`UnitCard.js`) — donc le rendu des unités reste identique au mode 2D.
- `createBoard3D(container, opts)` — factory async (charge Three.js + CSS3DRenderer), retourne une instance `Board3D`.
- Surlignages (highlight, matériaux candidats/sélectionnés, cases bloquées) rendus via un anneau CSS (`box-shadow`) sur le wrapper CSS3D, mis à l'échelle (`CSS_SCALE = CELL / CARD_PX`) pour compenser le scaling du `CSS3DObject`.

### `game/ui/components/CombatAnimator3D.js`

Équivalent 3D de `CombatAnimator.js` — consomme `CombatManager.step()` au même rythme (`BASE_TICK_MS = 180 / speed`), pilote les animations sur `Board3D` au lieu du DOM 2D direct. Même contrat : pas de logique de combat ici, uniquement consommation d'événements.

### `game/ui/screens/GameScreen3D.js`

Variante 3D de `GameScreen.js` — même logique de jeu (`GameState`, `Board`, `CombatManager`, `InvocationManager`, `AttributeManager`, `EnemyAI`, Phase Shopping, etc.), mais utilise `Board3D` + `CombatAnimator3D` au lieu de `BoardGrid` + `CombatAnimator`. Doit être maintenu en parallèle de `GameScreen.js` pour toute évolution de la boucle de jeu — la logique (`logic/`) est partagée et ne change pas.

### CSS (`index.html` / `game/game.css`)

- `.game3d-3d .unit-card { pointer-events: none; cursor: default; }` — le board 3D gère tous les pointer events via le canvas WebGL ; les `.unit-card` (rendues en CSS3D) ne doivent pas intercepter les événements.
- `.poc3d-wrap` / `.poc3d-3d` / `.poc3d-hint` (POC), `.game3d-wrap` / `.game3d-3d` (GameScreen3D) — conteneurs plein écran (`position: absolute; inset: 0`) pour les renderers WebGL + CSS3D.

---

## CSS Rules

- Variables CSS via `var(--*)` — toujours utiliser les variables définies dans `game.css`
- Pas de styles inline dans le JS (exception : `transform: translate()` dans les animations)
- Mobile-first : écrire pour mobile, surcharger pour desktop avec `@media (min-width: ...)`
- Touch targets : **44px minimum** sur tous les éléments interactifs
- Safe areas iOS : `env(safe-area-inset-*)` pour les bords de l'écran

---

## Mobile Rules

- Pointer Events API sur tous les éléments interactifs (pas de `mousedown`/`touchstart` séparés)
- Tester sur Safari iOS en portrait (priorité)
- Portrait recommandé ; afficher un message si l'utilisateur passe en paysage
- `manifest.json` PWA : icône, nom, couleurs de thème
- Bouton plein écran (Fullscreen API)

---

## Phase 7 — Polish Mobile

### Safe areas (notch / home indicator iOS)

`viewport-fit=cover` est défini dans `index.html`. Les insets sont appliqués via `env(safe-area-inset-*)` :

- `#screen` (`game/game.css`) : `padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)` — protège tous les écrans (topbar, contenu, hand-ui, phase-controls, MainMenu) en une seule règle, car ils sont tous enfants de `#screen`.
- `.overlay` (`position: fixed`, donc hors du padding de `#screen`) : `padding: max(16px, env(safe-area-inset-*))` sur chaque côté.
- Les overlays internes au board (`.shopping-overlay`, `.end-round-overlay`, `.shopping-select-banner`) sont `position: absolute` dans `.game-layout`, donc déjà protégés par le padding de `#screen`.

### PWA

- `game/manifest.json` (servi via `/game/manifest.json`, `express.static`) : `name`, `short_name`, `display: standalone`, `orientation: portrait`, `theme_color`/`background_color: #0f1117`, icônes `game/icon-192.png` et `game/icon-512.png` (générées depuis `game/logo.png`, fond `--bg`).
- `index.html` : `<link rel="manifest">`, `<link rel="apple-touch-icon">`, `<meta name="theme-color">`.
- Bouton plein écran (Fullscreen API) sur `MainMenu` (`#btn-fullscreen`, en haut à droite) : `requestFullscreen()` / `exitFullscreen()`, icône mise à jour via l'event `fullscreenchange`. Masqué si l'API n'est pas supportée.

### Orientation

Avertissement plein écran en CSS pur (`game/game.css`), aucune logique JS :

```css
@media (orientation: landscape) and (hover: none) and (pointer: coarse) {
  #screen { display: none; }
  .orientation-warning { display: flex; /* ... */ }
}
```

`.orientation-warning` (markup statique dans `index.html`, hors de `#screen`) n'est visible qu'en paysage sur un appareil tactile (`pointer: coarse`) — n'affecte pas les fenêtres desktop en paysage.

### Touch targets

`--touch-target: 44px` (déjà défini) appliqué aux éléments qui en manquaient :
- `.topbar-back`, `.filter-pill`, `.speed-btn`, `.tb-terrain-select`, `.tb-terrain-info`, `.attribute-chip`, `.board-ind` → `min-height`/`min-width: var(--touch-target)`.
- `.slot-remove` (badge de suppression sur un `.deck-slot` de 52px) : agrandi à 24×24px — un plein 44px chevaucherait excessivement le slot ; compromis documenté ici.

---

## Important Design Rules

Toujours garder :

**Logique ≠ Visuel**

Les classes `logic/` ne doivent jamais :
- Manipuler le DOM
- Importer des composants UI
- Contenir de `requestAnimationFrame`

Les classes `ui/` ne doivent jamais contenir :
- Logique de combat
- Logique d'attribut
- Logique d'invocation

---

## Known Technical Lessons

Le board est la source de vérité.

Ne jamais déduire une position depuis la position d'un élément DOM.

Des bugs ont déjà découlé de désynchronisations entre :
- `unit.position`
- `board.grid`
- Position DOM

Lors d'un déplacement d'unité :

1. Mettre à jour `board.grid`
2. Mettre à jour `unit.position`
3. Animer visuellement

Dans cet ordre.

---

## Development Philosophy

Préférer :

- Systèmes simples
- Comportement déterministe
- Design data-driven
- UX mobile-friendly
- Zéro bundler tant que la complexité ne l'exige pas

Éviter :

- Hasard caché
- State machines complexes
- Logique visuelle mélangée à la logique de jeu
- Styles inline

Le jeu doit ressembler à :

"Auto Chess avec la cadence de Marvel Snap."
