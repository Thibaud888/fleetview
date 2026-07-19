---
name: handoff
description: Génère un prompt de handoff standardisé pour reprendre le travail dans une nouvelle session Claude Code (locale ou Cloud). Utiliser en fin de session, ou quand l'utilisateur dit « fais-moi un handoff », « prépare la reprise », « prompt pour la prochaine session ». Produit un fichier chantiers/<slug>.md + le texte prêt à coller.
---

# /handoff — prompt de reprise standardisé

Objectif : capturer l'état de la session courante dans un prompt **autonome** qu'une session
neuve (locale ou Cloud) pourra exécuter sans que Thibaud re-raconte le contexte à la main.
Même format que les fichiers `claude-ops/chantiers/*.md`.

## 1. Rassembler le contexte (ne rien demander qui soit déductible)

Exécuter et lire :
- `git remote get-url origin` → repo (en déduire `owner/name`).
- `git rev-parse --abbrev-ref HEAD` → branche courante.
- `git status --short` et `git log --oneline -8` → état de l'arbre, travail récent.
- `gh pr status` ou `gh pr list --head <branche>` → PR liée éventuelle (numéro, état).
- Le `BACKLOG.md` du repo s'il existe → chantier en cours ?

Déduire de la conversation : ce qui vient d'être fait, ce qui reste, les décisions prises.

## 2. Compléter le strict nécessaire

Demander à Thibaud UNIQUEMENT ce qui n'est pas déductible :
- l'objectif de la prochaine session (si pas évident) ;
- contraintes particulières.

Sinon, proposer un objectif déduit et le laisser corriger. Ne pas poser de question dont la
réponse est dans le repo ou la conversation.

## 3. Écrire le fichier

Emplacement : `chantiers/<slug>.md` à la racine du repo concerné (créer le dossier
`chantiers/` s'il n'existe pas encore). `<slug>` = objectif en kebab-case court.
Repli en session **locale** seulement, si le repo n'a pas vocation à porter de chantiers :
écrire dans le clone local de `claude-ops` (dossier `chantiers/`).

Squelette à remplir :

````markdown
# <Titre court> — <objectif en une ligne>

> À lancer dans une session **<locale | Cloud>** sur `<repo>`.
> Prérequis : <… ou « aucun »>.

## Prompt de handoff (coller tel quel)

Contexte : <2-4 lignes — repo, branche, PR, où on en est, décisions clés>.

Fais, dans l'ordre :
1. <étape>
2. <étape>
…

Contraintes : <français ; branche + PR si repo projet>.
Definition of done : <critères vérifiables>.
Termine en mettant à jour le `BACKLOG.md` (statut + lien PR).
````

## 4. Restituer

Afficher : le chemin du fichier créé **et** le bloc « Prompt de handoff » prêt à copier-coller.
Rappeler la reprise la plus directe : nouvelle session locale/Cloud sur le repo + coller le
prompt, ou `claude --from-pr <n°>` si une PR existe.
