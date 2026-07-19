---
name: bilan
description: Rituel de fin de session Claude Code — met à jour le BACKLOG.md du repo, écrit les décisions durables en mémoire persistante, propose un /handoff si un chantier reste ouvert, et récapitule branches/PRs créées. Utiliser quand l'utilisateur dit « bilan », « on s'arrête », « fais le point », « fin de session ».
---

# /bilan — clôture de session

Rituel de fin de session pour ne rien perdre entre deux sessions.

## 1. Récapituler ce qui a été fait
- `git log --oneline -15` et `gh pr list --head <branche>` (ou `gh pr status`) : lister
  commits, branches et PRs créés/modifiés pendant la session.
- Résumer en 3-6 puces : **fait / en cours / bloqué**.

## 2. Mettre à jour le BACKLOG.md
Repérer le `BACKLOG.md` pertinent (racine du repo projet, ou
`claude-ops/chantiers/BACKLOG.md` pour un chantier d'optimisation). Mettre à jour le statut
des items traités (🔲→🔄→✅ + lien PR) et ajouter les items découverts pendant la session.

## 3. Mémoire persistante
Écrire en mémoire les **décisions durables** (pas l'éphémère) : préférences confirmées,
choix d'architecture, faits de projet non déductibles du code/historique. Une fiche = un fait ;
mettre à jour l'index `MEMORY.md`. Corriger ou supprimer les fiches devenues fausses.
Ne pas dupliquer ce que le repo enregistre déjà.

## 4. Handoff si un chantier reste ouvert
S'il reste du travail : invoquer `/handoff` (ou en proposer un) pour préparer la reprise.

## 5. Restituer
Afficher : le récap fait/reste, les liens PRs, la ligne de BACKLOG mise à jour, et le
handoff éventuel (chemin + texte à coller).

## Rappel des conventions (socle Thibaud)
- Repos projet : branche + PR, jamais de push direct sur `main`.
- Exceptions : les repos méta `claude-ops` et `fleet-kit` (commits directs sur `main`).
- Langue : français. Messages de commit en français.
