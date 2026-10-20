import type { EngineInterface, Register, RenderElement, RenderInput, ToolCallInput } from 'claude-code'

import type { DiffLine, ReplayStep } from '../types'
import type { Row } from './row'

// The replay row and pane: records the file edits Claude makes in a turn, then
// lets you step through them in a pane, one diff at a time. It only watches: it
// never blocks, changes or delays an edit.

const PANE_ID = 'session-band-replay'
const MAX_DIFF_LINES = 12
const MAX_LCS_LINES = 400
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit'])
// The last replay, kept by the host so a hot reload of this module keeps it.
const REPLAY_REF = { plugin: 'session-band', key: 'replay' } as const
// The pane's diff region, the Client that hears ↑ and ↓.
const DIFF_KEY = 'diff'
const REPLAY_COLOR = 'magenta'
const REPLAY_GLYPH = '▶'

// Module state. `pending` fills during a turn; `replay` is the last finished
// turn's steps, the ones the pane shows.
const state = {
  pending: [] as ReplayStep[],
  replay: [] as ReplayStep[],
  index: 0,
  isOpen: false,
  isInBand: false,
}

const relPath = (cwd: string, path: string | undefined): string => {
  if (!path) return '(unknown file)'
  if (cwd && path.startsWith(`${cwd}/`)) return path.slice(cwd.length + 1)
  return path
}

const splitLines = (text: string | undefined | null): string[] => {
  if (text === undefined || text === null || text === '') return []
  const lines = String(text).split('\n')
  if (lines.length > 1 && lines.at(-1) === '') lines.pop()
  return lines
}

// Keep one line of context around each change, so a long file's Write shows
// the changed lines, not the whole file.
const trimContext = (lines: DiffLine[]): DiffLine[] => {
  if (!lines.some(l => l.op !== ' ')) return lines.slice(0, MAX_DIFF_LINES)
  const isChange = (k: number): boolean => {
    const op = lines[k]?.op
    return op !== undefined && op !== ' '
  }
  const out: DiffLine[] = []
  let isSkipping = false
  lines.forEach((l, k) => {
    if (isChange(k) || isChange(k - 1) || isChange(k + 1)) {
      if (isSkipping && out.length > 0) out.push({ op: '~', t: '⋯' })
      out.push(l)
      isSkipping = false
    } else isSkipping = true
  })
  return out
}

// A line diff. Small inputs get an LCS diff, so unchanged lines show as
// context; large ones fall back to all-removed then all-added.
const diffLines = (oldText: string | undefined, newText: string | undefined): DiffLine[] => {
  const a = splitLines(oldText)
  const b = splitLines(newText)
  if (a.length > MAX_LCS_LINES || b.length > MAX_LCS_LINES) {
    return [...a.map(t => ({ op: '-' as const, t })), ...b.map(t => ({ op: '+' as const, t }))]
  }
  const n = a.length
  const m = b.length
  const dp = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  const at = (i: number, j: number): number => dp[i]?.[j] ?? 0
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1))
    }
  }
  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ op: ' ', t: a[i]! })
      i++
      j++
    } else if (at(i + 1, j) >= at(i, j + 1)) out.push({ op: '-', t: a[i++]! })
    else out.push({ op: '+', t: b[j++]! })
  }
  while (i < n) out.push({ op: '-', t: a[i++]! })
  while (j < m) out.push({ op: '+', t: b[j++]! })
  return trimContext(out)
}

const countChanges = (diff: readonly DiffLine[]): { add: number; del: number } => {
  let add = 0
  let del = 0
  for (const l of diff) {
    if (l.op === '+') add++
    else if (l.op === '-') del++
  }
  return { add, del }
}

// The shape of a MultiEdit call, for builds that have the tool; this one's types do not.
type MultiEditCall = { file_path?: string; edits?: { old_string?: string; new_string?: string }[] }

// Turns one tool call into one or more steps.
async function stepsFor($: EngineInterface, e: ToolCallInput): Promise<ReplayStep[]> {
  let cwd = ''
  try {
    cwd = await $.session.cwd()
  } catch {
    // Keep the full path.
  }
  if (e.tool === 'Edit') {
    const file = relPath(cwd, e.file_path)
    return [{ tool: 'Edit', file, diff: diffLines(e.old_string, e.new_string), note: e.replace_all === true ? 'replace all' : '' }]
  }
  if (e.tool === 'Write') {
    const file = relPath(cwd, e.file_path)
    let before = ''
    let isNew = true
    try {
      if (e.file_path && (await $.fs.exists(e.file_path))) {
        before = await $.fs.read(e.file_path)
        isNew = false
      }
    } catch {
      // Unreadable: show it as a new file.
    }
    return [{ tool: 'Write', file, diff: diffLines(before, e.content), note: isNew ? 'new file' : 'rewrite' }]
  }
  if (String(e.tool) === 'MultiEdit') {
    const multi = e as unknown as MultiEditCall
    const file = relPath(cwd, multi.file_path)
    const edits = Array.isArray(multi.edits) ? multi.edits : []
    return edits.map((ed, k) => ({
      tool: 'MultiEdit' as const,
      file,
      diff: diffLines(ed.old_string, ed.new_string),
      note: `edit ${k + 1} of ${edits.length}`,
    }))
  }
  return []
}

