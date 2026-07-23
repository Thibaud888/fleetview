#!/usr/bin/env node
// Veilleur de la flotte — pousse une notification ntfy quand un événement actionnable
// APPARAÎT, même si FleetView est fermé. L'app ouverte-et-visible a ses notifications
// natives ; onglet en arrière-plan ou app fermée, personne ne surveillait : ce cron comble
// ce trou. Zéro dépendance.
//
// Tourne en GitHub Actions sur CE repo (public → minutes gratuites), toutes les 15 min
// (.github/workflows/veilleur.yml). SANS ÉTAT stocké : la fenêtre va du début du précédent
// run TERMINÉ (−2 min de recouvrement) à maintenant — l'historique Actions sert d'état.
// « Terminé » et pas « réussi » : après une panne ntfy (runs en échec), se caler sur le
// dernier succès re-notifierait toute la panne à chaque cron.
//
// Secrets requis (Settings → Secrets and variables → Actions du repo fleetview) :
//   FLEET_GH_TOKEN — PAT fine-grained : lecture Contents+Issues+Pull requests+Actions
//                    sur les repos de la flotte, et Contents sur claude-ops (fleet.json).
//   NTFY_TOPIC     — le nom du sujet ntfy secret (le même que côté claude-ops).
// Absents → sortie 0 silencieuse (le cron reste vert tant que tu n'as pas activé le veilleur).

import { estPrDeSession, seuilFranchiDans, synthetiseChecks } from "./rade.mjs";

const OWNER = "Thibaud888";
const META = "claude-ops";
const APP_URL = "https://thibaud888.github.io/fleetview/";
const WINDOW_MIN = Number(process.env.WINDOW_MIN ?? 20); // repli si pas d'historique
// Dispatchs en rade (cf. scripts/rade.mjs, miroir de claude-ops scripts/brief-rade.mjs) :
// issue sans PR/session au-delà de ce seuil, PR verte non mergée au-delà de ce seuil.
const RADE_SEUIL_H = 1;
const RADE_SEUIL_SANS_CI_H = 12; // repo sans CI : rien ne prouve la fin du travail, on laisse la nuit

const token = process.env.FLEET_GH_TOKEN;
const topic = process.env.NTFY_TOPIC;
if (!token || !topic) {
  console.log("Veilleur inactif : secrets FLEET_GH_TOKEN et/ou NTFY_TOPIC absents. Rien à faire.");
  process.exit(0);
}

let since = Date.now() - WINDOW_MIN * 60_000;
const inWindow = (iso) => iso && new Date(iso).getTime() >= since;
// Même frontière de confiance que l'app : seuls les bots ([bot] en suffixe — un login
// GitHub ne peut pas contenir de crochets) parlent au nom de Claude. Sur un repo public,
// le commentaire d'un tiers ne doit pas déclencher « Claude attend ta réponse ».
const isBot = (login) => /\[bot\]$/i.test(String(login || ""));
// Vraie question seulement (même règle que l'app) : bloc **Options :**, ou DERNIÈRE ligne
// non vide finissant par « ? » — un commentaire d'étape ou un rapport final de session
// ne doit pas pousser « Claude attend ta réponse ».
const asksQuestion = (body) => {
  const s = String(body || "");
  if (/\*\*Options\s*:?\s*\*\*/i.test(s)) return true;
  const lines = s.split(/\n/).map((l) => l.trim()).filter(Boolean);
  return lines.length > 0 && /\?$/.test(lines[lines.length - 1]);
};

