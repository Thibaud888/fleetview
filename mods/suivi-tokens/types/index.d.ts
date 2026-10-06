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

export type Tab = 'apercu' | 'jours' | 'repos' | 'session'
export type Metric = 'tokens' | 'cache' | 'usd'

declare module 'claude-code' {
  interface PluginState {
    'suivi-tokens': {
      turns: Turn[]
      live: Daily
      hist: Daily
      tab: Tab
      period: number
      metric: Metric
      repoFilter: string | null
      isCostly: boolean
      importNote: string
    }
  }
}
