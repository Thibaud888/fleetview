import { test, expect, mock } from 'claude-code/testing'

const PANE_PROPS = { title: 'Tokens', isFocused: false } as never

const HIST = {
  days: {
    '2026-10-04': { fleetview: { input: 100, output: 4000, cacheRead: 90000, cacheWrite: 8000, usd: 0, turns: 12 }, claude_ops: { input: 50, output: 2000, cacheRead: 40000, cacheWrite: 3000, usd: 0, turns: 5 } },
    '2026-10-06': { fleetview: { input: 124, output: 47075, cacheRead: 8532416, cacheWrite: 253417, usd: 0, turns: 60 } },
  },
  files: 3,
  messages: 77,
}

const setup = async ($: any, on: any) => {
  mock.clock(on, { now: Date.UTC(2026, 9, 6, 12, 0, 0) })
  mock.store(on)
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000 }, rateLimits: [], cost: { usd: 0 } } }))
  on('env.get', () => ({ value: '/home/test' }))
  on('fs.exists', () => ({ value: true }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: JSON.stringify(HIST), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('ui.render', ($: any, e: any) => $.ui.resolve(e).Box({}))
  on('command.register', () => ({ value: {} }))
  on('ui.open', () => ({ value: {} }))
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }))
  on('session.measure', (_$: any, e: any) => ({ changed: e.changed }))
  on('turn.complete', (_$: any, e: any) => ({ text: e.answer }))
}

test('/tokens : historique repris, résumé texte et panneau interactif', async ($, on) => {
  await setup($, on)
  await $.session.start({ cwd: '/home/user/fleetview', surface: 'terminal', isInteractive: true } as never)
  await $.session.measure({ context: { tokens: 1000, window: 200000, percent: 1 }, rateLimits: [], cost: { usd: 0.5 }, changed: ['cost'] })
  await $.turn.complete({
    answer: 'ok', durationMs: 4000, isAborted: false, turnId: 't1', reason: 'end_turn',
    usage: { input_tokens: 1200, output_tokens: 300, cache_read_input_tokens: 9000, cache_creation_input_tokens: 500, model: 'm' },
  } as never)

  const imp = await $.command.run({ command: 'tokens', args: 'import', origin: { kind: 'composer' }, presentation: {} } as never)
  expect(JSON.stringify(imp)).toContain('77 réponses')

  const out = JSON.stringify(await $.command.run({ command: 'tokens', args: 'texte', origin: { kind: 'composer' }, presentation: {} } as never))
  expect(out).toContain('Cette session')
  expect(out).toContain('30 jours')
  expect(out).toContain('Tendance 30 j')
  expect(out).toContain('fleetview')

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'suivi-tokens', surface, component: 'Pane', requestId: 'suivi-tokens', props: PANE_PROPS })
    expect(await ui.find({ type: 'Text', text: /Tendance/ })).toBeDefined()
    expect(await ui.find({ key: 'repo-fleetview' })).toBeDefined()
    await ui.unmount()
  }

  const ui = await $.ui.mount({ plugin: 'suivi-tokens', surface: 'terminal', component: 'Pane', requestId: 'suivi-tokens', props: PANE_PROPS })
  await ui.press({ key: 'tab-jours' })
  expect(await ui.find({ type: 'Text', text: /me 04\/10|ve 04\/10|di 04\/10|sa 04\/10/ })).toBeDefined()
  await ui.press({ key: 'p7' })
  await ui.press({ key: 'm-usd' })
  await ui.press({ key: 'tab-repos' })
  await ui.press({ key: 'repo-fleetview' })
  expect(await ui.find({ key: 'unfilter' })).toBeDefined()
  await ui.press({ key: 'unfilter' })
  expect(await ui.find({ key: 'unfilter' })).toBeUndefined()
  await ui.press({ key: 'tab-session' })
  expect(await ui.find({ type: 'Text', text: /↑1\.7k/ })).toBeDefined()
  await ui.unmount()
})
