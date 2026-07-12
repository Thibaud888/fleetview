# Backlog

> 1 item = 1 session Claude (issue labellisée `claude` ou session Cloud) = 1 PR.
> Cocher + lien PR quand c'est mergé. `/dispatch` (claude-ops) lit ce fichier.

- [ ] Service worker + cache hors-ligne — l'app s'ouvre sans réseau avec le dernier relevé ; DoD : coupure réseau → l'UI s'affiche avec données en cache et bandeau « hors ligne ».
- [ ] Icône apple-touch PNG 180×180 — installation propre sur iOS ; DoD : « Ajouter à l'écran d'accueil » affiche l'icône vitruvienne, pas une capture.
- [ ] Journal de run en direct dans la vue projet — bouton « Suivre » affiche les logs du run Actions ; DoD : logs visibles et rafraîchis pendant un run réel.
- [ ] Secrets automatiques au bootstrap « Nouveau projet » — poser CLAUDE_CODE_OAUTH_TOKEN via l'API (libsodium) ou documenter le geste manuel ; DoD : un projet créé depuis FleetView peut lancer sa première session sans passage par un terminal.
- [ ] Compteur de quota API GitHub dans le pied de page — DoD : requêtes restantes visibles, alerte sous 500.
- [ ] Notifications ntfy cliquables vers la vue projet — DoD : le lien d'une notif ouvre FleetView sur le bon repo.
- [ ] Passage du repo en public — historique vérifié (aucun secret), URL Pages documentée dans le README ([PR #6](https://github.com/Thibaud888/fleetview/pull/6)) ; reste le geste manuel : Settings → Change visibility → Make public.
- [x] Workflow Pages en pause tant que le repo est privé (garde `if` dans le stub, réactivation automatique au passage en public) — [PR #5](https://github.com/Thibaud888/fleetview/pull/5).
