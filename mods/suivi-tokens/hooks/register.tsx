import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Daily, Metric, Tab, Totals, Turn } from '../types'

const PANE = 'suivi-tokens'
const LIVE = 'daily' // mesuré en direct (coût en $, tours)
const HIST = 'history' // reconstitué depuis les transcripts (tokens)
const HIST_AT = 'historyAt'
const KEEP_DAYS = 90
const REFRESH_MS = 6 * 3_600_000

const turns = atom({ plugin: 'suivi-tokens', key: 'turns' } as const, [])
const live = atom({ plugin: 'suivi-tokens', key: 'live' } as const, {})
const hist = atom({ plugin: 'suivi-tokens', key: 'hist' } as const, {})
const tab = atom({ plugin: 'suivi-tokens', key: 'tab' } as const, 'apercu')
const period = atom({ plugin: 'suivi-tokens', key: 'period' } as const, 14)
const metric = atom({ plugin: 'suivi-tokens', key: 'metric' } as const, 'tokens')
const repoFilter = atom({ plugin: 'suivi-tokens', key: 'repoFilter' } as const, null)
const isCostly = atom({ plugin: 'suivi-tokens', key: 'isCostly' } as const, false)
const importNote = atom({ plugin: 'suivi-tokens', key: 'importNote' } as const, '')

const empty = (): Totals => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, usd: 0, turns: 0 })

const add = (a: Totals, b: Partial<Totals>): Totals => ({
  input: a.input + (b.input ?? 0),
  output: a.output + (b.output ?? 0),
  cacheRead: a.cacheRead + (b.cacheRead ?? 0),
  cacheWrite: a.cacheWrite + (b.cacheWrite ?? 0),
  usd: a.usd + (b.usd ?? 0),
  turns: a.turns + (b.turns ?? 0),
})

const compact = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 10_000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${Math.round(n)}`

const money = (n: number) => (n >= 100 ? `$${Math.round(n)}` : `$${n.toFixed(2)}`)

/** Ce qui « compte » : tout sauf les lectures de cache, quasi gratuites. */
const spent = (t: { input: number; output: number; cacheWrite: number }) => t.input + t.output + t.cacheWrite

const value = (t: Totals, m: Metric) => (m === 'usd' ? t.usd : m === 'cache' ? t.cacheRead : spent(t))
const show = (n: number, m: Metric) => (m === 'usd' ? money(n) : compact(n))
const METRIC_LABEL: Record<Metric, string> = { tokens: 'Tokens (hors cache lu)', cache: 'Cache lu', usd: 'Coût mesuré ($)' }

const p2 = (n: number) => String(n).padStart(2, '0')
const dayKey = (ms: number) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`
}
const hhmm = (ms: number) => `${p2(new Date(ms).getHours())}:${p2(new Date(ms).getMinutes())}`
const WD = ['di', 'lu', 'ma', 'me', 'je', 've', 'sa']
const dayLabel = (k: string) => {
  const d = new Date(`${k}T12:00:00`)
  return `${WD[d.getDay()]} ${k.slice(8)}/${k.slice(5, 7)}`
}

const SPARK = '▁▂▃▄▅▆▇█'
const spark = (xs: number[]) => {
  const max = Math.max(0, ...xs)
  return xs.map(x => (max <= 0 || x <= 0 ? '▁' : (SPARK[Math.min(7, Math.floor((x / max) * 7.999))] as string))).join('')
}

/** Barre à deux couleurs (entrée / sortie) : renvoie les deux longueurs. */
const split = (a: number, b: number, max: number, width: number) => {
  if (max <= 0) return [0, 0] as const
  const total = Math.max(a + b > 0 ? 1 : 0, Math.round(((a + b) / max) * width))
  const first = a + b > 0 ? Math.min(total, Math.max(a > 0 ? 1 : 0, Math.round((a / (a + b)) * total))) : 0
  return [first, total - first] as const
}
const fill = (n: number) => '█'.repeat(n)
const rest = (n: number, width: number) => '░'.repeat(Math.max(0, width - n))

