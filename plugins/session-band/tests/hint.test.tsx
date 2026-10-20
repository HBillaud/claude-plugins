import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { PromptOrigin } from 'claude-code'

import { BAND, MINUTE, PLUGIN, answered, bandTexts, engine, fiveHour, nodeOf, rowTexts, textIn as textNode, unanswered } from './engine'
import type { World } from './engine'

// The task row.

const HINT_GLYPH = String.fromCharCode(0xf075)
const GLYPH_COLOR = '#fb8500'
const COMPOSER: PromptOrigin = { kind: 'composer' }

test('draws the summary of the last message, bold, after the orange glyph and its label, on both band surfaces', async ($, on) => {
  const w = engine(on)
  w.replies.push([/split vertically/, answered('Add a task hint above the status band')])
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

  await $.prompt.submit({ text: 'I keep Ghostty split vertically, add a hint above the worktree band', wait: false, origin: COMPOSER })
  await w.clock.settle()

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...BAND })
    expect(await rowTexts(ui, 'task')).toEqual([HINT_GLYPH, 'task', 'Add a task hint above the status band'])
    const row = nodeOf(await ui.drawn(), 'task')
    expect(row).toMatchObject({ type: 'Box', props: { paddingLeft: 2 } })
    expect(textNode(row, HINT_GLYPH)?.props?.['color']).toBe(GLYPH_COLOR)
    expect(textNode(row, 'task')?.props?.['dimColor']).toBe(true)
    expect(textNode(row, 'Add a task hint above the status band')?.props?.['bold']).toBe(true)
    await ui.unmount()
  }
})

test("shows the message's first line, dim, until the summary lands", async ($, on) => {
  const w = engine(on)
  w.replies.push([/flaky/, answered('Fix flaky replay test'), 1_000])
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

  await $.prompt.submit({ text: '\nthe replay test is flaky again\nhere is the log: ...', wait: false, origin: COMPOSER })
  await w.clock.settle()

  const pending = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  expect(await rowTexts(pending, 'task')).toEqual([HINT_GLYPH, 'task', 'the replay test is flaky again'])
  expect(textNode(nodeOf(await pending.drawn(), 'task'), 'the replay test is flaky again')?.props?.['dimColor']).toBe(true)
  await pending.unmount()

  await w.clock.advance(1_000)
  const landed = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  expect(await rowTexts(landed, 'task')).toEqual([HINT_GLYPH, 'task', 'Fix flaky replay test'])
  await landed.unmount()
})

test('hands the current label to the model with a follow-up, so a confirmation keeps it', async ($, on) => {
  const w = engine(on)
  w.replies.push([/gateway/, answered('Add retries to gateway uploads')], [/go ahead/, answered('Add retries to gateway uploads')])
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

  await $.prompt.submit({ text: 'add retries to the gateway uploads', wait: false, origin: COMPOSER })
  await w.clock.settle()
  await $.prompt.submit({ text: 'yes, go ahead', wait: false, origin: COMPOSER })
  await w.clock.settle()

  expect(w.asked[0]).toContain('Current label: (none)')
  expect(w.asked[1]).toContain('Current label: Add retries to gateway uploads')
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  expect(await rowTexts(ui, 'task')).toEqual([HINT_GLYPH, 'task', 'Add retries to gateway uploads'])
  await ui.unmount()
})

test('drops a summary that lands after a newer one', async ($, on) => {
  const w = engine(on)
  w.replies.push([/first task/, answered('Do the first task'), 5_000], [/second task/, answered('Do the second task'), 100])
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

  await $.prompt.submit({ text: 'the first task', wait: false, origin: COMPOSER })
  await w.clock.settle()
  await $.prompt.submit({ text: 'no, the second task', wait: false, origin: COMPOSER })
  await w.clock.advance(5_000)

  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  expect(await rowTexts(ui, 'task')).toEqual([HINT_GLYPH, 'task', 'Do the second task'])
  await ui.unmount()
})

