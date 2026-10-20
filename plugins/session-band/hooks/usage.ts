import type { EngineInterface, Register, Timer } from 'claude-code'

import type { BandInput, Row } from './row'
import { drawsSymbol } from './symbols'

// The usage row: how much of Claude's five-hour session limit is used, and when it resets.

// The window Claude's usage panel calls the current session: five hours from the
// first request after the last window closed, shared by every session on the account.
const SESSION_WINDOW = 'five_hour'
// Ten segments, a tenth of the window each, lit whole: filled for what is used,
// outlined for what is left, so the bar reads without its color.
const SEGMENTS = 10
const LIT = '■'
const UNLIT = '□'
const FILL_COLOR = '#92eeff'
// Material Design's speedometer (U+F04C5), from the Nerd Font symbols. It lies
// past U+FFFF, hence `fromCodePoint`.
export const SPEEDOMETER = 0xf04c5
const SPEEDOMETER_GLYPH = String.fromCodePoint(SPEEDOMETER)
// Where no font draws the speedometer, a dial a quarter full stands in, a
// geometric shape every terminal's fallback fonts draw, one cell wide.
const DIAL_GLYPH = '◔'
const GLYPH_COLOR = '#fb8500'
// The countdown is drawn to the minute, and a window that closes while the session
// sits idle has no response to say so: the clock redraws the band instead.
const TICK_MS = 60_000

const untilReset = (ms: number): string => {
  const minutes = Math.ceil(ms / 60_000)
  const hours = Math.floor(minutes / 60)
  return hours > 0 ? `${hours}h ${String(minutes % 60).padStart(2, '0')}m` : `${minutes}m`
}

let tick: Timer | null = null

// Before the session starts: the minute tick.
export async function startUsage($: EngineInterface): Promise<void> {
  tick?.cancel()
  tick = $.clock.every(TICK_MS, () => $.ui.invalidate('ui.render'))
}

export const registerUsage: Register = on => {
  // The row reads the figures as it draws, so a window that moved only redraws it.
  on('session.measure', ($, e, next) => {
    if (e.changed.includes('rateLimits')) $.ui.invalidate('ui.render')
    return next(e)
  })
}

export async function usageRow($: EngineInterface, e: BandInput): Promise<Row | null> {
  const limit = (await $.session.usage()).rateLimits.find(l => l.kind === SESSION_WINDOW)
  if (limit === undefined) return null

  // The reading is the last response's: once its window has closed, the next
  // request opens a new one with nothing used.
  const now = await $.clock.now()
  const resetsAt = limit.resetsAt === undefined ? Number.NaN : Date.parse(limit.resetsAt)
  const left = Number.isNaN(resetsAt) ? null : resetsAt - now
  const percent = left !== null && left <= 0 ? 0 : limit.percentUsed
  const lit = Math.min(SEGMENTS, Math.max(0, Math.round((percent / 100) * SEGMENTS)))

  return {
    id: 'usage',
    glyph: { text: drawsSymbol(SPEEDOMETER, e.surface) ? SPEEDOMETER_GLYPH : DIAL_GLYPH, color: GLYPH_COLOR },
    label: 'usage',
    value: [
      ...(lit > 0 ? [{ text: LIT.repeat(lit), color: FILL_COLOR, isFixed: true }] : []),
      ...(lit < SEGMENTS ? [{ text: UNLIT.repeat(SEGMENTS - lit), dim: true, isFixed: true, isAttached: lit > 0 }] : []),
      { text: `${Math.round(percent)}%`, color: FILL_COLOR, bold: true, isFixed: true },
    ],
    meta: left !== null && left > 0 ? [{ text: `resets in ${untilReset(left)}` }] : [],
  }
}
