# Backlog

> 1 item = 1 session Claude (issue labellisée `claude` ou session Cloud) = 1 PR.
> Cocher + lien PR quand c'est mergé. `/dispatch` (claude-ops) lit ce fichier.

- [x] Retours UX mobile (lot 1) : filtre « En action », paramètres ⚙ (thème + token), retrait du + mobile — [PR #13](https://github.com/Thibaud888/fleetview/pull/13).
- [x] Retours UX mobile (lot 2) : codex v2 (détails, catégories, édition, suppression, filtre par projet), micro partout (demande, réponses, édition d'idée), option « cadrer d'abord » sur les demandes de changements.

- [x] Service worker + cache hors-ligne — `sw.js` pré-cache la coquille (stale-while-revalidate), le dernier relevé est persisté et réaffiché avec un bandeau « hors ligne » ; l'API GitHub n'est jamais mise en cache (issue #8).
- [x] Icônes PWA PNG maskable (192/512) + apple-touch — installation propre sur Android : l'icône vitruvienne s'affiche masquée, pas une capture ; générées depuis `icon.svg` par `scripts/icons.mjs` (issue #7).
- [ ] Journal de run en direct dans la vue projet — bouton « Suivre » affiche les logs du run Actions ; DoD : logs visibles et rafraîchis pendant un run réel.
- [ ] Secrets automatiques au bootstrap « Nouveau projet » — poser CLAUDE_CODE_OAUTH_TOKEN via l'API (libsodium) ou documenter le geste manuel ; DoD : un projet créé depuis FleetView peut lancer sa première session sans passage par un terminal.
- [ ] Compteur de quota API GitHub dans le pied de page — DoD : requêtes restantes visibles, alerte sous 500.
- [ ] Notifications ntfy cliquables vers la vue projet — DoD : le lien d'une notif ouvre FleetView sur le bon repo.
- [ ] Passage du repo en public — historique vérifié (aucun secret), URL Pages documentée dans le README ([PR #6](https://github.com/Thibaud888/fleetview/pull/6)) ; reste le geste manuel : Settings → Change visibility → Make public.
- [x] Workflow Pages en pause tant que le repo est privé (garde `if` dans le stub, réactivation automatique au passage en public) — [PR #5](https://github.com/Thibaud888/fleetview/pull/5).
- [x] Bouton micro 🎙️ pour dicter les idées (Web Speech API) — [PR #10](https://github.com/Thibaud888/fleetview/pull/10).
