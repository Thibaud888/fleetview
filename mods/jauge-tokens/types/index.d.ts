export type Jauge = {
  percent: number | null
  tokens: number | null
  window: number
  usd: number | null
  limits: { kind: string; percentUsed: number }[]
}

declare module 'claude-code' {
  interface PluginState {
    'jauge-tokens': { jauge: Jauge | null; isHidden: boolean }
  }
}
