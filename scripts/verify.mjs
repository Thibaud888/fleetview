#!/usr/bin/env node
// Vérification minimale d'un site statique : le serveur démarre et la page d'accueil répond.
// Usage : node scripts/verify.mjs  (la session Claude doit le lancer avant de conclure)
//
// Serveur HTTP natif (zéro dépendance, aucun téléchargement) : démarrage instantané et arrêt
// propre. On ne lance plus `npx serve` en sous-processus — ce qui, avec `shell:true`, laissait
// l'arbre `npx → node serve` orphelin en CI (server.kill() ne tuait que le shell parent) et
// imposait le retéléchargement du paquet à chaque run. Ici tout vit dans ce process.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { estPrDeSession, seuilFranchiDans, synthetiseChecks } from "./rade.mjs";

const PORT = Number(process.env.VERIFY_PORT ?? 4000);
const ROOT = process.cwd();
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
};

// Sert les fichiers de ROOT ; « / » → index.html. On empêche de sortir de ROOT (path traversal).
const server = createServer(async (req, res) => {
  const path = decodeURIComponent((req.url || "/").split("?")[0]);
  const rel = normalize(path === "/" ? "/index.html" : path).replace(/^(\.\.[/\\])+/, "");
  const file = join(ROOT, rel);
  if (!file.startsWith(ROOT)) { res.statusCode = 403; return res.end("forbidden"); }
  try {
    const body = await readFile(file);
    res.setHeader("content-type", TYPES[extname(file)] ?? "application/octet-stream");
    res.end(body);
  } catch {
    res.statusCode = 404;
    res.end("not found");
  }
});

const fail = (msg) => {
  server.close();
  console.error(`VERIFY ÉCHEC : ${msg}`);
  process.exit(1);
};

server.on("error", (e) => fail(`le serveur n'a pas démarré : ${e.message}`));

// Contrat du prompt de session cloud. `app.js` est enveloppé dans une IIFE (rien n'est exposé),
// et le geste 🌩 ne se rejoue pas sans token : on découpe donc la fonction de sa source pour la
// tester isolément. Ses seules dépendances externes sont OWNER, META et `model`, qu'on injecte.
// Ce qui est verrouillé ici : la 1re ligne « <repo> — <tâche> » (= titre de session dans
// claude.ai), la brièveté (les règles de flotte vivent dans le CLAUDE.md du repo, plus dans le
// prompt), et le « Closes #N » qui ferme l'issue d'ancrage au merge.
// Découpe une déclaration `function <name>(...){...}` de son source. app.js est une IIFE
// fermée (rien n'est exporté) : on teste ses fonctions pures en les ré-évaluant isolément.
// 3e usage (composeCloudPrompt, parseBacklog, micFinals/micJoin) → factorisé (règle de flotte :
// 3e récurrence = un utilitaire). Gère les accolades de la liste de paramètres (destructuration
// `{repo, title, …}`), d'où le comptage des parenthèses avant de chercher le corps.
function sliceFn(src, name) {
  const start = src.indexOf(`function ${name}(`);
  if (start === -1) return null;
  let paren = 0, bodyStart = -1;
  for (let i = src.indexOf("(", start); i < src.length; i++) {
    if (src[i] === "(") paren++;
    else if (src[i] === ")" && --paren === 0) { bodyStart = src.indexOf("{", i); break; }
  }
  if (bodyStart === -1) return null;
  let depth = 0;
  for (let i = bodyStart; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(start, i + 1);
  }
  return null;
}

