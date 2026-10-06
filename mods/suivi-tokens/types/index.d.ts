export type Totals = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  usd: number
  turns: number
}

export type Turn = {
  at: number
  seconds: number
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  usd: number
}

/** jour (AAAA-MM-JJ) → repo → cumul */
export type Daily = Record<string, Record<string, Totals>>

export type Tab = 'session' | 'jours' | 'repos'

declare module 'claude-code' {
  interface PluginState {
    'suivi-tokens': { turns: Turn[]; daily: Daily; tab: Tab; isCostly: boolean }
  }
}
