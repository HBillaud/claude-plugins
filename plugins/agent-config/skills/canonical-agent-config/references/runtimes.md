# What each agent reads, and how to prove it

Loader behaviour is the least stable fact in this whole job: it changes between releases, differs between agents, and is misdescribed by issue threads that were true once. Everything below marked **measured** was observed on the version named, with the fixture `scripts/probe_fixture.py` builds; everything marked **documented** comes from the vendor's documentation or bundled reference and was not re-measured. Treat both as the starting hypothesis, measure the agents the team actually runs, and write the versions into the pull request.

## Contents

- [Summary](#summary)
- [Probing](#probing)
- [Claude Code](#claude-code)
- [Codex CLI](#codex-cli)
- [Gemini CLI](#gemini-cli)
- [Antigravity](#antigravity)
- [Cursor, GitHub Copilot and others](#cursor-github-copilot-and-others)
- [The size cap](#the-size-cap)

## Summary

| Agent | Instructions | Skills | Adapter the canonical layout needs |
| --- | --- | --- | --- |
| Claude Code | `CLAUDE.md` along the chain from the root to the session's directory, nested ones on demand, `@` imports; `.claude/rules/*.md`; a built-in AGENTS.md reader that stands down when any CLAUDE.md is above the session (measured 2.1.309) | `.claude/skills/<name>/SKILL.md`, one level deep; follows a symlinked root (measured 2.1.309) | `CLAUDE.md` beside each AGENTS.md: a relative symlink to it, or a stub `@AGENTS.md`; `.claude/skills -> ../.agents/skills` |
| Codex CLI | `AGENTS.md`, concatenated from the repository root down to the session's directory, truncated at 32 KiB (measured 0.154.0) | `.agents/skills`, nested directories included; follows a symlinked root in both directions (measured 0.154.0) | none |
| Gemini CLI | `GEMINI.md` by default; `context.fileName` in `.gemini/settings.json` names other files (documented) | `<cwd>/.agents/skills` only, one level deep, in a trusted folder only (measured 0.59.0) | `.gemini/settings.json` `{"context": {"fileName": "AGENTS.md"}}`, or a `GEMINI.md` stub `@AGENTS.md` |
| Antigravity | `AGENTS.md`; rules apply to their directory and below (documented, bundled reference) | `.agents/` (documented) | none |
| Cursor | `AGENTS.md`; `.cursor/rules/*.mdc`; legacy `.cursorrules` (documented) | verify | none when it reads AGENTS.md; delete `.cursorrules` |
| GitHub Copilot | `.github/copilot-instructions.md`, `.github/instructions/*.instructions.md`; `AGENTS.md` in the coding agent and VS Code (documented) | verify | a pointer, or nothing where AGENTS.md is read |

Claude-only by design, whatever the layout: `.claude/rules/`, `.claude/agents/`, the hook and permission wiring in `.claude/settings.json`, `.mcp.json`, and plugins. Each rule another agent must follow is stated in AGENTS.md as prose as well (phase 9).

## Probing

`python3 <skill-dir>/scripts/probe_fixture.py <new-dir> [--claude-md import|symlink|none] [--oversize]` builds a git repository whose every file carries a canary token (`CANARY-ROOT-START` and `CANARY-ROOT-END` at the two ends of AGENTS.md, `CANARY-SUB-END` in `sub/AGENTS.md`, `probe-*` skills at depth one, at depth two, behind `paths:`, and in nested roots), with the CLAUDE.md adapter you want to test, then prints the probe commands for each agent. Probe from the root and again from `sub/`: several behaviours below differ only in a session started in a subdirectory, which a verification run from the root never shows.

Rules that keep a probe honest:

- **Make every probe able to say yes and no.** A pipeline that prints nothing has proved nothing: `timeout(1)` does not exist on stock macOS, so `timeout 60 claude …` fails whole and every grep after it reports "not found". Check exit statuses.
- **Ask from context, not from disk.** "Quote the last sentence of your instructions" proves the file was loaded only if the agent cannot simply read it: refuse the file tools (`--disallowedTools Read Grep Glob Bash` for Claude Code). Codex renders its prompt without a model call, which is better still.
- **Use the last sentence.** Truncation cuts the end of a file, so the end is what a probe checks.
- **Run a negative control.** The same probe on a fixture without the thing under test must answer no.
- **Keep the version with the answer.** A result without the version that produced it cannot be compared with the next one.

## Claude Code

Measured on 2.1.308 and 2.1.309 with the probe fixture:

| Session started in | CLAUDE.md adapter | Instructions delivered | Project skills |
| --- | --- | --- | --- |
| root | stub `@AGENTS.md` | root AGENTS.md, through the stub's import | `probe-alpha`, `probe-scoped` (conditional); not `probe-nested` (depth two); not `sub/.claude/skills` |
| root | none | root AGENTS.md, through the built-in reader (`no CLAUDE.md found; AGENTS.md loaded`) | same |
| root, then reads `sub/notes.txt` | none | root, then `sub/AGENTS.md` on demand | same |
| `sub/` | stub, root and `sub/` | `sub/AGENTS.md` and the root CLAUDE.md's own text; **not** the root AGENTS.md: the root stub's import is not expanded | `sub/.claude/skills` and the root's |
| `sub/` | stub, plus `@../AGENTS.md` in `sub/`'s stub | `sub/AGENTS.md` only: the extra import is not expanded either | same |
| `sub/` | relative symlink `CLAUDE.md -> AGENTS.md`, root and `sub/` | root and `sub/` AGENTS.md, the whole chain | same |
| `sub/` | stub, with `instructionFiles: claude-md-and-agents-md` in user or `--settings` settings | root and `sub/` AGENTS.md | same |
| `sub/` | none | root and `sub/` AGENTS.md, the whole chain | same |

What that means:

- **An import that leaves the session's directory is an external include.** Claude Code expands `@AGENTS.md` relative to the importing file, but treats an import that resolves outside the directory the session started in as external, and gates it behind an approval it records per directory (`hasClaudeMdExternalIncludesApproved` in `~/.claude.json`); a headless run (`claude -p`, CI, an SDK agent) does not expand it. With stubs, a session started inside a component gets the component's AGENTS.md but not the root's.
- **A symlinked CLAUDE.md has no import to gate.** Claude Code reads each CLAUDE.md along the chain from the root to the session's directory, and a symlink delivers its target's content, so every session gets the whole chain. The cost is symlinks in every checkout, which the `.claude/skills` link already requires.
- **The built-in AGENTS.md reader is a plugin, `agents-md@builtin`, with one option, `instructionFiles`:** `claude-md`, `claude-md-or-agents-md` (the default: AGENTS.md only when no CLAUDE.md, `.claude/CLAUDE.md` or `CLAUDE.local.md` exists in any directory above the session), `claude-md-and-agents-md`, `managed-only`. Plugin options are read from user settings, `--settings` and managed settings, never from a project's settings (the debug log says so), so it is each developer's remedy or an administrator's, not the repository's: `{"pluginConfigs": {"agents-md@builtin": {"options": {"instructionFiles": "claude-md-and-agents-md"}}}}`. Under the default, one stub anywhere above, a parent folder's CLAUDE.md, or one developer's personal `CLAUDE.local.md` silently turns the reader off.
- **Skills load from `<root>/<name>/SKILL.md` only.** A nested `.claude/skills` loads only for sessions started inside its directory. `paths:` frontmatter makes a skill conditional: listed once a matching file is read, edited or written.
- **A skill whose frontmatter name differs from its directory answers to both names,** which is why the guard requires them equal, as the Agent Skills spec does.
- **`.claude/rules/*.md` at the project root load even for a session started in a component.**
- **Nested CLAUDE.md files below the session's directory load when Claude reads a file there**, with their imports expanded.
- Claude Code warns when one memory file passes about 40,000 characters.

Probes:

```bash
claude --debug-file /tmp/cc.log --disallowedTools Read Grep Glob Bash \
  -p 'Without using any tool, list every token that starts with CANARY- in your instructions.' < /dev/null
grep -E 'Loading skills from|unique skills|conditional|agents-md' /tmp/cc.log
# Loaded 18 unique skills (17 unconditional, 1 conditional, managed: 0, user: 7, project: 2, …)
claude --disallowedTools Read Grep Glob Bash \
  -p 'Without using any tool, list the skills available to you whose names start with probe-.' < /dev/null
claude --debug-file /tmp/cc.log --allowedTools Read -p 'Read src/main.txt and reply OK' < /dev/null
grep 'Activated conditional skill' /tmp/cc.log
```

The `Loaded … unique skills` line counts skills without naming them; the roster question names them. `--debug` alone writes nothing to the terminal; the log reaches a file only through `--debug-file`. Redirect stdin from `/dev/null`, or `-p` waits three seconds for piped input.

## Codex CLI

Measured on 0.154.0:

- **Instructions:** AGENTS.md from the repository root down to the session's directory, concatenated in that order. Past 32 KiB (`project_doc_max_bytes`) the rest is dropped, mid-line, with no marker and nothing on stderr: with a 43 KB root file, `CANARY-ROOT-END` was gone, and from `sub/` the whole of `sub/AGENTS.md` was gone too. The file closest to the session, the most specific guidance, is the first to go.
- **Skills:** `.agents/skills` at the repository root, plus `~/.agents/skills` and Codex's own system skills. A nested `<dir>/.agents/skills` is listed only for a session started inside `<dir>`. Skills nested two levels deep are listed. `paths:` is ignored: a scoped skill is listed like any other. `.claude/skills` is not read. A symlinked skills root is followed in both directions, real `.agents/skills` with a linked `.claude/skills` and the reverse (an issue thread had said otherwise; it no longer describes shipped behaviour).
- **Hooks and MCP:** a trusted repository's `.codex/config.toml` configures both (documented); verify payloads before relying on them.

Probe, with no model call:

```bash
codex debug prompt-input > codex.json                          # the model-visible prompt, as JSON
grep -o 'CANARY-[A-Z-]*' codex.json | sort -u
grep -o '`r[0-9]*` = `[^`]*`' codex.json                       # which rN alias is which skills root
grep -o '(file: [^)]*SKILL.md)' codex.json | sort -u           # rN/<name>/SKILL.md
```

## Gemini CLI

Measured on 0.59.0, in a trusted folder: `gemini skills list` lists project skills from `<cwd>/.agents/skills` only, one level deep. From the fixture's root it listed `probe-alpha` and `probe-scoped` but not `probe-nested`; from `src/` it found no skills at all, because it does not look up to the repository root; from `sub/` it listed only `sub/`'s own nested root. In an untrusted folder it prints `Skipping project agents due to untrusted folder` and disables project hooks. So a Gemini session gets the canonical skills only when it starts at the repository root, which a team serving Gemini writes down as its convention.

Documented: `GEMINI.md` is the default instruction file, `context.fileName` in `.gemini/settings.json` replaces it (a string or a list), and `GEMINI.md` supports `@file.md` imports, so either a setting or a stub is a thin adapter. Some account tiers are refused the CLI and pointed at Antigravity.

## Antigravity

Documented in its bundled customization reference: `AGENTS.md` and `.agents/` are native inputs, rules apply to the directory they sit in and below, hooks live in `.agents/hooks.json` with a schema close to Claude Code's, and MCP servers are configured globally or by a plugin, with a different `serverUrl` shape for HTTP servers. The `agy` CLI has no skills listing; probe it with the canary question in `agy -p`.

## Cursor, GitHub Copilot and others

Documented, not measured here; verify the version the team runs before deleting the files they read.

- **Cursor** reads `AGENTS.md` and `.cursor/rules/*.mdc` (frontmatter `description`, `globs`, `alwaysApply`); `.cursorrules` is its legacy single file.
- **GitHub Copilot** reads `.github/copilot-instructions.md` and `.github/instructions/*.instructions.md` (`applyTo` globs); its coding agent and VS Code read `AGENTS.md`.
- **Windsurf** (`.windsurf/rules/`, legacy `.windsurfrules`), **Zed** (`.rules`, falling back to AGENTS.md and others), **Amp**, **Aider** (`CONVENTIONS.md` passed with `--read`), **Cline** (`.clinerules`), **Roo Code** (`.roo/rules*`), **Kiro** (`.kiro/steering/`) and **Junie** (`.junie/guidelines.md`) each have their own file; most read AGENTS.md as well. [agents.md](https://agents.md) keeps the list of agents that read AGENTS.md.

For any of these, the probe is the canary question asked in a session opened in the fixture's root and in `sub/`, plus the skills roster question.

## The size cap

- Codex: 32 KiB (`project_doc_max_bytes`) on the concatenated root-to-directory chain, the end cut first (measured 0.154.0). A trusted repository's `.codex/config.toml` can raise it, for Codex alone.
- Kimi CLI applies the same 32 KiB cap to the same chain but budgets from the leaf up, so on the same input it truncates the root file instead (read from its source). Two agents failing in opposite directions is why no per-agent cap setting fixes a chain over the cap: shed instead (phase 10).
- Claude Code warns at about 40,000 characters per memory file.