test('sums up a skill command with arguments, and leaves built-ins, bare commands and prompts nobody typed alone', async ($, on) => {
  const w = engine(on)
  w.replies.push([/flaky test/, answered('Draft spec for flaky test')])
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

  await $.prompt.submit({ text: '/model opus', command: { name: 'model', args: 'opus' }, wait: false, origin: COMPOSER })
  await $.prompt.submit({ text: '/clear', command: { name: 'clear', args: '' }, wait: false, origin: COMPOSER })
  await $.prompt.submit({ text: 'a background task finished', wait: false, origin: { kind: 'task-notification' } })
  await $.prompt.submit({ text: 'a peer says hello', wait: false, origin: { kind: 'peer' } })
  await w.clock.settle()
  expect(w.asked).toEqual([])
  const none = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  expect(await bandTexts(none)).toEqual([])
  await none.unmount()

  await $.prompt.submit({ text: '/draft-spec fix the flaky test', command: { name: 'draft-spec', args: 'fix the flaky test' }, wait: false, origin: COMPOSER })
  await w.clock.settle()
  expect(w.asked).toHaveLength(1)
  expect(w.asked[0]).toContain('/draft-spec fix the flaky test')
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  expect(await rowTexts(ui, 'task')).toEqual([HINT_GLYPH, 'task', 'Draft spec for flaky test'])
  await ui.unmount()
})

test("seeds a session first seen mid-conversation from the person's last prompts only", async ($, on) => {
  const w = engine(on, {
    transcript: [
      { role: 'user', text: 'an old prompt', toolUses: [] },
      { role: 'user', text: '<context>\nfour panes, many agents\n</context>\nadd a hint above the band', toolUses: [] },
      { role: 'user', text: 'Base directory for this skill: /skills/plugin-authoring', toolUses: [] },
      { role: 'assistant', text: 'On it.', toolUses: [] },
      { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 't1', text: 'ok', isError: false, result: {} }] },
      { role: 'user', text: '<command-name>/model</command-name>\n<command-args>opus</command-args>', toolUses: [] },
      { role: 'user', text: '<local-command-stdout>Set model to opus</local-command-stdout>', toolUses: [] },
      { role: 'user', text: '<command-name>/draft-spec</command-name>\n<command-args>tidy the band</command-args>', toolUses: [] },
      { role: 'user', text: 'yes please<system-reminder>a reminder</system-reminder>', toolUses: [] },
    ],
  })
  w.replies.push([/yes please/, answered('Add hint above the worktree band')])
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await w.clock.settle()

  expect(w.asked).toHaveLength(1)
  const messages = w.asked[0]?.split('<message>\n').slice(1).map(m => m.replace(/\n<\/message>[\s\S]*$/, ''))
  expect(messages).toEqual(['<context>\nfour panes, many agents\n</context>\nadd a hint above the band', '/draft-spec tidy the band', 'yes please'])
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  expect(await rowTexts(ui, 'task')).toEqual([HINT_GLYPH, 'task', 'Add hint above the worktree band'])
  await ui.unmount()
})

test('/clear empties the task row, and a summary in flight does not bring it back', async ($, on) => {
  const w = engine(on)
  w.replies.push([/old work/, answered('Do the old work')], [/more of it/, answered('Do more old work'), 1_000])
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.prompt.submit({ text: 'the old work', wait: false, origin: COMPOSER })
  await w.clock.settle()
  await $.prompt.submit({ text: 'more of it', wait: false, origin: COMPOSER })
  await w.clock.settle()

  await $.classic.SessionStart({ source: 'clear' })
  await w.clock.advance(1_000)

  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  expect(await bandTexts(ui)).toEqual([])
  await ui.unmount()
})

test('keeps the first line up when the model gives no label', async ($, on) => {
  const w = engine(on)
  w.replies.push([/rate/, unanswered])
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.prompt.submit({ text: 'check the rate limiter', wait: false, origin: COMPOSER })
  await w.clock.settle()

  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  expect(await rowTexts(ui, 'task')).toEqual([HINT_GLYPH, 'task', 'check the rate limiter'])
  await ui.unmount()
})

