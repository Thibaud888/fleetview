// Détection des dispatchs « en rade » — logique pure (aucun appel réseau), utilisée par
// veilleur.mjs et testée depuis scripts/verify.mjs. Miroir volontaire de claude-ops
// scripts/brief-rade.mjs (même définition du rade) : le brief hebdo de claude-ops ne tourne
// que le lundi — un dispatch en rade le mardi y attendait six jours (BACKLOG.md #40). Le
// veilleur (cron 15 min) comble ce trou, en continu.

const CONCLUSIONS_ROUGES = new Set(["failure", "timed_out", "cancelled"]);

/** Synthétise les check-runs d'un commit en un mot : verts/rouges/en_cours/aucun. */
export const synthetiseChecks = (runs) => {
  const checks = runs ?? [];
  if (!checks.length) return "aucun"; // repo sans CI : rien ne bloque, rien ne prouve non plus
  if (checks.some((c) => c.status !== "completed")) return "en_cours";
  if (checks.some((c) => CONCLUSIONS_ROUGES.has(c.conclusion))) return "rouges";
  return "verts";
};

/**
 * PR issue d'une session dispatchée : branche `claude/issue-<n>` (convention de dispatch.yml),
 * ou poussée par le bot Actions sur une branche `claude/*` — le seul préfixe `claude/` ne suffit
 * pas, une session locale peut nommer sa branche pareil (ex. `claude/brief-abonnement`, poussée
 * à la main) sans être un dispatch en rade.
 */
export const estPrDeSession = (headRef, authorLogin) =>
  /^claude\/issue-\d+$/.test(headRef ?? "") ||
  (/\[bot\]$/i.test(authorLogin ?? "") && (headRef ?? "").startsWith("claude/"));

/**
 * Un seuil (en heures depuis `createdIso`) a-t-il été franchi PENDANT la fenêtre [since, maintenant] ?
 * Le veilleur est sans état (cf. veilleur.mjs) : c'est ce qui permet de notifier UNE fois au
 * franchissement plutôt qu'à chaque cron tant que l'item reste en rade.
 */
export const seuilFranchiDans = (createdIso, seuilH, since, maintenant = Date.now()) => {
  const t = new Date(createdIso).getTime() + seuilH * 3_600_000;
  return t >= since && t <= maintenant;
};
