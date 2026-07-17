---
name: backlog
description: Backlog du repo courant — consulter le BACKLOG.md, traiter un item dans la session, ajouter, supprimer, prioriser P1/P2/P3. Utiliser quand l'utilisateur dit « /backlog », « montre le backlog », « qu'est-ce qu'il reste à faire », « traite l'item N », « ajoute ça au backlog », « supprime l'item N », « priorise ». Version mono-repo du kit ; si la skill backlog de flotte (multi-repo, session locale) est aussi disponible, c'est elle qui prime.
---

# /backlog — le backlog du repo courant

Version **mono-repo** embarquée par le kit de flotte : elle opère sur le `BACKLOG.md` à la
racine du **repo courant** uniquement. Pensée pour les **sessions Cloud** (qui ne voient que ce
repo) ; en session locale, si la skill de flotte multi-repo (claude-ops) est listée, c'est elle
qui prime.

Convention : **1 item de backlog = 1 session = 1 PR.**

## Gestes

| Geste | Effet |
|---|---|
| `/backlog` | afficher le backlog du repo |
| `/backlog <n°>` | traiter l'item ici, dans la session courante |
| `/backlog <n°> voir` | détail de l'item, sans rien écrire |
| `/backlog <n°> suppr` | retirer l'item (confirmation obligatoire) |
| `/backlog ajoute <idée>` | ajouter un item formaté |
| `/backlog prio` | passe de priorisation P1/P2/P3 |

## Règles

- **Numérotation stable.** n° = position de l'item parmi les `- [ ]` du fichier (ordre du
  fichier), même quand l'affichage trie par priorité. Ne jamais agir sur un n° sans relire le
  fichier au moment T ; si le contenu ne correspond plus à ce que l'utilisateur avait sous les
  yeux, confirmer avant d'agir.
- **Priorités.** Marqueur optionnel en tête d'item : `- [ ] (P1) titre — contexte/DoD`.
  P1 = urgent · P2 = important · P3 = un jour · sans marqueur = non trié. Affichage trié
  P1 → P2 → P3 → sans. Les `- [x]` sont de l'historique : ignorés à l'affichage.
- **Format d'un item.** `- [ ] (Px) titre — contexte et definition of done`, sur une ligne.
  `/backlog ajoute` reformule l'idée à ce format (droit à UNE question en cas de grosse
  ambiguïté seulement). Conserver tel quel un éventuel 📱 en fin d'item (provenance codex).
- **Anti-collision.** Avant tout traitement ou écriture : si une issue `claude` est ouverte sur
  ce repo (`gh issue list --label claude --state open`), le signaler (sa PR touchera aussi
  BACKLOG.md) et ne continuer qu'avec l'accord de l'utilisateur.
- **Écritures** (`ajoute`/`suppr`/`prio`) : périmètre strict = `BACKLOG.md` seul. Commit direct
  sur la branche par défaut quand la session le permet ; sinon, dans la branche/PR courante en
  le signalant. `BACKLOG.md` absent → le créer avec l'en-tête du template du kit
  (`templates/common/BACKLOG.md` de fleet-kit, repo public).
- **Traiter un item** (`/backlog <n°>`) : branche + PR comme n'importe quel chantier ; en fin
  de travail, cocher l'item (`- [x]` + lien PR) dans la même PR.