// The bubble is a Nerd Font symbol: where nothing would draw it, a diamond stands in.

const DIAMOND_GLYPH = '◆'
const DIAL_GLYPH = '◔'
const named = async ($: Engine, w: World): Promise<void> => {
  w.replies.push([/docs/, answered('Update the docs')])
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.prompt.submit({ text: 'update the docs', wait: false, origin: COMPOSER })
  await w.clock.settle()
}

test('stands a diamond in for the bubble where no font or terminal would draw it, in the same color', async ($, on) => {
  const w = engine(on, { fontconfig: ['.LastResort'] })
  await named($, w)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...BAND })
    expect(await rowTexts(ui, 'task')).toEqual([DIAMOND_GLYPH, 'task', 'Update the docs'])
    expect(textNode(nodeOf(await ui.drawn(), 'task'), DIAMOND_GLYPH)?.props?.['color']).toBe(GLYPH_COLOR)
    await ui.unmount()
  }
})

test('draws the bubble in a terminal that ships the symbols, and the diamond on the desktop', async ($, on) => {
  const w = engine(on, { env: { TERM_PROGRAM: 'ghostty' }, fontconfig: ['.LastResort'] })
  await named($, w)

  for (const [surface, glyph] of [['terminal', HINT_GLYPH], ['desktop', DIAMOND_GLYPH]] as const) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...BAND })
    expect((await rowTexts(ui, 'task'))[0]).toBe(glyph)
    await ui.unmount()
  }
})

test('draws the bubble from a font installed on the machine on all its surfaces, and the diamond on a phone', async ($, on) => {
  const w = engine(on)
  await named($, w)

  for (const [surface, glyph] of [['terminal', HINT_GLYPH], ['desktop', HINT_GLYPH], ['mobile', DIAMOND_GLYPH]] as const) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...BAND })
    expect((await rowTexts(ui, 'task'))[0]).toBe(glyph)
    await ui.unmount()
  }
})

test('asks after each symbol on its own: a font with the bubble and no speedometer draws one and not the other', async ($, on) => {
  // A Nerd Font v2: Font Awesome's range, without Material Design's new one.
  const w = engine(on, { rateLimits: [fiveHour(42, 133 * MINUTE)], fontconfigFor: { f04c5: ['.LastResort'] } })
  await named($, w)

  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  expect((await rowTexts(ui, 'task'))[0]).toBe(HINT_GLYPH)
  expect((await rowTexts(ui, 'usage'))[0]).toBe(DIAL_GLYPH)
  await ui.unmount()
})

test('reads the font folders for the bubble where fontconfig is not installed', async ($, on) => {
  const w = engine(on, {
    env: { HOME: '/Users/someone' },
    fontconfig: null,
    folders: { '/Users/someone/Library/Fonts': ['MesloLGS NF Regular.ttf'] },
  })
  await named($, w)

  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  expect((await rowTexts(ui, 'task'))[0]).toBe(HINT_GLYPH)
  await ui.unmount()
})

test('counts no symbol font that only happens to map the range: Wingdings is not a bubble', async ($, on) => {
  // What fontconfig answers for U+F075 on a Mac with no Nerd Font installed.
  const w = engine(on, {
    fontconfig: ['.LastResort'],
    fontconfigFor: { f075: ['Wingdings 3', 'Wingdings 2', 'Webdings', 'Wingdings', '.LastResort', 'Hoefler Text,Hoefler Text Ornaments'] },
  })
  await named($, w)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...BAND })
    expect((await rowTexts(ui, 'task'))[0]).toBe(DIAMOND_GLYPH)
    await ui.unmount()
  }
})

