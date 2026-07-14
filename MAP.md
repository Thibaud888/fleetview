# MAP.md — fleetview

## Quoi

**FleetView** est un tableau de bord statique 100 % vanilla JS pour orchestrer une flotte GitHub. 
Il affiche les états en temps réel (à débloquer/session en cours/attente/calme), un codex d'idées priorisées, lance des sessions Claude (cloud interactive via claude.ai/code, ou issue directe fire-and-forget via Actions), notifications ntfy/natives cliquables, journal de run en direct, et alerte quota API — zéro backend, zéro dépendance, le navigateur parle directement à l'API GitHub.

## Arborescence annotée

```
index.html              Coquille statique : topbar, écran config, atelier (cartes), vue projet, codex, chroniques, modales, journal
styles.css              Tous les styles : 6 thèmes via CSS variables (De Vinci défaut), responsive ≤ 900 px, journal stylisé
app.js                  Comportement complet (aucune dépendance) : storage, API GitHub, chargement, rendus, actions, notifications, journal run, quota API
sw.js                   Service worker : cache coquille, pas l'API (stale-while-revalidate), notifications natives
manifest.webmanifest    PWA config : icônes, couleurs, orientation
icon.svg                Marque vitruvienne (cercle + carré)
icon-*.png, maskable-*.png, apple-touch-icon.png    Icônes générées (ne pas éditer à la main)
.mcp.json               Config MCP : intégration serveur GitHub via HTTP (token env GITHUB_TOKEN)
README.md               Page d'accueil : pitch rapide, installation express
docs/GUIDE.md           Guide complet : concepts, usage, sécurité, archi, lanceur cloud + issue directe
scripts/verify.mjs      Vérification : serveur HTTP natif (pas npx serve), teste démarrage et syntaxe
scripts/icons.mjs       Génère icônes PNG à partir de icon.svg (lance après modif : node scripts/icons.mjs)
.github/workflows/      Stubs kit : claude.yml (dispatch), map.yml, pages.yml (déploiement)
```

## Points d'entrée

| Besoin | Où | Quoi |
|---|---|---|
| Ajouter un état de repo | `app.js:buildModel()` | Modifier le calcul d'état (`crit`/`info`/`warn`/`calm`) |
| Ajouter une colonne UI | `index.html` + `app.js:render*()` | HTML structure + fonction render correspondante |
| Nouveau thème | `styles.css` | Ajouter `html[data-fv-theme="nom"]` + vars CSS |
| Modifier l'API GitHub | `app.js:gh()` | Fonction wrapper (headers, retry, erreurs, quota) |
| Notifications ntfy | `app.js:notifyNtfy()` + index.html settings | Sujet localStorage, handlers cliquables, testable |
| Lanceur session cloud | `app.js:composeCloudPrompt()`/`launchCloud()` | Compose un prompt de cadrage, le copie, ouvre claude.ai/code (interactif) |
| Issue directe (Actions) | `app.js:createRequest()`/`directBody()` | Crée l'issue `claude` (fire-and-forget), déclencheur `@claude` du kit |
| Journal de run | `app.js:renderLog()` + `styles.css .log` | Actualisation ~4,5s pendant run, lien vers logs bruts |
| Changer l'icône | `icon.svg` puis `node scripts/icons.mjs` | Édite SVG, régénère PNG (192, 512, maskable, apple) |

## Flux de données

1. **Chargement** : `loadAll()` récupère via API (token localStorage) fleet.json + issues `claude` + ideas + PRs + runs Actions.
2. **Normalisation** : `buildModel()` trie tout en `.repos[]` + `.ideas[]` avec états calculés, lit quota API.
3. **Render** : `render*()` transforment modèle en HTML, injectent dans DOM, journal run actualisé live.
4. **Actions** : clics déclenchent API (créer issue, PUT fleet.json, run, notif) → re-fetch `loadAll()`.
5. **Storage** : token + thème + sujet ntfy en localStorage (jamais ailleurs qu'`api.github.com`).

## Commandes

```bash
npx serve -l 4000 .              # Dev : http://localhost:4000
node scripts/verify.mjs          # Test : serveur HTTP natif, vérifie réponse
# Pas de build (site statique)
# Déploiement : GitHub Pages auto (pages.yml sur main)
```

## Pièges connus

- **Public repo** : GitHub Pages (gratuit) → ne JAMAIS commiter token, URL ntfy, data privée. Tout vient de l'API à l'exécution.
- **Labels dynamiques** : `ensureLabel()` crée labels à la volée (`claude`, `idée`, `P1-P3`, etc.) — ne pas supposer leur existence.
- **Deux canaux de lancement** : session **cloud** (interactif, claude.ai/code — prompt composé, copié, ouvert ; pas d'API pour pré-remplir, geste copier→coller) et **issue directe** (fire-and-forget, session Actions → PR). Le protocole cadrage 2 phases (label `cadrage`, « GO ») a été retiré — ne pas le réintroduire.
- **fleet.json dual-write** : aussi écrit par `scripts/fleet.mjs` (claude-ops) — modifier UNIQuement `statut`, préserver reste, gérer conflit `sha` (re-fetch avant PUT).
- **Notifications ntfy** : sujet localStorage, jamais commité. Handlers cliquables passent `?repo=<id>` et scrollent vers le bon projet. Test via bouton Tester.
- **Journal de run** : actualise ~4,5s tant que `run.status !== 'completed'`. Logs bruts indisponibles côté client (CORS) → lien vers GitHub Actions.
- **Quota API** : lu depuis en-têtes x-ratelimit-*, alerte toast < 500 req. Service worker ne cache pas l'API.
- **Service worker** : cache la coquille (HTML/CSS/JS/icônes) ; JAMAIS l'API GitHub (cross-origin, réseau direct). Coupure réseau = app hors-ligne mais fonctionnelle.
- **CSS variables** : thème = `html[data-fv-theme]` + vars root — défaut De Vinci, choix localStorage. Ajouter thème = scope + noms consistants.
- **Icônes PNG** : générées automatiquement (`scripts/icons.mjs`), committées dans repo. Modifier = éditer `icon.svg` + relancer le script.