/** tokens depuis l'historique (transcripts) quand il existe, coût depuis la mesure en direct. */
const merge = (h: Daily, l: Daily): Daily => {
  const out: Daily = {}
  for (const day of new Set([...Object.keys(h), ...Object.keys(l)])) {
    const hr = h[day] ?? {}
    const lr = l[day] ?? {}
    const row: Record<string, Totals> = {}
    for (const repo of new Set([...Object.keys(hr), ...Object.keys(lr)])) {
      const src = hr[repo] ?? lr[repo] ?? empty()
      row[repo] = { ...src, usd: lr[repo]?.usd ?? 0 }
    }
    out[day] = row
  }
  return out
}

const filtered = (d: Daily, repo: string | null): Record<string, Totals> => {
  const out: Record<string, Totals> = {}
  for (const [day, row] of Object.entries(d)) {
    const t = Object.entries(row).reduce((a, [r, v]) => (repo === null || r === repo ? add(a, v) : a), empty())
    out[day] = t
  }
  return out
}

/** Les N derniers jours calendaires, anciens → récents (jours vides inclus). */
const lastDays = (n: number, nowMs: number) =>
  Array.from({ length: n }, (_, i) => dayKey(nowMs - (n - 1 - i) * 86_400_000))

const sumOver = (d: Record<string, Totals>, days: string[]) => days.reduce((a, k) => add(a, d[k] ?? empty()), empty())

const byRepo = (d: Daily, days: string[]) => {
  const out: Record<string, Totals> = {}
  for (const k of days) for (const [r, v] of Object.entries(d[k] ?? {})) out[r] = add(out[r] ?? empty(), v)
  return Object.entries(out).sort((a, b) => spent(b[1]) - spent(a[1]))
}

const prune = (d: Daily): Daily => {
  const keys = Object.keys(d).sort().slice(-KEEP_DAYS)
  return Object.fromEntries(keys.map(k => [k, d[k] as Record<string, Totals>]))
}

/** Résumé texte aligné : sert à la commande, et partout où rien ne se dessine. */
const report = (session: Turn[], all: Daily, nowMs: number, repo: string, note: string): string => {
  const flat = filtered(all, null)
  const s = session.reduce(
    (a, t) => add(a, { input: t.input, output: t.output, cacheRead: t.cacheRead, cacheWrite: t.cacheWrite, usd: t.usd, turns: 1 }),
    empty(),
  )
  const periods: [string, Totals][] = [
    ['Cette session', s],
    ["Aujourd'hui", sumOver(flat, lastDays(1, nowMs))],
    ['7 jours', sumOver(flat, lastDays(7, nowMs))],
    ['30 jours', sumOver(flat, lastDays(30, nowMs))],
  ]
  const head = `${''.padEnd(14)}${'tokens'.padStart(8)}${'↑ entrée'.padStart(10)}${'↓ sortie'.padStart(10)}${'cache lu'.padStart(10)}${'coût'.padStart(9)}`
  const rows = periods.map(
    ([l, t]) =>
      `${l.padEnd(14)}${compact(spent(t)).padStart(8)}${compact(t.input + t.cacheWrite).padStart(10)}${compact(t.output).padStart(10)}${compact(t.cacheRead).padStart(10)}${(t.usd > 0 ? money(t.usd) : '—').padStart(9)}`,
  )
  const days30 = lastDays(30, nowMs)
  const trend = spark(days30.map(k => spent(flat[k] ?? empty())))
  const top = byRepo(all, days30).slice(0, 5)
  const topMax = Math.max(1, ...top.map(x => spent(x[1])))
  const topLines = top.map(([r, v]) => `  ${r.padEnd(18).slice(0, 18)} ${fill(Math.max(1, Math.round((spent(v) / topMax) * 12))).padEnd(12, '░')} ${compact(spent(v)).padStart(6)}`)
  return [
    `Suivi des tokens — ${repo}`,
    '',
    head,
    ...rows,
    '',
    `Tendance 30 j  ${trend}  (tokens/jour, ${compact(Math.max(0, ...days30.map(k => spent(flat[k] ?? empty()))))} max)`,
    top.length ? 'Top repos (30 j) :' : '',
    ...topLines,
    '',
    note,
    "Astuce : /tokens ouvre le panneau interactif (périodes, filtre par repo) là où l'interface dessine ; /tokens import relit l'historique.",
  ]
    .filter((l, i, a) => l !== '' || a[i - 1] !== '')
    .join('\n')
}

