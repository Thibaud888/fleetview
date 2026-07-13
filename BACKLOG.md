# Backlog

> 1 item = 1 session Claude (issue labellisée `claude` ou session Cloud) = 1 PR.
> Cocher + lien PR quand c'est mergé. `/dispatch` (claude-ops) lit ce fichier.

- [ ] Lanceur de session cloud — l'interactif (cadrage, questions/réponses) passe par des sessions claude.ai/code, les issues+Actions restent pour le fire-and-forget ; sur chaque carte repo et chaque item du codex, un bouton « Session cloud » compose un prompt de cadrage complet (repo ciblé, item et sa DoD, rappels flotte : lire MAP.md d'abord, branche + PR, verify avant de conclure, ouvrir la PR avec `gh pr create`), le copie au presse-papier puis ouvre claude.ai/code dans un nouvel onglet (pas d'API publique pour pré-remplir une session : le geste est copier → coller) ; DoD : depuis le codex et depuis une carte repo, un clic met le prompt complet au presse-papier et ouvre claude.ai/code, mobile compris.
- [ ] Retrait du protocole cadrage 2 phases (à faire APRÈS le lanceur de session cloud) — supprimer d'app.js le flux issue `cadrage` (phase 1 spécifier / phase 2 « GO »), router le geste de cadrage vers le lanceur de session cloud, ne plus poser le label `cadrage`, et nettoyer GUIDE.md, CLAUDE.md et MAP.md (piège « cadrage 2 phases ») ; DoD : plus aucune référence au protocole 2 phases dans le code ni la doc, le bouton de cadrage ouvre le lanceur.
- [ ] PRs de sessions cloud visibles et actionnables — les sessions claude.ai/code ouvrent souvent leurs PRs en draft (donc jamais auto-mergées) ; afficher les PRs draft avec un état distinct dans la vue projet et ajouter un bouton « Passer ready » (mutation GraphQL `markPullRequestReadyForReview` — le REST ne le permet pas) ; DoD : une PR draft apparaît marquée « draft » dans la vue projet et un clic la passe ready.
- [ ] Service worker + cache hors-ligne — l'app s'ouvre sans réseau avec le dernier relevé ; DoD : coupure réseau → l'UI s'affiche avec données en cache et bandeau « hors ligne ».
- [ ] Icône apple-touch PNG 180×180 — installation propre sur iOS ; DoD : « Ajouter à l'écran d'accueil » affiche l'icône vitruvienne, pas une capture.
- [ ] Journal de run en direct dans la vue projet — bouton « Suivre » affiche les logs du run Actions ; DoD : logs visibles et rafraîchis pendant un run réel.
- [ ] Secrets automatiques au bootstrap « Nouveau projet » — poser CLAUDE_CODE_OAUTH_TOKEN via l'API (libsodium) ou documenter le geste manuel ; DoD : un projet créé depuis FleetView peut lancer sa première session sans passage par un terminal.
- [ ] Compteur de quota API GitHub dans le pied de page — DoD : requêtes restantes visibles, alerte sous 500.
- [ ] Notifications ntfy cliquables vers la vue projet — DoD : le lien d'une notif ouvre FleetView sur le bon repo.
- [x] Workflow Pages en pause tant que le repo est privé (garde `if` dans le stub, réactivation automatique au passage en public) — [PR #5](https://github.com/Thibaud888/fleetview/pull/5).
