import { atom, read, update } from 'claude-code'
import type { EngineInterface, PromptSubmitInput, Register, SessionMessage } from 'claude-code'

import type { Hint } from '../types'
import type { BandInput, Row } from './row'
import { drawsSymbol } from './symbols'

// The task row: the person's last message summed up as a short phrase.

const hint = atom({ plugin: 'session-band', key: 'hint' } as const, null)

// A label, not a judgment: the smallest model at low effort answers in about a second.
const MODEL = 'haiku'
const SUMMARY_TIMEOUT_MS = 15_000
// The head of a long paste says what it is for; the rest only costs tokens.
const MESSAGE_CHARS = 4_000
const HINT_CHARS = 72
// A session first seen mid-conversation (a reload, a resume) is summed up from
// its last few prompts, so a closing "yes, go ahead" still has its task.
const SEED_PROMPTS = 3
// Font Awesome's comment bubble (U+F075), from the Nerd Font symbols Ghostty embeds.
export const BUBBLE = 0xf075
const BUBBLE_GLYPH = String.fromCodePoint(BUBBLE)
// Where no font draws the bubble, a black diamond stands in: a geometric shape
// every terminal's fallback fonts draw, one cell wide, and the task glyph of the
// band's design.
const DIAMOND_GLYPH = '◆'
const GLYPH_COLOR = '#fb8500'

const SYSTEM = [
  "You write the one-line label a developer reads above a coding agent's prompt, to tell at a glance what that session is working on.",
  "You are given the session's current label and the developer's latest messages, oldest first.",
  'Reply with the new label alone: a verb-led phrase of at most eight words and under 60 characters, in sentence case, with no trailing period, quotes, markdown or emoji.',
  'Name the concrete subject the messages give: the feature, component, file, pull request or issue number.',
  'When the latest message only approves, confirms, answers a question or nudges the work under way ("yes", "go ahead", "looks good", "the second option"), reply with the current label, narrowed only if the message narrows the work.',
].join(' ')

// How the label is written, the `taskLabel` option: by the model, read from the
// message itself with no model call, or not at all (no task row).
type LabelMode = 'model' | 'local' | 'off'
let mode: LabelMode = 'model'

const labelMode = (value: unknown): LabelMode => (value === 'local' || value === 'off' ? value : 'model')

// The local label, at most this long, cut at a word.
const LOCAL_CHARS = 60
// A reply that only approves or nudges the work under way keeps the label;
// fewer words than this, once the approval is taken off, is still a nudge.
const NUDGE_WORDS = 3
// A context block pasted ahead of the request (`<context>…</context>`).
const BLOCK = /<([a-z][\w-]*)>[\s\S]*?<\/\1>/gi
// Leading approvals: "yes", "ok so", "sounds good,", "the second option".
const ACK =
  /^(?:yes|yep|yeah|ok|okay|sure|great|perfect|nice|cool|thanks|thank you|lgtm|sounds good|looks good|go ahead|do it|please do|continue|proceed|the (?:first|second|third|last|other) (?:one|option)|option \w+)\b[\s,.!:;-]*/i