async function checkCloudPrompt() {
  const src = await readFile(join(ROOT, "app.js"), "utf8");
  const body = sliceFn(src, "composeCloudPrompt");
  if (!body) return "composeCloudPrompt() introuvable / illisible dans app.js";
  let compose;
  try {
    compose = new Function("OWNER", "META", "model",
      `${body}; return composeCloudPrompt;`)("Thibaud888", "claude-ops", null);
  } catch (e) { return `composeCloudPrompt() ne s'évalue pas : ${e.message}`; }

  const ancre = compose({ repo: "bulletins-viz", title: "Moyennes par trimestre", issue: 42 });
  if (!ancre.startsWith("bulletins-viz — Moyennes par trimestre\n"))
    return `1re ligne attendue « <repo> — <tâche> », obtenu : ${JSON.stringify(ancre.split("\n")[0])}`;
  if (!ancre.includes("Closes #42"))
    return "le prompt ancré ne demande pas « Closes #42 » — l'issue ne se fermerait pas au merge";
  if (ancre.split("\n").filter((l) => l.trim()).length > 4)
    return "le prompt ancré doit rester court (≤ 4 lignes non vides)";

  // Sans issue (ancrage impossible) : pas de « Closes » fantôme.
  if (compose({ repo: "bulletins-viz", title: "T" }).includes("Closes"))
    return "prompt sans ancrage : « Closes » ne doit pas apparaître sans numéro d'issue";

  // `flotte` est un alias du repo méta — le prompt doit nommer le vrai repo.
  if (!compose({ repo: "flotte", title: "Revue", issue: 7 }).startsWith("claude-ops — Revue"))
    return "le pseudo-repo « flotte » doit se résoudre en claude-ops";

  // Sans tâche (🌩 depuis une carte) : session de cadrage, aucun ancrage donc aucun « Closes ».
  const nu = compose({ repo: "bulletins-viz" });
  if (!nu.startsWith("bulletins-viz — ") || nu.includes("Closes"))
    return "prompt sans tâche : 1re ligne « <repo> — … » et pas de « Closes »";
  return null;
}

// Contrat du découpage BACKLOG.md → tâches. Extrait de la source comme ci-dessus (app.js est une
// IIFE fermée). Ce qui est verrouillé : la version cadrée d'une tâche (le développé après le
// tiret, ou le corps entier à défaut de tiret) atterrit TOUJOURS dans title+desc — sinon le
// prompt de session cloud repart « éclaté », sans le contexte spécifique de la tâche.
async function checkParseBacklog() {
  const src = await readFile(join(ROOT, "app.js"), "utf8");
  const body = sliceFn(src, "parseBacklog");
  if (!body) return "parseBacklog() introuvable / illisible dans app.js";
  let parse;
  try {
    parse = new Function(`${body}; return parseBacklog;`)();
  } catch (e) { return `parseBacklog() ne s'évalue pas : ${e.message}`; }

  // Tâche cadrée avec tiret cadratin : titre court + développé complet séparés.
  const [a] = parse("- [ ] Faire X — DoD : X marche et verify passe.");
  if (a.title !== "Faire X" || !a.desc.includes("DoD : X marche"))
    return `séparateur « — » : titre/développé mal coupés (${JSON.stringify(a)})`;

  // Tâche cadrée SANS tiret et trop longue pour tenir en titre : le développé NE DOIT PAS être
  // perdu — c'était le bug (le corps passait à la trappe, le prompt sortait sans contexte).
  const long = "Ajouter un mode révision espacé : rejouer les capitales déjà vues selon un "
    + "intervalle croissant (1j, 3j, 7j), stocker la progression en localStorage. DoD : verify passe.";
  const [b] = parse(`- [ ] ${long}`);
  if (!b.desc || !b.desc.includes("DoD : verify passe"))
    return "tâche longue sans tiret : le développé est perdu (prompt cloud sans contexte)";
  if (b.title.length > 130) return "tâche longue sans tiret : le titre n'est pas resserré";

  // Développé sur des sous-lignes indentées : agrégé, pas jeté.
  const [c] = parse("- [ ] Refonte du codex\n  - DoD : les idées se rangent par priorité\n  - Contexte : suite audit UX");
  if (!c.desc.includes("les idées se rangent") || !c.desc.includes("Contexte"))
    return "développé multi-ligne (sous-puces) non agrégé";

  // 📱 = promue du codex : drapeau posé, marqueur retiré du texte.
  const [d] = parse("- [ ] Miniatures auto — DoD : 3 shorts. 📱");
  if (!d.codex || /📱/u.test(d.title + d.desc))
    return "marqueur 📱 : drapeau codex non posé ou marqueur laissé dans le texte";

  // Seuls les items ouverts comptent (les `- [x]` cochés sont hors backlog vivant).
  if (parse("- [x] Déjà fait — rien à lancer").length !== 0)
    return "un item coché `- [x]` ne doit pas remonter comme tâche ouverte";
  return null;
}

