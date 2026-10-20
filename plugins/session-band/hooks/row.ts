import type { RenderInput } from 'claude-code'

// The band's one grammar: every row is a glyph, a label, a value, dim meta and
// an optional action, in that order, so the eye learns one shape and finds the
// same slot in the same column on every row.

export type RowId = 'task' | 'repo' | 'usage' | 'replay'

/** A run of text in one style. */
export type Segment = {
  text: string
  color?: string
  bold?: boolean
  dim?: boolean
  /** Never truncated: a number the row exists to show (`42%`, `●3`). */
  isFixed?: boolean
  /** Drawn flush against the segment before it, with no space between (a bar's lit and unlit runs). */
  isAttached?: boolean
}

/** The row's one action: a band Button, pressed by its hotkey once the band holds the keys. */
export type RowAction = { hotkey: string; label: string; onPress: () => void }

export type Row = {
  id: RowId
  glyph: Segment
  label: string
  /** What the row is for, at full brightness. */
  value: Segment[]
  /** Safe to skip: dim, and the first to give way on a narrow band. */
  meta?: Segment[]
  action?: RowAction
}

export type BandInput = RenderInput<'AbovePrompt'>

// The prompt footer draws its mode line two cells in, and so does every row.
export const FOOTER_INDENT = 2
// The longest label, `replay`; the value starts one cell after it on every row.
export const LABEL_COLUMNS = 6
