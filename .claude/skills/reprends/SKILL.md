---
name: reprends
description: Relance le travail interrompu par épuisement de tokens ou de limite — équivaut à dire « Tu t'es arrêté par manque de tokens ; tu peux reprendre où tu en étais ». Utiliser quand l'utilisateur dit « reprends », « /reprends », « tu t'es arrêté », « continue où tu en étais », ou après une coupure (limite atteinte, auto-compact, session tronquée).
---

# /reprends — reprendre après une coupure

Message de Thibaud : **« Tu t'es arrêté par manque de tokens ; tu peux reprendre où tu en étais. »**

Le travail s'est interrompu en plein milieu. L'objectif est de **reprendre, pas recommencer** :

## 1. Retrouver où on en était

- Si la conversation contient encore le contexte (ou un résumé de compaction) : relire la fin,
  la TodoList éventuelle, et identifier l'étape en cours au moment de la coupure.
- Si la session est neuve (contexte perdu) : chercher un handoff dans `chantiers/` du repo
  courant ou de `claude-ops`, lire le `BACKLOG.md`, et regarder l'état réel :
  `git status --short`, `git log --oneline -5`, branche courante, PR ouverte (`gh pr status`),
  fichiers à moitié écrits.

## 2. Ne pas refaire ce qui est fait

Ne pas ré-explorer le repo, ne pas re-poser des questions déjà tranchées, ne pas régénérer
des fichiers déjà corrects. Chaque redite coûte les tokens qui ont causé la coupure.

## 3. Continuer directement

Enchaîner sur l'étape interrompue et mener la tâche initiale à son terme, vérification
comprise (`scripts/verify*` du repo, ou build + tests), comme pour toute session.

Si l'état est vraiment ambigu (impossible de déduire la tâche interrompue), dire ce qui a
été retrouvé et demander UNIQUEMENT le point manquant — rien qui soit déductible du
contexte, du repo ou du git.
