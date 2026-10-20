import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, ToolCallResult } from 'claude-code'

import type { Where } from '../types'
import type { Row, Segment } from './row'

// The repo row: which repository, branch and worktree the session works in.

const where = atom({ plugin: 'session-band', key: 'where' } as const, null)

// Each slot keeps one color, so the eye finds the same thing in the same hue in
// every session: the worktree's name, the repository's, and the branch.
const WORKTREE_COLOR = '#f5f5dc'
const REPOSITORY_COLOR = '#d4834a'
const BRANCH_COLOR = '#55e07e'
// The branch glyph, Unicode's ALTERNATIVE KEY SYMBOL (U+2387), which needs no
// Nerd Font; Powerline's U+E0A0 is the one to swap in where the terminal has one.
const BRANCH_GLYPH = '⎇'
const GLYPH_COLOR = '#fb8500'
// The marks after the branch, drawn only when nonzero: files changed in the
// working tree, and commits ahead of and behind the upstream.
const CHANGED_GLYPH = '●'
const CHANGED_COLOR = '#ffb703'
const AHEAD_GLYPH = '↑'
const BEHIND_GLYPH = '↓'
const SYNC_COLOR = '#8ecae6'
const GIT_TIMEOUT_MS = 5_000

const basename = (path: string): string => path.replace(/\/+$/, '').split('/').pop() ?? path

async function git($: EngineInterface, cwd: string, args: readonly string[]): Promise<string | null> {
  try {
    const ran = await $.process.run(['git', ...args], { cwd, timeoutMs: GIT_TIMEOUT_MS })
    return ran.exitCode === 0 ? ran.stdout.trim() : null
  } catch {
    return null
  }
}

type Status = Pick<Where, 'branch' | 'changed' | 'upstream' | 'ahead' | 'behind'>

// `git status --porcelain=v2 --branch`: the `# branch.*` headers, then one line
// per changed path (`1`, `2` and `u` tracked, `?` untracked).
const parseStatus = (out: string): Status => {
  let head: string | null = null
  let oid: string | null = null
  let upstream: string | null = null
  let ahead: number | null = null
  let behind: number | null = null
  let changed = 0
  for (const line of out.split('\n')) {
    if (line.startsWith('# branch.head ')) head = line.slice('# branch.head '.length)
    else if (line.startsWith('# branch.oid ')) oid = line.slice('# branch.oid '.length)
    else if (line.startsWith('# branch.upstream ')) upstream = line.slice('# branch.upstream '.length)
    else if (line.startsWith('# branch.ab ')) {
      const ab = /^# branch\.ab \+(\d+) -(\d+)$/.exec(line)
      if (ab !== null) {
        ahead = Number(ab[1])
        behind = Number(ab[2])
      }
    } else if (/^[12u?] /.test(line)) changed += 1
  }
  const branch =
    head !== '(detached)' ? head : oid === null || oid === '(initial)' ? null : `detached @ ${oid.slice(0, 7)}`
  return { branch, changed, upstream, ahead, behind }
}

async function branchOf($: EngineInterface, root: string): Promise<string | null> {
  const branch = await git($, root, ['branch', '--show-current'])
  if (branch === null) return null
  if (branch !== '') return branch
  const head = await git($, root, ['rev-parse', '--short', 'HEAD'])
  return head === null || head === '' ? null : `detached @ ${head}`
}

// One status call reads the branch and the marks together. `--no-optional-locks`
// keeps it off the index lock, so it never fails a git command the model runs
// at the same moment. Where status fails (a repository too large for the
// timeout) the branch is still read, by the cheaper calls, and the marks left out.
async function statusOf($: EngineInterface, root: string): Promise<Status> {
  const out = await git($, root, ['--no-optional-locks', 'status', '--porcelain=v2', '--branch'])
  if (out !== null) return parseStatus(out)
  return { branch: await branchOf($, root), changed: null, upstream: null, ahead: null, behind: null }
}

// Git alone knows whether a directory is in a linked worktree: there its own git
// dir differs from the common one. The session's root differing from the
// repository's says nothing, since a session started in a subfolder of the main
// checkout has the same difference.
async function treeOf(
  $: EngineInterface,
  root: string,
  repoRoot: string,
): Promise<{ top: string; isWorktree: boolean }> {
  const out = await git($, root, ['rev-parse', '--path-format=absolute', '--show-toplevel', '--git-dir', '--git-common-dir'])
  const [top, gitDir, commonDir, ...rest] = out?.split('\n') ?? []
  if (top === undefined || gitDir === undefined || commonDir === undefined || rest.length > 0 || !top.startsWith('/')) {
    // A git too old for --path-format, or none: the session's root is the best guess.
    return { top: root, isWorktree: root !== repoRoot }
  }
  return { top, isWorktree: gitDir !== commonDir }
}

const NO_STATUS: Status = { branch: null, changed: null, upstream: null, ahead: null, behind: null }

// The session's root moves with /cd and with a worktree move; the repository's
// root stays the main working tree's.
async function locate($: EngineInterface): Promise<Where> {
  const root = await $.session.root()
  const repoRoot = (await $.session.repo())?.root ?? null
  if (repoRoot === null) {
    return { root, top: root, name: basename(root), repoRoot, repo: null, isWorktree: false, ...NO_STATUS }
  }
  const [{ top, isWorktree }, status] = await Promise.all([treeOf($, root, repoRoot), statusOf($, root)])
  return { root, top, name: basename(top), repoRoot, repo: basename(repoRoot), isWorktree, ...status }
}

