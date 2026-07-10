# CLAUDE.md — fleetview

> Tour de contrôle de la flotte : suivi des états de tous les repos, boîte à idées priorisée,
> lancement de sessions Claude (cadrage puis implémentation) — sans ouvrir GitHub.

## Règles de travail (flotte)
- **Lis `MAP.md` avant toute exploration** ; n'explore que ce qu'elle ne couvre pas.
- **Aucune session ne rend la main sans avoir vérifié** : lance `node scripts/verify.mjs`
  (ou build + tests) et regarde le résultat avant de conclure.
- Branche + PR, **jamais de push direct sur `main`**. Commits **en français**.
- 1 session = 1 item de `BACKLOG.md` = 1 PR ; mets à jour `BACKLOG.md` en fin de session.
- 3e récurrence d'une même tâche → écris un script réutilisable (`scripts/`), pas juste le résultat.

## Stack & commandes
- Stack : HTML/CSS/JS vanilla, **zéro dépendance**, API GitHub appelée côté client.
- Dev : `npx serve -l 4000 .`
- Test : `node scripts/verify.mjs`
- Build : aucun (site statique servi tel quel).
- Déploiement : GitHub Pages (workflow `pages.yml` du kit, déploie `main`).

## Architecture (5-10 lignes)
- `index.html` — coquille : topbar, atelier (cartes), codex des idées, chroniques, modales, écran de configuration.
- `styles.css` — 6 thèmes (De Vinci par défaut, Clair, Sombre, Océan, Forêt, Montagnes) via
  variables CSS sur `html[data-fv-theme]` ; mobile ≤ 900 px avec barre d'onglets basse.
- `app.js` — tout le comportement : stockage local (token, thème), couche API GitHub (`gh()`),
  chargement (`loadAll`) → modèle normalisé → rendus ; actions (issues, merge, rerun, fleet.json).
- Données : `claude-ops/fleet/fleet.json` (registre + statuts de cycle de vie), issues `claude`
  (sessions), issues `idée`+`P1/P2/P3` sur claude-ops (codex), PRs + check-runs, runs Actions.
- Aucune donnée sensible dans le code : le token fine-grained reste en `localStorage`.

## Pièges connus
- Repo destiné à être **public** (GitHub Pages, plan gratuit) : ne JAMAIS commiter de token,
  d'URL ntfy ou de contenu privé de la flotte — tout vient de l'API à l'exécution.
- Les labels (`claude`, `claude:opus`…, `idée`, `P1-P3`, `cadrage`) sont créés à la volée par
  `ensureLabel()` ; ne pas supposer qu'ils existent.
- Le protocole **cadrage** repose sur le corps de l'issue (phase 1 : spécifier en commentaire,
  ne pas coder ; phase 2 : après « GO ») et sur le déclencheur `@claude` du kit — ne pas le
  reformuler sans tester les deux phases.
- `fleet.json` est aussi écrit par `scripts/fleet.mjs` (claude-ops) : ne toucher que le champ
  `statut`, préserver le reste, et gérer le conflit de `sha` (re-fetch avant PUT).
