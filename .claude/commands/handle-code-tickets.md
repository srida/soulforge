---
description: Récupère les tickets Notion tagués "Code" et les traite selon leur complexité
---

Tu vas traiter les tickets Notion taggés "Code" qui sont en attente.

## Étape 1 — Récupérer les tickets

Exécute :
```
node scripts/list-code-tickets.mjs
```

Cela renvoie un tableau JSON de tickets `{ id, url, title, status, content }`.

S'il n'y a aucun ticket, dis-le simplement et arrête-toi là.

## Étape 2 — Traiter chaque ticket, un par un

Pour chaque ticket, dans l'ordre :

1. Lis le titre et le contenu du ticket.
2. Explore le repo (déjà présent dans le répertoire courant) pour comprendre
   le contexte technique lié à la demande.
3. Évalue la complexité :
   - **Simple** (bug clair, petite feature bien cadrée, changement localisé) :
     - Implémente la solution directement sur la branche `master`.
     - Commit avec un message clair référençant le ticket.
     - Ne pousse pas (`git push`). Reste local pour l'instant. Pas de branche, pas de PR.
   - **Complexe / ambigu** (besoin de clarification, choix d'architecture,
     impact transverse, risque élevé) :
     - N'écris PAS de code.
     - Rédige une analyse : compréhension du besoin, options possibles,
       questions ouvertes, recommandation.
4. Rédige un commentaire de synthèse (5-10 lignes max) qui sera posté sur le
   ticket :
   - Cas simple : ce qui a été fait, le commit (hash/message) sur `master` (non poussé), comment tester.
   - Cas complexe : l'analyse + les questions à trancher.
5. Mets à jour le ticket :
```
node scripts/update-ticket.mjs "<page_id>" "<commentaire>" "<nouveau statut>"
```
   - Cas simple → statut du type "À valider" / "En revue"
   - Cas complexe → statut du type "Besoin de clarification"
   (adapte les valeurs exactes à ton workflow Notion)

## Étape 3 — Récapitulatif

Une fois tous les tickets traités, affiche un résumé : combien traités en
mode "code direct" (avec les commits locaux sur `master`, non poussés),
combien en mode "analyse", avec les liens des tickets correspondants.
