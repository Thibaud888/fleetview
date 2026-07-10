# FleetView — il codice della bottega 📡

Tour de contrôle de la flotte de repos : états en un coup d'œil (à débloquer / en session /
en attente / calme), boîte à idées priorisée (« codex »), lancement de sessions Claude avec
cadrage préalable, gestion du cycle de vie (actif / veille / archivé) — le tout sans ouvrir GitHub.

Site 100 % statique, zéro backend, zéro dépendance : le navigateur parle directement à l'API
GitHub et s'appuie sur le pipeline existant de la flotte (issues `claude` → sessions Actions → PRs).

## Lancer en local
```bash
npx serve -l 4000 .
# puis http://localhost:4000
```
Vérification : `node scripts/verify.mjs`

## Configuration (premier lancement)
1. Créer un token GitHub **fine-grained** sur https://github.com/settings/personal-access-tokens
   — accès : tous les repos du compte ; permissions : **Contents** (read/write), **Issues**
   (read/write), **Pull requests** (read/write), **Actions** (read/write), **Metadata** (read),
   **Administration** (read/write, uniquement si tu veux créer des projets depuis l'interface).
2. Le coller dans l'écran de configuration. Il reste dans le `localStorage` du navigateur,
   il ne transite jamais ailleurs que vers `api.github.com`.
3. Ou cliquer **Mode démo** pour explorer l'interface avec des données factices.

## Sur téléphone
Ouvrir l'URL GitHub Pages puis « Ajouter à l'écran d'accueil » : l'app s'ouvre en plein écran
(manifest PWA). Thème au choix : De Vinci (défaut), Clair, Sombre, Océan, Forêt, Montagnes.

## Coût
0 € : GitHub Pages + API GitHub (limite 5 000 req/h, l'app en consomme ~25 par relevé).
Les sessions lancées consomment le budget API Claude existant de la flotte.