// Contrat de l'anti-répétition du micro (issue #59). micFinals()/micJoin() sont les fonctions
// PURES au cœur de la dictée : recomposer le texte finalisé à chaque événement au lieu de
// l'accumuler. On simule ici le bug Android — un même segment final ré-émis / allongé sur
// plusieurs événements ne doit JAMAIS se dupliquer en cascade (« quand quand quand… »).
async function checkMic() {
  const src = await readFile(join(ROOT, "app.js"), "utf8");
  const j = sliceFn(src, "micJoin"), f = sliceFn(src, "micFinals");
  if (!j || !f) return "micJoin()/micFinals() introuvables dans app.js";
  let micJoin, micFinals;
  try {
    ({ micJoin, micFinals } = new Function(`${j}; ${f}; return {micJoin, micFinals};`)());
  } catch (e) { return `micJoin/micFinals ne s'évaluent pas : ${e.message}`; }
  const R = (t, isFinal = true) => ({ isFinal, 0: { transcript: t } });

  // Segment final ré-émis puis allongé au fil des événements : on recompose à chaque fois,
  // donc pas d'accumulation. C'était la cascade « le / le micro / le micro de… ».
  const seq = [[R("quand")], [R("quand j'enregistre")], [R("quand j'enregistre à Paris")]];
  let val = "";
  for (const results of seq) val = micJoin("", micFinals(results));
  if (val !== "quand j'enregistre à Paris")
    return `répétition micro : attendu « quand j'enregistre à Paris », obtenu ${JSON.stringify(val)}`;

  // Plusieurs segments finaux distincts : joints par une espace, chacun une fois.
  if (micFinals([R("bonjour"), R("le monde")]) !== "bonjour le monde")
    return "segments finaux multiples mal recomposés";
  // L'interim (non final) n'entre pas dans le texte acquis.
  if (micFinals([R("salut"), R("comm", false)]) !== "salut")
    return "micFinals ne doit garder que le finalisé (l'interim reste en aperçu)";
  // Commit inter-runs : Chrome relance de lui-même ; le texte des runs précédents est
  // préservé (dans `committed`) sans être rejoué par le run suivant.
  const committed = micJoin("", micFinals([R("bonjour le monde")]));
  if (micJoin(committed, micFinals([R("comment ça va")])) !== "bonjour le monde comment ça va")
    return "commit inter-runs : le texte des runs précédents doit être gardé sans doublon";
  // Le contenu déjà présent dans le champ est préservé.
  if (micJoin("Déjà là", micFinals([R("ajout")])) !== "Déjà là ajout")
    return "le texte déjà saisi dans le champ doit être préservé";
  return null;
}

// Contrat du titre auto-résumé (issue point 11 : titre optionnel, résumé depuis la description).
// summarizeTitle() est PURE : 1re phrase courte ou amorce coupée sur une frontière de mot,
// capitalisée, sans ponctuation finale. Ce qui est verrouillé : jamais de mot tronqué en plein,
// une amorce lisible, et le cas vide → vide (on retombe alors sur la validation « écris qqch »).
async function checkTitle() {
  const src = await readFile(join(ROOT, "app.js"), "utf8");
  const body = sliceFn(src, "summarizeTitle");
  if (!body) return "summarizeTitle() introuvable / illisible dans app.js";
  let f;
  try { f = new Function(`${body}; return summarizeTitle;`)(); }
  catch (e) { return `summarizeTitle() ne s'évalue pas : ${e.message}`; }

  if (f("") !== "" || f("   ") !== "") return "description vide → titre vide attendu";
  if (f("Ajouter un bouton export PDF. Puis tester l'impression.") !== "Ajouter un bouton export PDF")
    return `1re phrase mal extraite : ${JSON.stringify(f("Ajouter un bouton export PDF. Puis tester l'impression."))}`;
  if (f("corriger l'affichage mobile") !== "Corriger l'affichage mobile")
    return "la 1re lettre doit être capitalisée";
  if (f("Régler le bug.") !== "Régler le bug")
    return "ponctuation finale non retirée sur une phrase courte";

  // Longue amorce sans terminateur : coupée sur une frontière de mot, finie par …, jamais en plein mot.
  const srcLong = "rejouer les capitales déjà vues selon un intervalle croissant de un puis trois puis sept jours en stockant la progression";
  const long = f(srcLong);
  if (!long.endsWith("…")) return "titre long : doit se terminer par …";
  if (long.length > 72) return "titre long : pas assez resserré (" + long.length + ")";
  const stem = long.slice(0, -1); // sans le …
  const norm = srcLong.charAt(0).toUpperCase() + srcLong.slice(1);
  if (!norm.startsWith(stem)) return "titre long : l'amorce n'est pas un préfixe des détails";
  if (norm[stem.length] !== " ") return "titre long : coupe en plein mot (pas sur une frontière)";

  // 1re phrase trop longue pour tenir : on ne la prend pas telle quelle, on retombe sur la coupe.
  const bigSentence = "Une première phrase délibérément interminable qui dépasse largement les quatre-vingts caractères autorisés pour un titre.";
  if (!f(bigSentence).endsWith("…")) return "1re phrase > 80 car. : doit retomber sur la coupe (…)";
  return null;
}

