# FleetView — *il codice della bottega* 📡

**Le poste de pilotage de ma flotte de repos.** Une seule page — sur ordinateur comme sur
téléphone — pour voir où en est chaque projet et lancer du travail dessus, sans jamais ouvrir
GitHub.

- **États en un coup d'œil** : à débloquer · en session · en attente · calme — et surtout, un
  bandeau **« À traiter »** qui isole ce qui réclame ta main.
- **Codex des idées** : une boîte à idées priorisée (P1/P2/P3), qui ne coûte rien tant qu'elle dort.
- **Lancer une demande** : tu décris quoi, Claude cadre puis implémente — le dialogue reste
  dans l'interface (les sessions Actions « parlent » par commentaires d'issue que FleetView relit).
- **Gestes directs** : merger une PR, relancer un run, mettre un projet en veille/archivé —
  appel API instantané, zéro session.
- **Cycle de vie** : *actif* / *veille* (dev en pause mais pannes surveillées) / *archivé*.
- **6 thèmes**, PWA installable sur mobile.

Site **100 % statique** (aucun build, aucune dépendance JS) : le navigateur parle directement
à l'API GitHub et s'appuie sur le pipeline existant de la flotte (issue `claude` → session
Actions → PR).

## Démarrer

```bash
npx serve -l 4010 .        # puis http://localhost:4010
```

Au premier lancement : colle un **token GitHub fine-grained** (il reste dans ton navigateur),
ou clique **« explorer en mode démo »** pour découvrir l'interface sans token.

Les permissions exactes du token, tous les concepts et l'architecture sont dans le
**[Guide complet →](docs/GUIDE.md)**.

## Repères

| | |
|---|---|
| **Lancer** | `npx serve -l 4010 .` |
| **Vérifier** | `node scripts/verify.mjs` |
| **Déployer** | GitHub Pages (`pages.yml`, sur `main`) — nécessite le repo public |
| **Coût** | 0 € (Pages + API GitHub, ~25 requêtes/relevé sur 5 000/h) |
| **Feuille de route** | [BACKLOG.md](BACKLOG.md) |

## Structure

```
index.html            Coquille de l'interface
styles.css            Styles + 6 thèmes (variables CSS)
app.js                Tout le comportement (API GitHub, rendus, actions)
docs/GUIDE.md         Le manuel complet
scripts/verify.mjs    Vérification (le site démarre et répond)
.github/workflows/    Stubs du kit de flotte (claude, map, pages)
```

> Convention : 1 item de `BACKLOG.md` = 1 session = 1 PR ; commits en français ;
> branche + PR (jamais de push direct sur `main`). Voir [CLAUDE.md](CLAUDE.md).
