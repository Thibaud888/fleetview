#!/usr/bin/env node
// Veilleur de la flotte — pousse une notification ntfy quand un événement actionnable
// APPARAÎT, même si FleetView est fermé. L'app ouverte a ses notifications natives ;
// app fermée, personne ne surveillait : ce cron comble ce trou. Zéro dépendance.
//
// Tourne en GitHub Actions sur CE repo (public → minutes gratuites), toutes les 15 min
// (.github/workflows/veilleur.yml). SANS ÉTAT : on ne signale que ce qui est apparu dans
// la fenêtre écoulée (WINDOW_MIN, défaut 20 min → léger recouvrement assumé, un doublon
// rare vaut mieux qu'un état stocké qui peut fuir ou se perdre).
//
// Secrets requis (Settings → Secrets and variables → Actions du repo fleetview) :
//   FLEET_GH_TOKEN — PAT fine-grained : lecture Contents+Issues+Pull requests+Actions
//                    sur les repos de la flotte, et Contents sur claude-ops (fleet.json).
//   NTFY_TOPIC     — le nom du sujet ntfy secret (le même que côté claude-ops).
// Absents → sortie 0 silencieuse (le cron reste vert tant que tu n'as pas activé le veilleur).

const OWNER = "Thibaud888";
const META = "claude-ops";
const APP_URL = "https://thibaud888.github.io/fleetview/";
const WINDOW_MIN = Number(process.env.WINDOW_MIN ?? 20);

const token = process.env.FLEET_GH_TOKEN;
const topic = process.env.NTFY_TOPIC;
if (!token || !topic) {
  console.log("Veilleur inactif : secrets FLEET_GH_TOKEN et/ou NTFY_TOPIC absents. Rien à faire.");
  process.exit(0);
}

let since = Date.now() - WINDOW_MIN * 60_000;
const inWindow = (iso) => iso && new Date(iso).getTime() >= since;

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

// 0. Fenêtre réelle : depuis le début du précédent run réussi du veilleur (−2 min de
// recouvrement). Les crons GitHub dérivent (10 à 40 min aux heures chargées) : une fenêtre
// fixe raterait ce qui tombe dans le trou. L'historique Actions sert d'état — rien à stocker.
try {
  const prev = await gh(`/repos/${OWNER}/fleetview/actions/workflows/veilleur.yml/runs?status=success&per_page=1`);
  const run = (prev.workflow_runs || [])[0];
  if (run) since = Math.min(since, new Date(run.run_started_at || run.created_at).getTime() - 120_000);
} catch (e) { console.log(`(fenêtre par défaut ${WINDOW_MIN} min) ${e.message}`); }

// 1. Registre : les repos suivis (tout sauf archivés/gelés).
const ff = await gh(`/repos/${OWNER}/${META}/contents/fleet/fleet.json`);
const fleet = JSON.parse(Buffer.from(ff.content, "base64").toString("utf8")).repos || [];
const suivis = new Set(fleet
  .filter((r) => !["archivé", "archive", "gelé"].includes(String(r.statut || "").toLowerCase()))
  .map((r) => r.repo));

// 2. Questions de Claude sur les issues `claude` ouvertes (dernier commentaire pas de Thibaud,
//    apparu dans la fenêtre).
const issuesRes = await gh(`/search/issues?q=${encodeURIComponent(`user:${OWNER} is:issue is:open label:claude`)}&per_page=50`);
for (const is of issuesRes.items || []) {
  const repo = is.repository_url.split("/").pop();
  if (!suivis.has(repo) || !is.comments) continue;
  if (!inWindow(is.updated_at)) continue; // fil sans activité récente : inutile de payer la requête
  try {
    const comments = await gh(`/repos/${OWNER}/${repo}/issues/${is.number}/comments?per_page=100`);
    const last = comments[comments.length - 1];
    if (last && last.user.login !== OWNER && inWindow(last.created_at)) {
      events.push({ title: `${repo} — Claude attend ta réponse`, msg: is.title,
        tag: "speech_balloon", click: `${APP_URL}?repo=${encodeURIComponent(repo)}` });
    }
  } catch (e) { console.log(`(ignoré) commentaires ${repo}#${is.number} : ${e.message}`); }
}

// 3. PRs : prête (tous les checks verts) ou en échec — au moment où les checks se terminent.
const prsRes = await gh(`/search/issues?q=${encodeURIComponent(`user:${OWNER} is:pr is:open`)}&per_page=50`);
for (const p of prsRes.items || []) {
  const repo = p.repository_url.split("/").pop();
  if (!suivis.has(repo)) continue;
  try {
    const d = await gh(`/repos/${OWNER}/${repo}/pulls/${p.number}`);
    const cr = await gh(`/repos/${OWNER}/${repo}/commits/${d.head.sha}/check-runs?per_page=30`);
    const runs = cr.check_runs || [];
    if (!runs.length || runs.some((c) => c.status !== "completed")) continue;
    const doneAt = Math.max(...runs.map((c) => new Date(c.completed_at || 0).getTime()));
    if (doneAt < since) continue; // les checks ne viennent pas de se terminer
    // `cancelled` compte comme échec : même règle que l'app (checks.bad de loadAll) —
    // sinon le veilleur annonce « prête à merger » une PR que l'app affiche en échec.
    const bad = runs.filter((c) => ["failure", "timed_out", "cancelled"].includes(c.conclusion)).length;
    events.push(bad
      ? { title: `${repo} — tests de la PR #${p.number} en échec`, msg: p.title,
          tag: "x", click: `${APP_URL}?repo=${encodeURIComponent(repo)}` }
      : { title: `${repo} — PR #${p.number} prête à merger`, msg: p.title,
          tag: "white_check_mark", click: `${APP_URL}?repo=${encodeURIComponent(repo)}` });
  } catch (e) { console.log(`(ignoré) PR ${repo}#${p.number} : ${e.message}`); }
}

// 4. Questions du cadrage sur les idées du codex (dernier commentaire 🪶 dans la fenêtre).
try {
  const idees = await gh(`/repos/${OWNER}/${META}/issues?labels=${encodeURIComponent("idée,à-préciser")}&state=open&per_page=50`);
  for (const i of idees) {
    if (i.pull_request || !i.comments) continue;
    const comments = await gh(`/repos/${OWNER}/${META}/issues/${i.number}/comments?per_page=100`);
    const last = comments[comments.length - 1];
    if (last && /^🪶/.test(last.body || "") && inWindow(last.created_at)) {
      events.push({ title: "codex — le cadrage te pose une question", msg: i.title,
        tag: "pencil2", click: `${APP_URL}?idea=${i.number}` });
    }
  }
} catch (e) { console.log(`(ignoré) codex : ${e.message}`); }

// 5. Envoi.
if (!events.length) { console.log(`Rien de nouveau dans la fenêtre (${WINDOW_MIN} min).`); process.exit(0); }
let sent = 0;
for (const ev of events) {
  try { await notify(ev); sent++; }
  catch (e) { console.error(`Échec d'envoi ntfy : ${e.message}`); }
}
console.log(`${sent}/${events.length} notification(s) envoyée(s).`);
process.exit(sent === events.length ? 0 : 1);