async function gh(path) {
  const res = await fetch("https://api.github.com" + path, {
    headers: {
      Authorization: "Bearer " + token,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!res.ok) throw new Error(`GitHub ${res.status} sur ${path}`);
  return res.json();
}
// Dernier commentaire RÉEL d'une issue : l'API pagine en ordre ascendant — viser la
// dernière page via le compteur `comments`, sinon on relirait à jamais le 100e.
async function lastComment(repo, num, count) {
  const page = Math.max(1, Math.ceil(count / 100));
  const comments = await gh(`/repos/${OWNER}/${repo}/issues/${num}/comments?per_page=100&page=${page}`);
  return comments[comments.length - 1];
}

async function notify(ev) {
  // Métadonnées en query string, pas en en-têtes : fetch() n'accepte que du Latin-1 dans
  // les headers, et nos titres contiennent des tirets cadratins/accents (même leçon que
  // publishNtfy() côté app, cf. correctif « ntfy 405 » du lot 5).
  const q = new URLSearchParams({ title: ev.title, priority: "high",
    tags: ev.tag || "bell", click: ev.click || APP_URL });
  const res = await fetch(`https://ntfy.sh/${topic}?${q}`, { method: "POST", body: ev.msg });
  if (!res.ok) throw new Error(`ntfy ${res.status}`);
  console.log(`→ notifié : ${ev.title} — ${ev.msg}`);
}

const events = [];

// 0. Fenêtre : depuis le début du précédent run TERMINÉ de ce workflow (−2 min de
// recouvrement) — les crons GitHub dérivent (10 à 40 min aux heures chargées), une fenêtre
// fixe raterait le trou ; une fenêtre plancher systématique doublerait tout. Repli : WINDOW_MIN.
try {
  const prev = await gh(`/repos/${OWNER}/fleetview/actions/workflows/veilleur.yml/runs?status=completed&per_page=1`);
  const run = (prev.workflow_runs || [])[0];
  if (run) since = new Date(run.run_started_at || run.created_at).getTime() - 120_000;
} catch (e) { console.log(`(fenêtre par défaut ${WINDOW_MIN} min) ${e.message}`); }
console.log(`Fenêtre : depuis ${new Date(since).toISOString()}`);

// 1. Registre : les repos suivis (tout sauf archivés/gelés).
const ff = await gh(`/repos/${OWNER}/${META}/contents/fleet/fleet.json`);
const fleet = JSON.parse(Buffer.from(ff.content, "base64").toString("utf8")).repos || [];
const suivis = new Set(fleet
  .filter((r) => !["archivé", "archive", "gelé"].includes(String(r.statut || "").toLowerCase()))
  .map((r) => r.repo));

// 2. PRs ouvertes d'abord : servent aussi à taire les questions d'issues déjà couvertes
// par une PR (même règle que l'app : « la PR parle pour elle »).
const prsRes = await gh(`/search/issues?q=${encodeURIComponent(`user:${OWNER} is:pr is:open`)}&sort=updated&order=desc&per_page=100`);
const openPRs = (prsRes.items || []).map((p) => ({ ...p, repo: p.repository_url.split("/").pop() }));

for (const p of openPRs) {
  if (!suivis.has(p.repo)) continue;
  try {
    const d = await gh(`/repos/${OWNER}/${p.repo}/pulls/${p.number}`);
    const cr = await gh(`/repos/${OWNER}/${p.repo}/commits/${d.head.sha}/check-runs?per_page=30`);
    const runs = cr.check_runs || [];
    const checks = synthetiseChecks(runs);

    if (checks === "aucun") {
      // Pas de CI sur cette PR : l'app la classe quand même « attend ta décision » —
      // notifier à sa création, sinon le filet « app fermée » a un trou.
      if (inWindow(p.created_at)) {
        events.push({ title: `${p.repo} — PR #${p.number} attend ta décision`, msg: p.title,
          tag: "white_check_mark", click: `${APP_URL}?repo=${encodeURIComponent(p.repo)}` });
      }
    } else if (checks === "verts" || checks === "rouges") {
      const doneAt = Math.max(...runs.map((c) => new Date(c.completed_at || 0).getTime()));
      if (doneAt >= since) {
        // `cancelled` compte comme échec : même règle que l'app (checks.bad de loadAll) —
        // sinon le veilleur annonce « prête à merger » une PR que l'app affiche en échec.
        events.push(checks === "rouges"
          ? { title: `${p.repo} — tests de la PR #${p.number} en échec`, msg: p.title,
              tag: "x", click: `${APP_URL}?repo=${encodeURIComponent(p.repo)}` }
          : { title: `${p.repo} — PR #${p.number} prête à merger`, msg: p.title,
              tag: "white_check_mark", click: `${APP_URL}?repo=${encodeURIComponent(p.repo)}` });
      }
    }
    // checks === "en_cours" : rien à faire, on attend la fin.

    // Dispatch en rade (volet PR) : PR de session (checks verts, ou repo sans CI) toujours
    // ouverte bien après — le merge auto n'a pas eu lieu, le travail est fini mais pas livré.
    if (!d.draft && (checks === "verts" || checks === "aucun") && estPrDeSession(d.head.ref, d.user?.login)) {
      const seuil = checks === "verts" ? RADE_SEUIL_H : RADE_SEUIL_SANS_CI_H;
      if (seuilFranchiDans(p.created_at, seuil, since)) {
        events.push({ title: `${p.repo} — PR #${p.number} en rade`, msg: `${p.title} (prête depuis plus de ${seuil} h, pas mergée)`,
          tag: "warning", click: `${APP_URL}?repo=${encodeURIComponent(p.repo)}` });
      }
    }
  } catch (e) { console.log(`(ignoré) PR ${p.repo}#${p.number} : ${e.message}`); }
}

// 3. Questions de Claude sur les issues `claude` ouvertes : dernier commentaire d'un BOT,
// qui pose une VRAIE question, dans la fenêtre, et sans PR déjà ouverte pour cette issue.
const issuesRes = await gh(`/search/issues?q=${encodeURIComponent(`user:${OWNER} is:issue is:open label:claude`)}&sort=updated&order=desc&per_page=100`);
for (const is of issuesRes.items || []) {
  const repo = is.repository_url.split("/").pop();
  if (!suivis.has(repo) || !is.comments) continue;
  if (!inWindow(is.updated_at)) continue; // fil sans activité récente : inutile de payer la requête
  const linkedPR = openPRs.some((p) => p.repo === repo && new RegExp(`#${is.number}\\b`).test(p.body || ""));
  if (linkedPR) continue; // la PR parle pour elle (et a ses propres notifications)
  try {
    const last = await lastComment(repo, is.number, is.comments);
    if (last && isBot(last.user.login) && asksQuestion(last.body) && inWindow(last.created_at)) {
      events.push({ title: `${repo} — Claude attend ta réponse`, msg: is.title,
        tag: "speech_balloon", click: `${APP_URL}?repo=${encodeURIComponent(repo)}` });
    }
  } catch (e) { console.log(`(ignoré) commentaires ${repo}#${is.number} : ${e.message}`); }
}

// 3bis. Dispatch en rade (volet issue) : issue `claude` sans PR liée, sans session Actions
// active récente (< 3h : au-delà elle est coincée, pas vivante) — la session a échoué avant
// de pousser, ou n'a jamais démarré. Contrairement à la boucle précédente, on regarde TOUTES
// les issues (même sans commentaire : une session qui plante tôt n'en laisse aucun).
for (const is of issuesRes.items || []) {
  const repo = is.repository_url.split("/").pop();
  if (!suivis.has(repo)) continue;
  const linkedPR = openPRs.some((p) => p.repo === repo && new RegExp(`#${is.number}\\b`).test(p.body || ""));
  if (linkedPR || !seuilFranchiDans(is.created_at, RADE_SEUIL_H, since)) continue;
  try {
    const runs = await gh(`/repos/${OWNER}/${repo}/actions/runs?per_page=10`);
    const active = (runs.workflow_runs || []).some((r) =>
      r.status !== "completed" && Date.now() - new Date(r.created_at).getTime() < 3 * 3_600_000);
    if (active) continue; // une session est peut-être en train de la produire, pas encore un rade
    events.push({ title: `${repo} — dispatch en rade`, msg: `${is.title} (aucune PR ni session en cours)`,
      tag: "warning", click: `${APP_URL}?repo=${encodeURIComponent(repo)}` });
  } catch (e) { console.log(`(ignoré) rade ${repo}#${is.number} : ${e.message}`); }
}

// 4. Questions du cadrage sur les idées du codex (dernier commentaire 🪶 dans la fenêtre).
try {
  const idees = await gh(`/repos/${OWNER}/${META}/issues?labels=${encodeURIComponent("idée,à-préciser")}&state=open&per_page=100`);
  for (const i of idees) {
    if (i.pull_request || !i.comments) continue;
    const last = await lastComment(META, i.number, i.comments);
    if (last && /^🪶/.test(last.body || "") && inWindow(last.created_at)) {
      events.push({ title: "codex — le cadrage te pose une question", msg: i.title,
        tag: "pencil2", click: `${APP_URL}?idea=${i.number}` });
    }
  }
} catch (e) { console.log(`(ignoré) codex : ${e.message}`); }

// 5. Envoi.
if (!events.length) { console.log("Rien de nouveau dans la fenêtre."); process.exit(0); }
let sent = 0;
for (const ev of events) {
  try { await notify(ev); sent++; }
  catch (e) { console.error(`Échec d'envoi ntfy : ${e.message}`); }
}
console.log(`${sent}/${events.length} notification(s) envoyée(s).`);
process.exit(sent === events.length ? 0 : 1);
