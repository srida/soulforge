---
description: Brainstorme des idées d'implémentation pour les tickets Notion tagués "Design" passés à "À faire", et les publie en sous-page de "Brainstorm — Soulforge"
---

Tu vas traiter les tickets Notion taggés "Design" qui sont au statut "À faire".
Déclenchement **manuel uniquement** — n'exécute cette commande que si l'utilisateur la lance explicitement.

## Étape 1 — Lire le GDD (obligatoire avant toute idée)

Avant de produire la moindre idée d'implémentation, lis l'intégralité du GDD à jour :

```
notion-fetch id=38432660-e798-8162-896a-e5bc2ede158a   (page "📘 GDD – Soulforge (v2.0)")
```

Cette lecture est obligatoire pour chaque exécution de cette commande, même si tu l'as déjà lu
plus tôt dans la conversation — le GDD peut avoir changé. Toute proposition doit être cohérente
avec les systèmes déjà décrits (boucle de jeu, combat, attributs, pouvoirs, invocation, magies, etc.)
et éviter de répéter ce qui existe déjà.

## Étape 2 — Récupérer les tickets Design en attente

```
node scripts/list-design-tickets.mjs
```

Renvoie un tableau JSON `{ id, url, title, status, content }`. Si le tableau est vide, dis-le et arrête-toi.

## Étape 3 — Traiter chaque ticket, un par un

Pour chaque ticket :

1. Lis le titre et le contenu du ticket.
2. Explore le repo si besoin (mécaniques existantes, fichiers de données concernés) pour ancrer les idées dans le code réel.
3. Rédige un fichier markdown temporaire (ex: `/tmp/brainstorm-<id>.md`) structuré ainsi :

```md
# <Titre du ticket>

Ticket d'origine : <url du ticket>

## 💡 Idées d'implémentation

- Idée 1 — description concrète, comment ça s'intègre dans l'architecture actuelle (logic/ vs ui/, data-driven, etc.)
- Idée 2 — ...
- (2 à 4 idées, pas plus — privilégier la qualité à la quantité)

## 🤖 Proposition d'un prompt Claude Code

Pour chaque idée, rédige un prompt prêt à copier-coller dans Claude Code pour l'implémenter :
concret, ancré dans l'architecture réelle (fichiers, classes, conventions logic/ vs ui/ du
projet), décrivant le comportement attendu et les cas limites à gérer. Pas de bloc de code
(```) — le convertisseur Notion ne les supporte pas et afficherait les backticks tels quels ;
rédige le prompt en texte simple, comme un paragraphe.

### Idée 1
Prompt proposé : <prompt rédigé, prêt à être donné à Claude Code>

### Idée 2
Prompt proposé : <prompt rédigé, prêt à être donné à Claude Code>

## 📋 Proposition d'ajout au GDD

Section du GDD concernée : <ex: "9. Attributs et synergies">

Texte proposé (prêt à copier-coller dans le GDD) :

<paragraphe rédigé, cohérent avec le style et la structure du GDD existant>
```

4. Crée la sous-page Notion sous "Brainstorm — Soulforge" :

```
node scripts/create-brainstorm-page.mjs "<Titre du ticket>" "/tmp/brainstorm-<id>.md"
```

   Cela renvoie `{ id, url }` de la page créée.

5. Ajoute un commentaire sur le ticket d'origine avec le lien vers la sous-page créée, et fais
   passer son statut à "En cours" (pour éviter de le retraiter au prochain lancement) :

```
node scripts/update-ticket.mjs "<page_id du ticket>" "Brainstorm généré : <url de la sous-page>" "En cours"
```

## Étape 4 — Récapitulatif

Une fois tous les tickets traités, affiche un résumé : nombre de tickets traités, avec pour
chacun le titre du ticket et le lien vers la sous-page Brainstorm créée.
