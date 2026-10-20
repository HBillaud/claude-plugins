import { expect, test } from 'claude-code/testing'

import { BAND, PLUGIN, STATUS, engine, nodeOf, rowIds, rowTexts, textIn } from './engine'
import type { Given } from './engine'

// The repo row.

const WORKTREE_COLOR = '#f5f5dc'
const REPOSITORY_COLOR = '#d4834a'
const BRANCH_COLOR = '#55e07e'
const BRANCH_GLYPH = '⎇'
const GLYPH_COLOR = '#fb8500'
const CHANGED_COLOR = '#ffb703'
const SYNC_COLOR = '#8ecae6'

const start = (given: Given): Given => ({ repoRoot: '/acme', sha: 'abc1234', ...given })

test('names a worktree by its repository and branch, with the worktree in the meta, on both band surfaces', async ($, on) => {
  const w = engine(on, start({ root: '/acme/.claude/worktrees/pr-42', branch: 'fix/login-timeout' }))
  await $.session.start({ cwd: w.root, surface: 'terminal', isInteractive: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...BAND })
    expect(await rowTexts(ui, 'repo')).toEqual([BRANCH_GLYPH, 'repo', 'acme', 'on', 'fix/login-timeout', '· worktree', 'pr-42'])
    const row = nodeOf(await ui.drawn(), 'repo')
    expect(row).toMatchObject({ type: 'Box', props: { paddingLeft: 2 } })
    expect(textIn(row, BRANCH_GLYPH)?.props?.['color']).toBe(GLYPH_COLOR)
    expect(textIn(row, 'acme')?.props).toMatchObject({ bold: true, color: REPOSITORY_COLOR })
    expect(textIn(row, 'fix/login-timeout')?.props?.['color']).toBe(BRANCH_COLOR)
    expect(textIn(row, 'pr-42')?.props?.['color']).toBe(WORKTREE_COLOR)
    expect(textIn(row, '· worktree')?.props?.['dimColor']).toBe(true)
    await ui.unmount()
  }
})

