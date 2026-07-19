# Guide de FleetView

Le manuel complet : les concepts, l'usage au quotidien, la sécurité, l'architecture.
Pour l'installation express, voir le [README](../README.md).

---

## 1. À quoi ça sert

Claude Code est excellent pour suivre **un** sujet dans **une** session. Il l'est beaucoup
moins pour la **méta-gestion** de nombreux projets en parallèle : savoir d'un coup d'œil
lesquels avancent, lesquels sont bloqués, lesquels attendent une décision, et lancer une
nouvelle demande sur n'importe lequel sans jongler entre les onglets GitHub.

FleetView est ce **poste de pilotage**. Il ne remplace pas le moteur (le pipeline de la
flotte : `fleet.json`, sessions Claude dans GitHub Actions, self-heal) — il en est le
tableau de bord. Une seule page, sur ordinateur comme sur téléphone, qui répond à :

- **Où en est ma flotte ?** — états en un coup d'œil, et surtout ce qui demande une action.
- **Qu'est-ce que je voulais faire déjà ?** — un « codex » d'idées priorisées, sans pression.
- **Lance ça sur ce projet.** — une demande, un bouton, et Claude s'en occupe — sans ouvrir GitHub.

Le nom de code, *il codice della bottega* (« le carnet de l'atelier »), et le thème De Vinci
viennent de là : un carnet d'atelier où l'on note, suit et lance le travail.

---

## 2. Démarrer

### En local
```bash
npx serve -l 4000 .      # puis http://localhost:4000
```
Aucune installation, aucun build : c'est un site statique.

### Le token GitHub
Au premier lancement, FleetView demande un token pour parler à l'API GitHub en ton nom.

1. Crée un token **fine-grained** :
   [github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens/new)
2. **Resource owner** : ton compte · **Repository access** : *All repositories*.
3. **Permissions** (Repository permissions) :

   | Permission | Niveau | Pourquoi |
   |---|---|---|
   | Contents | Read & write | Lire/écrire `fleet.json` (cycle de vie), copier les fichiers du kit |
   | Issues | Read & write | Lire les issues `claude`/`idée`, en créer, commenter la session |
   | Pull requests | Read & write | Lire les PRs + checks, merger, demander des changements |
   | Actions | Read & write | Lire l'état des runs, en relancer un, déclencher le cadrage d'une idée (🪶) |
   | Metadata | Read | Obligatoire (dépendance implicite des autres) |
   | Administration | Read & write | **Seulement** si tu veux créer des projets depuis l'interface |

4. Colle-le dans l'écran « Relier l'atelier à GitHub », clique **Relier**.

Le token est stocké **uniquement** dans le `localStorage` de ton navigateur. Il ne part
jamais ailleurs que vers `api.github.com`. Pour l'oublier : vide le stockage du site, ou
ouvre les DevTools et supprime la clé `fv-token`.

### Le mode démo
Le lien « explorer en mode démo » charge des données **factices** (noms de projets fictifs) :
utile pour découvrir l'interface sans token, ou faire une capture. Aucune action n'y est réelle.

---

## 3. L'interface

```
┌──────────────────────────────────────────────────────────────┐
│  FleetView   ● 1 à débloquer ● 1 en session …   [thème] ⟳ ＋   │  topbar + synthèse
├───────────────────────────────────────┬──────────────────────┤
│  ❧ À TRAITER                          │  ❧ CODEX DES IDÉES    │
│   ce qui demande une action de TOI    │   idées priorisées    │
│                                        │   + ajout rapide      │
│  ❧ L'ATELIER   [filtres]              │                      │
│   ┌────────┐ ┌────────┐ ┌────────┐    │  ❧ CHRONIQUES         │
│   │ carte  │ │ carte  │ │ carte  │    │   activité récente   │
│   └────────┘ └────────┘ └────────┘    │                      │
│   ▸ Archivés                          │                      │
└───────────────────────────────────────┴──────────────────────┘
```

- **Synthèse (topbar)** — le compte des états qui comptent + le nombre d'idées en attente.
- **À traiter** — la liste, en tête, de ce qui réclame *ta* main : cron en échec, PR à
  décider, question de Claude sur une issue. Si c'est vide, tout roule. « Examiner » ouvre le projet.
- **L'atelier** — une carte par projet actif. Filtres : Tous / À débloquer / En session /
  En attente / Calmes / En veille. **Clique une carte** pour n'ouvrir que ce projet.
- **Vue projet** — le détail d'un seul repo : ses lignes d'état, sa PR (avec merge), les
  dialogues avec Claude (un bloc par issue `claude` ouverte, chacun avec son champ de
  réponse), ses idées, ses chroniques, et les actions de cycle de vie.
- **Tâches de la flotte** — la lecture agrégée des **`BACKLOG.md` de tous les repos actifs**
  (les tâches cadrées, distinctes des idées du codex). Elle se charge **à la demande**
  (bouton « ⟳ Lire », ou premier tap sur l'onglet Tâches en mobile) pour ne pas consommer
  de quota à chaque relevé. Chaque item porte ses deux lanceurs : **⚡** (issue directe,
  pré-remplit la modale Demande) et **🌩** (session cloud avec la tâche et sa DoD dans le
  prompt). Un repo dont une session est déjà en cours est marqué 🔵 et son ⚡ est désactivé
  (anti-collision : 1 session à la fois par repo).
- **Codex des idées** — la boîte à idées priorisée (voir §5). Une idée **non cadrée** vit au
  codex ; une tâche **cadrée avec sa DoD** vit dans le `BACKLOG.md` du repo (vue Tâches).
- **Chroniques** — le fil de ce qui s'est passé (PRs, crons, sessions), par jour.
- **Sur téléphone** — les zones deviennent des onglets en bas (Atelier / Tâches / Codex /
  Chroniques) + un bouton ＋ central.

---

## 4. Les concepts

### Les quatre états
Chaque projet a un **état** calculé à chaque relevé, dans cet ordre de priorité :

| État | Couleur | Signifie |
|---|---|---|
| **À débloquer** | rouge | Cron en échec, checks de PR au rouge, ou issue sans nouvelles (ni PR, ni commentaire, ni session) depuis > 2 h |
| **En session** | bleu | Une session Claude tourne (ou une PR est en cours de vérification) |
| **En attente** | orange | Une PR attend ta décision, ou Claude attend ta réponse sur une issue |
| **Calme** | vert | Rien en cours |

C'est le pire état parmi ses signaux qui l'emporte : un projet avec un cron en échec **et**
une PR ouverte s'affiche « à débloquer ».

### Le cycle de vie
Distinct de l'état (qui est momentané), le **cycle de vie** dit ce que tu veux faire du projet.
Il est stocké dans le champ `statut` de `fleet.json`.

| Cycle | Ce que ça fait dans FleetView |
|---|---|
| **actif** | Projet normal, pleinement suivi. |
| **veille** | Dev en pause, mais le repo vit encore (ex. un cron quotidien). Carte grisée, **mais les erreurs remontent toujours** dans « À traiter ». Pour ce qui est fini ou en pause dont une panne doit être traitée. |
| **archivé** | « Ça ne m'intéresse plus. » Disparaît de l'atelier, des chroniques, des filtres. Rangé dans le tiroir **Archivés**, réactivable d'un clic. |

(Le statut `gelé` hérité du registre est traité comme *archivé*.)

### Le codex : une salle d'attente, pas un deuxième stock
Le codex n'est **pas** une liste de tâches — c'est la **salle d'attente** des idées jetées en
vrac (même dictées au micro), le temps qu'elles soient **cadrées**. La liste des tâches, c'est
les `BACKLOG.md` des repos (vue **Tâches**). Le passage de l'une à l'autre est automatique :

- **Chaque matin** (et à la demande via **🪶 Cadrer**), le workflow `codex-cadrage.yml`
  (claude-ops, session Haiku) relit les idées en attente. Le cadrage **tranche par défaut** :
  une idée dont l'intention est claire devient un item `- [ ] (Px) titre — contexte/DoD 📱`
  dans le `BACKLOG.md` du projet visé (les détails manquants sont comblés par des hypothèses
  raisonnables, **notées dans l'item**), et son issue se ferme. Le cadrage n'implémente **jamais**.
- **La question est l'exception** : seulement si un choix change radicalement le résultat.
  Elle arrive alors **dans FleetView** — le codex l'affiche en tête, groupe « ⏳ À toi de
  répondre », avec **2 à 4 options cliquables** (dont une ⭐ recommandée), un bouton
  « 👍 Tranche toi-même » et un champ libre. Elle remonte aussi dans « À traiter » et en
  notification. Dès que tu réponds (un numéro suffit), **le cadrage repart tout seul**
  (déclencheur `issue_comment` côté claude-ops) — plus rien à recliquer.
- Pendant qu'il travaille, l'idée s'affiche « **🪶 Cadrage en route** » ; à la promotion,
  elle quitte le codex et sa tâche apparaît dans la vue **Tâches** (badge 📱).

Les priorités suivent l'idée jusqu'au backlog :
- **P1** — dès que possible · **P2** — quand j'en ai envie · **P3** — un jour peut-être.

Chaque idée est rattachée à un **projet** (ou à `flotte` = le repo méta claude-ops si elle
est transverse). Techniquement, une idée = une issue `idée` + label de priorité sur claude-ops.
**Tant qu'une idée attend, elle ne coûte rien** ; son cadrage coûte une courte session Haiku.

> ⚠️ Promouvoir vers un autre repo que claude-ops exige le secret **`FLEET_GH_TOKEN`** (PAT
> fine-grained, Contents R&W sur la flotte) posé sur claude-ops — sans lui, le cadrage le dit
> en commentaire au lieu d'échouer en silence.

---

## 5. Agir depuis l'interface (sans ouvrir GitHub)

C'est le cœur de FleetView : deux canaux, selon que le geste demande de l'intelligence ou non.

### Gestes simples — appel API direct, zéro token Claude, instantané
| Geste | Où | Ce qui se passe |
|---|---|---|
| **Merger une PR** | vue projet, bloc PR | `PUT /pulls/:n/merge` (squash) |
| **Relancer un run** | carte / vue projet, bouton « Relancer » | `POST …/runs/:id/rerun-failed-jobs` |
| **Mettre en veille / archiver / réactiver** | vue projet | écrit `statut` dans `fleet.json` |
| **Ranger / prioriser une idée** | codex | crée/ferme une issue `idée` |
| **Cadrer une idée (🪶)** | codex | déclenche `codex-cadrage.yml` sur claude-ops (la session Haiku tourne côté Actions) |

### Gestes intelligents — lancer une session Claude
Tu décris **quoi**, le système s'occupe du **comment**. Trois parcours, dans la modale « Demande » :

- **🌩 Session cloud (recommandé pour cadrer)** — ouvre une **session interactive claude.ai/code**.
  FleetView crée d'abord une **issue d'ancrage** (labellisée `cloud`, titre = la tâche), puis
  compose un prompt **court** — 1re ligne « `<repo> — <tâche>` », qui devient le titre de session
  dans claude.ai — et te propose « **Copier et ouvrir** » ; tu colles, et tu **discutes** avec
  Claude comme dans l'app desktop, jusqu'à la PR. Suivable depuis le téléphone, reprenable dans
  l'app desktop, sur ton abonnement. Le bouton **🌩** est aussi présent directement sur chaque
  **carte repo** et chaque **tâche** de la vue Tâches.
  L'ancrage est ce qui rend la session **visible** : le projet passe « en session » dans l'atelier,
  l'anti-collision la voit, et l'issue se ferme toute seule au merge (le prompt demande
  `Closes #N`). Depuis une **carte** (aucune tâche nommée), il n'y a rien à ancrer : la session
  s'ouvre directement, comme avant, pour que tu dictes la tâche sur place.
- **⚡ Issue directe (fire-and-forget)** — pour une demande déjà limpide : l'issue `claude` part
  telle quelle, une **session GitHub Actions** démarre seule, machine éteinte, et la PR revient
  dans l'interface. **Le modèle** est au choix : **Sonnet** (défaut), **Haiku** (mécanique, éco),
  **Opus**/**Fable** (gros chantier) — un label (`claude:haiku`…) que le workflow du kit traduit.
- **💡 Codex** — pas maintenant : range l'idée dans la boîte (avec sa priorité). Elle sera
  **cadrée puis promue au backlog** automatiquement (chaque matin, ou tout de suite via 🪶) ;
  le lancement se fait ensuite depuis la vue **Tâches** (⚡ ou 🌩) — jamais depuis une idée
  non cadrée.

**Interactif ou fire-and-forget ?** La session cloud est une **conversation** — le bon canal
quand il faut cadrer, préciser, répondre à des questions. L'issue directe est un **envoi sans
retour** — idéale pour un lot d'items déjà spécifiés qui avancent pendant que tu fais autre chose.
Les deux tournent sur ton **abonnement**, pas sur des crédits API.

> ⚠️ Un item **gros ou ambigu** ne part pas en issue directe : une session Actions plafonnée en
> tours échoue sans PR (vécu). Passe par la **session cloud** (🌩) ou, sur l'ordinateur, par la
> skill **`/backlog <repo> <n°>`** de claude-ops qui traite l'item dans ta session locale.

**Et depuis l'ordinateur ?** Les mêmes tâches sont accessibles dans une session Claude Code
locale avec la skill **`/backlog`** (vue agrégée de toute la flotte), `/backlog <repo> <n°>`
(traiter l'item **dans la session courante**, en dialoguant) ou `/backlog <repo> <n°> cloud`
(l'envoyer en issue). FleetView et `/backlog` lisent les **mêmes `BACKLOG.md`** : une seule
liste, deux surfaces.

> 💰 **Sur une issue directe : 1 commentaire = 1 lot** — pour les **retours de relecture** :
> chaque commentaire `@claude` relance une session Actions complète (re-clone + relecture du
> fil), donc groupe tes remarques. En revanche, **répondre à une question posée par la session**
> (boutons d'options du fil) est le fonctionnement normal — un clic, une relance, aucun scrupule
> à avoir. Pour de la vraie discussion, préfère la **session cloud** (🌩).

### Le cycle complet d'une demande
```
Session cloud (interactif) :
   Toi : 🌩 sur une tâche ─▶ issue d'ancrage `cloud` créée, prompt court copié, claude.ai/code s'ouvre
     │                        (le projet passe « en session » dans l'atelier)
   Toi ⇄ Claude : vous cadrez et discutez dans la session (mobile ou desktop)
     │
   Claude : branche, vérifie, ouvre la PR (`Closes #N`) ─▶ le projet passe « à décider »
     │
   Toi : tu merges ─▶ l'issue d'ancrage se ferme toute seule

Issue directe (fire-and-forget) :
   Toi : ⚡ "améliore X" ─▶ issue claude ─▶ session Actions ─▶ PR ─▶ ✓ Merger

Idée du codex :
   Toi : 💡 idée en vrac ─▶ cadrage auto (chaque matin, ou 🪶) ─▶ item 📱 au BACKLOG.md du projet
     │        (vraiment ambiguë : question à options DANS le codex → tu cliques une option
     │         → le cadrage repart tout seul → promue)
   Toi : ⚡ ou 🌩 depuis la vue Tâches, quand tu décides de la lancer
```

> 💬 **Quand une session te pose une question** (issue directe), elle propose désormais
> **2 à 4 options numérotées + sa recommandation** (convention demandée dans le corps de
> l'issue) : FleetView les affiche en **boutons** dans le fil — un clic répond ; « 👍 Fais
> au mieux » est toujours là si tu ne veux pas trancher.

---

## 6. Créer un nouveau projet

Bouton **⚒ Nouveau projet** (ou le lien dans la modale Demande). Tu donnes un nom, un type
(static, service-node, cron-python…) et une visibilité. FleetView :

1. crée le repo (`POST /user/repos`),
2. y copie les fichiers du kit `fleet-kit` (workflows `claude`/`map`/`pages`, `CLAUDE.md`,
   `BACKLOG.md`, allowlist `.claude/settings.json`, `.kit-version`…),
3. pose le label `claude`,
4. ouvre une **issue de finition** listant les gestes manuels restants.

Le projet apparaît alors dans l'atelier au relevé suivant. **À finir à la main une fois**
(l'issue le rappelle) : poser le secret `CLAUDE_CODE_OAUTH_TOKEN`, activer « Actions peut créer
des PRs », et rafraîchir le registre (`node scripts/fleet.mjs` sur claude-ops).

> C'est l'équivalent, depuis l'interface, de la commande `/nouveau-projet` de claude-ops.

---

## 7. Notifications

Trois étages, du plus simple au plus complet. **Le canal recommandé est le veilleur (étage 3)**
— app fermée, toute la flotte, gratuit ; les étages 1 et 2 deviennent superflus (et redondants)
quand il est actif :

1. **Notifications de l'appareil** (⚙ → « Activer sur cet appareil ») — FleetView notifie
   directement quand une action t'attend : question de Claude, PR prête, question du cadrage.
   Le clic ouvre le bon endroit. **Limite** : ça ne marche que tant que l'onglet FleetView
   est ouvert **et visible** (le relevé se met en pause en arrière-plan) — une page web
   fermée ou cachée ne surveille pas.
2. **ntfy depuis l'app** (⚙ → champ URL) — pareil, mais livré via l'app ntfy. Même limite.
3. **Le veilleur de la flotte** — pour être notifié **même app fermée** : un cron GitHub
   Actions de CE repo (`veilleur.yml`, toutes les 15 min, gratuit car repo public) surveille
   la flotte côté serveur et pousse sur ntfy. Activation en 2 minutes, sans terminal :
   - pose deux secrets sur `fleetview` (Settings → Secrets and variables → Actions) :
     **`FLEET_GH_TOKEN`** (PAT fine-grained : Contents+Issues+Pull requests+Actions en lecture
     sur la flotte — celui de claude-ops convient) et **`NTFY_TOPIC`** (le nom de ton sujet
     ntfy secret, le même que côté claude-ops) ;
   - abonne l'app ntfy de ton téléphone à ce sujet ;
   - c'est tout — sans les secrets, le cron sort immédiatement sans rien faire.

   > Si le veilleur est actif, laisse le champ ntfy de l'étage 2 **vide** : sinon chaque
   > événement arrive en double (une fois par l'app ouverte, une fois par le veilleur).

---

## 8. Thèmes

Six thèmes, au sélecteur en haut à droite, mémorisés par navigateur :

**De Vinci** (défaut, parchemin/sanguine, grain de papier) · **Clair** · **Sombre** ·
**Océan** (bleu profond) · **Forêt** (vert) · **Montagnes** (bleu alpin clair).

Le thème De Vinci utilise un corps de texte en serif (Fraunces) et un léger grain ; les cinq
autres passent en sans-serif net (IBM Plex Sans) sans grain. Les identifiants de repos, chiffres
et étiquettes sont toujours en mono (IBM Plex Mono).

---

## 9. Sur téléphone

FleetView est une **PWA** : ouvre l'URL (GitHub Pages, une fois le repo public), puis
« Ajouter à l'écran d'accueil ». Elle s'ouvre en plein écran comme une app, avec la barre
d'onglets basse. Le token se saisit une fois par appareil.

> Tant que le repo est **privé**, il n'y a pas de version en ligne (Pages gratuit = repo public).
> On l'utilise alors en local. Passer en public n'expose **que l'outil**, jamais tes données (§10).

---

## 10. Sécurité & vie privée

- **Aucune donnée de la flotte n'est dans le code.** États, PRs, noms de repos réels : tout
  est récupéré à l'exécution via l'API, avec ton token. Le code source ne contient que la
  logique + des données de démo **fictives**.
- **Le token ne quitte pas ton navigateur** (`localStorage`), et ne parle qu'à `api.github.com`.
- **Rendre le repo public** met en ligne l'outil, pas tes projets. Un tiers qui l'ouvrirait
  verrait une page vierge tant qu'il n'a pas *son* token et *sa* propre flotte équipée du kit.
- **Ne jamais commiter** de token, d'URL ntfy/Healthchecks ni de donnée privée dans ce repo
  (rappel dans `CLAUDE.md`).

---

## 11. Coût & limites

- **Interface : 0 €.** GitHub Pages (gratuit) + API GitHub. Un relevé consomme ~25 requêtes
  sur une limite de 5 000/h — très large. Les *gestes simples* ne coûtent rien.
- Les **sessions lancées** (🌩 comme ⚡) tournent sur ton **abonnement Claude** (token OAuth),
  exactement comme via `/dispatch` — pas de crédits API. Ce qu'elles consomment, c'est la
  limite d'usage de l'abonnement, d'où le routage de modèles (Haiku pour le mécanique).
- **Rate limit** : si tu dépasses (peu probable), le relevé échoue proprement avec un bandeau
  et réessaie au cycle suivant. Le relevé auto tourne toutes les 2 min quand l'onglet est ouvert.
- **Hors-ligne** : le service worker (`sw.js`) pré-cache la coquille (HTML/CSS/JS/icônes) et
  réaffiche le dernier relevé avec un bandeau « hors ligne » — l'API GitHub, elle, n'est jamais
  mise en cache. Les polices viennent de Google Fonts (mises en cache après le premier chargement) ;
  hors-ligne, le fallback système prend le relais.

---

## 12. Architecture (pour développer)

Trois fichiers, aucune dépendance JS, aucun build.

| Fichier | Rôle |
|---|---|
| `index.html` | Coquille : topbar, écran config, atelier, vue projet, codex, chroniques, modales, barre mobile. |
| `styles.css` | Tout le style. Thèmes = variables CSS sur `html[data-fv-theme="…"]`. Mobile ≤ 900 px. |
| `app.js` | Tout le comportement. Sections balisées : *stockage · utilitaires · API (`gh()`) · chargement (`loadAll`→`buildModel`) · démo · rendus (`render*`) · actions · événements · init*. |

**Flux de données :**
1. `loadAll()` lit `fleet.json` + recherches d'issues `claude`/`idée` + PRs + runs Actions +
   commentaires, en parallèle (API GitHub, token du `localStorage`).
2. `buildModel()` normalise tout en `{ repos[], ideas[], attention[], feed[] }` avec l'état
   calculé en cascade par projet.
3. Les `render*()` transforment le modèle en HTML.
4. Une action (créer une issue, merger, `PUT fleet.json`, relancer un run) appelle l'API puis
   `refresh()` recharge le modèle.

**Points d'entrée fréquents :**

| Besoin | Où |
|---|---|
| Changer le calcul d'un état | `buildModel()` dans `app.js` |
| Ajouter/modifier une action | le `switch(b.dataset.act)` du gestionnaire de clic + la fonction d'écriture concernée (`createRequest()`, `mergePr()`, `setLifecycle()`, `rerunRun()`…) |
| Nouveau thème | un bloc `html[data-fv-theme="nom"]{ … }` dans `styles.css` + une `<option>` |
| Lanceur de session cloud | `createCloudIssue()` (ancrage, label `cloud` seul) + `composeCloudPrompt()` + `launchCloudAnchored()` — crée l'issue, compose le prompt court, relaie par la modale « Copier et ouvrir » |
| Issue directe (Actions) | `createRequest()` + `directBody()` + le déclencheur `@claude` du workflow du kit |
| Questions à options (boutons) | `parseOptions()` (convention `**Options :**` + `**Recommandation :**`) + les handlers `data-qr`/`data-iqr` |
| Veilleur (notifs app fermée) | `scripts/veilleur.mjs` + `.github/workflows/veilleur.yml` (cron 15 min, secrets `FLEET_GH_TOKEN` + `NTFY_TOPIC`) |
| État d'URL (?repo/?tab/?idea) | `syncUrl()` + `readDeepLink()` — recharger laisse sur place, les notifs pointent au bon endroit |

**Pièges** : la liste de référence vit dans [`CLAUDE.md`](../CLAUDE.md) (et la carte `MAP.md`) —
un seul domicile, pas de copie ici qui finirait par diverger.

---

## 13. Dépannage

| Symptôme | Piste |
|---|---|
| Écran de config qui revient / bandeau « token refusé » | Token expiré ou permissions insuffisantes — recrée-le avec les 6 permissions du §2. |
| Un projet n'apparaît pas | Absent de `fleet.json` : lance `node scripts/fleet.mjs` sur claude-ops. |
| « Lancer » ne déclenche rien côté GitHub | Le repo cible n'a pas le workflow `claude.yml`, ou le secret `CLAUDE_CODE_OAUTH_TOKEN` manque, ou « Actions crée des PRs » est désactivé. |
| Le dialogue d'une issue directe reste vide | La session Actions n'a pas encore commenté — patiente un cycle de relevé (~1-2 min) ou vérifie le run Actions. |
| Une idée reste bloquée « à préciser » | Sa question est affichée dans le codex (groupe « ⏳ À toi de répondre ») : clique une option ou réponds — le cadrage repart tout seul. |
| Pas de notification quand l'app est fermée | C'est le rôle du **veilleur** (§7) : vérifie que les secrets `FLEET_GH_TOKEN` et `NTFY_TOPIC` sont posés sur fleetview et que le cron `veilleur.yml` est vert. |
| Le bouton 🌩 n'ouvre pas de session | Le prompt est copié mais le navigateur bloque les pop-ups : autorise-les, ou va sur claude.ai/code et colle (Ctrl/Cmd+V). Si la copie a échoué, une fenêtre affiche le prompt à copier à la main. |
| Polices « fades » au premier affichage | Google Fonts pas encore chargé (réseau lent) ; le fallback s'affiche puis bascule. |

---

## 14. Feuille de route

Le gros du confort est déjà livré (service worker + cache hors-ligne, icônes PWA PNG maskable,
journal de run en direct, secret Claude au bootstrap, quota API, notifications ntfy/natives,
lanceur de session cloud). Ce qui reste, dans le [BACKLOG](../BACKLOG.md) :

- **Registre rafraîchissable depuis l'interface** — un bouton « Rafraîchir le registre » + un
  déclenchement automatique en fin de « Nouveau projet » (via un workflow `fleet-refresh.yml` côté
  claude-ops), pour qu'un projet créé apparaisse dans l'atelier sans passer par un terminal.

Convention du repo : 1 item = 1 session = 1 PR ; vérifier avec `node scripts/verify.mjs` avant
de conclure ; commits en français, branche + PR (jamais de push direct sur `main`).
