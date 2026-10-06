import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Daily, Tab, Totals, Turn } from '../types'

const PANE = 'suivi-tokens'
const STORE = 'daily'
const KEEP_DAYS = 60

const turns = atom({ plugin: 'suivi-tokens', key: 'turns' } as const, [])
const daily = atom({ plugin: 'suivi-tokens', key: 'daily' } as const, {})
const tab = atom({ plugin: 'suivi-tokens', key: 'tab' } as const, 'session')
const isCostly = atom({ plugin: 'suivi-tokens', key: 'isCostly' } as const, false)

const empty = (): Totals => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, usd: 0, turns: 0 })

const compact = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`

/** Ce qui « compte » : tout sauf les lectures de cache, quasi gratuites. */
const spent = (t: { input: number; output: number; cacheWrite: number }) => t.input + t.output + t.cacheWrite

const bar = (value: number, max: number, width = 14) => {
  const filled = max > 0 ? Math.max(value > 0 ? 1 : 0, Math.round((value / max) * width)) : 0
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

const dayKey = (ms: number) => {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

const hhmm = (ms: number) => {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}`
}

const add = (to: Totals, by: Partial<Totals>): Totals => ({
  input: to.input + (by.input ?? 0),
  output: to.output + (by.output ?? 0),
  cacheRead: to.cacheRead + (by.cacheRead ?? 0),
  cacheWrite: to.cacheWrite + (by.cacheWrite ?? 0),
  usd: to.usd + (by.usd ?? 0),
  turns: to.turns + (by.turns ?? 0),
})

const sumDay = (d: Record<string, Totals>) => Object.values(d).reduce(add, empty())

const prune = (d: Daily): Daily => {
  const keys = Object.keys(d).sort().slice(-KEEP_DAYS)
  return Object.fromEntries(keys.map(k => [k, d[k] as Record<string, Totals>]))
}

/** Résumé texte : sert à la commande, et partout où rien ne se dessine. */
const report = (session: Turn[], d: Daily, today: string, repo: string): string => {
  const s = session.reduce(
    (a, t) => add(a, { input: t.input, output: t.output, cacheRead: t.cacheRead, cacheWrite: t.cacheWrite, usd: t.usd, turns: 1 }),
    empty(),
  )
  const days = Object.keys(d).sort().reverse()
  const week = days.slice(0, 7).reduce((a, k) => add(a, sumDay(d[k] as Record<string, Totals>)), empty())
  const t = sumDay(d[today] ?? {})
  const byRepo: Record<string, Totals> = {}
  for (const k of days.slice(0, 30)) {
    for (const [r, v] of Object.entries(d[k] as Record<string, Totals>)) byRepo[r] = add(byRepo[r] ?? empty(), v)
  }
  const top = Object.entries(byRepo)
    .sort((a, b) => b[1].usd - a[1].usd)
    .slice(0, 5)
  const line = (label: string, x: Totals) =>
    `${label} : ${compact(spent(x))} tokens (↑${compact(x.input + x.cacheWrite)} ↓${compact(x.output)}, cache lu ${compact(x.cacheRead)}), $${x.usd.toFixed(2)}, ${x.turns} tours`
  return [
    `Suivi des tokens — ${repo}`,
    line('Cette session', s),
    line("Aujourd'hui", t),
    line('7 derniers jours', week),
    top.length ? 'Top repos (30 j) : ' + top.map(([r, v]) => `${r} $${v.usd.toFixed(2)}`).join(' · ') : '',
  ]
    .filter(Boolean)
    .join('\n')
}

async function save($: EngineInterface, d: Daily) {
  await $.store.set(STORE, d)
}