async function save($: EngineInterface, key: string, d: Daily) {
  await $.store.set(key, d)
}

async function importHistory($: EngineInterface): Promise<{ days: Daily; files: number; messages: number } | string> {
  const home = await $.env.get('HOME')
  if (!home) return 'dossier personnel introuvable'
  const dir = `${home}/.claude/projects`
  if (!(await $.fs.exists(dir))) return `rien à lire dans ${dir}`
  try {
    const r = await $.process.run(['node', `${$.plugin.root}/scripts/import.mjs`, dir, String(KEEP_DAYS)], { timeoutMs: 120_000 })
    if (r.exitCode !== 0) return `import échoué : ${r.stderr.slice(0, 200) || `code ${r.exitCode}`}`
    return JSON.parse(r.stdout)
  } catch (err) {
    return `import impossible (Node.js est requis) : ${String(err).slice(0, 160)}`
  }
}

async function runImport($: EngineInterface, force: boolean) {
  const at = Number((await $.store.get(HIST_AT)) ?? 0)
  const now = await $.clock.now()
  if (!force && at > 0 && now - at < REFRESH_MS) return
  const r = await importHistory($)
  if (typeof r === 'string') {
    await update($, importNote, () => `Historique : ${r}`)
    return
  }
  await $.store.set(HIST, prune(r.days))
  await $.store.set(HIST_AT, now)
  await update($, hist, () => prune(r.days))
  await update($, importNote, () => `Historique relu : ${r.messages} réponses dans ${r.files} fichiers de session (${Object.keys(r.days).length} jours).`)
}

