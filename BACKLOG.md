# Backlog

> 1 item = 1 session Claude (issue labellisée `claude` ou session Cloud) = 1 PR.
> Cocher + lien PR quand c'est mergé. `/dispatch` (claude-ops) lit ce fichier.

- [x] Retours UX mobile (lot 1) : filtre « En action », paramètres ⚙ (thème + token), retrait du + mobile — [PR #13](https://github.com/Thibaud888/fleetview/pull/13).
- [x] Retours UX mobile (lot 2) : codex v2 (détails, catégories, édition, suppression, filtre par projet), micro partout (demande, réponses, édition d'idée), option « cadrer d'abord » sur les demandes de changements.
- [x] Retours UX mobile (lot 3) : méta-filtres Tous/En action distincts, bouton « Idée » (même modale que Demande), codex sans barre d'ajout, dialogue avec navigation + agrandissement, cadrage sans étape GO (implémentation enchaînée), invite de permission micro (getUserMedia) + message d'aide Android.
- [x] Suivi & bootstrap (lot 4) : notifications ntfy cliquables (push sur question de Claude / PR prête, lien `?repo=` vers la vue projet), journal de run en direct (étapes Actions rafraîchies pendant la session), secret Claude au bootstrap (badge présence + « poser sans terminal »), compteur de quota API GitHub (topbar + paramètres, alerte sous 500).
- [x] Retours sur le lot 4 (lot 5) : notifications natives de l'appareil (API Notification via service worker, sans service tiers, clic → bon projet), correctif ntfy 405 (POST sur l'URL du sujet, métadonnées en query string), avertissement secret seulement si réellement manquant (404 confirmé, nom du secret en clair), dialogue en vrai plein écran (le fil sort de sa boîte et remplit l'appareil), journal du dernier run toujours visible dans la vue projet.

- [x] Service worker + cache hors-ligne — `sw.js` pré-cache la coquille (stale-while-revalidate), le dernier relevé est persisté et réaffiché avec un bandeau « hors ligne » ; l'API GitHub n'est jamais mise en cache (issue #8).
- [x] Icônes PWA PNG maskable (192/512) + apple-touch — installation propre sur Android : l'icône vitruvienne s'affiche masquée, pas une capture ; générées depuis `icon.svg` par `scripts/icons.mjs` (issue #7).
- [x] Journal de run en direct dans la vue projet — bloc « Journal du run » affiche les jobs/étapes Actions, rafraîchis toutes les ~4,5 s tant que le run tourne, avec lien vers les logs complets (les logs bruts ne sont pas lisibles côté client pour cause de CORS) — lot 4.
- [x] Secrets automatiques au bootstrap « Nouveau projet » — geste sans terminal : badge de présence du secret par projet + bouton « Poser / mettre à jour » (copie le nom, ouvre la page du secret) ; à la création d'un projet, l'onglet du secret s'ouvre automatiquement. Chiffrement libsodium volontairement écarté (règle zéro-dépendance) — lot 4.
- [x] Compteur de quota API GitHub — requêtes restantes lues sur les en-têtes `x-ratelimit-*`, affichées dans la topbar et les paramètres, alerte toast sous 500 — lot 4.
- [x] Notifications ntfy cliquables vers la vue projet — push sur nouveaux événements actionnables (question de Claude, PR prête), le lien `?repo=<id>` ouvre FleetView sur le bon repo ; sujet ntfy en localStorage, jamais commité — lot 4.
- [ ] Passage du repo en public — historique vérifié (aucun secret), URL Pages documentée dans le README ([PR #6](https://github.com/Thibaud888/fleetview/pull/6)) ; reste le geste manuel : Settings → Change visibility → Make public.
- [x] Workflow Pages en pause tant que le repo est privé (garde `if` dans le stub, réactivation automatique au passage en public) — [PR #5](https://github.com/Thibaud888/fleetview/pull/5).
- [x] Bouton micro 🎙️ pour dicter les idées (Web Speech API) — [PR #10](https://github.com/Thibaud888/fleetview/pull/10).