async function openReplay($: EngineInterface): Promise<boolean> {
  if (state.replay.length === 0) return false
  state.index = 0
  state.isOpen = true
  // The pane only takes the keyboard while nothing else holds it. Hide the
  // band row first (it held the keys if its button was pressed), then open.
  $.ui.invalidate('ui.render')
  await $.clock.sleep(200)
  const rows = Math.min(MAX_DIFF_LINES + 8, 22)
  const placed = await $.ui.open({ id: PANE_ID, title: 'Replay', focus: true, closeOnEscape: true, rows, columns: 58 })
  // No room for a pane (a narrow terminal): draw the replay in the band.
  state.isInBand = !placed.isPlaced
  $.ui.invalidate('ui.render')
  // Hand the diff region the keys so ↑ and ↓ work without a click. Not every
  // engine moves the ring onto a Client: a deny leaves it on Next.
  if (!state.isInBand) {
    try {
      await $.ui.focus({ requestId: PANE_ID, key: DIFF_KEY })
    } catch {
      // The click still works.
    }
  }
  return true
}

// Moves the replay to step `to`, held to its ends.
function goTo($: EngineInterface, to: number): void {
  state.index = Math.max(0, Math.min(to, state.replay.length - 1))
  $.ui.invalidate('ui.render')
}

function close($: EngineInterface): void {
  state.isOpen = false
  if (!state.isInBand) void $.ui.close({ id: PANE_ID })
  state.isInBand = false
  $.ui.invalidate('ui.render')
}

type ReplayInput = RenderInput<'Pane'> | RenderInput<'AbovePrompt'>

// The replay view: one step at a time. Drawn in the Pane, or in the band
// above the prompt when the surface can't place a pane.
function replayView($: EngineInterface, e: ReplayInput, isInBand: boolean): RenderElement {
  const elements = $.ui.resolve(e)
  const { Box, Text, Button } = elements
  // In the pane the diff is a Client, so ↑ and ↓ reach the mod once it is
  // clicked; a surface without Clients, and the band, draw the rows as Text.
  const Client = 'Client' in elements ? elements.Client : undefined
  const hasArrowKeys = !isInBand && Client !== undefined
  const maxRows = 'maxRows' in e.props && typeof e.props.maxRows === 'number' ? e.props.maxRows : 20
  const maxDiff = isInBand ? Math.max(3, Math.min(MAX_DIFF_LINES, maxRows - 7)) : MAX_DIFF_LINES
  const total = state.replay.length
  if (total === 0) return <Text dimColor>No edits to replay.</Text>
  const k = Math.max(0, Math.min(state.index, total - 1))
  const step = state.replay[k]!
  const width = Math.max(40, (e.props.bodyColumns ?? 100) - 4)
  const { add, del } = countChanges(step.diff)
  const shown = step.diff.slice(0, maxDiff)

  const lines = shown.map(l => ({
    text: `${l.op === '~' ? ' ' : l.op} ${l.t}`.slice(0, width),
    color: l.op === '+' ? 'green' : l.op === '-' ? 'red' : undefined,
    dim: l.op === ' ' || l.op === '~',
  }))
  if (step.diff.length > maxDiff) lines.push({ text: `  … ${step.diff.length - maxDiff} more lines`, color: undefined, dim: true })
  if (shown.length === 0) lines.push({ text: '  (no line changes)', color: undefined, dim: true })
  const diff = hasArrowKeys && Client !== undefined ? (
    <Client key={DIFF_KEY} module="./diff-surface.mjs" props={{ rows: lines }} />
  ) : (
    <Box flexDirection="column">
      {lines.map((l, n) => (
        <Text key={`d${n}`} color={l.color} dimColor={l.dim} wrap="truncate-end">
          {l.text}
        </Text>
      ))}
    </Box>
  )

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={REPLAY_COLOR} paddingX={1}>
      <Box flexDirection="row" justifyContent="space-between">
        <Text bold color={REPLAY_COLOR}>{`${REPLAY_GLYPH} Replay`}</Text>
        <Text bold>{`step ${k + 1} of ${total}`}</Text>
      </Box>
      <Box flexDirection="row">
        {state.replay.map((_, n) => (
          <Text key={`s${n}`} inverse={n === k} color={n === k ? 'cyan' : undefined} dimColor={n !== k}>
            {` ${n + 1} `}
          </Text>
        ))}
      </Box>
      <Text bold color="cyan" wrap="truncate-start">
        {step.file}
      </Text>
      <Box flexDirection="row" gap={2}>
        <Text dimColor>{`${step.tool}${step.note ? ` · ${step.note}` : ''}`}</Text>
        <Text color="green">{`+${add}`}</Text>
        <Text color="red">{`-${del}`}</Text>
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {diff}
      </Box>
      {hasArrowKeys && <Text dimColor>click the diff, then ↑ next · ↓ prev</Text>}
      <Box flexDirection="row" gap={2} marginTop={1}>
        <Button key="prev" label="◀ Prev" hotkey="p" onPress={() => goTo($, k - 1)} />
        <Button key="next" label="Next ▶" hotkey="n" autoFocus onPress={() => goTo($, k + 1)} />
        <Button key="close" label="Close" hotkey="c" onPress={() => close($)} />
      </Box>
    </Box>
  )
}

