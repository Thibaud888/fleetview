import { test, expect } from 'claude-code/testing'

const measure = (percent: number, five = 10, usd = 0) => ({
  context: { tokens: percent * 2000, window: 200000, percent },
  rateLimits: [{ kind: 'five_hour', percentUsed: five }],
  cost: { usd },
  changed: ['context'] as ('context' | 'rateLimits' | 'cost')[],
})

test('alerte aux seuils, une seule fois, et prévient avant le plein', async ($, on) => {
  const toasts: string[] = []
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('ui.toast', (_$, e) => {
    toasts.push(JSON.stringify(e))
    return {} as never
  })
  on('ui.log', () => ({}) as never)

  await $.session.measure(measure(40))
  expect(toasts).toHaveLength(0)

  await $.session.measure(measure(72))
  await $.session.measure(measure(73))
  expect(toasts.filter(t => t.includes('pense à compacter'))).toHaveLength(1)

  await $.session.measure(measure(92, 85))
  expect(toasts.some(t => t.includes('compacte ou /clear'))).toBe(true)
  expect(toasts.some(t => t.includes('limite 5 h'))).toBe(true)
})
