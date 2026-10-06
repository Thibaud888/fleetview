import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Jauge } from '../types'

const jauge = atom({ plugin: 'jauge-tokens', key: 'jauge' } as const, null)
const isHidden = atom({ plugin: 'jauge-tokens', key: 'isHidden' } as const, false)

const LIMITS: Record<string, string> = { five_hour: '5 h', seven_day: '7 j', spend_limit: 'budget' }

const level = (pct: number) => (pct >= 90 ? 'error' : pct >= 70 ? 'warning' : 'success')

const bar = (pct: number, width = 10) => {
  const filled = Math.max(0, Math.min(width, Math.round((pct / 100) * width)))
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

const compact = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`)

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const u = await $.session.usage()
    await update($, jauge, () => ({
      percent: u.context.percent ?? null,
      tokens: u.context.tokens ?? null,
      window: u.context.window,
      usd: u.cost?.usd ?? null,
      limits: u.rateLimits.map(l => ({ kind: l.kind, percentUsed: l.percentUsed })),
    }))
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    const j: Jauge = {
      percent: e.context.percent ?? null,
      tokens: e.context.tokens ?? null,
      window: e.context.window,
      usd: e.cost?.usd ?? null,
      limits: e.rateLimits.map(l => ({ kind: l.kind, percentUsed: l.percentUsed })),
    }
    await update($, jauge, () => j)

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const j = await read($, jauge)
    if (e.props.hasSurvey || j === null || (await read($, isHidden))) {
      return next(e)
    }

    const { Box, Button, Text } = $.ui.resolve(e)
    const limits = j.limits.filter(l => l.percentUsed >= 1)

    return (
      <Box>
        {j.percent === null ? (
          <Text dimColor>Contexte : en attente de la 1re réponse</Text>
        ) : (
          <Text>
            <Text dimColor>Contexte </Text>
            <Text color={level(j.percent)}>{bar(j.percent)} {Math.round(j.percent)} %</Text>
            <Text dimColor> ({compact(j.tokens ?? 0)}/{compact(j.window)})</Text>
          </Text>
        )}
        {limits.map(l => (
          <Text key={l.kind}>
            <Text dimColor>  ·  {LIMITS[l.kind] ?? l.kind} </Text>
            <Text color={level(l.percentUsed)}>{Math.round(l.percentUsed)} %</Text>
          </Text>
        ))}
        {j.usd !== null ? <Text dimColor>  ·  ${j.usd.toFixed(2)}</Text> : null}
        <Text>{'  '}</Text>
        <Button key="hide" label="Masquer" onPress={() => update($, isHidden, () => true)} />
      </Box>
    )
  })
}
