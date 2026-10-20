import { mock } from 'claude-code/testing'
import type { MockClock } from 'claude-code/testing'
import type { CommandInfo, ModelCompleteResult, On, ProcessRunResult, SessionMessage, SessionRateLimit } from 'claude-code'

// The engine beneath the plugin, shared by every test file: each one sets only
// what its row reads, and the rest answers as a quiet session would (no
// repository, no usage reading, no transcript), so the other rows stay out of
// its way.

export const PLUGIN = 'session-band'
export const NOW = Date.parse('2026-10-14T12:00:00Z')
export const MINUTE = 60_000
const CONTEXT = { window: 200_000 }

export const BAND = {
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 8,
    bodyColumns: 120,
    scroll: { offset: 0, bodyRows: 8 },
    view: {},
  },
} as const

const COMMANDS: CommandInfo[] = [
  { name: 'model', description: 'Set the model', source: 'builtin' },
  { name: 'clear', description: 'Clear the conversation', source: 'builtin' },
  { name: 'draft-spec', description: 'Draft a spec', source: 'plugin' },
]

const USAGE = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
export const answered = (text: string): ModelCompleteResult => ({ isAnswered: true, text, usage: USAGE })
export const unanswered: ModelCompleteResult = { isAnswered: false, reason: 'api-error', status: 529, error: 'overloaded', usage: USAGE }

export type World = {
  clock: MockClock
  // The task row's model and transcript.
  /** Each completion's prompt, in the order asked. */
  asked: string[]
  /** The label the model answers each prompt with, by a word the prompt holds; or how it fails, and after how long. */
  replies: Array<[RegExp, ModelCompleteResult, number?]>
  transcript: SessionMessage[]
  // The repo row's git.
  /** The session's root: the working tree's top, or a folder beneath it. */
  root: string
  /** The working tree's top; a linked worktree when it is not `repoRoot`. */
  top: string
  repoRoot: string | null
  branch: string | null
  sha: string
  changed: number
  upstream: string | null
  ahead: number
  behind: number
  /** Status fails, as in a repository too large for the timeout. */
  isStatusFailing: boolean
  /** Holds each git answer until the test's clock moves this far. */
  gitDelayMs: number
  /** Every tool call answers as one the tool held read-only. */
  isToolReadOnly: boolean
  gitCalls: string[]
  // The usage row's windows and the machine's fonts.
  rateLimits: SessionRateLimit[]
  /** The families fontconfig names as carrying any symbol asked after; `null` where fontconfig is not installed. */
  fontconfig: string[] | null
  /** The families for one symbol, by its code point in hex (`f075`), in place of `fontconfig`. */
  fontconfigFor: Record<string, string[]>
  /** The files in each font folder. */
  folders: Record<string, string[]>
  /** Engine calls that are refused, with the reason given. */
  refused: Partial<Record<'session.usage' | 'command.register', string>>
}

export type Given = Partial<Omit<World, 'clock' | 'asked' | 'gitCalls'>> & { env?: Record<string, string> }

const REV_PARSE = 'git rev-parse --path-format=absolute --show-toplevel --git-dir --git-common-dir'
export const STATUS = 'git --no-optional-locks status --porcelain=v2 --branch'
const FONTCONFIG = /^fc-list :charset=([0-9a-f]+) family$/

const exited = (stdout: string, exitCode = 0): ProcessRunResult => ({
  exitCode,
  stdout,
  stderr: '',
  isStdoutTruncated: false,
  isStderrTruncated: false,
})

const statusOut = (w: World): string => {
  const oid = w.sha.padEnd(40, '0')
  return [
    `# branch.oid ${oid}`,
    `# branch.head ${w.branch ?? '(detached)'}`,
    ...(w.upstream === null ? [] : [`# branch.upstream ${w.upstream}`, `# branch.ab +${w.ahead} -${w.behind}`]),
    ...Array.from({ length: w.changed }, (_, i) =>
      i % 2 === 0 ? `1 .M N... 100644 100644 100644 ${oid} ${oid} file-${i}` : `? new-${i}`,
    ),
    '',
  ].join('\n')
}

