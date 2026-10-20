import { expect, test } from 'claude-code/testing'

import { BAND, MINUTE, NOW, PLUGIN, engine, fiveHour, nodeOf, rowIds, rowTexts, textIn } from './engine'

// The usage row.

const FILL_COLOR = '#92eeff'
const LIT = '■'
const UNLIT = '□'
const SPEEDOMETER_GLYPH = String.fromCodePoint(0xf04c5)
const DIAL_GLYPH = '◔'
const GLYPH_COLOR = '#fb8500'
const CONTEXT = { window: 200_000 }

test('draws the session window as a bar, its percentage and the time to its reset, on both band surfaces', async ($, on) => {
  engine(on, { rateLimits: [{ kind: 'seven_day', percentUsed: 80 }, fiveHour(42.4, 133 * MINUTE)] })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...BAND })
    expect(await rowTexts(ui, 'usage')).toEqual([SPEEDOMETER_GLYPH, 'usage', LIT.repeat(4), UNLIT.repeat(6), '42%', 'resets in 2h 13m'])
    const row = nodeOf(await ui.drawn(), 'usage')
    expect(row).toMatchObject({ type: 'Box', props: { paddingLeft: 2 } })
    expect(textIn(row, LIT.repeat(4))?.props?.['color']).toBe(FILL_COLOR)
    expect(textIn(row, UNLIT.repeat(6))?.props?.['dimColor']).toBe(true)
    expect(textIn(row, '42%')?.props).toMatchObject({ color: FILL_COLOR, bold: true })
    expect(textIn(row, 'resets in 2h 13m')?.props?.['dimColor']).toBe(true)
    await ui.unmount()
  }
})

test('redraws when the engine measures the window moving', async ($, on) => {
  const w = engine(on, { rateLimits: [fiveHour(42, 133 * MINUTE)] })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  expect(await rowTexts(ui, 'usage')).toContain('42%')

  w.rateLimits = [fiveHour(75, 133 * MINUTE)]
  await $.session.measure({ context: CONTEXT, rateLimits: w.rateLimits, changed: ['rateLimits'] })
  const shown = await rowTexts(ui, 'usage')
  expect(shown).toContain('75%')
  expect(shown).toContain(LIT.repeat(8))
  await ui.unmount()
})

test('counts the reset down by the minute, and empties the bar once the window has closed', async ($, on) => {
  const w = engine(on, { rateLimits: [fiveHour(42, 133 * MINUTE)] })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  await w.clock.advance(MINUTE)
  expect(await rowTexts(ui, 'usage')).toContain('resets in 2h 12m')

  await w.clock.advance(132 * MINUTE)
  expect(await rowTexts(ui, 'usage')).toEqual([SPEEDOMETER_GLYPH, 'usage', UNLIT.repeat(10), '0%'])
  await ui.unmount()
})

test('draws no row without a reading of the five-hour window', async ($, on) => {
  engine(on, { rateLimits: [{ kind: 'seven_day', percentUsed: 80 }] })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  expect(rowIds(await ui.drawn())).not.toContain('usage')
  await ui.unmount()
})

test('stands a dial in for the speedometer where no font or terminal would draw it', async ($, on) => {
  engine(on, { rateLimits: [fiveHour(42.4, 133 * MINUTE)], fontconfig: ['.LastResort'] })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...BAND })
    expect(await rowTexts(ui, 'usage')).toEqual([DIAL_GLYPH, 'usage', LIT.repeat(4), UNLIT.repeat(6), '42%', 'resets in 2h 13m'])
    expect(textIn(nodeOf(await ui.drawn(), 'usage'), DIAL_GLYPH)?.props?.['color']).toBe(GLYPH_COLOR)
    await ui.unmount()
  }
})

for (const [name, value] of [
  ['TERM_PROGRAM', 'ghostty'],
  ['TERM', 'xterm-ghostty'],
  ['TERM_PROGRAM', 'WezTerm'],
  ['TERM', 'xterm-kitty'],
] as const) {
  test(`draws the speedometer in a terminal that ships it (${name}=${value}), and the dial on the desktop`, async ($, on) => {
    engine(on, { rateLimits: [fiveHour(42, 133 * MINUTE)], env: { [name]: value }, fontconfig: ['.LastResort'] })
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

    for (const [surface, glyph] of [['terminal', SPEEDOMETER_GLYPH], ['desktop', DIAL_GLYPH]] as const) {
      const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...BAND })
      expect((await rowTexts(ui, 'usage'))[0]).toBe(glyph)
      await ui.unmount()
    }
  })
}

test('draws the speedometer from a font installed on the machine on all its surfaces, and the dial on a phone', async ($, on) => {
  engine(on, { rateLimits: [fiveHour(42, 133 * MINUTE)], fontconfig: ['.LastResort', 'Symbols Nerd Font'] })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

  for (const [surface, glyph] of [['terminal', SPEEDOMETER_GLYPH], ['desktop', SPEEDOMETER_GLYPH], ['mobile', DIAL_GLYPH]] as const) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...BAND })
    expect((await rowTexts(ui, 'usage'))[0]).toBe(glyph)
    await ui.unmount()
  }
})

for (const [folder, file, glyph] of [
  ['/Users/someone/Library/Fonts', 'JetBrainsMonoNerdFont-Regular.ttf', SPEEDOMETER_GLYPH],
  ['/Library/Fonts', 'Hack Regular Nerd Font Complete Mono.ttf', SPEEDOMETER_GLYPH],
  ['/Users/someone/Library/Fonts', 'MesloLGS NF Regular.ttf', SPEEDOMETER_GLYPH],
  ['/Users/someone/Library/Fonts', 'JetBrainsMono-Regular.ttf', DIAL_GLYPH],
  ['/Library/Fonts', 'Infinity-Regular.ttf', DIAL_GLYPH],
] as const) {
  test(`reads the font folders where fontconfig is not installed: ${file} in ${folder}`, async ($, on) => {
    engine(on, {
      rateLimits: [fiveHour(42, 133 * MINUTE)],
      env: { HOME: '/Users/someone' },
      fontconfig: null,
      folders: { [folder]: ['Arial.ttf', file] },
    })
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
    expect((await rowTexts(ui, 'usage'))[0]).toBe(glyph)
    await ui.unmount()
  })
}

// Keeps NOW in use as the anchor the readings above are dated from.
test('reads the reset time from the window, not from when the session started', async ($, on) => {
  engine(on, { rateLimits: [{ kind: 'five_hour', percentUsed: 10, resetsAt: new Date(NOW + 45 * MINUTE).toISOString() }] })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  expect(await rowTexts(ui, 'usage')).toContain('resets in 45m')
  await ui.unmount()
})
