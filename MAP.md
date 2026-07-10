# MAP.md — fleetview

> Carte du repo. Générée/maintenue à la main pour l'instant (map.yml la régénérera).

## Fichiers
| Fichier | Rôle |
|---|---|
| `index.html` | Coquille statique : topbar, écran config, atelier, vue projet, codex, chroniques, modales (demande / nouveau projet), barre mobile. |
| `styles.css` | Tous les styles. Thèmes = variables CSS : `:root` (De Vinci, défaut) + `html[data-fv-theme="clair|sombre|ocean|foret|montagnes"]`. Mobile ≤ 900 px. |
| `app.js` | Comportement complet, sans dépendance. Sections : stockage, API (`gh()`), chargement (`loadAll` → `buildModel`), rendus (`render*`), actions (écritures API), événements, démo. |
| `manifest.webmanifest` | Installation mobile (PWA minimale, icône SVG). |
| `icon.svg` | Marque vitruvienne (cercle + carré). |
| `scripts/verify.mjs` | Vérification kit : le site démarre et répond. |
| `.github/workflows/` | Stubs kit : `claude.yml` (dispatch sessions), `map.yml`, `pages.yml` (déploiement Pages). |

## Modèle de données (app.js)
- `fleetFile` : `fleet.json` de claude-ops (`{json, sha}`) — la liste des repos et leur `statut`
  (cycle de vie : `actif` / `veille` / `archivé` ; `gelé` traité comme archivé).
- `model.repos[]` : `{id, type, life, state, lines[], last, pr?, threadIssue?, url}`.
- `model.ideas[]` : issues `idée` de claude-ops — `{num, p, repo, t, url}` (`**Projet** :` en 1re ligne du corps).
- États calculés (`state`) : `crit` (cron en échec, checks PR rouges, issue `claude` > 2 h sans PR) →
  `info` (session en cours) → `warn` (PR à review, questions de cadrage en attente) → `calm`.

## Protocoles
- **Lancer direct** : issue sur le repo cible, labels `claude` (+ `claude:haiku|opus|fable`) → session Actions → PR.
- **Cadrage** : issue labels `claude`+`cadrage`, corps en 2 phases (spécifier en commentaire, ne pas
  coder ; implémenter après un commentaire « GO »). Réponses de l'interface = commentaires `@claude …`.
- **Idée** : issue `idée`+`P1|P2|P3` sur claude-ops, fermée avec lien quand elle est lancée.
- **Cycle de vie** : bouton veille/archive → PUT `fleet.json` (champ `statut` uniquement).
- **Nouveau projet** : POST /user/repos + copie des templates fleet-kit via l'API contents + issue de finition.
