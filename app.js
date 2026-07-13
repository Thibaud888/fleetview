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
};
let demo = false;

const STATES = {
  crit:{label:"à débloquer", v:"var(--crit)", order:0},
  info:{label:"en session",  v:"var(--info)", order:1},
  warn:{label:"en attente",  v:"var(--warn)", order:2},
  calm:{label:"calme",       v:"var(--ok)",   order:3},
};
const PRIO_COLOR = {P1:"var(--crit)", P2:"var(--warn)", P3:"var(--mut)"};
const MODEL_LABEL = {haiku:"claude:haiku", opus:"claude:opus", fable:"claude:fable"};

let model = null;          // { repos:[], ideas:[], attention:[], feed:[] }
let fleetFile = null;      // { json, sha }
let ui = { filter:"all", openRepo:null, lastSync:null, loading:false };
let ideaLaunchCtx = null;  // idée en cours de lancement (depuis le codex)
const labelCache = new Set();

/* ================= Utilitaires ================= */
const $ = (s)=>document.querySelector(s);
function esc(s){ return String(s??"").replace(/[&<>"]/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])); }
function b64d(s){ const bin=atob(String(s).replace(/\n/g,"")); const a=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++)a[i]=bin.charCodeAt(i); return new TextDecoder().decode(a); }
function b64e(s){ const a=new TextEncoder().encode(s); let bin=""; for(const b of a) bin+=String.fromCharCode(b); return btoa(bin); }
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
  if(res.status===401||res.status===403){
    const e=new Error("auth"); e.status=res.status; e.detail=await res.text().catch(()=> ""); throw e;
  }
  if(!res.ok){
    const e=new Error(`GitHub ${res.status} sur ${path}`); e.status=res.status; e.detail=await res.text().catch(()=> ""); throw e;
  }
  return res.status===204?null:res.json();
}
const enc = encodeURIComponent;

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

  // 4. Détails PR (head sha, stats) + check-runs
  const prDetails = {};
  await Promise.all(openPRs.map(async p=>{
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

  // 5. Commentaires des issues claude ouvertes (dialogue de cadrage)
  const commentsByIssue = {};
  await Promise.all(claudeIssues.filter(i=>i.comments>0).map(async i=>{
    try{ commentsByIssue[i.repo+"#"+i.number] = await gh(`/repos/${OWNER}/${i.repo}/issues/${i.number}/comments?per_page=100`); }
    catch(e){}
  }));

  model = buildModel(fleet, {claudeIssues, openPRs, ideasRaw:ideasRes, runsByRepo, prDetails, commentsByIssue});
  ui.lastSync = new Date();
}

function isArchived(statut){ return ["archivé","archive","gelé"].includes(String(statut||"").toLowerCase()); }
function isVeille(statut){ return String(statut||"").toLowerCase()==="veille"; }

function buildModel(fleet, D){
  const repos=[], attention=[], feed=[];

  for(const fr of fleet){
    const id=fr.repo;
    const life = isArchived(fr.statut)?"archive":(isVeille(fr.statut)?"veille":"actif");
    const lines=[]; let state="calm"; let lastTs=null; let pr=null; let threadIssue=null;
    const bump=(s)=>{ if(STATES[s].order<STATES[state].order) state=s; };
    const seen=(iso)=>{ if(iso && (!lastTs||iso>lastTs)) lastTs=iso; };
    const runs = D.runsByRepo[id]||[];

    // Issues claude ouvertes (sessions / cadrage)
    for(const is of D.claudeIssues.filter(i=>i.repo===id)){
      seen(is.updated_at);
      const isCadrage = (is.labels||[]).some(l=>l.name==="cadrage");
      const comments = D.commentsByIssue[id+"#"+is.number]||[];
      const lastC = comments[comments.length-1];
      const linkedPR = D.openPRs.find(p=>p.repo===id && (p.body||"").includes(`#${is.number}`));
      const running = runs.some(r=>["in_progress","queued"].includes(r.status));
      const ageH = (Date.now()-new Date(is.created_at))/3.6e6;

      if(isCadrage && lastC && lastC.user.login!==OWNER){
        bump("warn");
        lines.push({c:"warn", t:`Cadrage #${is.number} « ${is.title} » — réponse de Claude à lire`, small:timeAgo(lastC.created_at), act:{id:"open-thread", n:is.number, label:"Répondre"}});
        attention.push({c:"warn", repo:id, t:`Claude attend ta réponse sur « ${is.title} »`, small:timeAgo(lastC.created_at)});
        threadIssue = threadIssue??{num:is.number, title:is.title, comments, cadrage:true};
      } else if(linkedPR){
        // la PR parle pour elle (traitée plus bas)
      } else if(running){
        bump("info");
        lines.push({c:"info", t:`Issue #${is.number} « ${is.title} » — session Actions en cours`, small:timeAgo(is.updated_at), act:{id:"gh-issue", n:is.number, label:"Suivre"}});
        threadIssue = threadIssue??{num:is.number, title:is.title, comments, cadrage:isCadrage};
      } else if(ageH>2){
        bump("crit");
        lines.push({c:"crit", t:`Issue #${is.number} « ${is.title} » — pas de PR après ${Math.round(ageH)} h (session en échec ?)`, act:{id:"relabel", n:is.number, label:"Relancer"}});
        attention.push({c:"crit", repo:id, t:`« ${is.title} » : session sans PR après ${Math.round(ageH)} h`});
        threadIssue = threadIssue??{num:is.number, title:is.title, comments, cadrage:isCadrage};
      } else {
        bump("info");
        lines.push({c:"info", t:`Issue #${is.number} « ${is.title} » — session en attente de démarrage`, small:timeAgo(is.created_at)});
        threadIssue = threadIssue??{num:is.number, title:is.title, comments, cadrage:isCadrage};
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

    if(!lines.length) lines.push({c:"ok", t:"Rien en cours"});
    repos.push({
      id, type: fr.type + (fr.kit_version?` · kit ${fr.kit_version}`:""), life, state,
      lines, last: lastTs?timeAgo(lastTs):"—", lastTs, pr, threadIssue,
      notes: fr.notes||"", url:`https://github.com/${OWNER}/${id}`,
    });
  }

  // Codex des idées (issues `idée` de claude-ops)
  const ideas = (D.ideasRaw||[]).filter(i=>!i.pull_request).map(i=>{
    const m=(i.body||"").match(/\*\*Projet\*\*\s*:\s*(\S+)/);
    const p=(i.labels||[]).map(l=>l.name).find(n=>/^P[123]$/.test(n))||"P3";
    return {num:i.number, p, repo:m?m[1]:"flotte", t:i.title, url:i.html_url, created:i.created_at};
  });

  feed.sort((a,b)=>b.ts<a.ts?-1:1);
  // « À traiter » ne concerne que les repos suivis : on écarte les archivés,
  // dont une PR ou une issue claude peut rester ouverte après archivage.
  const archived = new Set(repos.filter(r=>r.life==="archive").map(r=>r.id));
  return { repos, ideas, attention: attention.filter(x=>!archived.has(x.repo)), feed: feed.slice(0,16) };
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
        lines:[L("info","Issue #18 « Export PDF » — session Actions en cours","12 min")]},
      {id:"talk-show-oral", type:"service-node", life:"actif", state:"warn", last:"hier", url:"#",
        pr:{num:15,title:"Lecture audio iOS",checks:"checks ✓ 3/3",files:4,add:118,del:22,body:"Débloque l'AudioContext au premier geste utilisateur. Résout l'issue #12."},
        lines:[L("warn","PR #15 « Lecture audio iOS » — checks ✓, attend ta décision","depuis 15 h",{id:"demo",label:"Examiner"})]},
      {id:"veille-emploi", type:"cron-python", life:"actif", state:"calm", last:"07:05", url:"#",
        lines:[L("ok","veille.yml — OK","ce matin")]},
      {id:"digest-hebdo", type:"cron-python", life:"veille", state:"calm", last:"lundi", url:"#",
        lines:[L("ok","Dev en pause · weekly-digest.yml surveillé")]},
    ],
    ideas:[
      {num:1,p:"P1",repo:"quiz-capitales",t:"Miniatures automatiques pour les shorts",url:"#"},
      {num:2,p:"P2",repo:"bulletins-viz",t:"Comparaison des moyennes entre trimestres",url:"#"},
      {num:3,p:"P3",repo:"flotte",t:"Statusline + raccourcis desktop",url:"#"},
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
  $("#tab-idees-n").textContent=model.ideas.length;
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
  const defs=[
    {id:"all",l:"Tous",n:R.filter(r=>r.life!=="archive").length},
    {id:"crit",l:"À débloquer",n:R.filter(r=>r.state==="crit"&&r.life!=="archive").length},
    {id:"info",l:"En session",n:R.filter(r=>r.state==="info"&&r.life!=="archive").length},
    {id:"warn",l:"En attente",n:R.filter(r=>r.state==="warn"&&r.life!=="archive").length},
    {id:"calm",l:"Calmes",n:R.filter(r=>r.state==="calm"&&r.life==="actif").length},
    {id:"veille",l:"En veille",n:R.filter(r=>r.life==="veille").length},
  ];
  $("#filters").innerHTML=defs.map(d=>
    `<button class="chip" data-filter="${d.id}" aria-pressed="${ui.filter===d.id}">${d.l} <span class="n num">${d.n}</span></button>`).join("");
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
function renderIdeas(){
  const order={P1:0,P2:1,P3:2};
  const list=model.ideas.slice().sort((a,b)=>order[a.p]-order[b.p]||a.num-b.num);
  $("#ideas-count").textContent=model.ideas.length;
  $("#ideas").innerHTML=list.map(i=>`
    <div class="idea">
      <span class="prio" style="--c:${PRIO_COLOR[i.p]}">${i.p}</span>
      <span class="idea-body">${esc(i.t)}<span class="idea-repo">${esc(i.repo)}</span></span>
      <button class="idea-launch" data-launch="${i.num}" title="Détailler puis lancer">🚀</button>
    </div>`).join("")||`<p style="padding:12px 15px" class="marginalia">Codex vide — note une idée ci-dessous.</p>`;
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
function renderDetail(){
  const r=ui.openRepo&&model.repos.find(x=>x.id===ui.openRepo);
  $("#view-fleet").hidden=!!r;
  $("#view-detail").hidden=!r;
  if(!r){ $("#view-detail").innerHTML=""; return; }
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
      <p class="pr-body">${esc(r.pr.body)}</p>
      <div class="block-actions">
        <button class="btn btn-primary" data-act="merge" data-n="${r.pr.num}">✓ Merger (squash)</button>
        <button class="btn" data-act="pr-comment" data-n="${r.pr.num}">💬 Demander des changements</button>
      </div>
      <div class="reply" id="pr-reply" hidden>
        <textarea id="pr-reply-text" placeholder="Ce qui doit changer — envoyé à Claude sur la PR…"></textarea>
        <button class="btn" data-act="pr-comment-send" data-n="${r.pr.num}">Envoyer</button>
      </div>
    </div>`:"";

  const th=r.threadIssue;
  const threadBlock=th?`
    <div class="block">
      <div class="block-head"><span class="eyebrow">Dialogue — issue #${th.num} « ${esc(th.title)} »</span></div>
      <div class="thread">${(th.comments||[]).map(m=>{
        const mine=m.user.login===OWNER;
        return `<div class="msg ${mine?"":"claude"}"><span class="who">${mine?"Toi":"Claude"}</span>
          <span class="bubble">${esc(String(m.body||"").replace(/^@claude\s*/i,""))}</span></div>`;
      }).join("")||`<p class="marginalia" style="margin:0">Pas encore de commentaire — la session écrit ici.</p>`}
      </div>
      <div class="reply">
        <textarea id="thread-reply" placeholder="Répondre à Claude…"></textarea>
        <button class="btn" data-act="thread-send" data-n="${th.num}">Envoyer</button>
      </div>
      ${th.cadrage?`<div class="block-actions" style="margin-top:8px">
        <button class="btn btn-primary" data-act="go" data-n="${th.num}">✓ GO — spécification validée, implémente</button>
      </div>`:""}
    </div>`:"";

  $("#view-detail").innerHTML=`
    <div class="detail">
      <div class="detail-top">
        <button class="btn" data-act="back">← L'atelier</button>
        <h2>${esc(r.id)}</h2>
        <span class="pill" style="--c:${st.v}">${st.label}</span>
      </div>
      <div class="detail-meta">${esc(r.type)} · ${lifeLabel} · relevé ${esc(r.last)}</div>
      <ul class="lines">${r.lines.map(lineHtml).join("")}</ul>
      ${prBlock}
      ${threadBlock}
      ${relatedIdeas.length?`
      <div class="sub-list">
        <div class="eyebrow"><span class="orn">❧</span>Au codex pour ce projet</div>
        ${relatedIdeas.map(i=>`
          <div class="sub-row">
            <span class="prio" style="--c:${PRIO_COLOR[i.p]}">${i.p}</span>
            <span style="flex:1">${esc(i.t)}</span>
            <button class="idea-launch" data-launch="${i.num}">🚀</button>
          </div>`).join("")}
      </div>`:""}
      ${relatedFeed.length?`
      <div class="sub-list">
        <div class="eyebrow"><span class="orn">❧</span>Chroniques du projet</div>
        ${relatedFeed.map(f=>`
          <div class="sub-row"><span class="t num">${esc(dayLabel(f.ts))} ${hhmm(f.ts)}</span><span style="flex:1">${esc(f.txt)}</span></div>`).join("")}
      </div>`:""}
      <div class="detail-actions">
        <button class="btn btn-primary" data-newfor="${esc(r.id)}">＋ Demande</button>
        ${r.life==="actif"?`<button class="btn" data-act="life" data-n="veille">⏸ Mettre en veille</button>`
                          :`<button class="btn" data-act="life" data-n="actif">▶ Réactiver</button>`}
        <button class="btn" data-act="life" data-n="archivé">🗄 Archiver</button>
        <a class="ghlink" href="${esc(r.url)}" target="_blank" rel="noopener">au besoin : GitHub ↗</a>
      </div>
    </div>`;
}
function fillQuickRepo(){
  const sel=$("#quick-repo"); if(!sel||!model) return;
  const cur=sel.value;
  sel.innerHTML=`<option value="flotte">flotte</option>`+
    model.repos.filter(r=>r.life!=="archive").map(r=>`<option value="${esc(r.id)}">${esc(r.id)}</option>`).join("");
  if(cur&&[...sel.options].some(o=>o.value===cur)) sel.value=cur;
}
function renderSyncNote(){
  const el=$("#sync-note");
  if(ui.loading){ el.textContent="relevé en cours…"; return; }
  el.textContent=ui.lastSync?("relevé "+timeAgo(ui.lastSync.toISOString())+(demo?" · démo":"")):"";
}
function renderAll(){
  if(!model) return;
  renderSummary(); renderAttention(); renderFilters(); renderGrid();
  renderArchived(); renderIdeas(); renderFeed(); renderDetail(); fillQuickRepo(); renderSyncNote();
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
function cadrageBody(title,desc){
  return `**PHASE 1 — CADRAGE (ne code pas, n'ouvre pas de PR dans cette phase)**
Reformule la demande ci-dessous en spécification : contexte, objectif, critères de done vérifiables, étapes.
Poste cette spécification en COMMENTAIRE de cette issue, avec tes questions numérotées s'il y en a. Puis attends.

**PHASE 2 — IMPLÉMENTATION**
Uniquement après un commentaire de ${OWNER} contenant « GO » : traite la spécification validée —
branche \`claude/issue-<n>\`, vérification (script verify du repo, sinon build + tests), PR en
français avec \`Closes #<n>\`, BACKLOG.md mis à jour.

**Demande brute :**
${desc||title}

_Créée depuis FleetView (parcours cadrage)._`;
}
async function createRequest({repo,title,desc,mode,modelChoice,prio}){
  if(demo){ toast("Mode démo — rien n'est envoyé. Relie ton token pour agir en vrai."); return; }
  if(mode==="box"){
    await ensureLabel(META,"idée","E9C46A","Boîte à idées FleetView");
    await ensureLabel(META,prio,{P1:"C1442E",P2:"C99A3F",P3:"8A7A63"}[prio],"Priorité codex");
    const body=`**Projet** : ${repo}\n\n${desc||""}\n\n_Créée depuis FleetView._`;
    const is=await gh(`/repos/${OWNER}/${META}/issues`,{method:"POST",body:{title,body,labels:["idée",prio]}});
    toast(`💡 Idée #${is.number} rangée au codex (${prio}, projet ${repo}).`);
    return is;
  }
  const target = repo==="flotte"?META:repo;
  const labels=["claude"];
  if(MODEL_LABEL[modelChoice]) labels.push(MODEL_LABEL[modelChoice]);
  await ensureLabel(target,"claude","5319E7","Déclenche une session Claude (kit de flotte)");
  if(MODEL_LABEL[modelChoice]) await ensureLabel(target,MODEL_LABEL[modelChoice],"7B61C4","Choix de modèle");
  if(mode==="cadrage"){ labels.push("cadrage"); await ensureLabel(target,"cadrage","2E86AB","Phase de spécification avant implémentation"); }
  const body = mode==="cadrage"?cadrageBody(title,desc):directBody(title,desc);
  const is=await gh(`/repos/${OWNER}/${target}/issues`,{method:"POST",body:{title,body,labels}});
  toast(mode==="cadrage"
    ?`🪶 Cadrage lancé : issue #${is.number} sur ${target}. Claude poste sa spécification et ses questions ici.`
    :`⚡ Issue #${is.number} lancée sur ${target} — session Actions en route, la PR apparaîtra ici.`, 5600);
  return is;
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
  await gh(`/repos/${OWNER}/${name}/issues`,{method:"POST",body:{
    title:"Finaliser l'équipement du repo",
    body:`Repo créé depuis FleetView avec les stubs du kit (${type}).\n\nReste à faire (session locale /equiper ou à la main) :\n- [ ] Personnaliser CLAUDE.md (placeholders TODO)\n- [ ] Poser le secret CLAUDE_CODE_OAUTH_TOKEN (ou ANTHROPIC_API_KEY)\n- [ ] Activer « Actions peut créer des PRs » (Settings → Actions)\n- [ ] Rafraîchir le registre : \`node scripts/fleet.mjs\` sur claude-ops\n${type.startsWith("cron")?"- [ ] Créer le workflow planifié (motif Recherche-Emploi) + self-heal\n":""}`}});
  toast(`⚒ ${name} créé et équipé des stubs. Vois l'issue de finition (secret Claude à poser une fois).`, 7000);
}

/* ================= Rafraîchissement ================= */
async function refresh(showErrors=true){
  if(ui.loading) return;
  ui.loading=true; renderSyncNote();
  try{
    await loadAll();
    banner(null);
    renderAll();
  }catch(e){
    if(e.status===401||e.status===403){
      banner("Token refusé par GitHub ("+e.status+"). Vérifie ses permissions ou recolle-le.", "");
      showConfig(true);
    } else if(showErrors){
      banner("Relevé impossible : "+e.message+" — nouvel essai au prochain cycle.");
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
  $("#modal-title").textContent=opts.title?"Lancer cette idée":"Nouvelle demande";
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
  $("#f-model-row").style.display=v==="box"?"none":"";
  $("#f-submit").textContent={cadrage:"🪶 Cadrer avec Claude",direct:"⚡ Créer l'issue",box:"💡 Ranger au codex"}[v];
}

/* ================= Événements ================= */
document.addEventListener("click",async(e)=>{
  const b=e.target.closest("button, a");
  const r=ui.openRepo&&model?model.repos.find(x=>x.id===ui.openRepo):null;

  if(b){
    if(b.dataset.filter!==undefined){ ui.filter=b.dataset.filter; renderFilters(); renderGrid(); return; }
    if(b.dataset.tab!==undefined){
      document.body.dataset.tab=b.dataset.tab;
      document.querySelectorAll(".bb-btn").forEach(x=>x.setAttribute("aria-pressed",String(x===b)));
      if(b.dataset.tab!=="flotte"){ ui.openRepo=null; renderDetail(); }
      return;
    }
    if(b.dataset.open!==undefined){
      ui.openRepo=b.dataset.open;
      document.body.dataset.tab="flotte";
      document.querySelectorAll(".bb-btn").forEach(x=>x.setAttribute("aria-pressed",String(x.dataset.tab==="flotte")));
      renderDetail(); window.scrollTo({top:0}); return;
    }
    if(b.dataset.newfor!==undefined){ openModal({repo:b.dataset.newfor}); return; }
    if(b.dataset.launch!==undefined){
      const idea=model.ideas.find(i=>i.num===Number(b.dataset.launch));
      if(idea){ ideaLaunchCtx=idea; openModal({repo:idea.repo==="flotte"?"flotte":idea.repo,title:idea.t,hideBox:true}); }
      return;
    }
    if(b.dataset.unarchive!==undefined){
      try{ await setLifecycle(b.dataset.unarchive,"actif"); await refresh(); }catch(err){ toast("Échec : "+err.message); }
      return;
    }
    if(b.dataset.act!==undefined){
      const n=b.dataset.n;
      try{
        switch(b.dataset.act){
          case "back": ui.openRepo=null; renderDetail(); break;
          case "open-thread": renderDetail(); break; // le fil est déjà dans la vue
          case "open-pr": /* bloc PR déjà dans la vue détail */ if(r) renderDetail(); break;
          case "gh-issue": if(r) window.open(`${r.url}/issues/${n}`,"_blank"); break;
          case "merge": if(r){ b.disabled=true; await mergePr(r.id,n); await refresh(); } break;
          case "pr-comment": $("#pr-reply").hidden=false; $("#pr-reply-text").focus(); break;
          case "pr-comment-send": if(r){ const v=$("#pr-reply-text").value.trim(); if(!v)break;
            b.disabled=true; await sendComment(r.id,n,v); await refresh(); } break;
          case "thread-send": if(r){ const v=$("#thread-reply").value.trim(); if(!v)break;
            b.disabled=true; await sendComment(r.id,n,v); await refresh(); } break;
          case "go": if(r){ b.disabled=true;
            await sendComment(r.id,n,"GO — spécification validée, lance l'implémentation (phase 2)."); await refresh(); } break;
          case "rerun": { const repoId=r?r.id:(e.target.closest(".card")||{}).dataset?.card;
            if(repoId){ b.disabled=true; await rerunRun(repoId,n); await refresh(); } } break;
          case "relabel": if(r){ b.disabled=true;
            await sendComment(r.id,n,"la session ne semble pas avoir abouti — reprends cette issue depuis le début."); await refresh(); } break;
          case "life": if(r){ b.disabled=true; await setLifecycle(r.id,n);
            if(n==="archivé") ui.openRepo=null; await refresh(); } break;
          case "demo": toast("Mode démo — relie ton token pour agir en vrai."); break;
        }
      }catch(err){ toast("Échec : "+err.message, 6000); b.disabled=false; }
      return;
    }
  }
  const card=e.target.closest(".card");
  if(card&&!b){ ui.openRepo=card.dataset.card; renderDetail(); window.scrollTo({top:0}); }
});

$("#form-new").addEventListener("submit",async(e)=>{
  const title=$("#f-title").value.trim();
  if(!title){ e.preventDefault(); $("#f-title").focus(); return; }
  const repo=$("#f-repo").value;
  const desc=$("#f-desc").value.trim();
  const mode=document.querySelector('input[name="f-when"]:checked').value;
  const modelChoice=document.querySelector('input[name="f-model"]:checked').value;
  const prio=document.querySelector('input[name="f-prio"]:checked').value;
  const ctx=ideaLaunchCtx; ideaLaunchCtx=null;
  try{
    const is=await createRequest({repo,title,desc,mode,modelChoice,prio});
    if(ctx&&is&&mode!=="box") await closeIdea(ctx.num,is.html_url);
    await refresh(false);
  }catch(err){ toast("Échec : "+err.message, 6000); }
});
document.querySelectorAll('input[name="f-when"]').forEach(x=>x.addEventListener("change",syncWhen));
$("#btn-new").addEventListener("click",()=>openModal());
$("#bb-new").addEventListener("click",()=>openModal());
$("#modal-close").addEventListener("click",()=>modal.close());
$("#btn-newproject").addEventListener("click",()=>modalProjet.showModal());
$("#link-newproject").addEventListener("click",(e)=>{e.preventDefault();modal.close();modalProjet.showModal();});
$("#modal-projet-close").addEventListener("click",()=>modalProjet.close());
$("#form-projet").addEventListener("submit",async(e)=>{
  const name=$("#p-name").value.trim();
  if(!name){ e.preventDefault(); return; }
  const type=$("#p-type").value;
  const priv=document.querySelector('input[name="p-vis"]:checked').value==="private";
  try{ await newProject(name,type,priv); await refresh(false); }
  catch(err){ toast("Échec : "+err.message, 7000); }
});

$("#btn-refresh").addEventListener("click",()=>refresh());
$("#quick-add").addEventListener("click",async()=>{
  const v=$("#quick-input").value.trim(); if(!v) return;
  const repo=$("#quick-repo").value||"flotte";
  try{
    await createRequest({repo,title:v,desc:"",mode:"box",modelChoice:"sonnet",prio:"P3"});
    $("#quick-input").value="";
    await refresh(false);
  }catch(err){ toast("Échec : "+err.message); }
});
$("#quick-input").addEventListener("keydown",(e)=>{ if(e.key==="Enter"){ e.preventDefault(); $("#quick-add").click(); } });

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

/* ================= Thème ================= */
const themeSel=$("#theme-select");
document.documentElement.dataset.fvTheme=store.theme;
themeSel.value=store.theme;
themeSel.addEventListener("change",()=>{
  document.documentElement.dataset.fvTheme=themeSel.value;
  store.theme=themeSel.value;
});

/* ================= Init ================= */
document.body.dataset.tab="flotte";
setInterval(()=>{ if(document.visibilityState==="visible"&&!demo&&store.token) refresh(false); }, REFRESH_MS);
setInterval(renderSyncNote, 30_000);
document.addEventListener("visibilitychange",()=>{
  if(document.visibilityState==="visible"&&ui.lastSync&&(Date.now()-ui.lastSync.getTime()>REFRESH_MS)&&!demo&&store.token) refresh(false);
});
if(store.token){ showConfig(false); refresh(); }
else showConfig(true);
})();
