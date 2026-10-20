import { expect, test } from 'claude-code/testing'

import { BAND, MINUTE, PLUGIN, answered, bandTexts, engine, fiveHour, nodeOf, rowIds, rowTexts } from './engine'

const COMPOSER = { kind: 'composer' } as const

test('draws every row in one order, task, repo, usage, replay, on both band surfaces', async ($, on) => {
  const w = engine(on, { root: '/acme', repoRoot: '/acme', branch: 'main', sha: 'abc1234', rateLimits: [fiveHour(42, 133 * MINUTE)] })
  w.replies.push([/rename/, answered('Rename greet to welcome')])
  await $.session.start({ cwd: w.root, surface: 'terminal', isInteractive: true })
  await $.prompt.submit({ text: 'rename greet to welcome', wait: false, origin: COMPOSER })
  await w.clock.settle()
  await $.turn.start({ text: 'rename', turnId: 't1' })
  await $.tool.call({ tool: 'Edit', file_path: '/acme/a.js', old_string: 'greet', new_string: 'welcome' })
  await $.turn.complete({ turnId: 't1', answer: '', durationMs: 1, isAborted: false, reason: 'answer' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...BAND })
    const drawn = await ui.drawn()
    expect(rowIds(drawn)).toEqual(['task', 'repo', 'usage', 'replay'])
    expect(drawn).toMatchObject({ type: 'Box', props: { flexDirection: 'column' } })
    // Every row has its label in the same slot, the second, padded to one width.
    for (const [id, label] of [['task', 'task'], ['repo', 'repo'], ['usage', 'usage'], ['replay', 'replay']] as const) {
      expect((await rowTexts(ui, id))[1]).toBe(label)
      expect(nodeOf(drawn, id)).toMatchObject({ type: 'Box', props: { paddingLeft: 2, gap: 1 } })
    }
    await ui.unmount()
  }
})

test('rows other plugins draw go below the band, whole', async ($, on) => {
  // Another plugin's row, when the chain runs it beneath this one.
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box key="other">
        <Text>another mod</Text>
      </Box>
    )
  })
  const w = engine(on, { root: '/acme', repoRoot: '/acme', branch: 'main', sha: 'abc1234', rateLimits: [fiveHour(42, 133 * MINUTE)] })
  await $.session.start({ cwd: w.root, surface: 'terminal', isInteractive: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...BAND })
    const drawn = await ui.drawn()
    expect(rowIds(drawn)).toEqual(['repo', 'usage'])
    expect((await bandTexts(ui)).at(-1)).toBe('another mod')
    expect(drawn).toMatchObject({ type: 'Box', props: { flexDirection: 'column' } })
    await ui.unmount()
  }
})

test('one row that fails to build leaves the others drawn, and the session started', async ($, on) => {
  // Usage readings fail: the usage row is left out, nothing else is.
  const w = engine(on, {
    root: '/acme',
    repoRoot: '/acme',
    branch: 'main',
    sha: 'abc1234',
    refused: { 'session.usage': 'usage is not available' },
  })
  await $.session.start({ cwd: w.root, surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  expect(rowIds(await ui.drawn())).toEqual(['repo'])
  await ui.unmount()
})

test('a mod that fails as the session starts leaves the other mods started', async ($, on) => {
  // The commands cannot be registered, so the repo and replay starts fail: the
  // usage row still starts after them, and replay still records.
  const w = engine(on, { rateLimits: [fiveHour(42, 133 * MINUTE)], refused: { 'command.register': 'no commands here' } })
  await $.session.start({ cwd: w.root, surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'rename', turnId: 't1' })
  await $.tool.call({ tool: 'Edit', file_path: '/tmp/scratch/a.js', old_string: 'greet', new_string: 'welcome' })
  await $.turn.complete({ turnId: 't1', answer: '', durationMs: 1, isAborted: false, reason: 'answer' })

  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  expect(rowIds(await ui.drawn())).toEqual(['usage', 'replay'])
  await ui.unmount()
})

test('yields the band to a survey', async ($, on) => {
  // The engine's own band, which the plugin hands the draw on to while a survey holds it.
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>survey</Text>
  })
  const w = engine(on, { root: '/acme', repoRoot: '/acme', branch: 'main', sha: 'abc1234', rateLimits: [fiveHour(42, 133 * MINUTE)] })
  await $.session.start({ cwd: w.root, surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND, props: { ...BAND.props, hasSurvey: true } })
  expect(await bandTexts(ui)).toEqual(['survey'])
  await ui.unmount()
})

test('a session with nothing to say draws no band of its own', async ($, on) => {
  const w = engine(on)
  await $.session.start({ cwd: w.root, surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  expect(await bandTexts(ui)).toEqual([])
  await ui.unmount()
})