export const register: Register = on => {
  let repo = 'session'
  let lastUsd = 0
  let pendingUsd = 0

  on('session.start', async ($, e, next) => {
    repo = e.cwd.split('/').filter(Boolean).pop() ?? 'session'
    const u = await $.session.usage()
    lastUsd = u.cost?.usd ?? 0
    const l = ((await $.store.get(LIVE)) ?? {}) as Daily
    const h = ((await $.store.get(HIST)) ?? {}) as Daily
    await update($, live, () => l)
    await update($, hist, () => h)
    await $.command.register({
      name: 'tokens',
      description: 'Suivi des tokens : tendance, jours, repos (panneau interactif). Options : texte, import',
    })
    void runImport($, false)
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
      await update($, live, d => {
        const row = d[day] ?? {}
        return { ...d, [day]: { ...row, [repo]: add(row[repo] ?? empty(), { usd: delta }) } }
      })
      await save($, LIVE, prune(await read($, live)))
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
      await update($, live, d => {
        const row = d[day] ?? {}
        const cur = row[repo] ?? empty()
        return { ...d, [day]: { ...row, [repo]: add(cur, { input: t.input, output: t.output, cacheRead: t.cacheRead, cacheWrite: t.cacheWrite, turns: 1 }) } }
      })
      await save($, LIVE, prune(await read($, live)))
    }
    return next(e)
  })

  on('command.run', { command: 'tokens' }, async ($, e) => {
    const arg = e.args.trim()
    if (arg === 'import') {
      await runImport($, true)
      return { text: (await read($, importNote)) || 'Historique relu.' }
    }
    const now = await $.clock.now()
    const text = report(await read($, turns), merge(await read($, hist), await read($, live)), now, repo, await read($, importNote))
    if (arg !== 'texte') {
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
    const nowMs = await $.clock.now()
    const current = await read($, tab)
    const n = await read($, period)
    const m = await read($, metric)
    const only = await read($, repoFilter)
    const costly = await read($, isCostly)
    const note = await read($, importNote)
    const all = merge(await read($, hist), await read($, live))
    const flat = filtered(all, only)
    const days = lastDays(n, nowMs)
    const room = Math.max(4, (e.viewport?.rows ?? 28) - 14)
    const wide = (e.props as { bodyColumns?: number }).bodyColumns ?? e.viewport?.columns ?? 60
    const barW = Math.max(8, Math.min(28, wide - 40))

    const tabs: [Tab, string][] = [
      ['apercu', 'Aperçu'],
      ['jours', 'Jours'],
      ['repos', 'Repos'],
      ['session', 'Session'],
    ]

    const chip = (id: string, label: string, isOn: boolean, act: () => void) => (
      <Button key={id} label={isOn ? `● ${label}` : label} onPress={act} plain />
    )

    // En-tête : trois repères chiffrés.
    const kpi = ([['Aujourd\'hui', 1], ['7 jours', 7], ['30 jours', 30]] as [string, number][]).map(([label, k]) => {
      const t = sumOver(flat, lastDays(k, nowMs))
      return { label, t }
    })

    let body
    if (current === 'apercu') {
      const dayVals = days.map(k => value(flat[k] ?? empty(), m))
      const top = byRepo(all, days).slice(0, Math.min(8, room))
      const topMax = Math.max(1, ...top.map(x => value(x[1], m)))
      body = (
        <Box flexDirection="column">
          <Text>
            <Text dimColor>Tendance {n} j </Text>
            <Text color="claude">{spark(dayVals)}</Text>
            <Text dimColor> max {show(Math.max(0, ...dayVals), m)}/jour</Text>
          </Text>
          <Text bold>Repos {only ? `(filtré : ${only})` : `(${n} j)`}</Text>
          {top.length === 0 && <Text dimColor>Pas encore d'historique.</Text>}
          {top.map(([r, v]) => {
            const [a, b] = split(r === only || only === null ? v.input + v.cacheWrite : 0, v.output, topMax * (m === 'tokens' ? 1 : 1), 12)
            return (
              <Box key={`row-${r}`}>
                <Button key={`repo-${r}`} label={`${r === only ? '▶ ' : '  '}${r.padEnd(16).slice(0, 16)}`} onPress={() => update($, repoFilter, cur => (cur === r ? null : r))} plain />
                <Text>
                  <Text color="suggestion">{fill(m === 'tokens' ? a : Math.round((value(v, m) / topMax) * 12))}</Text>
                  <Text color="claude">{m === 'tokens' ? fill(b) : ''}</Text>
                  <Text dimColor>{rest(m === 'tokens' ? a + b : Math.round((value(v, m) / topMax) * 12), 12)}</Text>
                  <Text> {show(value(v, m), m)}</Text>
                </Text>
              </Box>
            )
          })}
        </Box>
      )
    } else if (current === 'jours') {
      const rows = [...days].reverse().slice(0, room)
      const max = Math.max(1, ...days.map(k => (m === 'tokens' ? spent(flat[k] ?? empty()) : value(flat[k] ?? empty(), m))))
      body = (
        <Box flexDirection="column">
          {rows.map(k => {
            const t = flat[k] ?? empty()
            const [a, b] = m === 'tokens' ? split(t.input + t.cacheWrite, t.output, max, barW) : ([Math.round((value(t, m) / max) * barW), 0] as const)
            return (
              <Text key={k}>
                <Text dimColor>{dayLabel(k)} </Text>
                <Text color="suggestion">{fill(a)}</Text>
                <Text color="claude">{fill(b)}</Text>
                <Text dimColor>{rest(a + b, barW)}</Text>
                <Text> {show(value(t, m), m).padStart(6)}</Text>
                <Text dimColor>{m !== 'usd' && t.usd > 0 ? `  ${money(t.usd)}` : ''}</Text>
              </Text>
            )
          })}
        </Box>
      )
    } else if (current === 'repos') {
      const rows = byRepo(all, days).slice(0, room)
      const total = Math.max(1, rows.reduce((a, [, v]) => a + value(v, m), 0))
      const max = Math.max(1, ...rows.map(([, v]) => (m === 'tokens' ? spent(v) : value(v, m))))
      body = (
        <Box flexDirection="column">
          {rows.length === 0 && <Text dimColor>Pas encore d'historique.</Text>}
          {rows.map(([r, v]) => {
            const [a, b] = m === 'tokens' ? split(v.input + v.cacheWrite, v.output, max, barW) : ([Math.round((value(v, m) / max) * barW), 0] as const)
            return (
              <Box key={`row-${r}`}>
                <Button key={`repo-${r}`} label={`${r === only ? '▶ ' : '  '}${r.padEnd(16).slice(0, 16)}`} onPress={() => update($, repoFilter, cur => (cur === r ? null : r))} plain />
                <Text>
                  <Text color="suggestion">{fill(a)}</Text>
                  <Text color="claude">{fill(b)}</Text>
                  <Text dimColor>{rest(a + b, barW)}</Text>
                  <Text> {show(value(v, m), m).padStart(6)}</Text>
                  <Text dimColor> {Math.round((value(v, m) / total) * 100)} %</Text>
                </Text>
              </Box>
            )
          })}
        </Box>
      )
    } else {
      const list = await read($, turns)
      const rows = (costly ? [...list].sort((a, b) => spent(b) - spent(a)) : [...list].reverse()).slice(0, room)
      const max = Math.max(1, ...rows.map(spent))
      body = (
        <Box flexDirection="column">
          <Button key="sort" label={costly ? '↕ Tri : plus gourmands' : '↕ Tri : plus récents'} onPress={() => update($, isCostly, v => !v)} plain />
          {rows.length === 0 && <Text dimColor>Aucun tour terminé dans cette session.</Text>}
          {rows.map(t => {
            const [a, b] = split(t.input + t.cacheWrite, t.output, max, barW)
            return (
              <Text key={String(t.at)}>
                <Text dimColor>{hhmm(t.at)} </Text>
                <Text color="suggestion">{fill(a)}</Text>
                <Text color="claude">{fill(b)}</Text>
                <Text dimColor>{rest(a + b, barW)}</Text>
                <Text> ↑{compact(t.input + t.cacheWrite)} ↓{compact(t.output)}</Text>
                <Text dimColor> · cache {compact(t.cacheRead)} · {t.seconds}s{t.usd > 0 ? ` · ${money(t.usd)}` : ''}</Text>
              </Text>
            )
          })}
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        <Box>
          {kpi.map(k => (
            <Text key={k.label}>
              <Text dimColor>{k.label} </Text>
              <Text bold>{compact(spent(k.t))}</Text>
              <Text dimColor>{k.t.usd > 0 ? ` · ${money(k.t.usd)}` : ''}   </Text>
            </Text>
          ))}
        </Box>
        <Box>
          {tabs.map(([id, label]) => chip(`tab-${id}`, label, id === current, () => update($, tab, () => id)))}
        </Box>
        {current !== 'session' && (
          <Box>
            <Text dimColor>Période </Text>
            {[7, 14, 30, 60].map(k => chip(`p${k}`, `${k} j`, k === n, () => update($, period, () => k)))}
            <Text dimColor>  Mesure </Text>
            {(['tokens', 'cache', 'usd'] as Metric[]).map(k => chip(`m-${k}`, k === 'usd' ? '$' : k === 'cache' ? 'cache' : 'tokens', k === m, () => update($, metric, () => k)))}
            {only !== null && <Button key="unfilter" label={`✕ ${only}`} onPress={() => update($, repoFilter, () => null)} plain />}
          </Box>
        )}
        {body}
        <Text dimColor>
          <Text color="suggestion">█</Text> entrée <Text color="claude">█</Text> sortie · {METRIC_LABEL[m]}
        </Text>
        {note !== '' && <Text dimColor>{note}</Text>}
      </Box>
    )
  })
}
