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

server.listen(PORT, async () => {
  try {
    const res = await fetch(`http://localhost:${PORT}/`);
    if (!res.ok) return fail(`page d'accueil HTTP ${res.status}`);
    const html = await res.text();
    if (!html.toLowerCase().includes("<html")) return fail("la réponse ne ressemble pas à du HTML");
    server.close();
    console.log("VERIFY OK : le site démarre et répond.");
    process.exit(0);
  } catch (e) {
    fail(`pas de réponse : ${e.message}`);
  }
});
