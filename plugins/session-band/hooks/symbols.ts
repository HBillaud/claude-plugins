import type { EngineInterface, RenderSurface } from 'claude-code'

// Whether a Nerd Font symbol is drawn where the band is, so each row can stand
// a plain Unicode glyph in for its own where it would not be. Each symbol lies
// in a private-use range only a font that carries it draws, and Nerd Fonts do
// not all carry the same ones (v2 has Font Awesome's U+F075, not Material
// Design's U+F04C5), so each is asked after by its own code point.

// Terminals that ship the Nerd Font symbols and draw them whatever font is set,
// known by the variables they set: Ghostty, WezTerm, and kitty since 0.36.
const SYMBOL_PROGRAMS = ['ghostty', 'WezTerm']
const SYMBOL_TERMS = ['xterm-ghostty', 'xterm-kitty']
// A Nerd Font is known by its name, spelled out ("Symbols Nerd Font") or as the
// NF, NFM or NFP a patched family ends in ("MesloLGS NF", "JetBrainsMono NFM"):
// its family's name where fontconfig can be asked, else its files' names in the
// folders macOS installs fonts to, the user's under their home and everyone's
// (as on a Mac without Homebrew's fontconfig).
const NERD_FONT = /nerd ?font|\bnf[mp]?\b/i
const FONT_FOLDER = '/Library/Fonts'

let isSymbolTerminal = false
// The code points a font installed on this machine is known to carry.
const installed = new Set<number>()

async function shipsSymbols($: EngineInterface): Promise<boolean> {
  return (
    SYMBOL_PROGRAMS.includes((await $.env.get('TERM_PROGRAM')) ?? '') ||
    SYMBOL_TERMS.includes((await $.env.get('TERM')) ?? '')
  )
}

// fontconfig names every font that carries the code point, and only a Nerd Font
// counts: on a Mac the Last Resort font draws any character as a box, and the
// old symbol fonts (Wingdings, Webdings, Hoefler Text Ornaments) map pictures
// of their own onto U+F000 to U+F0FF, Font Awesome's part of the range.
async function hasSymbolFont($: EngineInterface, codePoint: number): Promise<boolean> {
  const fonts = await $.process.run(['fc-list', `:charset=${codePoint.toString(16)}`, 'family']).catch(() => undefined)
  if (fonts !== undefined) return fonts.stdout.split('\n').some(family => NERD_FONT.test(family))

  const home = await $.env.get('HOME')
  for (const folder of home === undefined ? [FONT_FOLDER] : [`${home}${FONT_FOLDER}`, FONT_FOLDER]) {
    const files = await $.fs.list(folder).catch(() => [])
    if (files.some(file => NERD_FONT.test(file.name))) return true
  }
  return false
}

// Before the session starts: asks once after the symbols the rows draw. fontconfig
// builds its cache first where it has none, which can take seconds: the session
// does not wait on a glyph, and the band redraws once one is known to be drawn.
export async function startSymbols($: EngineInterface, codePoints: readonly number[]): Promise<void> {
  isSymbolTerminal = await shipsSymbols($)
  installed.clear()
  for (const codePoint of codePoints) {
    void hasSymbolFont($, codePoint).then(isInstalled => {
      if (!isInstalled) return
      installed.add(codePoint)
      $.ui.invalidate('ui.render')
    })
  }
}

// A font installed here draws the symbol on every surface of this machine, a
// phone not being one; a terminal that ships the symbols, in that terminal.
export function drawsSymbol(codePoint: number, surface: RenderSurface): boolean {
  return (surface === 'terminal' && isSymbolTerminal) || (surface !== 'mobile' && installed.has(codePoint))
}
