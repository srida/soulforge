# Soulforge — Plan de migration Web

## Contexte

Le jeu était développé sous **Godot 4.5.1** (GDScript). Il est **gameplay-complete** pour un premier vertical slice : boucle de jeu complète sur 5 tours, toutes les mécaniques d'invocation, système de pouvoirs, attributs, pathfinding, IA ennemie, support mobile.

La décision de migrer vers une version **full web responsive** a été prise pour :
- Distribution instantanée via URL (pas d'installation)
- Meilleur outillage UI responsive (CSS Grid, Flexbox)
- Déploiement continu depuis GitHub (Railway)
- Les composants 3D ne sont pas encore finalisés → moins à sacrifier
- Les données sont déjà en JSON pur → migration data layer quasi-gratuite

---

## Plateforme existante

Le jeu s'intègre dans une app Express.js déjà déployée sur **Railway** :

```
tools/card_manager/
├── server.js        ← Express, port 3742 (Railway: var PORT)
├── index.html       ← Jeu (SPA, à construire)
├── admin.html       ← Card Manager (admin, fonctionnel)
└── game/            ← Modules JS du jeu (à créer)
```

**Routes disponibles :**
| Route | Accès | Description |
|---|---|---|
| `GET /` | Public | Jeu |
| `GET /admin` | Auth basique | Card Manager |
| `GET /api/cards` | Public | 253 cartes |
| `GET /api/attributes` | Public | Attributs |
| `GET /api/powers` | Public | Pouvoirs |
| `POST/PUT/DELETE /api/*` | Auth | Écriture (admin seulement) |
| `GET /illustrations/:id` | Public | Art des cartes (PNG sans extension) |

**Données :**
- 253 cartes — tiers 1 à 5, 5 types d'invocation (normal, sacrifice, fusion, heritage, transformation)
- Stats par carte : `atk`, `hp`, `movement_speed`, `attack_speed`, `initiative`, `range`
- Chaque carte peut avoir zéro ou un pouvoir (`power_speed` = vitesse de charge)

**Repo GitHub :** `https://github.com/srida/my-auto-battler`
**Déploiement :** Railway, auto-deploy sur push `master`

---

## Stack technique

**Vanilla JS avec ES modules** — cohérent avec `admin.html`, zéro build step, servi directement par Express static.

```html
<!-- index.html -->
<script type="module" src="/game/main.js"></script>
```

Pas de framework, pas de bundler. Si la complexité augmente → Vite + TypeScript envisageable plus tard.

---

## Architecture des modules

Principe fondamental hérité de Godot : **logique ≠ visuel**. Les classes `logic/` ne touchent jamais le DOM.

```
game/
├── main.js                  ← Router SPA, bootstrap
├── data/
│   ├── CardDatabase.js      ← fetch /api/cards, cache en mémoire
│   ├── AttributeDatabase.js ← fetch /api/attributes
│   ├── PowerDatabase.js     ← fetch /api/powers
│   └── DeckRepository.js   ← localStorage (même interface que Godot)
├── logic/
│   ├── Unit.js              ← État runtime d'une unité
│   ├── Board.js             ← Source de vérité des positions (grille 5×8)
│   ├── GameState.js         ← Phases, tours, HP, multiplicateurs
│   ├── CombatManager.js     ← Boucle de combat, step() → events[]
│   ├── InvocationManager.js ← Validation + exécution des 5 types de summon
│   ├── AttributeManager.js  ← Comptage attributs + application des bonus
│   ├── PathFinder.js        ← BFS sur la grille
│   └── EnemyAI.js           ← Placement IA, calcul multiplicateur
└── ui/
    ├── screens/
    │   ├── MainMenu.js
    │   ├── DeckSelector.js
    │   ├── DeckBuilder.js
    │   └── GameScreen.js
    └── components/
        ├── BoardGrid.js      ← CSS Grid 5×8, gestion des cases
        ├── UnitCard.js       ← Affichage unité, HP bar, power gauge
        ├── HandUI.js         ← Main du joueur, scroll horizontal
        ├── Tooltip.js        ← Instance unique globale, tap-to-show
        └── CombatAnimator.js ← requestAnimationFrame, consomme CombatManager.step()
```

---

## Règles de jeu (référence)

### Board
- Taille : 5 colonnes × 8 rangées
- Joueur : rangées 0–3 | Ennemi : rangées 4–7
- Préparation : joueur voit uniquement son côté, ennemis cachés
- Combat : board entier visible

### Boucle de jeu
1. Préparation (placement des cartes)
2. Combat (auto-résolu, animé)
3. Fin de combat (dégâts aux HP, nettoyage)
4. Tour suivant (max 5 tours)

Fin de partie : tour 5 terminé **ou** un joueur atteint 0 HP.

### Multiplicateur de dégâts
```
multiplier = 1.0 + cards_in_hand / 10.0
```
Appliqué symétriquement. Tension risk/reward : garder des cartes en main booste les dégâts sortants mais affaiblit le board.

### Invocation
| Type | Condition |
|---|---|
| Normal | Placement direct |
| Sacrifice | Consomme N unités alliées sur le board |
| Fusion | Consomme des matériaux spécifiques |
| Heritage | Matériau Heritage + tributs supplémentaires |
| Transformation | Remplace une unité spécifique déjà en jeu |

### Combat
- Ciblage : ligne de front ennemie en priorité → plus proche (Manhattan) → moins de HP en cas d'égalité
- Pathfinding : BFS, unités ne peuvent pas se chevaucher
- Pouvoir : jauge se charge avec le temps, remplace l'attaque normale à pleine charge
- Dégâts de fin de combat = somme ATK des survivants ennemis × multiplicateur
- HP joueurs : 1000
- Unités neutralisées : restent disponibles comme matériaux pendant toute la préparation suivante, retirées au lancement du combat suivant si non consommées
- Survivants : retournent à `initial_position` après le combat

### Pouvoirs implémentés
`POWER_HEAL`, `POWER_SHIELD`, `POWER_SUPER_ATTACK`, `POWER_AOE_ATTACK`,
`POWER_POISON`, `POWER_PARALYSIS`, `POWER_PUSH`, `POWER_DEBUFF`, `POWER_BLOCK`

### Attributs (effets)
`stat_bonus`, `stat_modifier`, `draw_bonus`, `guaranteed_draw`,
`revive`, `shield`, `board_slot_bonus`

---

## Phases d'implémentation

### Phase 1 — Foundation *(1 jour)*
**Objectif :** squelette navigable, design system CSS en place.

- [x] `index.html` : shell SPA avec `<div id="screen">` et import du module principal
- [x] `game/main.js` : router minimaliste (swap d'écrans)
- [x] `game/game.css` : variables CSS (reprend le design system de `admin.html` + nouvelles vars jeu)
- [x] Route Express `app.use('/game', express.static(...))` pour les modules

**Critère de sortie :** 4 écrans vides navigables (MainMenu → DeckSelector → DeckBuilder → Game).

---

### Phase 2 — Data layer *(1 jour)*
**Objectif :** accès aux données depuis n'importe quel module.

- [x] `CardDatabase.js` — `getCard(id)`, `getCardsByTier(tier)`, `getAllCards()`, `buildDeckFromIds(ids)`
- [x] `AttributeDatabase.js` — `getAttribute(id)`, `getAttributes()` (dict)
- [x] `PowerDatabase.js` — `getPower(id)`
- [x] `DeckRepository.js` — `saveDeck`, `loadDeck`, `getActiveDeck`, `setActiveDeck`, `hasDeck`, `listDecks`

Chaque database expose `init()` async, les données sont cachées en mémoire après le premier fetch.

**Critère de sortie :** `await CardDatabase.init()` retourne les 253 cartes avec illustrations accessibles.

---

### Phase 3 — Logique de jeu headless *(5–6 jours)*
**Objectif :** toute la mécanique tourne sans DOM, testable en console navigateur.

**`Unit.js`**
```js
// Propriétés runtime
atk, max_hp, current_hp, shield, power_gauge
dot_effects[], paralysis_ticks, attack_speed_modifier
position, initial_position, is_neutralized

// Méthodes
takeDamage(amount), heal(amount), applyShield(amount)
resetCombatStats(), recomputeStats(attributeManager)
```

**`Board.js`**
- Grid 5×8, source de vérité
- `placeUnit(unit, pos)`, `moveUnit(unit, to)`, `removeUnit(unit)`
- `getUnit(pos)`, `isOccupied(pos)`, `getUnitsOnSide(side)`
- Rebuild de la grille après fin de combat

**`PathFinder.js`**
- BFS, ignore les cases occupées (sauf unités neutralisées)
- Retourne le chemin complet ou null si inaccessible

**`CombatManager.js`**
- `step()` → `Event[]` : avance le combat d'un tick, retourne les événements
  - `{type: 'move', unit, from, to}`
  - `{type: 'attack', attacker, target, damage}`
  - `{type: 'power', unit, targets, power_id}`
  - `{type: 'death', unit}`
  - `{type: 'combat_end', winner}`
- Pas de `setTimeout` dans la logique — le timing est géré par `CombatAnimator`
- Résolution déterministe (même seed = même résultat)

**`InvocationManager.js`**
- `canSummon(cardId, pos, board, hand)` → `{ok: bool, reason: string}`
- `summon(cardId, pos, board, hand)` → `Unit | null`
- Consomme matériaux + tributs depuis hand/board

**`AttributeManager.js`**
- `computeBonuses(units[], attributeDb)` — applique tous les bonus actifs
- Recalculé à chaque début de combat

**`EnemyAI.js`**
- `placeUnits(board, deck)` — placement rangées 4–7
- `selectHand(deck)` — sélection des cartes en main (logique à définir)
- `computeMultiplier(handSize)` — identique au joueur

**`GameState.js`**
- `phase` : `'preparation' | 'combat' | 'end_round' | 'game_over'`
- `round` : 1–5, `player_hp`, `enemy_hp`, `player_multiplier`, `enemy_multiplier`
- `nextPhase()`, `applyEndOfCombat(result)`

**Critère de sortie :** un combat complet s'exécute en console, résultat identique à plusieurs runs (déterminisme).

---

### Phase 4 — Écrans de navigation *(2–3 jours)*

**`MainMenu.js`** — Bouton Jouer → DeckSelector, bouton TestBench (dev)

**`DeckSelector.js`**
- Liste des decks depuis `DeckRepository`
- Actions : Créer / Éditer / Supprimer / Activer
- Bouton "Jouer" → GameScreen avec le deck actif

**`DeckBuilder.js`**
- 5 colonnes (tiers 1–5), 8 slots par tier (4 à 8 cartes selectionnable)
- Grille de cartes disponibles avec filtre (search + summon_type)
- Clic pour assigner une carte au tier sélectionné
- Validation bloquante : tous les tiers doivent être complets avant sauvegarde
- Mode édition : déclenché via `DeckRepository.setPendingEdit(deckName)`

**Critère de sortie :** création et sauvegarde d'un deck complet (40 cartes), persisté en localStorage.

---

### Phase 5 — Board UI & Préparation *(5–6 jours)*

**`BoardGrid.js`**
- CSS Grid 5×4 (vue joueur pendant prépa), 5×8 pendant le combat
- `BoardCell` : état vide / occupé / survolé / sélectionné
- Pointer Events API pour unifier click et touch

**`UnitCard.js`**
- `<img src="/illustrations/:id">` pour l'art
- HP bar CSS (no canvas)
- Power gauge
- Badge tier + type d'invocation
- États : normal / sélectionné / neutralisé (fade)

**`HandUI.js`**
- Scroll horizontal, touch-friendly
- Tap pour sélectionner une carte
- Indicateur visuel des coûts (ex: "2 sacrifices requis")

**`Tooltip.js`**
- Instance globale unique
- Tap → show, tap ailleurs → hide
- Contenu : nom, stats, power, attributs, coût

**Drag & Drop**
- Pointer Events (`pointerdown`, `pointermove`, `pointerup`)
- Repositionnement d'unités déjà posées pendant la préparation
- Validation `Board.isOccupied()` avant drop

**Critère de sortie :** le joueur peut construire son board complet avec toutes les règles d'invocation respectées.

---

### Phase 6 — Combat visuel *(5–6 jours)*

**`CombatAnimator.js`**
- `requestAnimationFrame` loop qui consomme `CombatManager.step()` à intervalle régulier
- Vitesse : ×1 / ×2 / ×4 (bouton visible, utile pour le debug)
- Animations CSS :
  - **Mouvement** : `transform: translate()` + `transition: transform Xms`
  - **Attaque** : shake sur l'attaquant + flash rouge sur la cible
  - **Mort** : fade-out + scale(0)
  - **Pouvoir** : flash coloré selon `power_id`
  - **HP bar** : transition smooth

**Board combat**
- Affiche les deux côtés (rangées 0–7)
- Ennemis cachés visuellement pendant la préparation (classe CSS `.hidden`)
- Board inspector (dev) : overlay avec stats live de toutes les unités

**Fin de round**
- Overlay résultat (victoire / défaite / égalité du round)
- Dégâts calculés avec multiplicateur → HP mis à jour
- Animation de retrait des unités mortes
- Bouton "Tour suivant" ou écran "Fin de partie"

**Critère de sortie :** un combat complet s'anime de bout en bout, visuellement lisible sur mobile.

---

### Phase 7 — Polish mobile *(2–3 jours)*

- [ ] Safe areas iOS : `env(safe-area-inset-*)`
- [ ] Touch targets : 44px minimum sur tous les éléments interactifs
- [ ] Test sur Safari iOS (portrait prioritaire)
- [ ] `manifest.json` pour PWA (icône, nom, couleurs)
- [ ] Bouton plein écran (Fullscreen API)
- [ ] Gestion de l'orientation (portrait recommandé, message si paysage)

---

## Règles d'implémentation

Ces règles sont héritées du projet Godot et s'appliquent à la version web :

1. **Logique ≠ Visuel** — les classes `logic/` ne font jamais de DOM manipulation
2. **Board = source de vérité** — ne jamais déduire une position depuis un élément DOM
3. **Déterminisme** — pas de `Math.random()` dans la logique de combat
4. **Mobile-first** — chaque composant est conçu pour le tactile avant la souris
5. **Itérer sur le `unit.duplicate()`** — lors des suppressions en boucle, toujours copier le tableau

---

## État actuel

- [x] Serveur Express avec APIs cards/attributes/powers
- [x] Card Manager fonctionnel à `/admin`
- [x] Illustrations servies à `/illustrations/:id`
- [x] `index.html` placeholder à `/`
- [x] Auth scopée (écriture API protégée, lecture et illustrations publiques)
- [x] Phase 1 — Foundation
- [x] Phase 2 — Data layer
- [x] Phase 3 — Logique headless
- [x] Phase 4 — Navigation
- [x] Phase 5 — Board UI
- [x] Phase 6 — Combat visuel
- [x] Phase 7 — Polish mobile