// The engine's own band, empty unless a survey holds it, is the innermost
// `ui.render` hook, so a test drawing a band beneath the plugin registers it
// before calling this.
export const engine = (on: On, given: Given = {}): World => {
  const root = given.root ?? '/tmp/scratch'
  const w: World = {
    clock: mock.clock(on, { now: NOW }),
    asked: [],
    replies: [],
    transcript: [],
    top: root,
    repoRoot: null,
    branch: null,
    sha: '',
    changed: 0,
    upstream: null,
    ahead: 0,
    behind: 0,
    isStatusFailing: false,
    gitDelayMs: 0,
    isToolReadOnly: false,
    rateLimits: [],
    fontconfig: ['.LastResort', 'Symbols Nerd Font'],
    fontconfigFor: {},
    folders: {},
    refused: {},
    ...given,
    root,
    gitCalls: [],
  }
  mock.env(on, given.env ?? {})

  on('model.complete', async ($, e) => {
    w.asked.push(e.prompt)
    const match = w.replies.find(([word]) => word.test(e.prompt.split('<message>').at(-1) ?? ''))
    if (match === undefined) return { value: answered('Unexpected prompt') }
    if (match[2] !== undefined) await w.clock.sleep(match[2])
    return { value: match[1] }
  })
  on('command.list', () => ({ value: COMMANDS }))
  on('command.register', ($, e) => {
    const refused = w.refused['command.register']
    return refused === undefined ? { value: { command: e.name } } : { deny: refused }
  })
  on('session.messages', () => ({ value: w.transcript }))
  on('session.root', () => ({ value: w.root }))
  on('session.repo', () => ({
    value: w.repoRoot === null ? null : { root: w.repoRoot, remote: null, internal: false, name: null },
  }))
  on('session.usage', () => {
    const refused = w.refused['session.usage']
    return refused === undefined ? { value: { startedAt: NOW, context: CONTEXT, rateLimits: w.rateLimits } } : { deny: refused }
  })
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('process.run', async ($, e) => {
    const args = e.argv.join(' ')
    const charset = FONTCONFIG.exec(args)?.[1]
    if (charset !== undefined) {
      if (w.fontconfig === null) return { deny: `${e.argv[0]}: command not found` }
      const families = w.fontconfigFor[charset] ?? w.fontconfig
      return { value: exited(families.map(family => `${family}\n`).join('')) }
    }
    w.gitCalls.push(args)
    if (w.gitDelayMs > 0) await w.clock.sleep(w.gitDelayMs)
    if (w.repoRoot === null) return { value: exited('', 128) }
    if (args === REV_PARSE) {
      const gitDir = w.top === w.repoRoot ? `${w.repoRoot}/.git` : `${w.repoRoot}/.git/worktrees/${w.top.split('/').pop()}`
      return { value: exited(`${w.top}\n${gitDir}\n${w.repoRoot}/.git\n`) }
    }
    if (args === STATUS) return { value: w.isStatusFailing ? exited('', 128) : exited(statusOut(w)) }
    if (args === 'git branch --show-current') return { value: exited(w.branch === null ? '' : `${w.branch}\n`) }
    if (args === 'git rev-parse --short HEAD') return { value: exited(`${w.sha}\n`) }
    return { value: exited('', 128) }
  })
  on('fs.list', ($, e) => {
    const files = w.folders[e.path]
    if (files === undefined) return { deny: `ENOENT: no such file or directory, scandir '${e.path}'` }
    return { value: files.map(name => ({ name, kind: 'file' as const, size: 0, mtimeMs: 0, isLink: false })) }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.version', () => ({ value: { version: '2.1.304', versionBase: '2.1.304', buildTime: '' } }))
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('tool.call', () => (w.isToolReadOnly ? { result: 'ran', isReadOnly: true } : { result: 'ran' }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('classic.SessionStart', () => ({}))
  on('classic.CwdChanged', () => ({}))
  on('ui.log', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }))

  return w
}

export const fiveHour = (percentUsed: number, resetsInMs: number): SessionRateLimit => ({
  kind: 'five_hour',
  percentUsed,
  resetsAt: new Date(NOW + resetsInMs).toISOString(),
})

// Reading a drawn band: the texts of the whole band, or of one row by its key.
type Node = { type?: unknown; props?: Record<string, unknown>; children?: unknown }

const kids = (n: Node): unknown[] => (n.children === undefined ? [] : Array.isArray(n.children) ? n.children : [n.children])

export const textsOf = (n: unknown): string[] => {
  if (n === null || typeof n !== 'object') return []
  const node = n as Node
  if (node.type === 'Text') return [kids(node).filter(c => typeof c === 'string' || typeof c === 'number').join('')]
  return kids(node).flatMap(textsOf)
}

export const nodeOf = (n: unknown, key: string): Node | undefined => {
  if (n === null || typeof n !== 'object') return undefined
  const node = n as Node
  if (node.props?.['key'] === key) return node
  for (const child of kids(node)) {
    const found = nodeOf(child, key)
    if (found !== undefined) return found
  }
  return undefined
}

/** The row keys the band draws, top to bottom. */
export const rowIds = (n: unknown): string[] => {
  if (n === null || typeof n !== 'object') return []
  const node = n as Node
  const key = node.props?.['key']
  if (key === 'task' || key === 'repo' || key === 'usage' || key === 'replay') return [key]
  return kids(node).flatMap(rowIds)
}

/** The first Text under `n` that draws exactly `text`. */
export const textIn = (n: unknown, text: string): Node | undefined => {
  if (n === null || typeof n !== 'object') return undefined
  const node = n as Node
  if (node.type === 'Text' && textsOf(node)[0] === text) return node
  for (const child of kids(node)) {
    const found = textIn(child, text)
    if (found !== undefined) return found
  }
  return undefined
}

type Drawn = { drawn: () => Promise<unknown> }

export const rowTexts = async (ui: Drawn, key: string): Promise<string[]> => textsOf(nodeOf(await ui.drawn(), key))
export const bandTexts = async (ui: Drawn): Promise<string[]> => textsOf(await ui.drawn())
