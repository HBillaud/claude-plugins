import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { BAND, PLUGIN, bandTexts, engine, nodeOf, rowIds, rowTexts } from './engine'

// The replay row and pane.

const PANE = {
  component: 'Pane',
  requestId: 'session-band-replay',
  props: { title: 'Replay', isFocused: true, bodyColumns: 80, placement: 'inline', scroll: { offset: 0, bodyRows: 20 }, view: {} },
} as const

const turnOf = async ($: Engine, edits: Array<[string, string, string]>): Promise<void> => {
  await $.turn.start({ text: 'rename', turnId: 't1' })
  for (const [file, from, to] of edits) await $.tool.call({ tool: 'Edit', file_path: file, old_string: from, new_string: to })
  await $.turn.complete({ turnId: 't1', answer: '', durationMs: 1, isAborted: false, reason: 'answer' })
}

test('after a turn that edits, the replay row counts the edits and offers its key', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await turnOf($, [['/repo/a.js', 'greet', 'welcome']])

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...BAND })
    expect(await rowTexts(ui, 'replay')).toEqual(['▶', 'replay', '1 edit'])
    const button = (nodeOf(await ui.drawn(), 'replay-action') ?? {}) as { type?: unknown; props?: Record<string, unknown> }
    expect(button.type).toBe('Button')
    expect(button.props).toMatchObject({ hotkey: 'r', label: 'replay', plain: true })
    await ui.unmount()
  }
})

test('a turn with no edits keeps the last replay, and a session with none draws no row', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

  const none = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  expect(await bandTexts(none)).toEqual([])
  await none.unmount()

  await turnOf($, [['/repo/a.js', 'greet', 'welcome'], ['/repo/b.js', 'one', 'two']])
  await turnOf($, [])
  const kept = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  expect(await rowTexts(kept, 'replay')).toEqual(['▶', 'replay', '2 edits'])
  await kept.unmount()
})

test('steps forward on ↑ and back on ↓ in the diff region', async ($, on) => {
  engine(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.message', () => ({}))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await turnOf($, [['/repo/a.js', 'greet', 'welcome'], ['/repo/b.js', 'one', 'two']])

  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  expect(await bandTexts(ui)).toContain('step 1 of 2')
  await ui.key({ key: 'up', in: 'diff' })
  expect(await bandTexts(ui)).toContain('step 2 of 2')
  await ui.key({ key: 'up', in: 'diff' })
  expect(await bandTexts(ui)).toContain('step 2 of 2')
  await ui.key({ key: 'down', in: 'diff' })
  expect(await bandTexts(ui)).toContain('step 1 of 2')
  await ui.unmount()
})

test('/replay opens the pane and hides the row while it is open', async ($, on) => {
  const w = engine(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.focus', () => ({}))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await turnOf($, [['/repo/a.js', 'greet', 'welcome']])

  const opened = $.command.run({ command: 'replay', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
  await w.clock.advance(200)
  expect(await opened).toMatchObject({ text: 'Replay: 1 edit' })

  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  expect(rowIds(await ui.drawn())).not.toContain('replay')
  await ui.unmount()
})

test('recording never stops an edit, even one whose file cannot be read', async ($, on) => {
  engine(on)
  on('fs.exists', () => ({ deny: 'EACCES' }))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'write', turnId: 't1' })
  expect(await $.tool.call({ tool: 'Write', file_path: '/repo/locked.txt', content: 'hello' })).toMatchObject({ result: 'ran' })
  await $.turn.complete({ turnId: 't1', answer: '', durationMs: 1, isAborted: false, reason: 'answer' })

  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  expect(await rowTexts(ui, 'replay')).toEqual(['▶', 'replay', '1 edit'])
  await ui.unmount()
})
