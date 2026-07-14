/* FleetView — app.js. Vanilla JS, zéro dépendance.
   Sections : stockage · utilitaires · API · chargement · démo · rendus · actions · événements · init. */
(function(){
"use strict";

/* ================= Constantes & stockage ================= */
const OWNER = "Thibaud888";
const META  = "claude-ops";               // repo méta : fleet.json + codex des idées
const FLEET_PATH = "fleet/fleet.json";
const REFRESH_MS = 120_000;

const store = {
  get token(){ try{ return localStorage.getItem("fv-token")||""; }catch(e){ return ""; } },
  set token(v){ try{ v?localStorage.setItem("fv-token",v):localStorage.removeItem("fv-token"); }catch(e){} },
  get theme(){ try{ return localStorage.getItem("fv-theme")||"devinci"; }catch(e){ return "devinci"; } },
  set theme(v){ try{ localStorage.setItem("fv-theme",v); }catch(e){} },
  // Sujet ntfy pour les notifications push (URL secrète : reste en localStorage, jamais commitée).
  get ntfy(){ try{ return localStorage.getItem("fv-ntfy")||""; }catch(e){ return ""; } },
  set ntfy(v){ try{ v?localStorage.setItem("fv-ntfy",v):localStorage.removeItem("fv-ntfy"); }catch(e){} },
  // Notifications natives de l'appareil (API Notification, sans service tiers).
  get notif(){ try{ return localStorage.getItem("fv-notif")||""; }catch(e){ return ""; } },
  set notif(v){ try{ v?localStorage.setItem("fv-notif",v):localStorage.removeItem("fv-notif"); }catch(e){} },
  // Dernier relevé, pour l'affichage hors-ligne (jamais de token ici : que le modèle normalisé).
  get snapshot(){ try{ const s=localStorage.getItem("fv-snapshot"); return s?JSON.parse(s):null; }catch(e){ return null; } },
  set snapshot(v){ try{ v?localStorage.setItem("fv-snapshot",JSON.stringify(v)):localStorage.removeItem("fv-snapshot"); }catch(e){} },
};
let demo = false;

const STATES = {
  crit:{label:"à débloquer", v:"var(--crit)", order:0},
  info:{label:"en session",  v:"var(--info)", order:1},
  warn:{label:"en attente",  v:"var(--warn)", order:2},
  calm:{label:"calme",       v:"var(--ok)",   order:3},
};
const PRIO_COLOR = {P1:"var(--crit)", P2:"var(--warn)", P3:"var(--mut)"};
const PRIO_LABEL_COLOR = {P1:"C1442E", P2:"C99A3F", P3:"8A7A63"};
const MODEL_LABEL = {haiku:"claude:haiku", opus:"claude:opus", fable:"claude:fable"};
// Catégories du codex (label GitHub `cat:<clé>` sur l'issue idée)
const IDEA_CATS = {
  feature:    {e:"✨", l:"Fonctionnalité", color:"2E86AB"},
  bug:        {e:"🐛", l:"Correctif",      color:"C1442E"},
  design:     {e:"🎨", l:"Design",         color:"B85C9E"},
  entretien:  {e:"🧹", l:"Entretien",      color:"8A7A63"},
  exploration:{e:"🔬", l:"Exploration",    color:"4F6B2C"},
};

let model = null;          // { repos:[], ideas:[], attention:[], feed:[], notify:[] }
let fleetFile = null;      // { json, sha }
let ui = { filter:"all", openRepo:null, lastSync:null, loading:false, threadBig:false };
let ideaLaunchCtx = null;  // idée en cours de lancement (depuis le codex)
let ideaUI = { repoFilter:"all", open:null, edit:null }; // état du codex (filtre projet, idée dépliée/éditée)
const labelCache = new Set();
let rateInfo = { remaining:null, limit:null, reset:null }; // quota API GitHub (en-têtes x-ratelimit-*)
let rateWarned = false;    // pour ne toaster l'alerte « quota bas » qu'une fois par fenêtre
let pendingOpen = null;    // repo à ouvrir au chargement (deep-link ntfy ?repo=…)
let runWatch = null;       // suivi live d'un run Actions : {repo, runId, box, timer, lastJobs, demoJobs}
const secretCache = new Map(); // repo → "present" | "absent" | "unknown" (secret Claude)

/* ================= Utilitaires ================= */
const $ = (s)=>document.querySelector(s);
function esc(s){ return String(s??"").replace(/[&<>"]/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])); }
function b64d(s){ const bin=atob(String(s).replace(/\n/g,"")); const a=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++)a[i]=bin.charCodeAt(i); return new TextDecoder().decode(a); }
function b64e(s){ const a=new TextEncoder().encode(s); let bin=""; for(const b of a) bin+=String.fromCharCode(b); return btoa(bin); }

// Mini-renderer markdown (zéro dépendance) pour le dialogue et les corps de PR :
// Claude écrit en markdown, l'afficher brut rendait le flux central illisible.
// Couvre : titres #–####, listes (-, *, 1.), cases à cocher, blocs et `code`,
// **gras**, [liens](https://…), citations >, filets ---. Tout passe par esc()
// AVANT transformation : aucune injection possible.
function mdInline(s){
  return s
    .replace(/`([^`]+)`/g,"<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g,"<b>$1</b>")
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g,'<a href="$2" target="_blank" rel="noopener">$1</a>');
}
function md(src){
  const out=[]; let list=null;
  const closeList=()=>{ if(list){ out.push(`</${list}>`); list=null; } };
  const lines=String(src||"").split(/\r?\n/);
  let i=0;
  while(i<lines.length){
    const t=lines[i].trim();
    if(/^```/.test(t)){
      closeList();
      const buf=[]; i++;
      while(i<lines.length && !/^```/.test(lines[i].trim())){ buf.push(lines[i]); i++; }
      i++; out.push(`<pre><code>${esc(buf.join("\n"))}</code></pre>`);
      continue;
    }
    let m;
    if(!t){ closeList(); }
    else if((m=t.match(/^(#{1,4})\s+(.*)$/))){ closeList(); out.push(`<div class="md-h md-h${m[1].length}">${mdInline(esc(m[2]))}</div>`); }
    else if(/^(-{3,}|\*{3,})$/.test(t)){ closeList(); out.push('<hr class="md-hr">'); }
    else if((m=t.match(/^[-*]\s+\[([ xX])\]\s+(.*)$/))){ if(list!=="ul"){closeList(); out.push("<ul>"); list="ul";} out.push(`<li>${m[1]===" "?"☐":"☑"} ${mdInline(esc(m[2]))}</li>`); }
    else if((m=t.match(/^[-*•]\s+(.*)$/))){ if(list!=="ul"){closeList(); out.push("<ul>"); list="ul";} out.push(`<li>${mdInline(esc(m[1]))}</li>`); }
    else if((m=t.match(/^\d+[.)]\s+(.*)$/))){ if(list!=="ol"){closeList(); out.push("<ol>"); list="ol";} out.push(`<li>${mdInline(esc(m[1]))}</li>`); }
    else if((m=t.match(/^>\s?(.*)$/))){ closeList(); out.push(`<blockquote>${mdInline(esc(m[1]))}</blockquote>`); }
    else { closeList(); out.push(`<p>${mdInline(esc(t))}</p>`); }
    i++;
  }
  closeList();
  return out.join("");
}
function timeAgo(iso){
  if(!iso) return "";
  const d=(Date.now()-new Date(iso).getTime())/1000;
  if(d<90) return "à l'instant";
  if(d<3600) return `il y a ${Math.round(d/60)} min`;
  if(d<86400) return `il y a ${Math.round(d/3600)} h`;
  if(d<172800) return "hier";
  return `il y a ${Math.round(d/86400)} j`;
}
function dayLabel(iso){
  const d=new Date(iso), now=new Date();
  const sameDay=(a,b)=>a.toDateString()===b.toDateString();
  if(sameDay(d,now)) return "Aujourd'hui";
  const y=new Date(now); y.setDate(y.getDate()-1);
  if(sameDay(d,y)) return "Hier";
  return d.toLocaleDateString("fr-FR",{day:"numeric",month:"short"});
}
function hhmm(iso){ const d=new Date(iso); return String(d.getHours()).padStart(2,"0")+":"+String(d.getMinutes()).padStart(2,"0"); }
function timeUntil(ms){
  if(!ms) return "";
  const d=(ms-Date.now())/1000;
  if(d<=0) return "imminente";
  if(d<3600) return `dans ${Math.round(d/60)} min`;
  return `dans ${Math.round(d/3600)} h`;
}
let toastTimer=null;
function toast(msg, ms){
  const t=$("#toast"); t.textContent=msg; t.classList.add("on");
  clearTimeout(toastTimer); toastTimer=setTimeout(()=>t.classList.remove("on"), ms||4600);
}
function banner(msg, kind){
  const b=$("#banner");
  if(!msg){ b.hidden=true; return; }
  b.textContent=msg; b.className="banner"+(kind==="info"?" info":""); b.hidden=false;
}

/* ================= API GitHub ================= */
async function gh(path, opts={}){
  const res = await fetch("https://api.github.com"+path, {
    method: opts.method||"GET",
    headers: {
      "Authorization": "Bearer "+store.token,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(opts.body?{"Content-Type":"application/json"}:{}),
    },
    body: opts.body?JSON.stringify(opts.body):undefined,
  });
  captureRate(res);
  if(res.status===401||res.status===403||res.status===429){
    const detail=await res.text().catch(()=> "");
    const e=new Error("auth"); e.status=res.status; e.detail=detail;
    // Un 403/429 de rate limit n'est PAS un problème de token : ne pas renvoyer
    // l'utilisateur à l'écran de config pour ça.
    if(res.status!==401 && (res.headers.get("x-ratelimit-remaining")==="0" || /rate limit/i.test(detail))) e.rateLimit=true;
    throw e;
  }
  if(!res.ok){
    const e=new Error(`GitHub ${res.status} sur ${path}`); e.status=res.status; e.detail=await res.text().catch(()=> ""); throw e;
  }
  return res.status===204?null:res.json();
}
const enc = encodeURIComponent;

// Message d'erreur GitHub extrait du corps de réponse (JSON {"message": …}), s'il existe.
function ghMsg(e){ try{ return JSON.parse(e.detail).message||""; }catch(_){ return ""; } }
// Traduit une erreur API en message actionnable (toasts et bandeaux) — fini les « Échec : auth ».
function errMsg(e, ctx){
  if(!e) return "erreur inconnue";
  const m=ghMsg(e);
  if(e.rateLimit) return "quota API GitHub épuisé — réessaie "+(rateInfo.reset?timeUntil(rateInfo.reset):"dans quelques minutes");
  if(e.status===401) return "token invalide ou expiré — recolle-le (⚙ → Changer le token)";
  if(e.status===403) return "refusé par GitHub — permission manquante sur le token ?"+(m?` (${m})`:"");
  if(e.status===404) return "introuvable côté GitHub — supprimé ou déplacé entre-temps ?";
  if(e.status===405) return ctx==="merge" ? "PR non mergeable — draft, conflit ou checks requis"+(m?` (${m})`:"")
                                          : "action refusée par GitHub"+(m?` : ${m}`:"");
  if(e.status===409) return "conflit de version — quelque chose a changé entre-temps, réessaie";
  if(e.status===422) return "refusé par GitHub — donnée invalide ou nom déjà pris"+(m?` (${m})`:"");
  return (e.message||"erreur inconnue")+(m?` — ${m}`:"");
}

// Quota API : lit les en-têtes x-ratelimit-* de chaque réponse, alerte sous 500.
// Ne retenir que la ressource "core" (5000 req/h) : /search/* a son propre compteur
// (30 req/min), bien plus bas, qui fausserait l'alerte si on le mélangeait au reste.
function captureRate(res){
  const rem=res.headers.get("x-ratelimit-remaining");
  if(rem===null) return;
  const resource=res.headers.get("x-ratelimit-resource")||"core";
  if(resource!=="core") return;
  rateInfo={ remaining:Number(rem),
    limit:Number(res.headers.get("x-ratelimit-limit")||0),
    reset:Number(res.headers.get("x-ratelimit-reset")||0)*1000 };
  if(rateInfo.remaining<500 && !rateWarned){
    rateWarned=true;
    toast(`⚠️ Quota API GitHub bas : ${rateInfo.remaining} requêtes restantes (réinit. ${timeUntil(rateInfo.reset)}).`, 7000);
  }
  if(rateInfo.remaining>=500) rateWarned=false;
  renderRate();
}
function renderRate(){
  const el=$("#rate-note");
  if(el){
    if(rateInfo.remaining===null){ el.hidden=true; }
    else{
      el.hidden=false;
      el.textContent=`API ${rateInfo.remaining}`;
      el.classList.toggle("low", rateInfo.remaining<500);
      el.title=`Requêtes API GitHub : ${rateInfo.remaining}/${rateInfo.limit||"?"} · réinit. ${timeUntil(rateInfo.reset)}`;
    }
  }
  const s=$("#rate-settings");
  if(s) s.textContent = rateInfo.remaining===null ? "—"
    : `${rateInfo.remaining} / ${rateInfo.limit||"?"} restantes · réinit. ${timeUntil(rateInfo.reset)}`;
}

/* ================= Chargement & modèle ================= */
async function loadAll(){
  if(demo){ model = demoModel(); ui.lastSync=new Date(); return; }
  // 1. Registre
  const ff = await gh(`/repos/${OWNER}/${META}/contents/${FLEET_PATH}`);
  fleetFile = { sha: ff.sha, json: JSON.parse(b64d(ff.content)) };
  const fleet = fleetFile.json.repos||[];

  // 2. Recherches globales (3 requêtes)
  const [issuesRes, prsRes, ideasRes] = await Promise.all([
    gh(`/search/issues?q=${enc(`user:${OWNER} is:issue is:open label:claude`)}&per_page=50`),
    gh(`/search/issues?q=${enc(`user:${OWNER} is:pr is:open`)}&per_page=50`),
    gh(`/repos/${OWNER}/${META}/issues?labels=${enc("idée")}&state=open&per_page=100`),
  ]);
  const claudeIssues = (issuesRes.items||[]).map(it=>({...it, repo: it.repository_url.split("/").pop()}));
  const openPRs = (prsRes.items||[]).map(it=>({...it, repo: it.repository_url.split("/").pop()}));

  // 3. Runs Actions : repos avec crons ou avec activité
  const active = fleet.filter(r=>!isArchived(r.statut));
  const pollRuns = active.filter(r=>(r.crons&&r.crons.length) ||
    claudeIssues.some(i=>i.repo===r.repo) || openPRs.some(p=>p.repo===r.repo));
  const runsByRepo = {};
  await Promise.all(pollRuns.map(async r=>{
    try{ runsByRepo[r.repo]=(await gh(`/repos/${OWNER}/${r.repo}/actions/runs?per_page=15`)).workflow_runs||[]; }
    catch(e){ runsByRepo[r.repo]=null; } // repo sans Actions ou droit manquant : on dégrade
  }));

  // 4. Détails PR (head sha, stats) + check-runs — seulement pour les repos suivis :
  // détailler les PRs hors flotte (2-3 requêtes chacune) gaspillait le quota pour rien.
  const activeIds = new Set(active.map(r=>r.repo));
  const prDetails = {};
  await Promise.all(openPRs.filter(p=>activeIds.has(p.repo)).map(async p=>{
    try{
      const d = await gh(`/repos/${OWNER}/${p.repo}/pulls/${p.number}`);
      let checks=null;
      try{
        const cr = await gh(`/repos/${OWNER}/${p.repo}/commits/${d.head.sha}/check-runs?per_page=30`);
        const runs=cr.check_runs||[];
        checks = {
          total: runs.length,
          ok: runs.filter(c=>c.conclusion==="success").length,
          bad: runs.filter(c=>["failure","timed_out","cancelled"].includes(c.conclusion)).length,
          pending: runs.filter(c=>c.status!=="completed").length,
        };
      }catch(e){}
      prDetails[p.repo+"#"+p.number] = {d, checks};
    }catch(e){}
  }));

  // 5. Commentaires des issues claude ouvertes (fil de dialogue de la session) — repos suivis seulement
  const commentsByIssue = {};
  await Promise.all(claudeIssues.filter(i=>i.comments>0 && activeIds.has(i.repo)).map(async i=>{
    try{ commentsByIssue[i.repo+"#"+i.number] = await gh(`/repos/${OWNER}/${i.repo}/issues/${i.number}/comments?per_page=100`); }
    catch(e){}
  }));

  model = buildModel(fleet, {claudeIssues, openPRs, ideasRaw:ideasRes, runsByRepo, prDetails, commentsByIssue});
  ui.lastSync = new Date();
  store.snapshot = { at: ui.lastSync.toISOString(), model }; // conserve le relevé pour le hors-ligne
}

function isArchived(statut){ return ["archivé","archive","gelé"].includes(String(statut||"").toLowerCase()); }
function isVeille(statut){ return String(statut||"").toLowerCase()==="veille"; }

function buildModel(fleet, D){
  const repos=[], attention=[], feed=[], notify=[];

  for(const fr of fleet){
    const id=fr.repo;
    const life = isArchived(fr.statut)?"archive":(isVeille(fr.statut)?"veille":"actif");
    const lines=[]; let state="calm"; let lastTs=null; let pr=null; let threadIssue=null;
    const bump=(s)=>{ if(STATES[s].order<STATES[state].order) state=s; };
    const seen=(iso)=>{ if(iso && (!lastTs||iso>lastTs)) lastTs=iso; };
    const runs = D.runsByRepo[id]||[];

    // Issues claude ouvertes (sessions fire-and-forget lancées via issue + Actions).
    // Seuls les runs du workflow de dispatch (claude.yml) comptent comme « session » :
    // un cron ou un map.yml qui tourne ne doit pas faire croire qu'une session est en cours.
    const claudeRunning = runs.some(r=>["in_progress","queued"].includes(r.status) && (r.path||"").endsWith("/claude.yml"));
    for(const is of D.claudeIssues.filter(i=>i.repo===id)){
      seen(is.updated_at);
      const comments = D.commentsByIssue[id+"#"+is.number]||[];
      const lastC = comments[comments.length-1];
      // Liaison PR ↔ issue : frontière de mot obligatoire (« #1 » ne doit pas matcher « #12 »).
      const linkedPR = D.openPRs.find(p=>p.repo===id && new RegExp(`#${is.number}\\b`).test(p.body||""));
      // L'âge se mesure depuis la DERNIÈRE activité du fil, pas depuis la création :
      // un fil qui échange des questions vit naturellement plus de 2 h sans être en échec.
      const lastActivity = lastC ? lastC.created_at : is.created_at;
      const idleH = (Date.now()-new Date(lastActivity))/3.6e6;

      if(linkedPR){
        // la PR parle pour elle (traitée plus bas)
      } else if(claudeRunning){
        bump("info");
        lines.push({c:"info", t:`Issue #${is.number} « ${is.title} » — session Actions en cours`, small:timeAgo(is.updated_at), act:{id:"gh-issue", n:is.number, label:"Suivre"}});
        threadIssue = threadIssue??{num:is.number, title:is.title, comments, body:is.body};
      } else if(lastC && lastC.user.login!==OWNER){
        bump("warn");
        lines.push({c:"warn", t:`Issue #${is.number} « ${is.title} » — réponse de Claude à lire`, small:timeAgo(lastC.created_at), act:{id:"open-thread", n:is.number, label:"Répondre"}});
        attention.push({c:"warn", repo:id, t:`Claude attend ta réponse sur « ${is.title} »`, small:timeAgo(lastC.created_at)});
        notify.push({key:`q:${id}#${is.number}:${lastC.id||lastC.created_at}`, kind:"q",
          title:`${id} — Claude attend ta réponse`, msg:is.title, repo:id, tag:"speech_balloon", prio:4});
        threadIssue = threadIssue??{num:is.number, title:is.title, comments, body:is.body};
      } else if(idleH>2){
        bump("crit");
        lines.push({c:"crit", t:`Issue #${is.number} « ${is.title} » — sans nouvelles depuis ${Math.round(idleH)} h (session en échec ?)`, act:{id:"relabel", n:is.number, label:"Relancer"}});
        attention.push({c:"crit", repo:id, t:`« ${is.title} » : sans nouvelles depuis ${Math.round(idleH)} h`});
        threadIssue = threadIssue??{num:is.number, title:is.title, comments, body:is.body};
      } else if(lastC){
        bump("info");
        lines.push({c:"info", t:`Issue #${is.number} « ${is.title} » — réponse envoyée, la session reprend`, small:timeAgo(lastC.created_at)});
        threadIssue = threadIssue??{num:is.number, title:is.title, comments, body:is.body};
      } else {
        bump("info");
        lines.push({c:"info", t:`Issue #${is.number} « ${is.title} » — session en attente de démarrage`, small:timeAgo(is.created_at)});
        threadIssue = threadIssue??{num:is.number, title:is.title, comments, body:is.body};
      }
      feed.push({ts:is.created_at, c:"info", repo:id, txt:`Issue #${is.number} « ${is.title} » ouverte.`});
    }

    // PRs ouvertes
    for(const p of D.openPRs.filter(p=>p.repo===id)){
      seen(p.updated_at);
      const det = D.prDetails[id+"#"+p.number];
      const ch = det&&det.checks;
      const chTxt = ch ? (ch.pending? "checks en cours" : ch.bad? `${ch.bad} check(s) en échec` : `checks ✓ ${ch.ok}/${ch.total}`) : "checks ?";
      if(ch && ch.bad){
        bump("crit");
        lines.push({c:"crit", t:`PR #${p.number} « ${p.title} » — ${chTxt}`, act:{id:"open-pr", n:p.number, label:"Examiner"}});
        attention.push({c:"crit", repo:id, t:`PR #${p.number} « ${p.title} » : ${chTxt}`});
      } else if(ch && ch.pending){
        bump("info");
        lines.push({c:"info", t:`PR #${p.number} « ${p.title} » — ${chTxt}`, small:timeAgo(p.updated_at)});
      } else {
        bump("warn");
        lines.push({c:"warn", t:`PR #${p.number} « ${p.title} » — ${chTxt}, attend ta décision`, small:timeAgo(p.created_at), act:{id:"open-pr", n:p.number, label:"Examiner"}});
        attention.push({c:"warn", repo:id, t:`PR #${p.number} « ${p.title} » attend ta décision`, small:timeAgo(p.created_at)});
        notify.push({key:`pr:${id}#${p.number}`, kind:"pr",
          title:`${id} — PR #${p.number} prête à merger`, msg:p.title, repo:id, tag:"white_check_mark", prio:4});
      }
      if(!pr && det){ pr={num:p.number, title:p.title, body:(det.d.body||"").slice(0,600), checks:chTxt,
        files:det.d.changed_files, add:det.d.additions, del:det.d.deletions, mergeable:det.d.mergeable_state}; }
      feed.push({ts:p.created_at, c:"warn", repo:id, txt:`PR #${p.number} « ${p.title} » ouverte.`});
    }

    // Crons : dernier run de chaque workflow planifié
    for(const cron of (fr.crons||[])){
      const wf = runs.filter(r=>(r.path||"").endsWith("/"+cron));
      const last = wf[0];
      if(!last) continue;
      seen(last.updated_at);
      if(last.conclusion==="failure"){
        const streak = wf.findIndex(r=>r.conclusion!=="failure");
        const n = streak===-1?wf.length:streak;
        bump("crit");
        lines.push({c:"crit", t:`${cron} — ${n>1?n+" échecs consécutifs":"en échec"}`, small:timeAgo(last.updated_at), act:{id:"rerun", n:last.id, label:"Relancer"}});
        attention.push({c:"crit", repo:id, t:`${cron} en échec${n>1?" ×"+n:""}`, small:timeAgo(last.updated_at)});
        feed.push({ts:last.updated_at, c:"crit", repo:id, txt:`${cron} en échec.`});
      } else if(last.status!=="completed"){
        bump("info");
        lines.push({c:"info", t:`${cron} — en cours`, small:timeAgo(last.updated_at)});
      } else {
        lines.push({c:"ok", t:`${cron} — OK`, small:timeAgo(last.updated_at)});
        feed.push({ts:last.updated_at, c:"ok", repo:id, txt:`${cron} OK.`});
      }
    }

    // Dernier run Actions : toujours proposé au journal (live s'il tourne, déroulé consultable sinon).
    let lastRun=null;
    if(runs.length){
      const rr=runs[0];
      const running=["in_progress","queued","requested","waiting","pending"].includes(rr.status);
      lastRun={ id:rr.id, name:rr.display_title||rr.name||"run", wf:rr.name||"",
        status:rr.status, conclusion:rr.conclusion, running,
        url:rr.html_url, started:rr.run_started_at||rr.created_at };
    }

    if(!lines.length) lines.push({c:"ok", t:"Rien en cours"});
    repos.push({
      id, type: fr.type + (fr.kit_version?` · kit ${fr.kit_version}`:""), life, state,
      lines, last: lastTs?timeAgo(lastTs):"—", lastTs, pr, threadIssue, lastRun,
      notes: fr.notes||"", url:`https://github.com/${OWNER}/${id}`,
    });
  }

  // Codex des idées (issues `idée` de claude-ops)
  const ideas = (D.ideasRaw||[]).filter(i=>!i.pull_request).map(i=>{
    const body=i.body||"";
    const m=body.match(/\*\*Projet\*\*\s*:\s*(\S+)/);
    const names=(i.labels||[]).map(l=>l.name);
    const p=names.find(n=>/^P[123]$/.test(n))||"P3";
    const catRaw=(names.find(n=>n.startsWith("cat:"))||"").slice(4);
    const desc=body.replace(/\*\*Projet\*\*\s*:\s*\S+\s*/,"").replace(/_Créée depuis FleetView\.?_\s*$/,"").trim();
    return {num:i.number, p, repo:m?m[1]:"flotte", t:i.title, desc,
      cat:IDEA_CATS[catRaw]?catRaw:null, url:i.html_url, created:i.created_at};
  });

  feed.sort((a,b)=>b.ts<a.ts?-1:1);
  // « À traiter », chroniques et notifications ne concernent que les repos suivis : on écarte
  // les archivés, dont une PR ou une issue claude peut rester ouverte après archivage.
  const archived = new Set(repos.filter(r=>r.life==="archive").map(r=>r.id));
  const keep = x=>!archived.has(x.repo);
  // Chroniques : rétention PAR repo (6 max chacun, 30 au total) — avec la coupe globale
  // brute, un repo bavard vidait les « Chroniques du projet » de tous les autres.
  const byRepo={}; const feedKept=[];
  for(const f of feed){
    if(!keep(f)) continue;
    byRepo[f.repo]=(byRepo[f.repo]||0)+1;
    if(byRepo[f.repo]<=6){ feedKept.push(f); if(feedKept.length>=30) break; }
  }
  return { repos, ideas, attention: attention.filter(keep), feed: feedKept, notify: notify.filter(keep) };
}

/* ================= Mode démo ================= */
function demoModel(){
  // Données factices et noms de projets fictifs — rien de la vraie flotte n'est exposé dans le code.
  const L=(c,t,small,act)=>({c,t,small,act});
  return {
    repos:[
      {id:"quiz-capitales", type:"cron-node", life:"actif", state:"crit", last:"il y a 40 min", url:"#",
        lines:[L("crit","publish-shorts.yml — 2 échecs consécutifs","il y a 40 min",{id:"demo",label:"Relancer"}), L("ok","retry-reels.yml — OK","cette nuit")]},
      {id:"bulletins-viz", type:"static · kit 1.0.0", life:"actif", state:"info", last:"il y a 12 min", url:"#",
        lines:[L("info","Issue #18 « Export PDF » — session Actions en cours","12 min",{id:"open-thread",n:18,label:"Suivre"})],
        lastRun:{id:1, name:"Export PDF — session #18", wf:"claude.yml", status:"in_progress",
          conclusion:null, running:true, url:"#", started:new Date(Date.now()-4*60000).toISOString()},
        demoJobs:[{name:"claude", status:"in_progress", conclusion:null, steps:[
          {number:1,name:"Set up job",status:"completed",conclusion:"success"},
          {number:2,name:"Checkout du dépôt",status:"completed",conclusion:"success"},
          {number:3,name:"Lecture de MAP.md et CLAUDE.md",status:"completed",conclusion:"success"},
          {number:4,name:"Session Claude Code (implémentation)",status:"in_progress",conclusion:null},
          {number:5,name:"Vérification (verify.mjs)",status:"queued",conclusion:null},
          {number:6,name:"Ouverture de la PR",status:"queued",conclusion:null}]}],
        threadIssue:{num:18, title:"Export PDF", body:"Ajouter un bouton pour exporter le bulletin courant en PDF.\n\n_Créée depuis FleetView._", comments:[
          {user:{login:OWNER}, body:"Ajouter un bouton pour exporter le bulletin courant en PDF."},
          {user:{login:"claude-bot"}, body:"## Spécification\n\n**Objectif** : bouton « Exporter en PDF » dans la barre du bulletin.\n\n- Rendu client via `window.print` + feuille `@media print` dédiée — aucune dépendance\n- Critères de done :\n- [x] le PDF reprend le graphe et le tableau\n- [ ] sans la navigation\n\nJ'enchaîne l'implémentation."},
          {user:{login:"claude-bot"}, body:"Fait : bouton ajouté, styles d'impression en place, **PR #19 ouverte** (Closes #18).\n\n```bash\nnode scripts/verify.mjs   # VERIFY OK\n```\nVérifié : l'aperçu d'impression montre le bulletin seul."},
        ]}},
      {id:"talk-show-oral", type:"service-node", life:"actif", state:"warn", last:"hier", url:"#",
        pr:{num:15,title:"Lecture audio iOS",checks:"checks ✓ 3/3",files:4,add:118,del:22,body:"Débloque l'AudioContext au premier geste utilisateur. Résout l'issue #12."},
        lines:[L("warn","PR #15 « Lecture audio iOS » — checks ✓, attend ta décision","depuis 15 h",{id:"open-pr",n:15,label:"Examiner"})]},
      {id:"veille-emploi", type:"cron-python", life:"actif", state:"calm", last:"07:05", url:"#",
        lines:[L("ok","veille.yml — OK","ce matin")]},
      {id:"digest-hebdo", type:"cron-python", life:"veille", state:"calm", last:"lundi", url:"#",
        lines:[L("ok","Dev en pause · weekly-digest.yml surveillé")]},
    ],
    ideas:[
      {num:1,p:"P1",repo:"quiz-capitales",t:"Miniatures automatiques pour les shorts",desc:"Générer la miniature depuis la première question du quiz, avec le drapeau en fond.",cat:"feature",url:"#"},
      {num:2,p:"P2",repo:"bulletins-viz",t:"Comparaison des moyennes entre trimestres",desc:"",cat:"feature",url:"#"},
      {num:3,p:"P3",repo:"flotte",t:"Statusline + raccourcis desktop",desc:"",cat:"exploration",url:"#"},
      {num:4,p:"P3",repo:"flotte",t:"Corriger l'alignement du pied de page",desc:"",cat:"bug",url:"#"},
    ],
    attention:[
      {c:"crit",repo:"quiz-capitales",t:"publish-shorts en échec ×2",small:"il y a 40 min"},
      {c:"warn",repo:"talk-show-oral",t:"PR #15 attend ta décision",small:"depuis 15 h"},
    ],
    feed:[
      {ts:new Date().toISOString(),c:"ok",repo:"bulletins-viz",txt:"PR #17 self-heal mergée."},
      {ts:new Date(Date.now()-3.6e6).toISOString(),c:"crit",repo:"quiz-capitales",txt:"publish-shorts.yml en échec."},
      {ts:new Date(Date.now()-86400e3).toISOString(),c:"warn",repo:"talk-show-oral",txt:"PR #15 ouverte par la session Actions."},
    ],
  };
}

/* ================= Rendus ================= */
function renderSummary(){
  const c=s=>model.repos.filter(r=>r.state===s&&r.life!=="archive").length;
  $("#summary").innerHTML = [
    {v:"var(--crit)", n:c("crit"), l:"à débloquer"},
    {v:"var(--info)", n:c("info"), l:"en session"},
    {v:"var(--warn)", n:c("warn"), l:"en attente"},
    {v:"var(--mut)",  n:model.ideas.length, l:"idées au codex"},
  ].map(p=>`<span class="sum-chip"><span class="dot" style="--c:${p.v}"></span><b class="num">${p.n}</b>&nbsp;${p.l}</span>`).join("");
}
function renderAttention(){
  const a=model.attention;
  $("#attn").hidden=!a.length;
  $("#attn-title").innerHTML=`<span class="orn">❧</span>À traiter · ${a.length}`;
  $("#attn-rows").innerHTML=a.map(x=>`
    <div class="attn-row">
      <span class="dot" style="--c:var(--${x.c})"></span>
      <span class="repo-name">${esc(x.repo)}</span>
      <span class="txt">${esc(x.t)}${x.small?` <span class="marginalia">· ${esc(x.small)}</span>`:""}</span>
      <button class="btn-mini" data-open="${esc(x.repo)}">Examiner</button>
    </div>`).join("");
}
function renderFilters(){
  const R=model.repos;
  const meta=[
    {id:"all",l:"Tous",n:R.filter(r=>r.life!=="archive").length},
    {id:"action",l:"En action",n:R.filter(r=>r.life==="actif"&&r.state!=="calm").length},
  ];
  const states=[
    {id:"crit",l:"À débloquer",n:R.filter(r=>r.state==="crit"&&r.life!=="archive").length},
    {id:"info",l:"En session",n:R.filter(r=>r.state==="info"&&r.life!=="archive").length},
    {id:"warn",l:"En attente",n:R.filter(r=>r.state==="warn"&&r.life!=="archive").length},
    {id:"calm",l:"Calmes",n:R.filter(r=>r.state==="calm"&&r.life==="actif").length},
    {id:"veille",l:"En veille",n:R.filter(r=>r.life==="veille").length},
  ];
  const chip=(d,cls)=>`<button class="chip ${cls}" data-filter="${d.id}" aria-pressed="${ui.filter===d.id}">${d.l} <span class="n num">${d.n}</span></button>`;
  $("#filters").innerHTML=
    meta.map(d=>chip(d,"chip-meta")).join("")+
    `<span class="chip-sep" aria-hidden="true"></span>`+
    states.map(d=>chip(d,"chip-state")).join("");
}
function lineHtml(l){
  return `<li><span class="ldot" style="--c:var(--${l.c})"></span>
    <span class="ltxt">${esc(l.t)}${l.small?` <span class="marginalia">· ${esc(l.small)}</span>`:""}</span>
    ${l.act?`<button class="btn-mini" data-act="${l.act.id}" data-n="${l.act.n??""}">${esc(l.act.label)}</button>`:""}</li>`;
}
function renderGrid(){
  const visible=model.repos.filter(r=>{
    if(r.life==="archive") return false;
    if(ui.filter==="all") return true;
    if(ui.filter==="action") return r.life==="actif"&&r.state!=="calm"; // tout sauf calmes et veille
    if(ui.filter==="veille") return r.life==="veille";
    if(ui.filter==="calm") return r.state==="calm"&&r.life==="actif";
    return r.state===ui.filter;
  }).sort((a,b)=>{
    const lo=x=>x.life==="veille"?1:0;
    return lo(a)-lo(b)||STATES[a.state].order-STATES[b.state].order||a.id.localeCompare(b.id);
  });
  $("#grid").innerHTML=visible.map(r=>{
    const st=STATES[r.state];
    const calmVeille=r.life==="veille"&&r.state==="calm";
    const stColor=calmVeille?"var(--mut)":st.v;
    return `
    <article class="card" data-life="${r.life}" data-card="${esc(r.id)}" style="--st:${stColor}">
      <header class="card-head">
        <span class="dot" style="--c:${stColor}"></span>
        <button class="repo-btn" data-open="${esc(r.id)}" title="Ouvrir ${esc(r.id)}">${esc(r.id)}</button>
        <span class="pill" style="--c:${calmVeille?"var(--mut)":st.v}">${calmVeille?"en veille":st.label}</span>
      </header>
      <div class="card-type">${esc(r.type)}</div>
      <ul class="lines">${r.lines.map(lineHtml).join("")}</ul>
      <footer class="card-foot">
        <span class="last">relevé ${esc(r.last)}</span>
        <a class="btn-mini" href="https://claude.ai/code" target="_blank" rel="noopener" data-cloud-repo="${esc(r.id)}" title="Session cloud interactive (claude.ai/code)">🌩 Session</a>
        <button class="btn-mini" data-newfor="${esc(r.id)}">＋ Demande</button>
      </footer>
    </article>`;
  }).join("")||`<p class="marginalia">Aucun projet dans ce filtre.</p>`;
}
function renderArchived(){
  const arch=model.repos.filter(r=>r.life==="archive");
  $("#drawer").hidden=!arch.length;
  $("#arch-count").textContent=arch.length;
  $("#arch-rows").innerHTML=arch.map(a=>`
    <div class="drawer-row">
      <span class="repo-name">${esc(a.id)}</span>
      <span class="why">${esc(a.notes||"")}</span>
      <button class="btn-mini" data-unarchive="${esc(a.id)}">Réactiver</button>
    </div>`).join("");
}
function ideaEditHtml(i){
  const repos=["flotte",...model.repos.filter(r=>r.life!=="archive").map(r=>r.id)];
  if(!repos.includes(i.repo)) repos.push(i.repo);
  return `<div class="idea-edit">
    <input id="ie-title" type="text" value="${esc(i.t)}" aria-label="Titre de l'idée">
    <textarea id="ie-desc" placeholder="Détails (optionnel)" aria-label="Détails">${esc(i.desc||"")}</textarea>
    <div class="row">
      <select id="ie-repo" aria-label="Projet">${repos.map(x=>`<option value="${esc(x)}"${x===i.repo?" selected":""}>${esc(x)}</option>`).join("")}</select>
      <select id="ie-prio" aria-label="Priorité">${["P1","P2","P3"].map(p=>`<option${p===i.p?" selected":""}>${p}</option>`).join("")}</select>
      <select id="ie-cat" aria-label="Catégorie"><option value="">💡 Divers</option>${Object.entries(IDEA_CATS).map(([k,c])=>
        `<option value="${k}"${i.cat===k?" selected":""}>${c.e} ${c.l}</option>`).join("")}</select>
    </div>
    <div class="idea-tools">
      <button class="btn btn-primary" data-idea-save="${i.num}">Enregistrer</button>
      <button class="btn" data-idea-cancel="${i.num}">Annuler</button>
      <button class="btn btn-mic" type="button" data-mic="#ie-desc" title="Dicter les détails">🎙️</button>
    </div>
  </div>`;
}
function renderIdeas(){
  // Édition en cours : ne pas écraser la saisie au relevé automatique.
  if(ideaUI.edit!==null && $("#ie-title")) return;
  const order={P1:0,P2:1,P3:2};
  let list=model.ideas.slice().sort((a,b)=>order[a.p]-order[b.p]||a.num-b.num);
  $("#ideas-count").textContent=model.ideas.length;
  const repos=[...new Set(model.ideas.map(i=>i.repo))].sort();
  if(ideaUI.repoFilter!=="all"&&!repos.includes(ideaUI.repoFilter)) ideaUI.repoFilter="all";
  if(ideaUI.repoFilter!=="all") list=list.filter(i=>i.repo===ideaUI.repoFilter);
  const toolbar=model.ideas.length?`<div class="ideas-toolbar">
    <select id="ideas-repo-filter" class="theme-select" aria-label="Filtrer par projet">
      <option value="all">Tous les projets</option>
      ${repos.map(r=>`<option value="${esc(r)}"${ideaUI.repoFilter===r?" selected":""}>${esc(r)}</option>`).join("")}
    </select></div>`:"";
  const rowHtml=(i)=>{
    const open=ideaUI.open===i.num, edit=ideaUI.edit===i.num;
    return `
    <div class="idea${open?" open":""}" data-idea="${i.num}">
      <span class="prio" style="--c:${PRIO_COLOR[i.p]}">${i.p}</span>
      <span class="idea-body" data-idea-toggle="${i.num}" role="button" tabindex="0">${esc(i.t)}<span class="idea-repo">${esc(i.repo)}${i.desc?" · …":""}</span></span>
      <a class="idea-launch" href="https://claude.ai/code" target="_blank" rel="noopener" data-cloud="${i.num}" title="Session cloud interactive (claude.ai/code)">🌩</a>
      <button class="idea-launch" data-launch="${i.num}" title="Lancer en issue directe (Actions, fire-and-forget)">🚀</button>
    </div>
    ${open?`<div class="idea-more">${edit?ideaEditHtml(i):`
      ${i.desc?`<p class="idea-desc">${esc(i.desc)}</p>`:""}
      <div class="idea-tools">
        <button class="btn-mini" data-idea-edit="${i.num}">✎ Modifier</button>
        <button class="btn-mini" data-idea-del="${i.num}">🗑 Supprimer</button>
        <a class="ghlink" href="${esc(i.url)}" target="_blank" rel="noopener">issue ↗</a>
      </div>`}
    </div>`:""}`;
  };
  let html=toolbar;
  for(const c of [...Object.keys(IDEA_CATS),""]){
    const group=list.filter(i=>(i.cat||"")===c);
    if(!group.length) continue;
    const head=c?`${IDEA_CATS[c].e} ${IDEA_CATS[c].l}`:"💡 Divers";
    html+=`<div class="cat-head eyebrow">${head} · <span class="num">${group.length}</span></div>`+group.map(rowHtml).join("");
  }
  if(model.ideas.length&&!list.length) html+=`<p style="padding:12px 15px" class="marginalia">Aucune idée pour ce projet.</p>`;
  $("#ideas").innerHTML=html||`<p style="padding:12px 15px" class="marginalia">Codex vide — ajoute une idée avec le bouton ci-dessous.</p>`;
}
function renderFeed(){
  let html="", day=null;
  for(const f of model.feed){
    const dl=dayLabel(f.ts);
    if(dl!==day){ if(day!==null) html+="</ul>"; day=dl; html+=`<div class="feed-day eyebrow">${esc(dl)}</div><ul class="feed">`; }
    html+=`<li><span class="t num">${hhmm(f.ts)}</span><span class="ldot" style="--c:var(--${f.c})"></span>
      <span><span class="repo-name">${esc(f.repo)}</span> — ${esc(f.txt)}</span></li>`;
  }
  $("#feed").innerHTML=html?(html+"</ul>"):`<p style="padding:12px 15px" class="marginalia">Rien à signaler.</p>`;
}
/* ===== Journal de run en direct (feature : suivre une session Claude) ===== */
function runStatusLabel(run){
  if(run.running) return {t:"en cours…", c:"info"};
  if(run.conclusion==="success") return {t:"terminé ✓", c:"ok"};
  if(["failure","timed_out"].includes(run.conclusion)) return {t:"en échec", c:"crit"};
  if(run.conclusion==="cancelled") return {t:"annulé", c:"mut"};
  return {t:run.status||"—", c:"mut"};
}
function stepIcon(s){
  if(s.status!=="completed") return s.status==="in_progress"?"◍":"○";
  return {success:"●", failure:"✕", cancelled:"–", skipped:"–"}[s.conclusion]||"●";
}
function stepColor(s){
  if(s.status!=="completed") return s.status==="in_progress"?"var(--info)":"var(--mut)";
  return {success:"var(--ok)", failure:"var(--crit)", cancelled:"var(--mut)", skipped:"var(--mut)"}[s.conclusion]||"var(--ok)";
}
function renderJournalInto(box, jobs){
  if(!box) return;
  if(!jobs || !jobs.length){ box.innerHTML=`<p class="marginalia" style="margin:0">Pas encore de détail — le run démarre…</p>`; return; }
  box.innerHTML=jobs.map(j=>{
    const js=runStatusLabel({running:j.status!=="completed", conclusion:j.conclusion, status:j.status});
    const steps=(j.steps||[]).slice().sort((a,b)=>(a.number||0)-(b.number||0));
    const cur=steps.find(s=>s.status==="in_progress");
    const col=js.c==="mut"?"var(--mut)":`var(--${js.c})`;
    return `<div class="job">
      <div class="job-head"><span class="dot" style="--c:${stepColor({status:j.status,conclusion:j.conclusion})}"></span>
        <span class="job-name">${esc(j.name)}</span>
        <span class="job-state num" style="color:${col}">${js.t}${cur?` · ${esc(cur.name)}`:""}</span></div>
      <ul class="steps">${steps.map(s=>`<li${s.status==="in_progress"?' class="on"':""}>
        <span class="si" style="color:${stepColor(s)}">${stepIcon(s)}</span>
        <span class="sn">${esc(s.name)}</span></li>`).join("")||`<li class="marginalia">étapes à venir…</li>`}</ul>
    </div>`;
  }).join("");
}
async function tickJournal(){
  if(!runWatch) return;
  let jobs=null;
  if(demo){ jobs=runWatch.demoJobs||[]; }
  else{
    try{ jobs=(await gh(`/repos/${OWNER}/${runWatch.repo}/actions/runs/${runWatch.runId}/jobs?per_page=30`)).jobs||[]; }
    catch(e){ return; } // erreur ponctuelle : on retentera au tick suivant
  }
  runWatch.lastJobs=jobs;
  renderJournalInto(runWatch.box, jobs);
  const active=jobs.some(j=>j.status!=="completed");
  if(!active) stopJournal(false); // run fini : on garde l'état final affiché, on arrête le poll
}
function startJournal(repo, runId, box, demoJobs){
  stopJournal(false);
  runWatch={ repo, runId, box, timer:null, lastJobs:null, demoJobs:demoJobs||null };
  tickJournal();
  if(!demo) runWatch.timer=setInterval(tickJournal, 4500);
}
function stopJournal(clearVar=true){
  if(runWatch && runWatch.timer){ clearInterval(runWatch.timer); runWatch.timer=null; }
  if(clearVar) runWatch=null;
}

/* ===== Secret Claude au bootstrap (feature : lancer une session sans terminal) ===== */
async function checkSecret(repoId){
  const target=repoId==="flotte"?META:repoId;
  if(secretCache.has(target)) return secretCache.get(target);
  let res="unknown";
  try{ await gh(`/repos/${OWNER}/${target}/actions/secrets/CLAUDE_CODE_OAUTH_TOKEN`); res="present"; }
  catch(e){ res = e.status===404 ? "absent" : "unknown"; } // 403 = droit « Secrets » absent du token
  secretCache.set(target,res);
  return res;
}
// La ligne n'apparaît QUE si le secret manque vraiment (404 confirmé) : un projet qui
// tourne a déjà son secret, inutile de l'inquiéter — et sans droit « Secrets » on se tait.
async function refreshSecretBadge(repoId){
  const row=$("#kit-row"); if(!row || demo) return;
  const s=await checkSecret(repoId);
  const cur=$("#kit-row"); if(cur!==row || !document.body.contains(row)) return; // vue changée entre-temps
  if(s==="absent") row.hidden=false;
}
function openSecretPage(repoId){
  const target=repoId==="flotte"?META:repoId;
  try{ navigator.clipboard && navigator.clipboard.writeText("CLAUDE_CODE_OAUTH_TOKEN"); }catch(e){}
  secretCache.delete(target);
  window.open(`https://github.com/${OWNER}/${target}/settings/secrets/actions/new`,"_blank","noopener");
  toast("🔑 Nom du secret copié : CLAUDE_CODE_OAUTH_TOKEN. Colle ta clé Claude dans l'onglet ouvert puis « Add secret » — aucun terminal.", 8000);
}

// Extrait la demande d'origine du corps d'une issue FleetView (sans le boilerplate
// du parcours cadrage ni les règles de flotte) pour l'afficher en tête du dialogue.
function requestFromIssueBody(body){
  let s=String(body||"");
  const m=s.match(/\*\*Demande brute :\*\*\s*([\s\S]*)$/);
  if(m) s=m[1];
  s=s.replace(/_Créée depuis FleetView[^_]*_\s*$/,"");
  s=s.replace(/\n-{3,}\s*\nRègles de la flotte :[\s\S]*$/,"");
  return s.trim();
}
function renderDetail(){
  const r=ui.openRepo&&model.repos.find(x=>x.id===ui.openRepo);
  $("#view-fleet").hidden=!!r;
  $("#view-detail").hidden=!r;
  if(!r){ stopJournal(); document.body.classList.remove("thread-full-open"); $("#view-detail").innerHTML=""; renderDetail._repo=null; return; }
  // Brouillons en cours (réponse à Claude, demande de changements) : le relevé auto
  // re-render toute la vue — on capture avant, on restaure après si c'est le même repo,
  // sinon ce qu'on tape serait effacé toutes les 2 minutes.
  const draft = renderDetail._repo===r.id ? {
    thread: ($("#thread-reply")||{}).value||"",
    pr: ($("#pr-reply-text")||{}).value||"",
    prOpen: !!($("#pr-reply") && !$("#pr-reply").hidden),
    focusId: document.activeElement ? document.activeElement.id : "",
  } : null;
  renderDetail._repo=r.id;
  const st=STATES[r.state];
  const lifeLabel={actif:"actif",veille:"en veille",archive:"archivé"}[r.life];
  const relatedIdeas=model.ideas.filter(i=>i.repo===r.id);
  const relatedFeed=model.feed.filter(f=>f.repo===r.id).slice(0,5);

  const prBlock=r.pr?`
    <div class="block">
      <div class="block-head">
        <span class="eyebrow">Pull request #${r.pr.num} — ${esc(r.pr.title)}</span>
        <span class="pr-stats num">${esc(r.pr.checks)} · ${r.pr.files} fichiers · <span class="add">+${r.pr.add}</span> <span class="del">−${r.pr.del}</span></span>
      </div>
      <div class="pr-body md">${md(r.pr.body)}</div>
      <div class="block-actions">
        <button class="btn btn-primary" data-act="merge" data-n="${r.pr.num}">✓ Merger (squash)</button>
        <button class="btn" data-act="pr-comment" data-n="${r.pr.num}">💬 Demander des changements</button>
      </div>
      <div id="pr-reply" hidden>
        <div class="reply">
          <textarea id="pr-reply-text" placeholder="Ce qui doit changer — envoyé à Claude sur la PR…"></textarea>
          <button type="button" class="btn btn-mic" data-mic="#pr-reply-text" title="Dicter">🎙️</button>
          <button class="btn" data-act="pr-comment-send" data-n="${r.pr.num}">Envoyer</button>
        </div>
      </div>
    </div>`:"";

  const th=r.threadIssue;
  // Le fil s'ouvre sur TA demande (corps de l'issue) : sans elle, le dialogue
  // commençait par la réponse de Claude, sans la question.
  const req=th?requestFromIssueBody(th.body):"";
  const msgs=th?[...(req?[{user:{login:OWNER}, body:req}]:[]), ...(th.comments||[])]:[];
  const threadBar=msgs.length>1?`
      <div class="thread-bar">
        <span class="count num">${msgs.length} messages</span>
        <button class="btn-mini" data-act="thread-top">↥ Début</button>
        <button class="btn-mini" data-act="thread-bottom">↧ Dernier</button>
      </div>`:"";
  const threadBlock=th?`
    <div class="block thread-block${ui.threadBig?" full":""}" id="thread-block">
      <div class="block-head">
        <span class="eyebrow">Dialogue — issue #${th.num} « ${esc(th.title)} »</span>
        <button class="btn-mini${ui.threadBig?" on":""}" data-act="thread-big">${ui.threadBig?"✕ Fermer":"⛶ Plein écran"}</button>
      </div>
      ${threadBar}
      <div class="thread" id="thread-box">${msgs.map((m,i)=>{
        const mine=m.user.login===OWNER;
        return `<div class="msg ${mine?"":"claude"}"><span class="who">${mine?"Toi":"Claude"} <span class="msg-n">${i+1}</span></span>
          <span class="bubble md">${md(String(m.body||"").replace(/^@claude\s*/i,""))}</span></div>`;
      }).join("")||`<p class="marginalia" style="margin:0">Pas encore de commentaire — la session écrit ici.</p>`}
      </div>
      <div class="reply">
        <textarea id="thread-reply" placeholder="Répondre à Claude…"></textarea>
        <button type="button" class="btn btn-mic" data-mic="#thread-reply" title="Dicter">🎙️</button>
        <button class="btn" data-act="thread-send" data-n="${th.num}">Envoyer</button>
      </div>
    </div>`:"";

  const runBlock=r.lastRun?(()=>{
    const rs=runStatusLabel(r.lastRun);
    const col=rs.c==="mut"?"var(--mut)":`var(--${rs.c})`;
    return `
    <div class="block">
      <div class="block-head">
        <span class="eyebrow">Journal du run — ${esc(r.lastRun.wf||"Actions")}</span>
        <span class="run-state num" style="color:${col}">${rs.t}</span>
      </div>
      <div class="run-title marginalia">${esc(r.lastRun.name)} · ${esc(timeAgo(r.lastRun.started))}</div>
      <div id="run-journal" class="journal">${r.lastRun.running?'<p class="marginalia" style="margin:0">Connexion au run…</p>':""}</div>
      <div class="block-actions">
        ${r.lastRun.running?"":`<button class="btn" data-act="run-follow" data-n="${r.lastRun.id}">▸ Voir le déroulé</button>`}
        <a class="ghlink" href="${esc(r.lastRun.url)}" target="_blank" rel="noopener">logs complets ↗</a>
      </div>
    </div>`;
  })():"";

  $("#view-detail").innerHTML=`
    <div class="detail">
      <div class="detail-top">
        <button class="btn" data-act="back">← L'atelier</button>
        <h2>${esc(r.id)}</h2>
        <span class="pill" style="--c:${st.v}">${st.label}</span>
      </div>
      <div class="detail-meta">${esc(r.type)} · ${lifeLabel} · relevé ${esc(r.last)}</div>
      <div class="kit-row" id="kit-row" hidden>
        <span class="secret-badge">🔑 Secret <code>CLAUDE_CODE_OAUTH_TOKEN</code> manquant sur ce repo —
          requis pour que les sessions Claude puissent démarrer.</span>
        <button class="btn-mini" data-act="secret-set" data-n="${esc(r.id)}">Le poser (sans terminal)</button>
      </div>
      <ul class="lines">${r.lines.map(lineHtml).join("")}</ul>
      ${prBlock}
      ${runBlock}
      ${threadBlock}
      ${relatedIdeas.length?`
      <div class="sub-list">
        <div class="eyebrow"><span class="orn">❧</span>Au codex pour ce projet</div>
        ${relatedIdeas.map(i=>`
          <div class="sub-row">
            <span class="prio" style="--c:${PRIO_COLOR[i.p]}">${i.p}</span>
            <span style="flex:1">${esc(i.t)}</span>
            <a class="idea-launch" href="https://claude.ai/code" target="_blank" rel="noopener" data-cloud="${i.num}" title="Session cloud interactive">🌩</a>
            <button class="idea-launch" data-launch="${i.num}" title="Lancer en issue directe (Actions, fire-and-forget)">🚀</button>
          </div>`).join("")}
      </div>`:""}
      ${relatedFeed.length?`
      <div class="sub-list">
        <div class="eyebrow"><span class="orn">❧</span>Chroniques du projet</div>
        ${relatedFeed.map(f=>`
          <div class="sub-row"><span class="t num">${esc(dayLabel(f.ts))} ${hhmm(f.ts)}</span><span style="flex:1">${esc(f.txt)}</span></div>`).join("")}
      </div>`:""}
      <div class="detail-actions">
        <a class="btn btn-primary" href="https://claude.ai/code" target="_blank" rel="noopener" data-cloud-repo="${esc(r.id)}">🌩 Session cloud</a>
        <button class="btn" data-newfor="${esc(r.id)}">＋ Demande</button>
        ${r.life==="actif"?`<button class="btn" data-act="life" data-n="veille">⏸ Mettre en veille</button>`
                          :`<button class="btn" data-act="life" data-n="actif">▶ Réactiver</button>`}
        <button class="btn" data-act="life" data-n="archivé">🗄 Archiver</button>
        <a class="ghlink" href="${esc(r.url)}" target="_blank" rel="noopener">au besoin : GitHub ↗</a>
      </div>
    </div>`;

  // Restauration des brouillons capturés ci-dessus (même repo re-rendu).
  if(draft){
    const tr=$("#thread-reply"); if(tr && draft.thread) tr.value=draft.thread;
    const pt=$("#pr-reply-text"); if(pt && draft.pr) pt.value=draft.pr;
    if(draft.prOpen && $("#pr-reply")) $("#pr-reply").hidden=false;
    if(draft.focusId==="thread-reply"||draft.focusId==="pr-reply-text"){
      const el=document.getElementById(draft.focusId);
      if(el){ el.focus(); const L=el.value.length; try{ el.setSelectionRange(L,L); }catch(_){} }
    }
  }

  // Dialogue en plein écran : on fige le défilement de la page derrière.
  document.body.classList.toggle("thread-full-open", !!(ui.threadBig && th));

  // Secret Claude : vérification paresseuse (une requête par repo, mise en cache).
  refreshSecretBadge(r.id);

  // Journal de run : (re)brancher le suivi live sur la nouvelle boîte #run-journal.
  if(r.lastRun){
    const box=$("#run-journal");
    if(runWatch && runWatch.repo===r.id && runWatch.runId===r.lastRun.id){
      runWatch.box=box; // même run : on garde le suivi, on rebranche juste la boîte redessinée
      renderJournalInto(box, runWatch.lastJobs || (demo?r.demoJobs:null));
    } else {
      stopJournal(); // repo différent ou nouveau run : on repart proprement
      if(r.lastRun.running) startJournal(r.id, r.lastRun.id, box, demo?r.demoJobs:null);
    }
  } else stopJournal();
}
function renderSyncNote(){
  const el=$("#sync-note");
  if(ui.loading){ el.textContent="relevé en cours…"; return; }
  el.textContent=ui.lastSync?("relevé "+timeAgo(ui.lastSync.toISOString())+(demo?" · démo":"")):"";
}
function renderAll(){
  if(!model) return;
  renderSummary(); renderAttention(); renderFilters(); renderGrid();
  renderArchived(); renderIdeas(); renderFeed(); renderDetail(); renderSyncNote();
}

/* ================= Actions (écritures API) ================= */
async function ensureLabel(repo,name,color,desc){
  const key=repo+"/"+name;
  if(labelCache.has(key)) return;
  try{ await gh(`/repos/${OWNER}/${repo}/labels/${enc(name)}`); }
  catch(e){
    if(e.status===404){
      try{ await gh(`/repos/${OWNER}/${repo}/labels`,{method:"POST",body:{name,color:color||"BFB6A4",description:desc||""}}); }catch(e2){}
    }
  }
  labelCache.add(key);
}
function directBody(title,desc){
  return `${desc||title}

---
Règles de la flotte :
- Lis MAP.md et CLAUDE.md d'abord ; n'explore que ce qu'ils ne couvrent pas.
- Vérifie avant de conclure (script verify du repo, sinon build + tests) et dis dans la PR ce qui a été vérifié.
- Mets à jour BACKLOG.md dans la PR.

_Créée depuis FleetView._`;
}
async function createRequest({repo,title,desc,mode,modelChoice,prio,cat}){
  if(demo){ toast("Mode démo — rien n'est envoyé. Relie ton token pour agir en vrai."); return; }
  if(mode==="box"){
    await ensureLabel(META,"idée","E9C46A","Boîte à idées FleetView");
    await ensureLabel(META,prio,PRIO_LABEL_COLOR[prio],"Priorité codex");
    const labels=["idée",prio];
    if(cat&&IDEA_CATS[cat]){ labels.push("cat:"+cat); await ensureLabel(META,"cat:"+cat,IDEA_CATS[cat].color,"Catégorie codex : "+IDEA_CATS[cat].l); }
    const body=`**Projet** : ${repo}\n\n${desc||""}\n\n_Créée depuis FleetView._`;
    const is=await gh(`/repos/${OWNER}/${META}/issues`,{method:"POST",body:{title,body,labels}});
    toast(`💡 Idée #${is.number} rangée au codex (${prio}, projet ${repo}).`);
    return is;
  }
  const target = repo==="flotte"?META:repo;
  const labels=["claude"];
  if(MODEL_LABEL[modelChoice]) labels.push(MODEL_LABEL[modelChoice]);
  await ensureLabel(target,"claude","5319E7","Déclenche une session Claude (kit de flotte)");
  if(MODEL_LABEL[modelChoice]) await ensureLabel(target,MODEL_LABEL[modelChoice],"7B61C4","Choix de modèle");
  const body = directBody(title,desc);
  const is=await gh(`/repos/${OWNER}/${target}/issues`,{method:"POST",body:{title,body,labels}});
  toast(`⚡ Issue #${is.number} lancée sur ${target} — session Actions en route, la PR apparaîtra ici.`, 5600);
  return is;
}
async function saveIdea(num){
  if(demo){ toast("Mode démo — rien n'est envoyé."); return; }
  const title=$("#ie-title").value.trim();
  if(!title){ toast("Un titre est requis."); return; }
  const desc=$("#ie-desc").value.trim();
  const repo=$("#ie-repo").value, prio=$("#ie-prio").value, cat=$("#ie-cat").value;
  await ensureLabel(META,prio,PRIO_LABEL_COLOR[prio],"Priorité codex");
  const labels=["idée",prio];
  if(cat){ labels.push("cat:"+cat); await ensureLabel(META,"cat:"+cat,IDEA_CATS[cat].color,"Catégorie codex : "+IDEA_CATS[cat].l); }
  const body=`**Projet** : ${repo}\n\n${desc||""}\n\n_Créée depuis FleetView._`;
  await gh(`/repos/${OWNER}/${META}/issues/${num}`,{method:"PATCH",body:{title,body,labels}});
  ideaUI.edit=null;
  toast("✎ Idée mise à jour.");
}
async function removeIdea(num){
  if(demo){ toast("Mode démo — rien n'est envoyé."); return; }
  await gh(`/repos/${OWNER}/${META}/issues/${num}/comments`,{method:"POST",body:{body:"→ retirée du codex depuis FleetView."}});
  await gh(`/repos/${OWNER}/${META}/issues/${num}`,{method:"PATCH",body:{state:"closed",state_reason:"not_planned"}});
  ideaUI.open=null; ideaUI.edit=null;
  toast("🗑 Idée retirée du codex.");
}
async function closeIdea(num, launchedUrl){
  try{
    await gh(`/repos/${OWNER}/${META}/issues/${num}/comments`,{method:"POST",body:{body:`→ lancée : ${launchedUrl}`}});
    await gh(`/repos/${OWNER}/${META}/issues/${num}`,{method:"PATCH",body:{state:"closed"}});
  }catch(e){}
}
async function sendComment(repo,num,text){
  if(demo){ toast("Mode démo — rien n'est envoyé."); return; }
  await gh(`/repos/${OWNER}/${repo}/issues/${num}/comments`,{method:"POST",body:{body:`@claude ${text}`}});
  toast("💬 Envoyé — la session Claude reprend sur ce fil (relève dans ~1 min).");
}
async function mergePr(repo,num){
  if(demo){ toast("Mode démo — rien n'est envoyé."); return; }
  await gh(`/repos/${OWNER}/${repo}/pulls/${num}/merge`,{method:"PUT",body:{merge_method:"squash"}});
  toast(`✓ PR #${num} mergée (squash) — sans ouvrir GitHub.`);
}
async function rerunRun(repo,runId){
  if(demo){ toast("Mode démo — rien n'est envoyé."); return; }
  try{ await gh(`/repos/${OWNER}/${repo}/actions/runs/${runId}/rerun-failed-jobs`,{method:"POST"}); }
  catch(e){ await gh(`/repos/${OWNER}/${repo}/actions/runs/${runId}/rerun`,{method:"POST"}); }
  toast("⟳ Run relancé — résultat au prochain relevé.");
}
async function setLifecycle(repoId,statut){
  if(demo){ toast("Mode démo — rien n'est envoyé."); return; }
  // re-fetch pour éviter les conflits de sha, ne modifier que `statut`
  const ff=await gh(`/repos/${OWNER}/${META}/contents/${FLEET_PATH}`);
  const json=JSON.parse(b64d(ff.content));
  const entry=(json.repos||[]).find(r=>r.repo===repoId);
  if(!entry){ toast("Repo absent du registre — lance node scripts/fleet.mjs sur claude-ops."); return; }
  entry.statut=statut;
  await gh(`/repos/${OWNER}/${META}/contents/${FLEET_PATH}`,{method:"PUT",body:{
    message:`fleetview: statut ${repoId} → ${statut}`,
    content:b64e(JSON.stringify(json,null,2)+"\n"), sha:ff.sha,
  }});
  toast({veille:"⏸ En veille — dev en pause, crons toujours surveillés.",
         "archivé":"🗄 Archivé — disparaît du suivi, réactivable depuis le tiroir.",
         actif:"▶ Réactivé — de retour dans l'atelier."}[statut]||"Statut mis à jour.");
}
async function newProject(name,type,priv){
  if(demo){ toast("Mode démo — rien n'est envoyé."); return; }
  toast(`⚒ Création de ${name}…`, 8000);
  await gh(`/user/repos`,{method:"POST",body:{name, private:priv, auto_init:true,
    description:"Né équipé du kit de flotte, via FleetView."}});
  // Copie des templates fleet-kit via l'API contents
  const files=[["templates/common/.github/workflows/claude.yml",".github/workflows/claude.yml"],
               ["templates/common/.github/workflows/map.yml",".github/workflows/map.yml"],
               ["templates/common/.claude/settings.json",".claude/settings.json"],
               ["templates/common/BACKLOG.md","BACKLOG.md"],
               ["VERSION",".kit-version"]];
  if(type==="static"){
    files.push(["templates/static/.github/workflows/pages.yml",".github/workflows/pages.yml"],
               ["templates/static/.claude/launch.json",".claude/launch.json"],
               ["templates/static/scripts/verify.mjs","scripts/verify.mjs"]);
  }
  for(const [src,dst] of files){
    try{
      const f=await gh(`/repos/${OWNER}/fleet-kit/contents/${enc(src).replace(/%2F/g,"/")}`);
      await gh(`/repos/${OWNER}/${name}/contents/${dst}`,{method:"PUT",body:{
        message:`chore: kit de flotte — ${dst}`, content:f.content.replace(/\n/g,"")}});
    }catch(e){ console.warn("kit:",src,e); }
  }
  const tpl=await gh(`/repos/${OWNER}/fleet-kit/contents/templates/common/CLAUDE.md.tpl`);
  const claudeMd=b64d(tpl.content).replace(/\{\{NOM\}\}/g,name).replace(/\{\{[A-Z_]+\}\}/g,"TODO au premier chantier");
  await gh(`/repos/${OWNER}/${name}/contents/CLAUDE.md`,{method:"PUT",body:{
    message:"chore: kit de flotte — CLAUDE.md", content:b64e(claudeMd)}});
  await ensureLabel(name,"claude","5319E7","Déclenche une session Claude (kit de flotte)");
  const secretUrl=`https://github.com/${OWNER}/${name}/settings/secrets/actions/new`;
  await gh(`/repos/${OWNER}/${name}/issues`,{method:"POST",body:{
    title:"Finaliser l'équipement du repo",
    body:`Repo créé depuis FleetView avec les stubs du kit (${type}).\n\nReste à faire (sans terminal) :\n- [ ] **Poser le secret \`CLAUDE_CODE_OAUTH_TOKEN\`** (ou \`ANTHROPIC_API_KEY\`) → [ouvrir la page du secret](${secretUrl}), coller la clé Claude, « Add secret ». Requis pour la première session.\n- [ ] Activer « Actions peut créer des PRs » (Settings → Actions → Workflow permissions)\n- [ ] Personnaliser CLAUDE.md (placeholders TODO)\n- [ ] Rafraîchir le registre : \`node scripts/fleet.mjs\` sur claude-ops (pour voir la carte dans FleetView)\n${type.startsWith("cron")?"- [ ] Créer le workflow planifié + self-heal\n":""}`}});
  // Ouvre la page du secret et copie le nom : la première session part sans passer par un terminal.
  try{ navigator.clipboard && navigator.clipboard.writeText("CLAUDE_CODE_OAUTH_TOKEN"); }catch(e){}
  try{ window.open(secretUrl,"_blank","noopener"); }catch(e){}
  toast(`⚒ ${name} créé et équipé. Onglet ouvert pour poser le secret Claude (nom copié) — colle ta clé, « Add secret », et la première session peut partir.`, 8000);
}

/* ================= Lanceur de session cloud ================= */
// L'interactif (cadrage, questions/réponses, précisions) passe par une session claude.ai/code :
// conversation continue, suivable sur mobile, reprenable dans l'app desktop, sur l'abonnement.
// Aucune API publique ne permet de pré-remplir une session : on compose le prompt, on le copie,
// et on ouvre claude.ai/code — le geste assumé est copier → coller.
function composeCloudPrompt({repo, title, desc}){
  const target = repo==="flotte" ? META : repo;
  const tache = title
    ? `## Tâche\n${title}${desc?`\n\n${desc}`:""}`
    : `## Tâche\n_(à préciser dans la session : dis-moi ce que tu veux faire sur ce repo)_`;
  return `Travaille sur le repo GitHub **${OWNER}/${target}**.

${tache}

## Règles de la flotte
- Lis \`MAP.md\` puis \`CLAUDE.md\` du repo d'abord ; n'explore que ce qu'ils ne couvrent pas.
- Travaille sur une branche dédiée \`claude/<slug>\`, jamais directement sur la branche par défaut.
- Vérifie avant de conclure : lance le script verify du repo (souvent \`node scripts/verify.mjs\`) ou build + tests, et regarde le résultat tourner.
- Ouvre la PR toi-même avec \`gh pr create\` (titre et corps en français) ; mets à jour \`BACKLOG.md\` dans la même PR.

On cadre ensemble ici : pose-moi tes questions au fil de l'eau, je te réponds dans cette session avant que tu n'ailles trop loin.`;
}
// Copie synchrone (dans le geste de clic, sans dépendre du focus ni d'un contexte sécurisé) :
// la voie la plus fiable sur mobile et en http. L'API Clipboard moderne sert de filet.
function copyViaTextarea(text){
  try{
    const ta=document.createElement("textarea");
    ta.value=text; ta.setAttribute("readonly","");
    ta.style.position="fixed"; ta.style.top="-1000px"; ta.style.opacity="0";
    document.body.appendChild(ta);
    ta.select(); ta.setSelectionRange(0, text.length);
    const ok=document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  }catch(e){ return false; }
}
function showCloudPrompt(text){
  const dlg=$("#modal-cloud"), ta=$("#cloud-prompt-text");
  if(dlg && ta){ ta.value=text; dlg.showModal(); setTimeout(()=>{ ta.focus(); ta.select(); }, 50); }
  else { try{ window.prompt("Copie ce prompt, puis colle-le dans claude.ai/code :", text); }catch(e){} }
}
function launchCloud(ctx){
  const text=composeCloudPrompt(ctx);
  if(demo){ // en démo : on montre le prompt composé, sans ouvrir d'onglet externe ni copier en douce
    showCloudPrompt(text);
    toast("Mode démo — voici le prompt qui serait copié puis ouvert dans claude.ai/code.", 6000);
    return;
  }
  const copied=copyViaTextarea(text);                          // synchrone, dans le geste
  const win=window.open("https://claude.ai/code","_blank","noopener"); // dans le geste (sinon bloqué)
  const done=(ok)=>{
    if(ok) toast(win
      ? "🌩 Prompt copié — colle-le (Ctrl/Cmd+V) dans la nouvelle session claude.ai/code."
      : "🌩 Prompt copié. Autorise les pop-ups ou ouvre claude.ai/code, puis colle-le (Ctrl/Cmd+V).", 7000);
    else showCloudPrompt(text);                                // dernier recours : copie manuelle
  };
  if(copied) done(true);
  else if(navigator.clipboard && navigator.clipboard.writeText)
    navigator.clipboard.writeText(text).then(()=>done(true)).catch(()=>done(false));
  else done(false);
}
// Variante « lien » des boutons 🌩 : ils sont de vrais <a href="claude.ai/code"> tapés.
// Sur mobile, un lien réellement tapé est le seul déclencheur fiable des universal/app links
// (contrairement à window.open) — c'est donc la meilleure chance d'ouvrir l'app Claude plutôt
// que le navigateur. On copie le prompt DANS le geste, puis on LAISSE le lien s'ouvrir
// (ni preventDefault, ni window.open : pas de double ouverture).
function launchCloudFromLink(e, ctx){
  const text=composeCloudPrompt(ctx);
  if(demo){ // démo : on n'ouvre pas d'onglet externe, on montre le prompt composé
    e.preventDefault(); showCloudPrompt(text);
    toast("Mode démo — voici le prompt qui serait copié puis ouvert dans claude.ai/code.", 6000);
    return;
  }
  if(copyViaTextarea(text)){
    toast("🌩 Prompt copié — colle-le (Ctrl/Cmd+V) dans la session claude.ai/code qui s'ouvre.", 7000);
  } else {
    // Copie synchrone impossible (certains WebViews mobiles) : filet moderne asynchrone,
    // et on affiche le prompt en repli pour une copie manuelle. Le lien s'ouvre quand même.
    if(navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).catch(()=>{});
    toast("🌩 Session ouverte. Si rien ne se colle, le prompt s'affiche ici à copier à la main.", 7000);
    showCloudPrompt(text);
  }
}

/* ================= Notifications ntfy ================= */
// Push uniquement sur événements actionnables NOUVEAUX (question de Claude, PR prête).
// Le lien de la notif rouvre FleetView sur le bon projet (?repo=…).
function loadNotified(){ try{ return new Set(JSON.parse(localStorage.getItem("fv-notified")||"[]")); }catch(e){ return new Set(); } }
function saveNotified(set){ try{ localStorage.setItem("fv-notified", JSON.stringify([...set].slice(-300))); }catch(e){} }
function notifClickUrl(ev){ return location.origin+location.pathname+(ev.repo?"?repo="+enc(ev.repo):""); }
// Publication ntfy : POST directement sur l'URL du sujet, métadonnées en query string
// (l'endpoint canonique — le POST JSON à la racine est refusé par certaines configurations, d'où des 405).
async function publishNtfy(url, ev){
  let u; try{ u=new URL(url); }catch(e){ throw new Error("URL ntfy invalide (attendu : https://ntfy.sh/mon-sujet)"); }
  if(u.pathname.replace(/\/+$/,"").length<2) throw new Error("Sujet manquant dans l'URL ntfy (attendu : https://ntfy.sh/mon-sujet).");
  const q=new URLSearchParams({title:ev.title, click:notifClickUrl(ev), tags:ev.tag||"bell", priority:String(ev.prio||4)});
  const res=await fetch(u.origin+u.pathname.replace(/\/+$/,"")+"?"+q, {method:"POST", body:ev.msg});
  if(!res.ok) throw new Error("ntfy a répondu "+res.status);
}
// Notification native de l'appareil : aucun service tiers, le service worker l'affiche
// (obligatoire sur Android) et son clic rouvre FleetView sur le bon projet.
async function nativeNotify(ev){
  if(!("Notification" in window) || Notification.permission!=="granted") return false;
  const opts={ body:ev.msg, tag:ev.key, icon:"icon-192.png", badge:"maskable-192.png", data:{url:notifClickUrl(ev)} };
  try{
    if("serviceWorker" in navigator){
      const reg=await navigator.serviceWorker.ready;
      await reg.showNotification(ev.title, opts);
      return true;
    }
  }catch(e){}
  try{ new Notification(ev.title, opts); return true; }catch(e){ return false; }
}
async function runPush(){
  if(demo || !model || !model.notify || !model.notify.length) return;
  const wantNative = store.notif==="on" && "Notification" in window && Notification.permission==="granted";
  const url=store.ntfy;
  if(!wantNative && !url) return;
  const seen=loadNotified(); let changed=false;
  for(const ev of model.notify){
    if(seen.has(ev.key)) continue;
    seen.add(ev.key); changed=true;
    if(wantNative) nativeNotify(ev);
    if(url){ try{ await publishNtfy(url, ev); }catch(e){ /* réseau : on ne bloque pas le relevé */ } }
  }
  if(changed) saveNotified(seen);
}
// À l'activation : marque les événements courants comme « déjà vus » pour ne pousser
// QUE les nouveautés (sinon activation = rafale de toutes les notifs en attente).
function seedNotified(){
  const seen=loadNotified();
  if(model && model.notify) for(const ev of model.notify) seen.add(ev.key);
  saveNotified(seen);
}
// Deep-link : ?repo=<id> ouvre directement la vue projet, puis nettoie l'URL.
function readDeepLink(){
  try{
    const rp=new URLSearchParams(location.search).get("repo");
    if(rp){ pendingOpen=rp; history.replaceState(null,"",location.pathname); }
  }catch(e){}
}
function applyPendingOpen(){
  if(!pendingOpen || !model) return;
  const target=pendingOpen; pendingOpen=null;
  openDetail(target);
}

/* ================= Rafraîchissement ================= */
function offlineBanner(atISO){
  banner("Hors ligne — dernier relevé "+(atISO?timeAgo(atISO):"inconnu")+". Reconnecte-toi pour rafraîchir.", "info");
}
// Bascule en affichage hors-ligne : garde le modèle courant s'il existe, sinon relit le dernier
// relevé en cache. Retourne true si quelque chose est affichable.
function hydrateFromSnapshot(){
  if(model){ offlineBanner(ui.lastSync?ui.lastSync.toISOString():null); return true; }
  const snap=store.snapshot;
  if(snap&&snap.model){
    model=snap.model; ui.lastSync=snap.at?new Date(snap.at):null;
    renderAll(); offlineBanner(snap.at); return true;
  }
  return false;
}

async function refresh(showErrors=true){
  if(ui.loading) return;
  ui.loading=true; renderSyncNote();
  try{
    await loadAll();
    // En démo, le bandeau d'avertissement reste affiché (il était effacé sitôt posé).
    if(demo) banner("Mode démo : données factices, aucune action réelle. Recharge la page pour relier ton token.","info");
    else banner(null);
    renderAll();
    applyPendingOpen(); // deep-link ntfy éventuel
    runPush();          // notifie les nouveaux événements actionnables
  }catch(e){
    if(e.rateLimit){
      // Quota épuisé : on garde l'affichage courant, pas d'écran de config.
      banner("Quota API GitHub épuisé — l'affichage reste sur le dernier relevé, nouvel essai au prochain cycle"+(rateInfo.reset?" (réinit. "+timeUntil(rateInfo.reset)+")":"")+".", "info");
    } else if(e.status===401||e.status===403){
      banner("Token refusé par GitHub ("+e.status+"). Vérifie ses permissions ou recolle-le.", "");
      showConfig(true);
    } else if(!e.status){
      // Pas de code HTTP → erreur réseau : on bascule hors-ligne sur le dernier relevé.
      if(!hydrateFromSnapshot() && showErrors){
        banner("Hors ligne — aucun relevé en cache pour l'instant. Reconnecte-toi.", "info");
      }
    } else if(showErrors){
      banner("Relevé impossible : "+errMsg(e)+" — nouvel essai au prochain cycle.");
    }
  }finally{
    ui.loading=false; renderSyncNote();
  }
}

/* ================= Écrans ================= */
function showConfig(show){
  $("#view-config").hidden=!show;
  $("#view-app").hidden=show;
  $("#bottombar").hidden=show;
  $("#btn-new").hidden=show;
  $("#btn-newidea").hidden=show;
  $("#btn-newproject").hidden=show;
}

/* ================= Modales ================= */
const modal=$("#modal"), modalProjet=$("#modal-projet");
function openModal(opts){
  opts=opts||{};
  if(!model) return;
  const sel=$("#f-repo");
  sel.innerHTML=`<option value="flotte">flotte (claude-ops)</option>`+
    model.repos.filter(r=>r.life!=="archive").map(r=>`<option value="${esc(r.id)}"${r.id===opts.repo?" selected":""}>${esc(r.id)} — ${esc(r.type)}</option>`).join("");
  $("#form-new").reset();
  if(opts.repo) sel.value=opts.repo;
  $("#f-title").value=opts.title||"";
  $("#f-desc").value=opts.desc||"";
  // Parcours de départ : "box" pour ranger au codex, "direct" pour une issue fire-and-forget,
  // sinon "cloud" (session interactive claude.ai/code) — le défaut recommandé pour cadrer.
  const parcours=opts.parcours||"cloud";
  const rp=document.querySelector(`input[name="f-when"][value="${parcours}"]`); if(rp) rp.checked=true;
  $("#modal-title").textContent=opts.title?"Lancer cette idée":(parcours==="box"?"Nouvelle idée":"Nouvelle demande");
  $("#opt-box").style.display=opts.hideBox?"none":"";
  $("#modal-note").textContent=demo?"Mode démo : aucune action réelle.":"";
  if(!opts.title) ideaLaunchCtx=null;
  syncWhen();
  modal.showModal();
  setTimeout(()=>$(opts.title?"#f-desc":"#f-title").focus(),50);
}
function syncWhen(){
  const v=document.querySelector('input[name="f-when"]:checked').value;
  $("#f-prio-row").classList.toggle("on",v==="box");
  $("#f-cat-row").classList.toggle("on",v==="box");
  // Le choix de modèle ne concerne que l'issue directe (Actions) ; la session cloud choisit le sien.
  $("#f-model-row").style.display=v==="direct"?"":"none";
  $("#f-submit").textContent={cloud:"🌩 Ouvrir la session cloud",direct:"⚡ Créer l'issue",box:"💡 Ranger au codex"}[v];
}

/* ================= Événements ================= */
// Ouvre la vue projet d'un repo (depuis « À traiter », une carte, ou un bouton de ligne).
function openDetail(id){
  if(!model || !model.repos.some(x=>x.id===id)) return;
  if(ui.openRepo!==id){
    if(!ui.openRepo) ui.scrollY=window.scrollY; // position dans l'atelier, restaurée au retour
    ui.openRepo=id; ui.threadBig=false;
  }
  document.body.dataset.tab="flotte";
  document.querySelectorAll(".bb-btn").forEach(x=>x.setAttribute("aria-pressed",String(x.dataset.tab==="flotte")));
  renderDetail(); window.scrollTo({top:0});
}
document.addEventListener("click",async(e)=>{
  const b=e.target.closest("button, a");
  let r=ui.openRepo&&model?model.repos.find(x=>x.id===ui.openRepo):null;

  if(b){
    if(b.dataset.filter!==undefined){ ui.filter=b.dataset.filter; renderFilters(); renderGrid(); return; }
    if(b.dataset.tab!==undefined){
      document.body.dataset.tab=b.dataset.tab;
      document.querySelectorAll(".bb-btn").forEach(x=>x.setAttribute("aria-pressed",String(x===b)));
      if(b.dataset.tab!=="flotte"){ ui.openRepo=null; renderDetail(); }
      return;
    }
    if(b.dataset.open!==undefined){ openDetail(b.dataset.open); return; }
    if(b.dataset.newfor!==undefined){ openModal({repo:b.dataset.newfor}); return; }
    if(b.dataset.launch!==undefined){
      const idea=model.ideas.find(i=>i.num===Number(b.dataset.launch));
      if(idea){ ideaLaunchCtx=idea; openModal({repo:idea.repo==="flotte"?"flotte":idea.repo,title:idea.t,desc:idea.desc,hideBox:true,parcours:"direct"}); }
      return;
    }
    // Session cloud interactive : les 🌩 sont de vrais liens <a> — on copie le prompt et on
    // laisse le lien s'ouvrir (meilleure chance d'ouvrir l'app Claude sur mobile).
    if(b.dataset.cloud!==undefined){
      const idea=model.ideas.find(i=>i.num===Number(b.dataset.cloud));
      if(idea) launchCloudFromLink(e, {repo:idea.repo, title:idea.t, desc:idea.desc});
      else e.preventDefault(); // idée introuvable : ne pas ouvrir claude.ai pour rien
      return;
    }
    if(b.dataset.cloudRepo!==undefined){ launchCloudFromLink(e, {repo:b.dataset.cloudRepo}); return; }
    if(b.dataset.unarchive!==undefined){
      try{ await setLifecycle(b.dataset.unarchive,"actif"); await refresh(); }catch(err){ toast("Échec : "+errMsg(err)); }
      return;
    }
    if(b.dataset.act!==undefined){
      const n=b.dataset.n;
      // Bouton d'une carte de l'atelier (vue projet pas encore ouverte) : le repo
      // se déduit de la carte — sans ça, ces boutons ne feraient rien depuis la grille.
      if(!r && model){
        const card=e.target.closest(".card");
        if(card) r=model.repos.find(x=>x.id===card.dataset.card);
      }
      try{
        switch(b.dataset.act){
          case "back": ui.openRepo=null; ui.threadBig=false; renderDetail();
            window.scrollTo({top:ui.scrollY||0}); ui.scrollY=0; break;
          case "open-thread": if(r) openDetail(r.id); break; // le fil est dans la vue projet
          case "open-pr": if(r) openDetail(r.id); break;     // le bloc PR aussi
          case "gh-issue": if(r) window.open(`${r.url}/issues/${n}`,"_blank"); break;
          case "merge": if(r){ b.disabled=true; await mergePr(r.id,n); await refresh(); } break;
          case "pr-comment": $("#pr-reply").hidden=false; $("#pr-reply-text").focus(); break;
          case "pr-comment-send": if(r){ const v=$("#pr-reply-text").value.trim(); if(!v)break;
            b.disabled=true; await sendComment(r.id,n,v);
            $("#pr-reply-text").value=""; $("#pr-reply").hidden=true; await refresh(); } break;
          case "thread-send": if(r){ const v=$("#thread-reply").value.trim(); if(!v)break;
            b.disabled=true; await sendComment(r.id,n,v);
            $("#thread-reply").value=""; await refresh(); } break;
          case "thread-big": ui.threadBig=!ui.threadBig; renderDetail();
            if(ui.threadBig){ const ms=document.querySelectorAll("#thread-box .msg"); if(ms.length) ms[ms.length-1].scrollIntoView({block:"end"}); } break;
          case "thread-top": { const m=document.querySelector("#thread-box .msg"); if(m) m.scrollIntoView({behavior:"smooth",block:"nearest"}); } break;
          case "thread-bottom": { const ms=document.querySelectorAll("#thread-box .msg"); if(ms.length) ms[ms.length-1].scrollIntoView({behavior:"smooth",block:"nearest"}); } break;
          case "rerun": if(r){ b.disabled=true; await rerunRun(r.id,n); await refresh(); } break;
          case "relabel": if(r){ b.disabled=true;
            await sendComment(r.id,n,"la session ne semble pas avoir abouti — reprends cette issue depuis le début."); await refresh(); } break;
          case "life": if(r){ b.disabled=true; await setLifecycle(r.id,n);
            if(n==="archivé") ui.openRepo=null; await refresh(); } break;
          case "run-follow": if(r&&r.lastRun) startJournal(r.id, r.lastRun.id, $("#run-journal"), demo?r.demoJobs:null); break;
          case "secret-set": openSecretPage(n||(r&&r.id)); break;
          case "demo": toast("Mode démo — relie ton token pour agir en vrai."); break;
        }
      }catch(err){ toast("Échec : "+errMsg(err, b.dataset.act==="merge"?"merge":""), 6000); b.disabled=false; }
      return;
    }
  }
  const card=e.target.closest(".card");
  if(card&&!b) openDetail(card.dataset.card);
});

// La modale ne se ferme qu'en cas de SUCCÈS : avant, method="dialog" la fermait dès le
// submit et un échec API (422, réseau…) emportait tout ce qui avait été saisi.
$("#form-new").addEventListener("submit",async(e)=>{
  e.preventDefault();
  const title=$("#f-title").value.trim();
  if(!title){ $("#f-title").focus(); return; }
  const repo=$("#f-repo").value;
  const desc=$("#f-desc").value.trim();
  const mode=document.querySelector('input[name="f-when"]:checked').value;
  // Parcours cloud : on ne crée pas d'issue — on compose le prompt, on copie, on ouvre claude.ai/code.
  // (Doit rester dans le geste de submit pour l'écriture presse-papier et l'ouverture d'onglet.)
  if(mode==="cloud"){ launchCloud({repo,title,desc}); ideaLaunchCtx=null; modal.close(); return; }
  const modelChoice=document.querySelector('input[name="f-model"]:checked').value;
  const prio=document.querySelector('input[name="f-prio"]:checked').value;
  const cat=$("#f-cat").value;
  const btn=$("#f-submit");
  btn.disabled=true; btn.textContent="Envoi…";
  try{
    const is=await createRequest({repo,title,desc,mode,modelChoice,prio,cat});
    const ctx=ideaLaunchCtx; ideaLaunchCtx=null;
    if(ctx&&is&&mode!=="box") await closeIdea(ctx.num,is.html_url);
    modal.close();
    await refresh(false);
  }catch(err){ toast("Échec : "+errMsg(err), 6000); }
  finally{ btn.disabled=false; syncWhen(); }
});
document.querySelectorAll('input[name="f-when"]').forEach(x=>x.addEventListener("change",syncWhen));
$("#btn-new").addEventListener("click",()=>openModal());
// « Idée » (topbar + panneau codex) : même modale, parcours « Codex » présélectionné.
document.querySelectorAll(".act-newidea").forEach(b=>b.addEventListener("click",()=>openModal({parcours:"box"})));
$("#modal-close").addEventListener("click",()=>modal.close());
$("#btn-newproject").addEventListener("click",()=>modalProjet.showModal());
$("#link-newproject").addEventListener("click",(e)=>{e.preventDefault();modal.close();modalProjet.showModal();});
$("#modal-projet-close").addEventListener("click",()=>modalProjet.close());
$("#form-projet").addEventListener("submit",async(e)=>{
  e.preventDefault(); // même principe : fermeture au succès seulement
  const name=$("#p-name").value.trim();
  if(!name) return;
  const type=$("#p-type").value;
  const priv=document.querySelector('input[name="p-vis"]:checked').value==="private";
  const btn=document.querySelector('#form-projet button[type="submit"]');
  btn.disabled=true; const old=btn.textContent; btn.textContent="⚒ Création…";
  try{ await newProject(name,type,priv); modalProjet.close(); await refresh(false); }
  catch(err){ toast("Échec : "+errMsg(err), 7000); }
  finally{ btn.disabled=false; btn.textContent=old; }
});

$("#btn-refresh").addEventListener("click",()=>refresh());

/* Codex : déplier, éditer, supprimer, filtrer par projet */
$("#ideas").addEventListener("click",async(e)=>{
  const t=e.target.closest("[data-idea-toggle],[data-idea-edit],[data-idea-del],[data-idea-save],[data-idea-cancel]");
  if(!t) return;
  const d=t.dataset;
  try{
    if(d.ideaToggle!==undefined){
      const n=Number(d.ideaToggle);
      ideaUI.open=ideaUI.open===n?null:n; ideaUI.edit=null; renderIdeas();
    } else if(d.ideaEdit!==undefined){
      ideaUI.open=Number(d.ideaEdit); ideaUI.edit=Number(d.ideaEdit); renderIdeas();
    } else if(d.ideaCancel!==undefined){
      ideaUI.edit=null; renderIdeas();
    } else if(d.ideaSave!==undefined){
      t.disabled=true; await saveIdea(Number(d.ideaSave)); await refresh(false);
    } else if(d.ideaDel!==undefined){
      if(!confirm("Retirer cette idée du codex ?")) return;
      t.disabled=true; await removeIdea(Number(d.ideaDel)); await refresh(false);
    }
  }catch(err){ t.disabled=false; toast("Échec : "+errMsg(err), 6000); }
});
$("#ideas").addEventListener("change",(e)=>{
  if(e.target.id==="ideas-repo-filter"){ ideaUI.repoFilter=e.target.value; renderIdeas(); }
});
$("#ideas").addEventListener("keydown",(e)=>{
  const t=e.target.closest("[data-idea-toggle]");
  if(t&&(e.key==="Enter"||e.key===" ")){ e.preventDefault(); t.click(); }
});

/* ================= Dictée vocale (générique : tout bouton [data-mic]) =================
   data-mic="#selecteur" cible le champ à remplir ; data-mic-interim="#sel" (optionnel)
   affiche le texte provisoire. Le texte final s'AJOUTE au contenu, sans l'écraser. */
(function initMic(){
  const Ctor=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!Ctor){ document.documentElement.classList.add("no-mic"); return; } // API absente : boutons masqués en CSS
  let rec=null, activeBtn=null, micGranted=false;
  function stopRec(){ if(rec){ try{ rec.stop(); }catch(e){} } }
  // Déclenche l'invite de permission micro d'Android et enregistre le site dans les
  // autorisations (la Web Speech API seule ne l'y fait pas toujours apparaître).
  async function ensureMic(){
    if(micGranted) return true;
    if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia) return true; // pas de garantie : on tente quand même
    try{
      const s=await navigator.mediaDevices.getUserMedia({audio:true});
      s.getTracks().forEach(t=>t.stop()); // on ne voulait que la permission
      micGranted=true; return true;
    }catch(err){
      toast("Micro bloqué. Android : Paramètres → Applications → Chrome (ou FleetView) → Autorisations → Microphone. Sinon, le micro du clavier marche dans n'importe quel champ.", 8000);
      return false;
    }
  }
  document.addEventListener("click",async(e)=>{
    const btn=e.target.closest("[data-mic]");
    if(!btn) return;
    if(activeBtn===btn){ stopRec(); return; } // second appui : arrêt
    stopRec();
    const target=document.querySelector(btn.dataset.mic);
    if(!target) return;
    if(!(await ensureMic())) return;
    const interimEl=btn.dataset.micInterim?document.querySelector(btn.dataset.micInterim):null;
    let base=target.value;
    const r=new Ctor();
    r.lang="fr-FR"; r.interimResults=true; r.continuous=false;
    r.addEventListener("result",(ev)=>{
      let interim="";
      for(let i=ev.resultIndex;i<ev.results.length;i++){
        const res=ev.results[i];
        if(res.isFinal){
          const t=res[0].transcript.trim();
          if(t){ base = base ? (base+" "+t) : t; target.value=base; }
        } else interim+=res[0].transcript;
      }
      if(interimEl){
        if(interim){ interimEl.textContent=interim; interimEl.hidden=false; }
        else { interimEl.hidden=true; interimEl.textContent=""; }
      }
    });
    r.addEventListener("end",()=>{
      btn.classList.remove("on");
      if(activeBtn===btn){ activeBtn=null; rec=null; }
      if(interimEl){ interimEl.hidden=true; interimEl.textContent=""; }
    });
    r.addEventListener("error",(ev)=>{
      if(ev.error==="not-allowed"||ev.error==="service-not-allowed"){
        micGranted=false;
        toast("Micro bloqué. Android : Paramètres → Applications → Chrome (ou FleetView) → Autorisations → Microphone. Sinon, le micro du clavier marche dans n'importe quel champ.", 8000);
      } else if(ev.error!=="no-speech" && ev.error!=="aborted"){
        toast("Dictée vocale indisponible pour le moment (elle passe par un service Google, parfois capricieux). Le micro du clavier reste une alternative.", 7000);
      }
    });
    try{ r.start(); rec=r; activeBtn=btn; btn.classList.add("on"); }
    catch(err){ btn.classList.remove("on"); }
  });
})();

