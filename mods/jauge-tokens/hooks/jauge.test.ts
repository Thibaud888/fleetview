import { test, expect } from 'claude-code/testing'

const MEASURE = {
  context: { tokens: 150000, window: 200000, percent: 75 },
  rateLimits: [{ kind: 'five_hour', percentUsed: 42 }],
  cost: { usd: 1.23 },
  changed: ['context', 'rateLimits', 'cost'],
} as const

test('la jauge se dessine puis se masque sur chaque surface', async ($, on) => {
  on('ui.render', ($, e) => $.ui.resolve(e).Box({}))
  on('ui.toast', (_$, e) => e as never)
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  await $.session.measure({ ...MEASURE, changed: [...MEASURE.changed] })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'jauge-tokens',
      surface,
      component: 'AbovePrompt',
      props: { hasSurvey: false },
    })
    expect(await ui.find({ type: 'Text', text: /75 %/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /5 h/ })).toBeDefined()
    await ui.unmount()
  }

  const ui = await $.ui.mount({
    plugin: 'jauge-tokens',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false },
  })
  await ui.press({ key: 'hide' })
  expect(await ui.find({ type: 'Text', text: /75 %/ })).toBeUndefined()
  await ui.unmount()
})
