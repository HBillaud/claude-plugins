# The migration, phase by phase

Each phase is one commit on the migration branch (phase 2 is two). It leaves the tree working, it is verified twice (the guard's rules for that phase, and a probe of each agent in scope), and the phases revert cleanly in reverse order; a single early phase reverted on its own conflicts with the later phases that build on it. Skip a phase that has nothing to do and say so in the report. Run `scripts/inventory.py` again after each phase: its Findings table shrinks as the phases land.

The commands assume the canonical layout of the SKILL.md (real tree in `.agents/skills`, `.claude/skills` a link, AGENTS.md canonical, each CLAUDE.md a relative symlink to it); substitute the repository's decisions where they differ.

## Contents

- [0. The guard](#0-the-guard)
- [1. Move the skills tree](#1-move-the-skills-tree)
- [2. Make AGENTS.md canonical](#2-make-agentsmd-canonical)
- [3. Scope skills by path](#3-scope-skills-by-path)
- [4. Components](#4-components)
- [5. Lift nested skills](#5-lift-nested-skills)
- [6. One skills root](#6-one-skills-root)
- [7. Drop the adapters no agent needs](#7-drop-the-adapters-no-agent-needs)
- [8. Subagents and commands become envelopes](#8-subagents-and-commands-become-envelopes)
- [9. Everything outside skills](#9-everything-outside-skills)
- [10. Size by chain](#10-size-by-chain)
- [11. Keep the guard running](#11-keep-the-guard-running)

## 0. The guard

```bash
mkdir -p scripts/agents
cp <skill-dir>/scripts/check_agent_config.py <skill-dir>/scripts/test_check_agent_config.py scripts/agents/
```

Format the copies with the repository's formatter if it has one (they are clean under ruff's defaults). Set the CONFIGURATION block at the top of `check_agent_config.py` to the decisions of step 2, with a reason beside each exclusion. A repository that would rather keep its decisions out of the script passes `--config <file.json>` with the same names. The CLAUDE.md adapter decision maps to:

| Decision 2 | Configuration |
| --- | --- |
| relative symlinks | `STUB_FORM = "symlink"` |
| stubs | `STUB_FORM = "import"` |
| no CLAUDE.md | `STUB_FILES` without `CLAUDE.md`, `REQUIRED_STUBS = ()`, and `CLAUDE.md` in `FORBIDDEN_FILES`, with the reason that any CLAUDE.md above a session turns Claude Code's built-in reader off |

Then:

```bash
python3 scripts/agents/test_check_agent_config.py          # hermetic, a few seconds; runs the shipped defaults, whatever the block says
python3 scripts/agents/check_agent_config.py --mode audit   # passes; its warnings are the to-do list
```

If audit mode fails, the tree has something broken in any layout. Fix that first, in its own commit, or exempt it with a printed reason if it is not what it looks like (a template `SKILL.md` goes in `SKILL_FILE_EXEMPT`).

Commit the guard alone. If the repository has CI, add the job now in audit mode (phase 11 has the job) so nothing gets worse while the migration is in flight.

## 1. Move the skills tree

When `.agents/skills` does not exist yet:

```bash
mkdir -p .agents
git mv .claude/skills .agents/skills                 # history follows the files
ln -s ../.agents/skills .claude/skills               # relative, so it resolves in every checkout
git add .claude/skills
git ls-files -s .claude/skills                        # 120000 <sha> 0  .claude/skills
readlink .claude/skills                               # ../.agents/skills
```

When `.agents/skills` already exists, `git mv .claude/skills .agents/skills` succeeds and nests the whole tree one level too deep, as a `skills` directory inside the canonical root, where Claude Code does not load it. Move each skill directory on its own instead, after settling any name that exists in both: `git mv .claude/skills/<name> .agents/skills/<name>`, then remove the empty directory and create the link.

- Where the same skill exists in several roots (`.claude/skills` and `.codex/skills`, say), diff the copies now and keep the better one; the others go in phase 6.
- On Windows, git checks a symlink out as a text file holding its target unless `core.symlinks` is true (which needs Developer Mode or administrator rights). Tell Windows users before this commit lands; the guard's `root-links` rule reports a link that became a file.
- If `.claude/skills` is the repository's first tracked symlink, no tooling in it has met one: packaging scripts, copy steps and CI caches that walk the tree may need `-L` or the equivalent.

Verify: `root-links` passes. Claude Code lists the same skills as before the move (its `Loaded N unique skills (… project: N …)` line and the roster question), and each agent that reads `.agents/skills` now lists them too (Codex's `(file: rN/<name>/SKILL.md)` entries).

## 2. Make AGENTS.md canonical

**First, find the links.** `find . -name AGENTS.md -type l -o -name CLAUDE.md -type l` (skip `node_modules`). Writing through a symlink writes the file it points at:

- `AGENTS.md -> CLAUDE.md`: the instructions live in CLAUDE.md. Remove the link (`git rm AGENTS.md`) before anything else, then rename.
- `CLAUDE.md -> AGENTS.md`: AGENTS.md is already canonical and CLAUDE.md is already the symlink adapter; leave it.

Writing the stub into a CLAUDE.md that AGENTS.md points at turns AGENTS.md into the stub and erases the instructions; the guard fails, in both modes, on an AGENTS.md that imports itself.

**2a, its own commit: the rename.** When CLAUDE.md holds the body, `git mv CLAUDE.md AGENTS.md` and commit nothing else. A rename committed with a new CLAUDE.md beside it reads to git as an edit and an addition, and `git log --follow AGENTS.md` stops there. If an AGENTS.md already exists (a pointer, or a file a scaffold generated), merge into it instead, and leave a file an upstream tool owns as that tool wrote it.

**2b, the next commit: everything else.**

1. **Fold in the copies.** The inventory's Instruction files and Duplicated content tables list them: GEMINI.md, `.cursorrules`, `.github/copilot-instructions.md`, `.windsurfrules`, `.cursor/rules/*.mdc`. Take every rule they hold that AGENTS.md lacks. Where two copies disagree, the code decides: check the build command, the path, the flag against the tree, keep the true one, and list the conflict in the report.
2. **Shed** until the file is under 32 KiB, in the order of the SKILL.md (§ Shed, don't move), starting with hand-kept catalogs of skills and agents: the loader lists them, and a wrong catalog in the new canonical file helps nobody.
3. **Move what only Claude Code acts on** (how its hooks are wired, its subagent roster, its MCP notes, its plugins) into `.claude/rules/claude-code.md`. Claude Code loads every `.claude/rules/*.md` without `paths:` at the start of each session; no import is needed.
4. **Say where agent configuration lives**, in a short paragraph of AGENTS.md: the skills root, the adapters, the guard and its command. The next contributor, human or agent, then puts things in the right place.
5. **Create the adapter**, as decided:

   ```bash
   ln -s AGENTS.md CLAUDE.md                              # relative symlink
   printf '# CLAUDE.md\n\n@AGENTS.md\n' > CLAUDE.md       # or a stub
   ```

6. **Repoint references.** `git grep -n 'CLAUDE\.md'` across docs, hook messages, CI comments and skills: most now mean AGENTS.md.

Verify: `size` and `stubs` pass for the root. Ask each agent for the last sentence of AGENTS.md from context (runtimes.md § Probing); ask Claude Code for a heading that lives only in `.claude/rules/claude-code.md`. If the team starts sessions in subdirectories, probe from one as well (runtimes.md § Claude Code).

## 3. Scope skills by path

Give each skill that concerns certain files only (one language, one component) a `paths:` list of globs in its frontmatter:

```yaml
---
name: web-testing
description: Write and run the web client's tests. Use when …
paths:
  - "web/**"
---
```

Claude Code then holds it as a conditional skill and lists it once a matching file is read, edited or written; Codex ignores `paths:` and lists it like any other, so no agent loses it. If a hand-kept catalog survived phase 2 (in a rules file, a component file), delete it here. The effort goes into the descriptions instead: they are what an agent routes on.

Verify: `claude --debug-file /tmp/cc.log --allowedTools Read -p 'Read <a matching file> and reply OK' < /dev/null`, then `grep 'Activated conditional skill' /tmp/cc.log`.

## 4. Components

For each component with its own instruction file, the same two steps as phase 2: commit `git mv <component>/CLAUDE.md <component>/AGENTS.md` alone, then create the adapter beside it, shed what the component file repeats from the root, and commit that.

```bash
git check-ignore --no-index -v <component>/AGENTS.md   # prints the pattern if a .gitignore would hide it
```

- Fix any `.gitignore` that matches AGENTS.md (a bare `AGENTS.md` line, or a `*.md`): an ignored AGENTS.md is written once and never shared, and `git status` stays clean.
- Where a scaffold already wrote an AGENTS.md there, `git mv` fails or clobbers it: keep the upstream file and point the adapter at it.
- Every component file adds to the chain Codex truncates (phase 10): keep it short, or make the material a `paths:`-scoped skill and leave a pointer.

Verify: `stubs` and `ignored` pass; probe from inside one component.

## 5. Lift nested skills

Claude Code and Gemini CLI load `<root>/<name>/SKILL.md` and nothing deeper, so a collection nested a level down (`<root>/docs/changelog/SKILL.md`) is invisible to them, though Codex lists it. Lift each group, one of two ways:

- **Promote** each nested skill one level up (`git mv <root>/<group>/<name> <root>/<name>`) when the skills are independent: each has its own triggers, and other files refer to them by name. Promotion keeps every name and every link between them.
- **Merge** the group into one skill when it is one subject split into topics: `<root>/<group>/SKILL.md` becomes the router (a description covering the union of the triggers, and a table saying which reference to read for what), and each nested skill's body becomes `<root>/<group>/references/<topic>.md`, its frontmatter dropped.

Then fix what the move exposes:

- **Name drift.** Keep the name callers use: `git grep` both the directory name and the frontmatter name across instructions, skills and docs, keep the one they cite, and rename the other to match.
- **Paths into someone's home directory.** Never invent a replacement. If the file is in the repository, cite it by its repository path; if not, name the tool without a location and record the gap in the report.
- **Links and self-references** at depths that never existed, and references to sibling skills from an upstream collection the repository never had: fix or remove each.
- **Near-duplicates** (the inventory's Duplicated content rows): fold one into the other after checking that it really covers it.

Verify: `skill-placement`, `skill-name`, `links` and `citations` pass; `home-paths` is clean or each remaining hit is prose that quotes a wrong path on purpose.

## 6. One skills root

A nested `<component>/.claude/skills` or `<component>/.agents/skills` is enumerated only for a session started inside that component, so its skills exist for some sessions and not others. Hoist each into the canonical root:

```bash
git mv <component>/.claude/skills/<name> .agents/skills/<component>-<name>
```

- Give each a `paths:` glob for its component, so it still applies where it did.
- Rename into a namespace on the way in: `testing`, `build`, `swift` were unambiguous inside their component and are not in the shared root (`web-testing`, `swift-tdd`). Update the frontmatter `name` with the directory, and the references to the old name.
- Delete vendor duplicates (`.codex/skills/<name>` beside `.claude/skills/<name>`), keeping the better copy.

Verify: `one-root` and `skill-copies` pass; from the repository root, each agent lists the hoisted skills.

## 7. Drop the adapters no agent needs

For each agent in scope:

- It reads AGENTS.md and `.agents/` natively (measured): delete its copy (a `GEMINI.md` copy, `.cursorrules`, `.windsurfrules`, a `.codex/skills` pointer set).
- It needs a pointer: make it the thinnest one the agent supports: a stub with an import (`GEMINI.md` containing `@AGENTS.md`), a setting (`.gemini/settings.json` `{"context": {"fileName": "AGENTS.md"}}`), or a one-line file naming AGENTS.md.
- Nobody uses it: delete its files. Deleting the only file a teammate's agent reads is the risk, which is why step 2 of the SKILL.md asks.

Record each decision in the guard: `FORBIDDEN_FILES` and `FORBIDDEN_DIRS` for what is gone (a scaffold update that brings one back then fails CI), `STUB_FILES` for what stays as an adapter.

## 8. Subagents and commands become envelopes

A subagent file carries what a skill cannot: its own context window, a `tools:` restriction (read-only reviewers), a `model:`, and the dispatch `description:` the main agent reads. The procedure and every repository-specific fact belong in a skill, where every agent reads them.

```markdown
---
name: ci-doctor
description: Use when a CI run is red, cancelled or hung; returns the evidence line, the class of failure and the fix.
tools: Bash, Read, Grep, Glob
model: sonnet
skills:
  - resolve-ci-run
---

Investigate the run you are given with the resolve-ci-run skill and return its report.
```

- Move each agent's body into a skill (new or existing) and preload it with `skills:`; keep the body to a dozen lines saying what to return.
- Commands (`.claude/commands/*.md`, `.gemini/commands/*.toml`) are procedures too: a skill is invocable by name in Claude Code (`/<name>`) and readable by every other agent. A command only a person typed becomes one the model may invoke on its own; add `disable-model-invocation: true` to the skill's frontmatter where that matters (a deploy, a release).

Verify: `agent-skills` and `agent-envelope` pass; run each subagent once on a small task, and once with its `skills:` line removed as the negative control.

## 9. Everything outside skills

Walk every Claude-only mechanism and ask of each rule it carries: must another agent follow this too?

- **Permissions.** A deny list (`sudo`, global installs, `rm -rf`) is a rule for every agent: name each denied command in AGENTS.md, in backticks. The guard's `settings-deny` keeps the list and the prose equal.
- **Environment.** A value in `.claude/settings.json` `env` that matters to the work (a parallelism level, a feature flag) goes into AGENTS.md as an instruction an agent without the setting can follow: "Run the tests with `TEST_WORKERS=4`." `settings-env` keeps the two values equal.
- **Hooks.** A hook enforces a rule for Claude Code's edits only. Give each hook script a command-line mode (`--file <path>`, `--command <cmd>`) beside its stdin payload, and run it in CI over each pull request's changed lines, so an edit by any agent, editor or codemod is checked the same way. Other agents' hook systems (`.codex/config.toml`, Antigravity's `.agents/hooks.json`) can then call the same scripts; verify their payloads first.
- **MCP.** `.mcp.json` serves Claude Code; Codex, Cursor and VS Code each have their own file. Record which servers each agent gets, or write "Claude Code only, by design" in `.claude/rules/claude-code.md`.
- **Personal files.** `.claude/settings.local.json` and `CLAUDE.local.md` stay out of git: `git rm --cached <file>` and add it to `.gitignore`. The file stays on disk here, but a teammate's pull deletes their copy, so say so in the pull request; what it held (an allow rule, a note) is promoted to the shared settings only if the team decides to.

## 10. Size by chain

The guard's `chain` warning and the inventory's chain table give, for each component AGENTS.md, the size of the root file plus every file down to that directory: the prompt a Codex session started there receives, cut at 32 KiB from the end. Remedies, in order of preference:

1. Shed the component file into a `paths:`-scoped skill (loaded on demand, no cap, every agent reads it) and leave a pointer AGENTS.md of a few lines.
2. Shed the root file further.
3. Raise `project_doc_max_bytes` in a trusted repository's `.codex/config.toml`: Codex only, and other agents budget the same chain differently (runtimes.md § The size cap).

This is the user's decision; record it in the report, and leave the guard's `chain` rule as a warning until it is made.

## 11. Keep the guard running

Run the guard in enforce mode on pushes to the default branch as well as on pull requests: the invariant is whole-tree, and a merge can break it with no pull-request diff to review. In GitHub Actions:

```yaml
agent-config:
  name: Agent config layout
  runs-on: ubuntu-latest
  permissions:
    contents: read
  steps:
    - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1  # v7.0.1, or the pin your other workflows use
      with:
        submodules: false          # a submodule's agent config belongs to its own repository
        persist-credentials: false
    - run: python3 scripts/agents/test_check_agent_config.py
    - run: python3 scripts/agents/check_agent_config.py
```

On another CI system the job is the same two commands. With no CI at all, run the guard from a pre-commit hook (or the repository's task runner) and say in the report that nothing runs it on the server yet: a layout no check holds drifts back.
