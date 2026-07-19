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
async function checkCloudPrompt() {
  const src = await readFile(join(ROOT, "app.js"), "utf8");
  const start = src.indexOf("function composeCloudPrompt(");
  if (start === -1) return "composeCloudPrompt() introuvable dans app.js";
  // Le corps commence APRÈS la liste de paramètres — qui contient elle-même des accolades
  // (destructuration `{repo, title, …}`) : compter depuis la 1re accolade partirait de là.
  let paren = 0, bodyStart = -1;
  for (let i = src.indexOf("(", start); i < src.length; i++) {
    if (src[i] === "(") paren++;
    else if (src[i] === ")" && --paren === 0) { bodyStart = src.indexOf("{", i); break; }
  }
  if (bodyStart === -1) return "composeCloudPrompt() : signature illisible";
  let depth = 0, end = -1;
  for (let i = bodyStart; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) { end = i + 1; break; }
  }
  if (end === -1) return "composeCloudPrompt() : accolades non appariées";

  let compose;
  try {
    compose = new Function("OWNER", "META", "model",
      `${src.slice(start, end)}; return composeCloudPrompt;`)("Thibaud888", "claude-ops", null);
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

server.listen(PORT, async () => {
  try {
    const res = await fetch(`http://localhost:${PORT}/`);
    if (!res.ok) return fail(`page d'accueil HTTP ${res.status}`);
    const html = await res.text();
    if (!html.toLowerCase().includes("<html")) return fail("la réponse ne ressemble pas à du HTML");
    const bad = await checkCloudPrompt();
    if (bad) return fail(`prompt de session cloud — ${bad}`);
    server.close();
    console.log("VERIFY OK : le site démarre et répond, contrat du prompt cloud respecté.");
    process.exit(0);
  } catch (e) {
    fail(`pas de réponse : ${e.message}`);
  }
});
