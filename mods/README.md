# Mods Claude Code — suivi de la consommation de tokens

Trois mods (plugins Claude Code) pour garder un œil sur les tokens. Ils tournent **dans Claude Code**
(terminal ou onglet Code de l'app Desktop) : zéro token consommé, zéro dépendance.

| Mod | Ce qu'il fait |
|---|---|
| `jauge-tokens` | Ligne au-dessus du prompt : remplissage du contexte (barre colorée), limites 5 h / 7 j, coût de la session. Bouton « Masquer ». |
| `suivi-tokens` | Commande `/tokens` : panneau interactif (Aperçu / Jours / Repos / Session), barres entrée/sortie, tendance, période 7-14-30-60 j, mesure tokens / cache / $, filtre par repo en cliquant. L'**historique est repris des transcripts** `~/.claude/projects` au premier lancement (puis toutes les 6 h ; `/tokens import` pour forcer). `/tokens texte` = tableau texte seul, partout. |
| `alerte-seuils` | Prévient avant de dépasser : contexte (70 % / 90 %), limites (80 %), budget de session, et « contexte plein dans ~N échanges » (prévision). Seuils réglables dans `/config`. |

## Installer (sur ta machine, dans un terminal)

```
/plugin marketplace add Thibaud888/fleetview
/plugin install jauge-tokens@fleetview-mods
/plugin install suivi-tokens@fleetview-mods
/plugin install alerte-seuils@fleetview-mods
```

Puis `/reload-plugins` si une session était déjà ouverte.

## Limites connues

- L'import d'historique lance `node` (script `mods/suivi-tokens/scripts/import.mjs`) et ne lit que les transcripts présents sur la machine : les sessions cloud passées n'y sont pas. Il restitue les **tokens** ; le **coût en $** n'est connu que pour ce que le mod a mesuré lui-même.
- **Sessions cloud (claude.ai/code)** : les plugins déclarés dans `.claude/settings.json` ne sont pas
  installés dans une session cloud, et les mods n'y dessinent rien (ni bande, ni panneau). Ces mods
  servent donc en local (terminal ou Desktop).
- La consommation est lue par Claude Code lui-même (`$.session.usage`) ; le coût en dollars est celui
  que `/cost` affiche.

## Développer

`claude plugin validate mods/<nom>` puis `claude plugin test mods/<nom>`.
