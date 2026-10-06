// Reconstitue l'historique des tokens depuis les transcripts de Claude Code.
// Usage : node import.mjs <dossier projects> [jours=90]
// Sortie : JSON { days: { "AAAA-MM-JJ": { repo: { input, output, cacheRead, cacheWrite, usd:0, turns } } }, files, messages }
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'

const root = process.argv[2]
const maxDays = Number(process.argv[3] ?? 90)
const since = Date.now() - maxDays * 86_400_000

const walk = dir => {
  const out = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...walk(p))
    else if (e.name.endsWith('.jsonl') && statSync(p).mtimeMs >= since) out.push(p)
  }
  return out
}

const p2 = n => String(n).padStart(2, '0')
const dayKey = ms => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`
}

const seen = new Map() // message.id -> dernière version (les blocs d'une même réponse répètent l'usage)
let files = 0
for (const file of walk(root)) {
  files++
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    continue
  }
  for (const line of text.split('\n')) {
    if (!line.includes('"usage"')) continue
    let d
    try {
      d = JSON.parse(line)
    } catch {
      continue
    }
    const m = d.message
    if (d.type !== 'assistant' || !m?.usage || !m.id || !d.timestamp) continue
    const at = Date.parse(d.timestamp)
    if (!(at >= since)) continue
    seen.set(`${m.id}:${d.requestId ?? ''}`, { at, cwd: d.cwd ?? '', u: m.usage })
  }
}

const days = {}
for (const { at, cwd, u } of seen.values()) {
  const day = dayKey(at)
  const repo = basename(cwd) || 'inconnu'
  const row = (days[day] ??= {})
  const t = (row[repo] ??= { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, usd: 0, turns: 0 })
  t.input += u.input_tokens ?? 0
  t.output += u.output_tokens ?? 0
  t.cacheRead += u.cache_read_input_tokens ?? 0
  t.cacheWrite += u.cache_creation_input_tokens ?? 0
  t.turns += 1
}
process.stdout.write(JSON.stringify({ days, files, messages: seen.size }))
