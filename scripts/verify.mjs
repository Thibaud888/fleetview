#!/usr/bin/env node
// Vérification minimale d'un site statique : le serveur démarre et la page d'accueil répond.
// Usage : node scripts/verify.mjs  (la session Claude doit le lancer avant de conclure)
import { spawn } from "node:child_process";

const PORT = process.env.VERIFY_PORT ?? 4000;
const DEADLINE_MS = 30_000; // large : au premier run, npx doit télécharger `serve`
const server = spawn(`npx -y serve -l ${PORT} .`, {
  stdio: "ignore",
  shell: true,
});

const fail = (msg) => {
  server.kill();
  console.error(`VERIFY ÉCHEC : ${msg}`);
  process.exit(1);
};

const t0 = Date.now();
const tryFetch = async () => {
  try {
    const res = await fetch(`http://localhost:${PORT}/`);
    if (!res.ok) return fail(`page d'accueil HTTP ${res.status}`);
    const html = await res.text();
    if (!html.toLowerCase().includes("<html")) return fail("la réponse ne ressemble pas à du HTML");
    server.kill();
    console.log("VERIFY OK : le site démarre et répond.");
    process.exit(0);
  } catch {
    if (Date.now() - t0 > DEADLINE_MS) return fail(`pas de réponse après ${DEADLINE_MS / 1000} s`);
    setTimeout(tryFetch, 1000); // le serveur n'écoute pas encore : on réessaie
  }
};
setTimeout(tryFetch, 1500);