export const register: Register = on => {
  let repo = 'session'
  let lastUsd = 0
  let pendingUsd = 0

  on('session.start', async ($, e, next) => {
    repo = e.cwd.split('/').filter(Boolean).pop() ?? 'session'
    const u = await $.session.usage()
    lastUsd = u.cost?.usd ?? 0
    const stored = ((await $.store.get(STORE)) ?? {}) as Daily
    await update($, daily, () => stored)
    await $.command.register({
      name: 'tokens',
      description: 'Suivi des tokens : par tour, par jour, par repo (ouvre un panneau)',
    })
    return next(e)
  })

  // Coût : on suit les écarts de la facture de session, ils alimentent le jour courant.
  on('session.measure', async ($, e, next) => {
    const usd = e.cost?.usd
    if (usd !== undefined && usd > lastUsd) {
      const delta = usd - lastUsd
      lastUsd = usd
      pendingUsd += delta
      const day = dayKey(await $.clock.now())
      await update($, daily, d => {
        const row = d[day] ?? {}
        return { ...d, [day]: { ...row, [repo]: add(row[repo] ?? empty(), { usd: delta }) } }
      })
      await save($, prune(await read($, daily)))
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined && e.usage) {
      const now = await $.clock.now()
      const t: Turn = {
        at: now,
        seconds: Math.round(e.durationMs / 1000),
        input: e.usage.input_tokens,
        output: e.usage.output_tokens,
        cacheRead: e.usage.cache_read_input_tokens,
        cacheWrite: e.usage.cache_creation_input_tokens,
        usd: pendingUsd,
      }
      pendingUsd = 0
      await update($, turns, list => [...list, t].slice(-300))
      const day = dayKey(now)
      await update($, daily, d => {
        const row = d[day] ?? {}
        const cur = row[repo] ?? empty()
        return {
          ...d,
          [day]: {
            ...row,
            [repo]: add(cur, { input: t.input, output: t.output, cacheRead: t.cacheRead, cacheWrite: t.cacheWrite, turns: 1 }),
          },
        }
      })
      await save($, prune(await read($, daily)))
    }
    return next(e)
  })

  on('command.run', { command: 'tokens' }, async ($, e) => {
    const now = await $.clock.now()
    const text = report(await read($, turns), await read($, daily), dayKey(now), repo)
    if (e.args.trim() !== 'texte') {
      try {
        await $.ui.open({ id: PANE, title: 'Tokens' })
      } catch {
        // pas de panneau sur cette surface : le texte suffit
      }
    }
    return { text }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const current = await read($, tab)
    const costly = await read($, isCostly)
    const d = await read($, daily)
    const list = await read($, turns)
    const room = Math.max(3, (e.viewport?.rows ?? 24) - 8)
    const tabs: [Tab, string][] = [
      ['session', 'Session'],
      ['jours', 'Jours'],
      ['repos', 'Repos'],
    ]

    let body
    if (current === 'session') {
      const rows = (costly ? [...list].sort((a, b) => spent(b) - spent(a)) : [...list].reverse()).slice(0, room)
      const max = Math.max(1, ...rows.map(spent))
      body = (
        <Box flexDirection="column">
          <Button
            key="sort"
            label={costly ? 'Tri : plus gourmands' : 'Tri : plus récents'}
            onPress={() => update($, isCostly, v => !v)}
          />
          {rows.length === 0 && <Text dimColor>Aucun tour terminé pour l'instant.</Text>}
          {rows.map(t => (
            <Text key={String(t.at)}>
              <Text dimColor>{hhmm(t.at)} </Text>
              <Text color="suggestion">{bar(spent(t), max)}</Text>
              <Text> ↑{compact(t.input + t.cacheWrite)} ↓{compact(t.output)}</Text>
              <Text dimColor> cache {compact(t.cacheRead)} · {t.seconds}s{t.usd > 0 ? ` · $${t.usd.toFixed(2)}` : ''}</Text>
            </Text>
          ))}
        </Box>
      )
    } else if (current === 'jours') {
      const days = Object.keys(d).sort().reverse().slice(0, room)
      const totals = days.map(k => ({ k, v: sumDay(d[k] as Record<string, Totals>) }))
      const max = Math.max(1, ...totals.map(x => spent(x.v)))
      body = (
        <Box flexDirection="column">
          {totals.length === 0 && <Text dimColor>Pas encore d'historique.</Text>}
          {totals.map(({ k, v }) => (
            <Text key={k}>
              <Text dimColor>{k.slice(5)} </Text>
              <Text color="suggestion">{bar(spent(v), max)}</Text>
              <Text> {compact(spent(v))}</Text>
              <Text dimColor> · ${v.usd.toFixed(2)} · {v.turns} tours</Text>
            </Text>
          ))}
        </Box>
      )
    } else {
      const byRepo: Record<string, Totals> = {}
      for (const k of Object.keys(d).sort().slice(-30)) {
        for (const [r, v] of Object.entries(d[k] as Record<string, Totals>)) byRepo[r] = add(byRepo[r] ?? empty(), v)
      }
      const rows = Object.entries(byRepo).sort((a, b) => spent(b[1]) - spent(a[1])).slice(0, room)
      const max = Math.max(1, ...rows.map(r => spent(r[1])))
      body = (
        <Box flexDirection="column">
          <Text dimColor>30 derniers jours</Text>
          {rows.length === 0 && <Text dimColor>Pas encore d'historique.</Text>}
          {rows.map(([r, v]) => (
            <Text key={r}>
              <Text>{r.padEnd(16).slice(0, 16)} </Text>
              <Text color="suggestion">{bar(spent(v), max, 10)}</Text>
              <Text> {compact(spent(v))}</Text>
              <Text dimColor> · ${v.usd.toFixed(2)}</Text>
            </Text>
          ))}
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        <Box>
          {tabs.map(([id, label]) => (
            <Button key={id} label={id === current ? `● ${label}` : label} onPress={() => update($, tab, () => id)} />
          ))}
        </Box>
        {body}
        <Text dimColor>↑ entrée (hors cache lu) · ↓ sortie · barres relatives</Text>
      </Box>
    )
  })
}