$("#token-save").addEventListener("click",async()=>{
  const v=$("#token-input").value.trim(); if(!v) return;
  store.token=v; demo=false;
  showConfig(false);
  await refresh();
});
$("#token-input").addEventListener("keydown",(e)=>{ if(e.key==="Enter"){ e.preventDefault(); $("#token-save").click(); } });
$("#demo-link").addEventListener("click",async(e)=>{
  e.preventDefault(); demo=true; showConfig(false);
  banner("Mode démo : données factices, aucune action réelle. Recharge la page pour relier ton token.","info");
  await refresh();
});

/* ================= Paramètres ================= */
const modalSettings=$("#modal-settings");
$("#btn-settings").addEventListener("click",()=>{
  $("#ntfy-input").value=store.ntfy;
  renderRate(); updateNotifStatus();
  modalSettings.showModal();
});
$("#modal-settings-close").addEventListener("click",()=>modalSettings.close());
$("#modal-cloud-close").addEventListener("click",()=>$("#modal-cloud").close());
// Notifications natives (API Notification du navigateur — sans service tiers)
function updateNotifStatus(){
  const el=$("#notif-status"); if(!el) return;
  if(!("Notification" in window)){ el.textContent="non gérées par ce navigateur"; return; }
  if(Notification.permission==="denied"){ el.textContent="bloquées — vois les autorisations du site"; return; }
  el.textContent = (store.notif==="on"&&Notification.permission==="granted") ? "✓ activées" : "désactivées";
}
$("#notif-native").addEventListener("click",async()=>{
  if(!("Notification" in window)){ toast("Ce navigateur ne gère pas les notifications."); return; }
  if(store.notif==="on"&&Notification.permission==="granted"){ // second appui : désactive
    store.notif=""; updateNotifStatus(); toast("Notifications de l'appareil désactivées."); return;
  }
  const p=await Notification.requestPermission();
  if(p==="granted"){
    store.notif="on"; seedNotified(); updateNotifStatus();
    toast("🔔 Activées — tu ne seras notifié que d'une question de Claude ou d'une PR prête.");
    nativeNotify({key:"test-"+Date.now(), title:"FleetView — test", msg:"Les notifications de l'appareil fonctionnent 🎉", repo:"", tag:"bell"});
  } else {
    store.notif=""; updateNotifStatus();
    toast(p==="denied"?"Notifications bloquées par le navigateur — Android : Paramètres du site → Notifications.":"Permission non accordée.");
  }
});
// Notifications ntfy
$("#ntfy-save").addEventListener("click",()=>{
  const v=$("#ntfy-input").value.trim();
  store.ntfy=v;
  if(v){ seedNotified(); toast("🔔 Notifications activées — tu ne recevras que les NOUVEAUX événements (question de Claude, PR prête)."); }
  else toast("Notifications désactivées.");
});
$("#ntfy-test").addEventListener("click",async()=>{
  const v=$("#ntfy-input").value.trim()||store.ntfy;
  if(!v){ toast("Renseigne d'abord l'URL du sujet ntfy (ex. https://ntfy.sh/mon-sujet)."); return; }
  try{
    await publishNtfy(v,{title:"FleetView — test", msg:"Si tu lis ceci sur ton téléphone, c'est branché 🎉",
      repo:(model&&model.repos[0]&&model.repos[0].id)||"", tag:"bell", prio:3});
    toast("🔔 Test envoyé — vérifie la notif sur ton téléphone.");
  }catch(e){ toast("Échec de l'envoi : "+e.message, 6000); }
});
$("#ntfy-clear").addEventListener("click",()=>{ store.ntfy=""; $("#ntfy-input").value=""; toast("Notifications désactivées."); });
$("#btn-change-token").addEventListener("click",()=>{
  modalSettings.close();
  $("#token-input").value="";
  showConfig(true); // l'ancien token reste actif tant qu'un nouveau n'est pas relié
});

