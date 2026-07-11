# MAP.md — fleetview

## Quoi

**FleetView** est un tableau de bord statique 100 % vanilla JS pour orchestrer une flotte GitHub. 
Il affiche les états en temps réel (à débloquer/session en cours/attente/calme), un codex d'idées priorisées, et lance des sessions Claude avec cadrage préalable — zéro backend, zéro dépendance, le navigateur parle directement à l'API GitHub.

## Arborescence annotée

```
index.html              Coquille statique : topbar, écran config, atelier (cartes), vue projet, codex, chroniques, modales
styles.css              Tous les styles : 6 thèmes via CSS variables (De Vinci défaut), responsive ≤ 900 px
app.js                  Comportement complet (aucune dépendance) : storage, API GitHub, chargement, rendus, actions
manifest.webmanifest    PWA minimaliste, installation mobile
icon.svg                Marque vitruvienne (cercle + carré)
README.md               Page d'accueil : pitch rapide, installation express
docs/GUIDE.md           Guide complet : concepts, usage, sécurité, archi, protocole cadrage
scripts/verify.mjs      Vérification : site démarre et répond
.github/workflows/      Stubs kit : claude.yml (dispatch), map.yml, pages.yml (déploiement)
```

## Points d'entrée

| Besoin | Où | Quoi |
|---|---|---|
| Ajouter un état de repo | `app.js:buildModel()` | Modifier le calcul d'état (`crit`/`info`/`warn`/`calm`) |
| Ajouter une colonne UI | `index.html` + `app.js:render*()` | HTML structure + fonction render correspondante |
| Nouveau thème | `styles.css` | Ajouter `html[data-fv-theme="nom"]` + vars CSS |
| Modifier l'API GitHub | `app.js:gh()` | Fonction wrapper (headers, retry, erreurs) |
| Protocole cadrage | `app.js:~800` | Parse issue phase 1 (spécif) / phase 2 (après GO) |

## Flux de données

1. **Chargement** : `loadAll()` récupère via API (token localStorage) fleet.json + issues `claude` + ideas + PRs + runs Actions.
2. **Normalisation** : `buildModel()` trie tout en `.repos[]` + `.ideas[]` avec états calculés en cascade.
3. **Render** : `render*()` transforment modèle en HTML, injectent dans DOM.
4. **Actions** : clics déclenchent API (créer issue, PUT fleet.json, run) → re-fetch `loadAll()`.
5. **Storage** : token + thème en localStorage (jamais ailleurs qu'`api.github.com`).

## Commandes

```bash
npx serve -l 4000 .              # Dev : http://localhost:4000
node scripts/verify.mjs          # Test : vérif basique
# Pas de build (site statique)
# Déploiement : GitHub Pages auto (pages.yml sur main)
```

## Pièges connus

- **Public repo** : GitHub Pages (gratuit) → ne JAMAIS commiter token, URL ntfy, data privée. Tout vient de l'API à l'exécution.
- **Labels dynamiques** : `ensureLabel()` crée labels à la volée (`claude`, `idée`, `P1-P3`, etc.) — ne pas supposer leur existence.
- **Cadrage 2 phases** : issue `claude`+`cadrage` → spécifier en commentaire (phase 1), implémenter après commentaire « GO » (phase 2). Tester les deux avant de reformuler.
- **fleet.json dual-write** : aussi écrit par `scripts/fleet.mjs` (claude-ops) — modifier UNIQuement `statut`, préserver reste, gérer conflit `sha` (re-fetch avant PUT).
- **CSS variables** : thème = `html[data-fv-theme]` + vars root — défaut De Vinci, choix localStorage. Ajouter thème = scope + noms consistants.
- **API rate limit** : 5 000 req/h GitHub, l'app ~25 par relevé. Pas de polyfill/bundler, zéro perte perfs.