// After the session starts: the command, and the replay a hot reload kept.
export async function startReplay($: EngineInterface): Promise<void> {
  await $.command.register({ name: 'replay', description: "Step through the last turn's file edits, one diff at a time" })
  try {
    const { value } = await $.state.get(REPLAY_REF)
    if (Array.isArray(value) && value.length > 0 && state.replay.length === 0) {
      state.replay = value
      $.ui.invalidate('ui.render')
    }
  } catch {
    // Nothing kept: start empty.
  }
}

// Before a tool call runs: records an edit. Never blocks or fails the call.
export async function recordEdit($: EngineInterface, e: ToolCallInput): Promise<void> {
  if (!EDIT_TOOLS.has(String(e.tool))) return
  try {
    state.pending.push(...(await stepsFor($, e)))
  } catch {
    // Recording must never stop the edit.
  }
}

export const registerReplay: Register = on => {
  on('command.run', { command: 'replay' }, async $ => {
    const isOpened = await openReplay($)
    return { text: isOpened ? `Replay: ${state.replay.length} edit${state.replay.length === 1 ? '' : 's'}` : 'Replay: no edits in the last turn.' }
  })

  on('turn.start', ($, e, next) => {
    if (!e.agentId) state.pending = []
    return next(e)
  })

  // At the end of a main-loop turn, the pending edits become the replay.
  on('turn.complete', async ($, e, next) => {
    const completed = await next(e)
    if (e.agentId || state.pending.length === 0) return completed
    state.replay = state.pending
    state.pending = []
    state.index = 0
    try {
      await $.state.set(REPLAY_REF, state.replay)
    } catch {
      // Kept in memory only.
    }
    $.ui.invalidate('ui.render')
    return completed
  })

  on('ui.render', { component: 'Pane' }, ($, e, next) => {
    if (e.requestId !== PANE_ID) return next(e)
    return replayView($, e, false)
  })

  // ↑ and ↓ in the diff region: the surface module posts which way to step.
  on('ui.message', ($, e, next) => {
    if (e.requestId !== PANE_ID || e.element !== DIFF_KEY) return next(e)
    const step = (e.data as { step?: unknown } | null)?.step
    if (step === 1 || step === -1) goTo($, state.index + step)
    return {}
  })

  // The person closed the pane (Escape): keep the flag in step.
  on('ui.close', ($, e, next) => {
    if (e.id === PANE_ID) state.isOpen = false
    $.ui.invalidate('ui.render')
    return next(e)
  })
}

// The row that offers the replay, shown while one exists and its pane is closed.
export async function replayRow($: EngineInterface): Promise<Row | null> {
  const n = state.replay.length
  if (n === 0 || state.isOpen) return null
  return {
    id: 'replay',
    glyph: { text: REPLAY_GLYPH, color: REPLAY_COLOR },
    label: 'replay',
    value: [{ text: `${n} edit${n === 1 ? '' : 's'}`, isFixed: true }],
    action: { hotkey: 'r', label: 'replay', onPress: () => void openReplay($) },
  }
}

// The replay itself, drawn in the band where no pane could be placed.
export function replayInBand($: EngineInterface, e: RenderInput<'AbovePrompt'>): RenderElement | null {
  return state.isOpen && state.isInBand ? replayView($, e, true) : null
}
