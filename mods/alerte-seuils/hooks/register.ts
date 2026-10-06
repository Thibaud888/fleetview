import type { EngineInterface, Register } from 'claude-code'

type Options = {
  contexte_alerte?: number
  contexte_critique?: number
  limite_alerte?: number
  budget_session?: number
  tours_avant_plein?: number
}

const LABEL: Record<string, string> = { five_hour: 'limite 5 h', seven_day: 'limite 7 j', spend_limit: 'budget' }

function tell($: EngineInterface, said: Set<string>, key: string, text: string, ms = 8000) {
  if (said.has(key)) return
  said.add(key)
  $.ui.toast(text, { timeoutMs: ms })
  // Là où rien ne se dessine (cloud, VS Code), la ligne de transcript fait foi.
  $.ui.log(`⚠ ${text}`)
}

export const register: Register = (on, options) => {
  const o = options as Options
  const ctxWarn = o.contexte_alerte ?? 70
  const ctxCrit = o.contexte_critique ?? 90
  const rateWarn = o.limite_alerte ?? 80
  const budget = o.budget_session ?? 0
  const horizon = o.tours_avant_plein ?? 5

  // Ce qui a déjà été dit : on ne répète pas (module rechargé = on redit, c'est voulu).
  const said = new Set<string>()
  const history: number[] = []
  let lastPercent = -1

  // Un seuil franchi à la baisse (compactage, /clear) se ré-arme.
  const rearm = (key: string, isBelow: boolean) => {
    if (isBelow) said.delete(key)
  }

  on('session.measure', async ($, e, next) => {
    const pct = e.context.percent

    if (pct !== undefined) {
      if (pct >= ctxCrit) tell($, said, 'ctx-crit', `Contexte à ${Math.round(pct)} % : compacte ou /clear avant de continuer`)
      else if (pct >= ctxWarn) tell($, said, 'ctx-warn', `Contexte à ${Math.round(pct)} % : pense à compacter`)
      rearm('ctx-warn', pct < ctxWarn - 10)
      rearm('ctx-crit', pct < ctxCrit - 10)

      // Prévision : croissance moyenne par réponse sur les dernières mesures.
      if (Math.round(pct) !== lastPercent) {
        if (pct < lastPercent - 20) history.length = 0 // compactage : on repart de zéro
        lastPercent = Math.round(pct)
        history.push(pct)
        if (history.length > 6) history.shift()
      }
      if (horizon > 0 && history.length >= 3) {
        const first = history[0] as number
        const growth = (pct - first) / (history.length - 1)
        if (growth > 0.5 && pct < ctxCrit) {
          const turnsLeft = Math.floor((100 - pct) / growth)
          if (turnsLeft <= horizon) {
            tell($, said, 'forecast', `Contexte plein dans ~${turnsLeft} échange${turnsLeft > 1 ? 's' : ''} au rythme actuel (${Math.round(pct)} %)`)
          } else {
            said.delete('forecast')
          }
        }
      }
    }

    for (const l of e.rateLimits) {
      const key = `rate-${l.kind}`
      if (l.percentUsed >= rateWarn) {
        tell($, said, key, `${LABEL[l.kind] ?? l.kind} à ${Math.round(l.percentUsed)} %${l.resetsAt ? ` (reset ${new Date(l.resetsAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })})` : ''}`)
      }
      rearm(key, l.percentUsed < rateWarn - 10)
    }

    if (budget > 0 && e.cost) {
      if (e.cost.usd >= budget) tell($, said, 'budget-100', `Budget de session dépassé : $${e.cost.usd.toFixed(2)} / $${budget}`)
      else if (e.cost.usd >= budget * 0.8) tell($, said, 'budget-80', `80 % du budget de session : $${e.cost.usd.toFixed(2)} / $${budget}`)
    }

    return next(e)
  })
}