for (const family of ['Symbols Nerd Font Mono', 'JetBrainsMono NFM', 'MesloLGS NF', 'Hack Nerd Font']) {
  test(`counts a Nerd Font by its family's name: ${family}`, async ($, on) => {
    const w = engine(on, { fontconfig: ['.LastResort'], fontconfigFor: { f075: ['Wingdings', family] } })
    await named($, w)

    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...BAND })
    expect((await rowTexts(ui, 'task'))[0]).toBe(HINT_GLYPH)
    await ui.unmount()
  })
}

// Without the model (`taskLabel: local`) the label is read from the message itself.

const LOCAL = { options: { taskLabel: 'local' } } as const

test('local: labels a message from its first sentence, with no model call, on both band surfaces', LOCAL, async ($, on) => {
  const w = engine(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.prompt.submit({ text: 'Hey, can you please add retries to the gateway uploads? They time out on slow networks.', wait: false, origin: COMPOSER })
  await w.clock.settle()

  expect(w.asked).toEqual([])
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...BAND })
    expect(await rowTexts(ui, 'task')).toEqual([HINT_GLYPH, 'task', 'Add retries to the gateway uploads'])
    expect(textNode(nodeOf(await ui.drawn(), 'task'), 'Add retries to the gateway uploads')?.props?.['bold']).toBe(true)
    await ui.unmount()
  }
})

test('local: a confirmation keeps the label, and one that carries a new request replaces it', LOCAL, async ($, on) => {
  const w = engine(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.prompt.submit({ text: "let's rename greet to welcome", wait: false, origin: COMPOSER })
  await w.clock.settle()

  for (const nudge of ['yes, go ahead', 'the second option', 'ok do it please']) {
    await $.prompt.submit({ text: nudge, wait: false, origin: COMPOSER })
    await w.clock.settle()
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
    expect((await rowTexts(ui, 'task'))[2]).toBe('Rename greet to welcome')
    await ui.unmount()
  }

  await $.prompt.submit({ text: 'yes, and then update the changelog for the release', wait: false, origin: COMPOSER })
  await w.clock.settle()
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  expect((await rowTexts(ui, 'task'))[2]).toBe('Update the changelog for the release')
  await ui.unmount()
  expect(w.asked).toEqual([])
})

test('local: cuts a long request at a word, and keeps a command as typed', LOCAL, async ($, on) => {
  const w = engine(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.prompt.submit({ text: 'I would like you to migrate every remaining class component in the settings area to hooks', wait: false, origin: COMPOSER })
  await w.clock.settle()
  const long = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  const label = (await rowTexts(long, 'task'))[2] ?? ''
  expect(label).toBe('Migrate every remaining class component in the settings…')
  expect(label.length).toBeLessThanOrEqual(60)
  await long.unmount()

  await $.prompt.submit({ text: '/draft-spec fix the flaky test', command: { name: 'draft-spec', args: 'fix the flaky test' }, wait: false, origin: COMPOSER })
  await w.clock.settle()
  const command = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  expect((await rowTexts(command, 'task'))[2]).toBe('/draft-spec fix the flaky test')
  await command.unmount()
})

test('local: seeds a session first seen mid-conversation from its last prompts', LOCAL, async ($, on) => {
  const w = engine(on, {
    transcript: [
      { role: 'user', text: '<context>\nfour panes, many agents\n</context>\nadd a hint above the band', toolUses: [] },
      { role: 'user', text: 'yes please', toolUses: [] },
    ],
  })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await w.clock.settle()

  expect(w.asked).toEqual([])
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  expect(await rowTexts(ui, 'task')).toEqual([HINT_GLYPH, 'task', 'Add a hint above the band'])
  await ui.unmount()
})

test('off: draws no task row and never calls the model', { options: { taskLabel: 'off' } }, async ($, on) => {
  const w = engine(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.prompt.submit({ text: 'add retries to the gateway uploads', wait: false, origin: COMPOSER })
  await w.clock.settle()

  expect(w.asked).toEqual([])
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  expect(await bandTexts(ui)).toEqual([])
  await ui.unmount()
})