// Leading politeness and framing: "hey, can you please", "I'd like you to", "let's".
const FILLER =
  /^(?:(?:hey|hi|so|and|also|alright|now|then|please|pls|claude)\b[\s,.!:;-]*)*(?:(?:can|could|would|will) you(?: please)?|i(?:'d| would) like(?: you)? to|i (?:want|need)(?: you)? to|we need to|let'?s|help me(?: to)?)?\b\s*/i

const stripAll = (text: string, pattern: RegExp): string => {
  let was = ''
  let now = text
  while (now !== was) {
    was = now
    now = now.replace(pattern, '')
  }
  return now
}

// The label a message gives without the model: its first sentence, with the
// request's approvals and politeness taken off the front, in sentence case. A
// command keeps its name. `current` stands where the message only nudges.
export const localLabel = (current: string | null, message: string): string | null => {
  const line = message.replace(BLOCK, '').split('\n').find(l => l.trim() !== '')?.trim() ?? ''
  const sentence = line.startsWith('/') ? line : (line.split(/(?<=[.?!])\s/)[0] ?? '')
  const stripped = stripAll(stripAll(sentence, ACK), FILLER)
    .replace(/\s+please$/i, '')
    .replace(/[\s?.!,;:]+$/, '')
  if (stripped === '') return current
  if (current !== null && stripped.split(/\s+/).length < NUDGE_WORDS) return current
  const text = stripped.startsWith('/') ? stripped : `${stripped[0]!.toUpperCase()}${stripped.slice(1)}`
  if (text.length <= LOCAL_CHARS) return text
  const cut = text.slice(0, LOCAL_CHARS - 1)
  return `${cut.slice(0, cut.lastIndexOf(' ') > 0 ? cut.lastIndexOf(' ') : cut.length)}…`
}

// Rows the engine stores as user messages that the person did not type.
const NOT_TYPED = ['<local-command-', '<task-notification', '<bash-', 'Base directory for this skill:', 'Caveat:', '[Request interrupted']
const REMINDER = /<system-reminder>[\s\S]*?<\/system-reminder>/g

const firstLine = (text: string): string => {
  const line = text.split('\n').find(l => l.trim() !== '')?.trim() ?? ''
  return line.length > HINT_CHARS ? `${line.slice(0, HINT_CHARS - 1)}…` : line
}

const cleaned = (reply: string): string | null => {
  const line = firstLine(reply)
    .replace(/^[\s"'`*_]+|[\s"'`*_.]+$/g, '')
    .slice(0, HINT_CHARS)
  return line === '' ? null : line
}

// A built-in command (`/model opus`, `/clear`) is housekeeping, not a task; a
// skill or prompt command with arguments (`/draft-spec <brief>`) is one.
async function isTask($: EngineInterface, name: string, args: string): Promise<boolean> {
  if (args.trim() === '') return false
  const command = (await $.command.list()).find(c => c.name === name)
  return command !== undefined && command.source !== 'builtin'
}

async function typed($: EngineInterface, e: PromptSubmitInput): Promise<string | null> {
  if (e.isMeta === true || (e.origin.kind !== 'composer' && e.origin.kind !== 'bridge')) return null
  if (e.command !== undefined) {
    return (await isTask($, e.command.name, e.command.args)) ? `/${e.command.name} ${e.command.args}` : null
  }
  return e.text.trim() === '' ? null : e.text
}

const storedPrompt = (m: SessionMessage, builtins: ReadonlySet<string>): string | null => {
  if (m.role !== 'user' || (m.toolResults?.length ?? 0) > 0) return null
  const text = m.text.replace(REMINDER, '').trim()
  const name = /<command-name>\/?([\s\S]*?)<\/command-name>/.exec(text)?.[1]?.trim()
  if (name !== undefined) {
    const args = /<command-args>([\s\S]*?)<\/command-args>/.exec(text)?.[1]?.trim() ?? ''
    return args === '' || builtins.has(name) ? null : `/${name} ${args}`
  }
  return text === '' || NOT_TYPED.some(p => text.startsWith(p)) ? null : text
}

async function recentPrompts($: EngineInterface): Promise<string[]> {
  const builtins = new Set((await $.command.list()).filter(c => c.source === 'builtin').map(c => c.name))
  const prompts = (await $.session.messages()).map(m => storedPrompt(m, builtins)).filter(p => p !== null)
  return prompts.slice(-SEED_PROMPTS)
}

// The newest summary asked for; one that lands after a newer one was asked is dropped.
let latest = 0

async function summarize($: EngineInterface, messages: readonly string[]): Promise<void> {
  const id = ++latest
  try {
    const was = await read($, hint)
    const last = messages.at(-1) ?? ''
    if (was === null) await update($, hint, () => ({ text: firstLine(last), isProvisional: true }))
    const current = was === null || was.isProvisional ? '(none)' : was.text
    const reply = await $.model.complete({
      model: MODEL,
      system: SYSTEM,
      prompt: [`Current label: ${current}`, ...messages.map(m => `<message>\n${m.slice(0, MESSAGE_CHARS)}\n</message>`)].join('\n\n'),
      maxTokens: 64,
      effort: 'low',
      timeoutMs: SUMMARY_TIMEOUT_MS,
    })
    if (id !== latest) return
    const text = reply.isAnswered ? cleaned(reply.text) : null
    if (text === null) {
      // The first line stays up in place of a summary that did not come.
      $.ui.log(`session-band: no task summary (${reply.isAnswered ? 'empty label' : reply.reason})`, { to: 'debug' })
      return
    }
    await update($, hint, () => ({ text, isProvisional: false }))
  } catch (error) {
    $.ui.log(`session-band: task: ${String(error)}`, { to: 'debug' })
  }
}

// The label without the model: each message in turn, oldest first.
async function label($: EngineInterface, messages: readonly string[]): Promise<void> {
  const id = ++latest
  try {
    const was = await read($, hint)
    const text = messages.reduce<string | null>((current, m) => localLabel(current, m), was?.text ?? null)
    if (id !== latest || text === null || text === was?.text) return
    await update($, hint, () => ({ text, isProvisional: false }))
  } catch (error) {
    $.ui.log(`session-band: task: ${String(error)}`, { to: 'debug' })
  }
}

// The label is written on a timer, outside the dispatch that asked for it, so
// neither the prompt nor the session's start waits on the model.
function later($: EngineInterface, messages: readonly string[]): void {
  if (messages.length === 0 || mode === 'off') return
  $.clock.after(0, () => void (mode === 'local' ? label($, messages) : summarize($, messages)))
}

async function seed($: EngineInterface): Promise<void> {
  try {
    later($, await recentPrompts($))
  } catch (error) {
    $.ui.log(`session-band: task: ${String(error)}`, { to: 'debug' })
  }
}

// After the session starts: a session first seen mid-conversation gets its task.
export async function startHint($: EngineInterface): Promise<void> {
  if ((await read($, hint)) === null) await seed($)
}

// As a prompt goes in: sums it up, off the prompt's path.
export async function promptHint($: EngineInterface, e: PromptSubmitInput): Promise<void> {
  try {
    const message = await typed($, e)
    if (message !== null) later($, [message])
  } catch (error) {
    $.ui.log(`session-band: task: ${String(error)}`, { to: 'debug' })
  }
}

export const registerHint: Register = (on, options) => {
  mode = labelMode(options['taskLabel'])
  on('classic.SessionStart', async ($, e, next) => {
    const ran = await next(e)
    if (e.source === 'clear' || e.source === 'resume' || e.source === 'fork') {
      latest += 1
      await update($, hint, () => null)
      if (e.source !== 'clear') await seed($)
    }
    return ran
  })
}

export async function hintRow($: EngineInterface, e: BandInput): Promise<Row | null> {
  if (mode === 'off') return null
  const shown = await read($, hint)
  if (shown === null) return null
  return {
    id: 'task',
    glyph: { text: drawsSymbol(BUBBLE, e.surface) ? BUBBLE_GLYPH : DIAMOND_GLYPH, color: GLYPH_COLOR },
    label: 'task',
    value: [{ text: shown.text, bold: !shown.isProvisional, dim: shown.isProvisional }],
  }
}
