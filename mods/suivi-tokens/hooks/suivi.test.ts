import { test, expect, mock } from 'claude-code/testing'

const PANE_PROPS = { title: 'Tokens', isFocused: false } as never

test('/tokens : le suivi cumule les tours, le coût et se dessine', async ($, on) => {
  mock.clock(on, { now: Date.UTC(2026, 9, 6, 12, 0, 0) })
  mock.store(on)
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000 }, rateLimits: [], cost: { usd: 0 } } }) as never)
  on('ui.render', ($, e) => $.ui.resolve(e).Box({}))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: {} }) as never)
  on('ui.open', () => ({ value: {} }) as never)
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('turn.complete', (_$, e) => ({ text: e.answer }) as never)

  await $.session.start({ cwd: '/home/user/fleetview', surface: 'terminal', isInteractive: true } as never)
  await $.session.measure({
    context: { tokens: 1000, window: 200000, percent: 1 },
    rateLimits: [],
    cost: { usd: 0.5 },
    changed: ['cost'],
  })
  await $.turn.complete({
    answer: 'ok',
    durationMs: 4000,
    isAborted: false,
    turnId: 't1',
    reason: 'end_turn',
    usage: { input_tokens: 1200, output_tokens: 300, cache_read_input_tokens: 9000, cache_creation_input_tokens: 500, model: 'm' },
  } as never)

  const out = await $.command.run({ command: 'tokens', args: 'texte', origin: { kind: 'composer' }, presentation: {} } as never)
  expect(JSON.stringify(out)).toContain('Cette session')
  expect(JSON.stringify(out)).toContain('$0.50')
  expect(JSON.stringify(out)).toContain('fleetview')

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'suivi-tokens', surface, component: 'Pane', requestId: 'suivi-tokens', props: PANE_PROPS })
    expect(await ui.find({ type: 'Text', text: /↑2k/ })).toBeDefined()
    await ui.unmount()
  }

  const ui = await $.ui.mount({ plugin: 'suivi-tokens', surface: 'terminal', component: 'Pane', requestId: 'suivi-tokens', props: PANE_PROPS })
  await ui.press({ key: 'jours' })
  expect(await ui.find({ type: 'Text', text: /1 tours/ })).toBeDefined()
  await ui.press({ key: 'repos' })
  expect(await ui.find({ type: 'Text', text: /fleetview/ })).toBeDefined()
  await ui.unmount()
})
