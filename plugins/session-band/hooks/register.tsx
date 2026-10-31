import type { EngineInterface, Register, RenderElement } from 'claude-code'

import { BUBBLE, hintRow, promptHint, registerHint, startHint } from './hint'
import { recordEdit, registerReplay, replayInBand, replayRow, startReplay } from './replay'
import { FOOTER_INDENT, LABEL_COLUMNS } from './row'
import type { Row, Segment } from './row'
import { startSymbols } from './symbols'
import { SPEEDOMETER, registerUsage, startUsage, usageRow } from './usage'
import { afterToolWhere, refreshSoon, registerWhere, startWhere, whereRow } from './where'

// Each mod only keeps its data and says what its row holds; this module alone
// draws the band, so the rows stack in one order and share one layout whatever
// the order the engine runs the mods' hooks in.

// A run of segments drawn flush, the first one a word of its own.
const words = (segments: readonly Segment[]): Segment[][] => {
  const out: Segment[][] = []
  for (const s of segments) {
    const last = out.at(-1)
    if (s.isAttached === true && last !== undefined) last.push(s)
    else out.push([s])
  }
  return out
}

// A mod's part of a shared event; its failure goes to the debug log.
async function quietly($: EngineInterface, row: string, work: () => unknown): Promise<void> {
  try {
    await work()
  } catch (error) {
    $.ui.log(`session-band: ${row}: ${String(error)}`, { to: 'debug' })
  }
}

async function orNull($: EngineInterface, row: string, built: Promise<Row | null>): Promise<Row | null> {
  try {
    return await built
  } catch (error) {
    $.ui.log(`session-band: ${row} row: ${String(error)}`, { to: 'debug' })
    return null
  }
}

export const register: Register = (on, options) => {
  registerHint(on, options)
  registerWhere(on, options)
  registerUsage(on, options)
  registerReplay(on, options)

  // The events several rows need are hooked once, here, in the order each mod
  // ran them on its own: what reads before the session starts, then what reads
  // after. Each mod's part is guarded, so one that fails leaves the others' work,
  // and the session's start, alone.
  on('session.start', async ($, e, next) => {
    await quietly($, 'repo', () => startWhere($))
    await quietly($, 'usage', () => startUsage($))
    await quietly($, 'glyphs', () => startSymbols($, [BUBBLE, SPEEDOMETER]))
    const started = await next(e)
    await quietly($, 'replay', () => startReplay($))
    await quietly($, 'task', () => startHint($))
    return started
  })

  on('prompt.submit', async ($, e, next) => {
    await quietly($, 'task', () => promptHint($, e))
    await quietly($, 'repo', () => refreshSoon($))
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    await quietly($, 'replay', () => recordEdit($, e))
    const ran = await next(e)
    await quietly($, 'repo', () => afterToolWhere($, ran))
    return ran
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    // In the band's order, top to bottom. A row that fails to build is left out.
    const built = await Promise.all([
      orNull($, 'task', hintRow($, e)),
      orNull($, 'repo', whereRow($)),
      orNull($, 'usage', usageRow($, e)),
      orNull($, 'replay', replayRow($)),
    ])
    const rows = built.filter((r): r is Row => r !== null)
    const inBand = replayInBand($, e)
    if (rows.length === 0 && inBand === null) return next(e)
    const beneath = await next(e)

    const { Box, Text, Button } = $.ui.resolve(e)

    // Meta is dim unless a segment carries a color of its own (the branch, a mark).
    const text = (s: Segment, isMeta: boolean, key: string): RenderElement => (
      <Text
        key={key}
        color={s.color}
        bold={s.bold}
        dimColor={s.dim ?? (isMeta && s.color === undefined)}
        wrap={s.isFixed === true ? undefined : 'truncate-end'}
      >
        {s.text}
      </Text>
    )
    // A slot gives way to a narrow band, value and meta alike; a fixed word keeps its cells.
    // Each Box of a row is held to one line: a graphical surface wraps a row Box
    // unless told not to, and breaks the line before it shrinks anything, so a
    // long value would drop below its label, a gap's height down, instead of giving way.
    const slot = (segments: readonly Segment[], isMeta: boolean, key: string): RenderElement => (
      <Box key={key} gap={1} flexShrink={1} flexWrap="nowrap">
        {words(segments).map((run, n) => (
          <Box key={`${key}${n}`} flexShrink={run.every(s => s.isFixed === true) ? 0 : 1} flexWrap="nowrap">
            {run.map((s, m) => text(s, isMeta, `${key}${n}.${m}`))}
          </Box>
        ))}
      </Box>
    )
    // The terminal lays the band out in cells, a row as wide as the band's count
    // of them. A graphical surface stretches the row across the band itself, and
    // its count can fall short: VS Code counts cells as wide as a box-drawing
    // rule, wider than the `ch` it draws a width in, so the row would stop early.
    const width = e.surface === 'terminal' ? e.props.bodyColumns : undefined
    const drawRow = (row: Row): RenderElement => (
      <Box key={row.id} gap={1} flexWrap="nowrap" paddingLeft={FOOTER_INDENT} width={width}>
        <Text color={row.glyph.color}>{row.glyph.text}</Text>
        <Box width={LABEL_COLUMNS} flexShrink={0}>
          <Text dimColor>{row.label}</Text>
        </Box>
        {slot(row.value, false, 'value')}
        {row.meta !== undefined && row.meta.length > 0 && slot(row.meta, true, 'meta')}
        {row.action !== undefined && <Box key="gap" flexGrow={1} />}
        {row.action !== undefined && (
          <Button key={`${row.id}-action`} plain hotkey={row.action.hotkey} label={row.action.label} onPress={row.action.onPress} />
        )}
      </Box>
    )

    const ours = [...rows.map(drawRow), ...(inBand === null ? [] : [inBand])]
    const band = ours.length === 1 ? ours[0]! : <Box flexDirection="column">{ours}</Box>
    // The band is shared: rows other plugins drew go below ours. The engine's own
    // band holds only a survey, yielded to above, so it is never stacked.
    return beneath.type === 'engine' ? (
      band
    ) : (
      <Box flexDirection="column">
        {band}
        {beneath}
      </Box>
    )
  })
}