test('names the main checkout by its repository and branch alone', async ($, on) => {
  const w = engine(on, start({ root: '/acme', branch: 'main' }))
  await $.session.start({ cwd: w.root, surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  expect(await rowTexts(ui, 'repo')).toEqual([BRANCH_GLYPH, 'repo', 'acme', 'on', 'main'])
  await ui.unmount()
})

test('a session started in a subfolder of the main checkout is the main checkout, not a worktree', async ($, on) => {
  const w = engine(on, start({ root: '/acme/packages/app', top: '/acme', branch: 'main' }))
  await $.session.start({ cwd: w.root, surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  expect(await rowTexts(ui, 'repo')).toEqual([BRANCH_GLYPH, 'repo', 'acme', 'on', 'main'])
  await ui.unmount()
})

test('a session started in a subfolder of a worktree is named by the worktree', async ($, on) => {
  const top = '/acme/.claude/worktrees/pr-42'
  const w = engine(on, start({ root: `${top}/src`, top, branch: 'fix/login-timeout' }))
  await $.session.start({ cwd: w.root, surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  expect(await rowTexts(ui, 'repo')).toEqual([BRANCH_GLYPH, 'repo', 'acme', 'on', 'fix/login-timeout', '· worktree', 'pr-42'])
  await ui.unmount()
})

test('marks changed files and commits ahead and behind, each in its color', async ($, on) => {
  const w = engine(on, start({ root: '/acme', branch: 'main', changed: 3, upstream: 'origin/main', ahead: 2, behind: 1 }))
  await $.session.start({ cwd: w.root, surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  expect(await rowTexts(ui, 'repo')).toEqual([BRANCH_GLYPH, 'repo', 'acme', 'on', 'main', '●3', '↑2', '↓1'])
  const row = nodeOf(await ui.drawn(), 'repo')
  expect(textIn(row, '●3')?.props?.['color']).toBe(CHANGED_COLOR)
  expect(textIn(row, '↑2')?.props?.['color']).toBe(SYNC_COLOR)
  expect(textIn(row, '↓1')?.props?.['color']).toBe(SYNC_COLOR)
  await ui.unmount()
})

test('draws no mark that is zero: a clean tree in sync shows none', async ($, on) => {
  const w = engine(on, start({ root: '/acme', branch: 'main', upstream: 'origin/main', behind: 4 }))
  await $.session.start({ cwd: w.root, surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  expect(await rowTexts(ui, 'repo')).toEqual([BRANCH_GLYPH, 'repo', 'acme', 'on', 'main', '↓4'])
  await ui.unmount()
})

test('reads status without the index lock, so it never fails the model’s own git', async ($, on) => {
  const w = engine(on, start({ root: '/acme', branch: 'main' }))
  await $.session.start({ cwd: w.root, surface: 'terminal', isInteractive: true })

  expect(w.gitCalls).toContain(STATUS)
  expect(w.gitCalls.filter(c => c.includes(' status')).every(c => c.includes('--no-optional-locks'))).toBe(true)
})

test('where status fails it still names the branch, with no marks', async ($, on) => {
  const w = engine(on, start({ root: '/acme', branch: 'main', changed: 5, isStatusFailing: true }))
  await $.session.start({ cwd: w.root, surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  expect(await rowTexts(ui, 'repo')).toEqual([BRANCH_GLYPH, 'repo', 'acme', 'on', 'main'])
  await ui.unmount()
})

test('spells a detached HEAD by its short sha', async ($, on) => {
  const w = engine(on, start({ root: '/acme/.claude/worktrees/bisect', branch: null, sha: 'deadbee' }))
  await $.session.start({ cwd: w.root, surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  expect(await rowTexts(ui, 'repo')).toContain('detached @ deadbee')
  await ui.unmount()
})

test('outside a repository it draws no row and never runs git, and /worktree still names the folder', async ($, on) => {
  const w = engine(on, { root: '/tmp/scratch' })
  await $.session.start({ cwd: w.root, surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  expect(rowIds(await ui.drawn())).not.toContain('repo')
  expect(w.gitCalls).toEqual([])
  await ui.unmount()

  expect(
    await $.command.run({ command: 'worktree', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } }),
  ).toMatchObject({ text: 'no repository: scratch\npath: /tmp/scratch' })
})

test('follows the session when its directory moves to another worktree', async ($, on) => {
  const w = engine(on, start({ root: '/acme/.claude/worktrees/a', branch: 'feature/a', sha: 'a' }))
  await $.session.start({ cwd: w.root, surface: 'terminal', isInteractive: true })

  const before = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  expect(await rowTexts(before, 'repo')).toContain('feature/a')
  await before.unmount()

  const from = w.root
  w.root = '/acme/.claude/worktrees/b'
  w.top = w.root
  w.branch = 'feature/b'
  await $.classic.CwdChanged({ old_cwd: from, new_cwd: w.root })

  const after = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  const shown = await rowTexts(after, 'repo')
  expect(shown).toContain('b')
  expect(shown).toContain('feature/b')
  expect(shown).not.toContain('feature/a')
  await after.unmount()
})

test('follows a branch any writing command moves, gh pr checkout included', async ($, on) => {
  const w = engine(on, start({ root: '/acme', branch: 'main' }))
  await $.session.start({ cwd: w.root, surface: 'terminal', isInteractive: true })

  w.branch = 'pr-42'
  w.changed = 1
  await $.tool.call({ tool: 'Bash', command: 'gh pr checkout 42' })
  await w.clock.settle()

  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  expect(await rowTexts(ui, 'repo')).toEqual([BRANCH_GLYPH, 'repo', 'acme', 'on', 'pr-42', '●1'])
  await ui.unmount()
})

test('a call the tool held read-only reads no git', async ($, on) => {
  const w = engine(on, start({ root: '/acme', branch: 'main', isToolReadOnly: true }))
  await $.session.start({ cwd: w.root, surface: 'terminal', isInteractive: true })

  const calls = w.gitCalls.length
  await $.tool.call({ tool: 'Read', file_path: '/acme/README.md' })
  await w.clock.settle()
  expect(w.gitCalls.length).toBe(calls)
})

test('a prompt goes in without waiting for git, and the row catches up after', async ($, on) => {
  const w = engine(on, start({ root: '/acme', branch: 'main' }))
  await $.session.start({ cwd: w.root, surface: 'terminal', isInteractive: true })

  // Git now answers only once the clock moves a second: a prompt that waited
  // for it would hold until the test's own time ran out.
  w.gitDelayMs = 1_000
  w.branch = 'moved-in-another-shell'
  expect(await $.prompt.submit({ text: 'hello', wait: false, origin: { kind: 'composer' } })).toMatchObject({ text: 'hello' })

  await w.clock.settle()
  await w.clock.advance(1_000)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  expect(await rowTexts(ui, 'repo')).toContain('moved-in-another-shell')
  await ui.unmount()
})

test('/worktree spells out the place, the paths, the changes and the upstream', async ($, on) => {
  const w = engine(
    on,
    start({ root: '/acme/.claude/worktrees/pr-42', branch: 'fix/login-timeout', changed: 2, upstream: 'origin/fix/login-timeout', ahead: 1 }),
  )
  await $.session.start({ cwd: w.root, surface: 'terminal', isInteractive: true })

  expect(
    await $.command.run({ command: 'worktree', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } }),
  ).toMatchObject({
    text: [
      'worktree pr-42 in acme on fix/login-timeout',
      'path: /acme/.claude/worktrees/pr-42',
      'main checkout: /acme',
      'changes: 2 changed files',
      'upstream: origin/fix/login-timeout, 1 ahead, 0 behind',
    ].join('\n'),
  })
})