// The main checkout goes by the repository's name alone. A worktree is named as
// one, since its name (`pr-42`, `brave-turing-3f9c21`) does not say so, and
// in which repository, which its name does not say either.
const placeOf = (w: Where): string => (w.isWorktree ? `worktree ${w.name} in ${w.repo ?? '?'}` : w.name)

// Never throws: a band that could not be read is left as it was.
async function readOnce($: EngineInterface): Promise<Where | null> {
  try {
    const was = await read($, where)
    const now = await locate($)
    await update($, where, () => now)
    if (was !== null && was.root !== now.root) $.ui.toast(`moved to ${placeOf(now)}`)
    return now
  } catch (error) {
    $.ui.log(`session-band: repo: ${String(error)}`, { to: 'debug' })
    return null
  }
}

// One read of git at a time. A refresh asked for while one runs makes that one
// go round once more when it ends, so a burst of tool calls costs two reads,
// the last of them after the burst, and every caller gets a result at least as
// new as its ask.
let inflight: Promise<Where | null> | null = null
let again = false

function refresh($: EngineInterface): Promise<Where | null> {
  if (inflight !== null) {
    again = true
    return inflight
  }
  const rounds = async (): Promise<Where | null> => {
    let now: Where | null = null
    do {
      again = false
      now = await readOnce($)
    } while (again)
    return now
  }
  inflight = rounds().finally(() => {
    inflight = null
  })
  return inflight
}

// A refresh off the hook's path, so nothing the person or the model does waits on git.
// The branch can also move under the session from another shell: a read per
// prompt keeps the band honest without a timer, and the prompt does not wait for it.
export function refreshSoon($: EngineInterface): void {
  $.clock.after(0, () => void refresh($))
}

// Before the session starts: the command, and a first read of git.
export async function startWhere($: EngineInterface): Promise<void> {
  await $.command.register({
    name: 'worktree',
    description: 'Show the worktree, branch, changes and path this session works in',
  })
  await refresh($)
}

// After a tool call: any call that may have written (an edit, `git switch`,
// `gh pr checkout`, an MCP tool) can move the branch or the changed files; a
// call the tool held read-only, or one refused, cannot.
export function afterToolWhere($: EngineInterface, ran: ToolCallResult): void {
  if (ran.deny === undefined && ran.isReadOnly !== true) refreshSoon($)
}

export const registerWhere: Register = on => {
  on('command.run', { command: 'worktree' }, async $ => {
    const w = await refresh($)
    if (w === null) return { text: 'session-band: could not read where this session works.' }
    const sync =
      w.ahead === null || w.behind === null
        ? ''
        : w.ahead === 0 && w.behind === 0
          ? ', in sync'
          : `, ${w.ahead} ahead, ${w.behind} behind`
    const lines = [
      w.repo === null ? `no repository: ${w.name}` : w.branch === null ? placeOf(w) : `${placeOf(w)} on ${w.branch}`,
      `path: ${w.root}`,
      ...(w.isWorktree && w.repoRoot !== null ? [`main checkout: ${w.repoRoot}`] : []),
      ...(w.changed === null ? [] : [`changes: ${w.changed === 0 ? 'none' : `${w.changed} changed files`}`]),
      ...(w.upstream === null ? [] : [`upstream: ${w.upstream}${sync}`]),
    ]
    return { text: lines.join('\n') }
  })

  // The moves themselves are awaited, so the band and its toast are right when
  // the move's own result shows.
  on('classic.CwdChanged', async ($, e, next) => {
    await refresh($)
    return next(e)
  })

  on('tool.call', { tool: 'EnterWorktree' }, async ($, e, next) => {
    const ran = await next(e)
    await refresh($)
    return ran
  })

  on('tool.call', { tool: 'ExitWorktree' }, async ($, e, next) => {
    const ran = await next(e)
    await refresh($)
    return ran
  })
}

// Outside a repository the row has nothing to say, so it is not drawn: /worktree
// still names the folder.
export async function whereRow($: EngineInterface): Promise<Row | null> {
  const w = await read($, where)
  if (w === null || w.repo === null) return null
  const changed = w.changed ?? 0
  const ahead = w.ahead ?? 0
  const behind = w.behind ?? 0
  const meta: Segment[] = [
    ...(w.branch === null ? [] : [{ text: 'on' }, { text: w.branch, color: BRANCH_COLOR }]),
    // The branch gives way to a narrow band; the marks keep their cells.
    ...(changed > 0 ? [{ text: `${CHANGED_GLYPH}${changed}`, color: CHANGED_COLOR, isFixed: true }] : []),
    ...(ahead > 0 ? [{ text: `${AHEAD_GLYPH}${ahead}`, color: SYNC_COLOR, isFixed: true }] : []),
    ...(behind > 0 ? [{ text: `${BEHIND_GLYPH}${behind}`, color: SYNC_COLOR, isFixed: true }] : []),
    ...(w.isWorktree ? [{ text: '· worktree' }, { text: w.name, color: WORKTREE_COLOR }] : []),
  ]
  return {
    id: 'repo',
    glyph: { text: BRANCH_GLYPH, color: GLYPH_COLOR },
    label: 'repo',
    value: [{ text: w.repo, color: REPOSITORY_COLOR, bold: true }],
    meta,
  }
}