/* ================= Thème ================= */
const themeSel=$("#theme-select");
// La meta theme-color suit le thème : sans ça, la barre d'état mobile restait
// parchemin même en thème sombre.
function syncThemeColor(){
  const meta=document.querySelector('meta[name="theme-color"]');
  if(meta) meta.setAttribute("content", getComputedStyle(document.body).backgroundColor);
}
document.documentElement.dataset.fvTheme=store.theme;
themeSel.value=store.theme;
syncThemeColor();
themeSel.addEventListener("change",()=>{
  document.documentElement.dataset.fvTheme=themeSel.value;
  store.theme=themeSel.value;
  syncThemeColor();
});

/* ================= Init ================= */
document.body.dataset.tab="flotte";
readDeepLink(); // ?repo=… (ouverture depuis une notif ntfy)
// Service worker : rend la coquille disponible hors-ligne (chemin relatif → scope /fleetview/).
if("serviceWorker" in navigator){
  window.addEventListener("load",()=>{ navigator.serviceWorker.register("sw.js").catch(()=>{}); });
}
// Retour/perte de réseau : rafraîchir dès le retour, signaler la coupure sinon.
window.addEventListener("online",()=>{ if(!demo&&store.token) refresh(false); });
window.addEventListener("offline",()=>{ if(model) offlineBanner(ui.lastSync?ui.lastSync.toISOString():null); });
setInterval(()=>{ if(document.visibilityState==="visible"&&!demo&&store.token) refresh(false); }, REFRESH_MS);
setInterval(renderSyncNote, 30_000);
document.addEventListener("visibilitychange",()=>{
  if(document.visibilityState==="visible"&&ui.lastSync&&(Date.now()-ui.lastSync.getTime()>REFRESH_MS)&&!demo&&store.token) refresh(false);
});
if(store.token){ showConfig(false); refresh(); }
else showConfig(true);
})();