// Contrat de scripts/rade.mjs (dispatch en rade, veilleur.mjs) — module pur, import direct
// possible (contrairement à app.js, IIFE de navigateur). Verrouille ce qui distingue une PR de
// session d'une PR de travail courant, et le franchissement de seuil en un seul passage
// (le veilleur est sans état : notifier deux fois le même rade serait aussi faux que jamais).
function checkRade() {
  if (synthetiseChecks([]) !== "aucun") return "synthetiseChecks([]) doit être « aucun » (repo sans CI)";
  if (synthetiseChecks([{ status: "in_progress" }]) !== "en_cours")
    return "un check non terminé doit donner « en_cours »";
  if (synthetiseChecks([{ status: "completed", conclusion: "success" }]) !== "verts")
    return "tous les checks au vert doit donner « verts »";
  if (synthetiseChecks([{ status: "completed", conclusion: "success" },
      { status: "completed", conclusion: "cancelled" }]) !== "rouges")
    return "un check annulé parmi les autres doit donner « rouges » (même règle que loadAll() côté app)";

  // Branche `claude/issue-<n>` : signature du dispatch, peu importe l'auteur.
  if (!estPrDeSession("claude/issue-42", "quelqu-un"))
    return "estPrDeSession() doit reconnaître claude/issue-<n> quel que soit l'auteur";
  // Bot Actions sur une branche claude/* : dispatch aussi (poussée par le workflow, pas à la main).
  if (!estPrDeSession("claude/autre-nom", "github-actions[bot]"))
    return "estPrDeSession() doit reconnaître une branche claude/* poussée par un bot";
  // Branche claude/* poussée à la main par Thibaud : session locale, PAS un dispatch en rade.
  if (estPrDeSession("claude/brief-abonnement", "Thibaud888"))
    return "estPrDeSession() ne doit PAS classer une branche claude/* humaine comme un dispatch";

  const H = 3_600_000;
  const t0 = 10 * H; // horloge arbitraire, seules les différences comptent
  // Créé à t0, seuil 1h : franchi à t0+1h — dans une fenêtre qui l'entoure, pas avant/après.
  const created = new Date(t0).toISOString();
  if (!seuilFranchiDans(created, 1, t0 + 0.5 * H, t0 + 1.5 * H))
    return "seuilFranchiDans() doit détecter un franchissement dans sa fenêtre";
  if (seuilFranchiDans(created, 1, t0 + 1.6 * H, t0 + 2 * H))
    return "seuilFranchiDans() ne doit PAS re-déclencher une fenêtre après le franchissement (sinon le veilleur, sans état, notifierait le même rade à chaque cron)";
  if (seuilFranchiDans(created, 1, t0, t0 + 0.9 * H))
    return "seuilFranchiDans() ne doit rien détecter avant que le seuil ne soit atteint";
  return null;
}

server.listen(PORT, async () => {
  try {
    const res = await fetch(`http://localhost:${PORT}/`);
    if (!res.ok) return fail(`page d'accueil HTTP ${res.status}`);
    const html = await res.text();
    if (!html.toLowerCase().includes("<html")) return fail("la réponse ne ressemble pas à du HTML");
    const bad = await checkCloudPrompt();
    if (bad) return fail(`prompt de session cloud — ${bad}`);
    const badParse = await checkParseBacklog();
    if (badParse) return fail(`découpage BACKLOG.md — ${badParse}`);
    const badMic = await checkMic();
    if (badMic) return fail(`anti-répétition du micro — ${badMic}`);
    const badTitle = await checkTitle();
    if (badTitle) return fail(`titre auto-résumé — ${badTitle}`);
    const badRade = checkRade();
    if (badRade) return fail(`dispatch en rade (scripts/rade.mjs) — ${badRade}`);
    server.close();
    console.log("VERIFY OK : le site démarre et répond, contrat du prompt cloud respecté.");
    process.exit(0);
  } catch (e) {
    fail(`pas de réponse : ${e.message}`);
  }
});
