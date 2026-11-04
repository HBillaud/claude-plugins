---
name: canonical-agent-config
description: Refactor a repository's coding-agent configuration (CLAUDE.md, AGENTS.md, GEMINI.md, .cursorrules, Copilot instructions, skills, subagents, rules, hooks, settings) into one canonical source with thin per-agent adapters, verified by measuring what each agent loads and held by a CI guard. Use it to audit agent config; to merge duplicated or drifting instruction files; when a skill loads in one agent but not another (Claude Code, Codex, Cursor, Copilot, Gemini, Antigravity); when nested or component skills don't show up; when CLAUDE.md or AGENTS.md is too big or gets truncated; when subagent files hold procedure; or when generic skills are copied across repositories and belong in a shared plugin. Also for "clean up our agent setup", "make our skills work in Codex too" or "set up AGENTS.md", even when only one of these files is named.
---

# Canonical agent config

Every coding agent looks in its own place. Claude Code reads `CLAUDE.md` and `.claude/`; Codex and Antigravity read `AGENTS.md` and `.agents/`; most other agents read `AGENTS.md`; Gemini CLI reads `GEMINI.md`; Cursor and Copilot have rule directories of their own. A repository that serves several of them drifts into copies, and copies rot unnoticed, because every copy still reads as plausible.

This skill refactors that into one canonical source with thin adapters:

- **Every fact lives in one file.** An adapter points at it (a symlink, a one-line import, a setting) and never restates it.
- **What an agent loads is measured, not assumed.** Loader behaviour changes between releases and differs between agents, and documentation, issue threads and memory go stale. Probe the installed versions and record them.
- **A guard script holds the layout in CI**, because none of it shows in a diff: a symlink a merge turned back into a directory, a skill renamed in its frontmatter but not on disk, an AGENTS.md a `.gitignore` swallows, a file grown past the size an agent truncates at.

It serves the whole migration or any part of it: an audit, a one-agent cleanup, a monorepo with per-component files, or moving generic skills into a shared plugin. `<skill-dir>` below is the directory this SKILL.md is in. An audit changes nothing in the repository: run the inventory, then the guard from here,

```bash
python3 <skill-dir>/scripts/check_agent_config.py --root <repo> --mode audit
```

and report what both say.

## The end state

```text
AGENTS.md                              canonical instructions, a real file, under 32 KiB
CLAUDE.md -> AGENTS.md                 relative symlink (or a stub "@AGENTS.md": decision 2)
.agents/skills/<name>/SKILL.md         the one real skills tree, one level deep
.claude/skills -> ../.agents/skills    relative symlink, git mode 120000
.claude/rules/<topic>.md               Claude Code-only machinery; path-scoped rules
.claude/agents/<name>.md               envelope: tools, model, `skills:` preload
.claude/settings.json                  hooks, permissions, env; each rule also stated in AGENTS.md
<component>/AGENTS.md                  component instructions, kept short (the chain cap)
<component>/CLAUDE.md -> AGENTS.md     the same adapter as the root's
scripts/agents/check_agent_config.py   the guard, on every push and pull request
```

The real tree sits in the neutral `.agents/skills` and the vendor path is the link, not the reverse. Both directions work today (Codex 0.154.0, Claude Code 2.1.309), but this way the layout does not depend on any one vendor continuing to follow symlinks: the dependency runs from each adapter to the neutral tree. A Claude Code-only repository may keep `.claude/skills` real and skip the link; the guard is configured either way.

## Workflow

### 1. Inventory, read only

```bash
python3 <skill-dir>/scripts/inventory.py --root <repo>          # Markdown report
python3 <skill-dir>/scripts/inventory.py --root <repo> --json   # the same, as data
```

It lists every instruction file, skills root, skill, subagent, command, and settings, hook or MCP file, with sizes, frontmatter, symlinks, files git ignores, near-duplicate content, AGENTS.md chain sizes, and the local skills an installed plugin already provides. Its Findings table maps each finding to the phase that fixes it. It takes about a second on a large monorepo.

Tell the user what you found in a few lines: the counts, the copies, the invisible skills, the oversize files, the agents whose files are present.

### 2. Decide, measuring before you settle

Most of the layout follows from the principle. Three decisions are the user's; ask them together, with the inventory's numbers in the question, and decide the rest yourself, stating each in a line the user can veto.

1. **Which agents the repository serves.** Ask rather than infer it from the files present: a stale `.cursorrules` does not mean anyone runs Cursor, and deleting the only file a teammate's agent reads breaks their setup. The answer sets the adapters (runtimes.md § Summary).

   Then measure what those agents actually load, on the versions the team runs: `python3 <skill-dir>/scripts/probe_fixture.py <new-dir>` builds a throwaway repository full of canary tokens and prints the probe for each agent, and [references/runtimes.md](references/runtimes.md) has the results measured so far. The inventory says what is on disk, a probe says what an agent sees, and the two differ exactly where the defects are: a skill nested where no loader looks, an import that does not expand in a subdirectory session, the end of a file cut off at 32 KiB.

2. **How Claude Code receives AGENTS.md.** Claude Code reads CLAUDE.md, so each AGENTS.md needs a CLAUDE.md beside it, in one of three forms (measured on Claude Code 2.1.309, runtimes.md § Claude Code):
   - **A relative symlink, `CLAUDE.md -> AGENTS.md`.** Every session gets every AGENTS.md from the root down to its directory, including a session started inside a component. It needs symlinks in every checkout, which the `.claude/skills` link already requires. Recommend it.
   - **A stub holding `@AGENTS.md`.** It works where symlinks are unwelcome, but a session started inside a component gets that component's file and not the root's: Claude Code treats the root stub's import as an external include there and does not expand it without an approval, and a headless run never does. A developer can close the gap for themselves with the built-in reader's `instructionFiles` option in their user settings; a repository cannot set it.
   - **No CLAUDE.md at all.** Claude Code's built-in reader then loads the AGENTS.md chain itself, but only while no CLAUDE.md, `.claude/CLAUDE.md` or `CLAUDE.local.md` exists in any directory above the session, one developer's personal file included. Choose it only after measuring it on every machine.
3. **Whether to extract a shared plugin**, only when the user maintains several repositories that carry copies of the same generic skills: [references/shared-plugin.md](references/shared-plugin.md).

### 3. Land the guard first

Copy `scripts/check_agent_config.py` and `scripts/test_check_agent_config.py` into the repository (`scripts/agents/` is a good home), format them with the repository's formatter if it has one, set the CONFIGURATION block at the top of the guard to the decisions, and run both on the unmigrated tree:

```bash
python3 scripts/agents/test_check_agent_config.py          # hermetic, a few seconds; independent of the CONFIGURATION block
python3 scripts/agents/check_agent_config.py --mode audit
```

Audit mode fails only on what is broken in any layout (a SKILL.md with no description, two skills answering to one name, a dangling symlink in the agent configuration, an AGENTS.md git ignores or that imports itself, a subagent preloading a skill that does not exist) and prints every other violation as a warning. The warnings are the migration's to-do list, and they shrink phase by phase. Commit the guard alone, before anything moves, so every later commit is checked against it, and add its CI job in audit mode now if the repository has CI.

### 4. Migrate, one phase per commit

Work on a fresh branch. Each phase is one commit (phase 2 is two: the rename, then the rest) that leaves the tree working and is verified by the guard and by a probe of each agent in scope; the phases revert cleanly in reverse order. Confirm once, before the first commit, that the user wants commits made. Run the phases that apply, in this order, and say which you skipped and why. Steps, commands and traps for each: [references/phases.md](references/phases.md).

| # | Phase | Exit gate |
| --- | --- | --- |
| 1 | Move the real skills tree to the canonical root; link each vendor root to it | Claude Code lists the same skills as before, and each agent that reads `.agents/skills` now lists them; git records the link as mode 120000 |
| 2 | Make AGENTS.md canonical: fold every instruction copy into it, shedding as you go (catalogs first); the CLAUDE.md adapter replaces CLAUDE.md; Claude Code-only material moves to `.claude/rules/` | each agent quotes the last sentence of AGENTS.md from context; the file is under 32 KiB |
| 3 | Scope skills that concern some files only with `paths:` | a session that reads a matching file activates the skill |
| 4 | Convert component instruction files the same way | every component AGENTS.md has its adapter; no `.gitignore` matches one |
| 5 | Lift skills nested below `<root>/<name>/`: promote the independent ones, merge the rest into one skill with `references/`; fix name drift, broken links, home-directory paths | no `skill-placement`, `skill-name`, `links` or `citations` warning |
| 6 | Hoist every other skills root into the canonical one, `paths:`-scoped, under namespace-safe names | one root; the hoisted skills listed from the repository root |
| 7 | Delete the copies and adapters no agent in scope needs | no `forbidden` or `stubs` warning |
| 8 | Turn subagents and commands into envelopes around skills | every subagent preloads a skill and keeps a short body |
| 9 | State in AGENTS.md every rule another agent must follow from the permissions, env, hooks and MCP | no `settings-deny` or `settings-env` warning |
| 10 | Check each AGENTS.md chain against the cap; decide, with the user, the remedy for each one over it | the `chain` warning resolved, or recorded as a decision |
| 11 | Run the guard in enforce mode on every push and pull request, or in a pre-commit hook where there is no CI | it runs automatically somewhere, or the report says that nothing does yet |

### 5. Report

Write the pull request description from [references/report-template.md](references/report-template.md): the phases with their commits, the decisions and why, the evidence for each phase (the command and the lines of output that prove it), what measurement contradicted in the plan or the documentation, what turned up that nobody had listed, and how to revert. A reviewer cannot see a layout invariant in a diff, so the evidence is the review.

## Where each kind of content goes

| Content | Home | Read by |
| --- | --- | --- |
| A rule every agent follows here: build and test commands, the map of the code, conventions, prohibitions | `AGENTS.md`, at the root or in the component | every agent, every session |
| A procedure or body of knowledge needed for some tasks only | a skill in the canonical root; `paths:` when it concerns certain files | every agent with skills, on demand |
| One agent's machinery: how its hooks are wired, its MCP notes, its plugins | that agent's own file, such as `.claude/rules/claude-code.md` | that agent, by design |
| A rule for certain files, for Claude Code | `.claude/rules/<topic>.md` with `paths:` | Claude Code, when a matching file is touched |
| A rule a hook or a setting enforces | the mechanism, plus one sentence in AGENTS.md naming it; the guard keeps them equal | every agent (the sentence), one (the mechanism) |
| A subagent's separate context, tools and model | `.claude/agents/<name>.md`, an envelope preloading the skill that holds the procedure | Claude Code |
| Generic craft several repositories share | a shared plugin, never a copy per repository | each repository that enables it |
| The list of available skills | nowhere: every loader injects the roster | |
| History: what changed, when, after which incident | the git log | |

## Shed, don't move

AGENTS.md is paid for on every turn of every session, and Codex drops whatever lies past 32 KiB without a word. A file gets smaller by removing what does not need to be resident, not by moving text from one always-loaded file to another:

1. Delete hand-kept catalogs of skills and agents: the loader lists them, and the copy drifts.
2. Delete what a tool already enforces and states (formatter options, lint rules), keeping one line that names the tool.
3. Delete history, dates and incident stories; keep each rule and its reason, in the present tense.
4. Move multi-step procedures into skills, which load on demand and have no cap.
5. Move one agent's machinery into that agent's own file.
6. Move one component's material into that component's AGENTS.md, or into a `paths:`-scoped skill when the component's chain is near the cap.

What stays is what a session needs on every turn, plus a short paragraph saying where agent configuration lives and that the guard checks it, so the next contributor puts things in the right place. Once the file is under the cap, stop: a shorter file that drops knowledge a session needs is a worse file.

## What the guard enforces

| Rule | Why |
| --- | --- |
| `skill-fields`, `skill-unique` (fail in audit too) | a skill without a name and a description is one no loader can route to; two skills answering to one name shadow each other |
| `skill-name` | the Agent Skills spec requires the frontmatter name to equal the directory name; otherwise one skill answers to two names |
| `skill-grammar`, `skill-description` | the spec's limits: lowercase-hyphenated names up to 64 characters, descriptions up to 1024 |
| `skill-copies` | one skill kept in two places drifts |
| `skill-placement` | Claude Code and Gemini CLI load `<root>/<name>/SKILL.md` and nothing deeper |
| `one-root` | a nested skills root exists only for sessions started inside it |
| `root-links` | an absolute link resolves in one checkout only; a link a merge turned into a directory is a second copy |
| `symlinks` (fails in audit too) | a dangling or escaping link in the agent configuration is a file that silently does not exist; links elsewhere are not the guard's business |
| `ignored` (fails in audit too when the file exists) | an instruction file git ignores is written once and never shared |
| `stubs` | AGENTS.md is a real file, and each CLAUDE.md beside it is a relative symlink to it or a stub importing it; an AGENTS.md that imports itself fails in audit too, because a stub written through a link has erased the instructions |
| `forbidden` | an instruction copy or adapter the repository decided against, brought back by a scaffold or a teammate |
| `agent-skills` (fails in audit too), `agent-envelope` | procedure kept in a subagent file is invisible to every other agent |
| `citations`, `links` | moves break paths, and a broken path in an instruction is an instruction that fails |
| `settings` (fails in audit too), `settings-env`, `settings-deny` | a rule one agent enforces mechanically reaches the others only as prose, and the two must agree |
| `size`, `chain` (a warning only) | Codex truncates at 32 KiB, silently, on the concatenated chain, cutting the most specific file first |
| `home-paths` (a warning only), `personal-files` | `/Users/<someone>/` works on one machine; personal settings do not belong in everyone's checkout |

Exclusions (git submodules, ignored paths, `node_modules`, linked worktrees, anything configured) are printed on every run: a silent exemption rots, a printed one gets noticed.

## Traps

- **Writing through a link erases the file it points at.** When AGENTS.md is a symlink to CLAUDE.md, a common starting point, writing the stub into CLAUDE.md overwrites the instructions. Find links before phase 2 (`find . -name AGENTS.md -type l -o -name CLAUDE.md -type l`), `git rm` the link, then `git mv`. The guard fails, in both modes, on an AGENTS.md that imports itself.
- **A rename and an edit in one commit lose the history.** `git mv CLAUDE.md AGENTS.md` followed by a new CLAUDE.md in the same commit reads to git as an edit and an addition, so `git log --follow AGENTS.md` stops there. Commit the rename alone first.
- **Loader facts go stale.** An issue thread said Codex did not follow a symlinked skills root; measured on the installed release, it did. Measured on Claude Code 2.1.309, a root stub's import does not expand in a session started inside a component, which a verification run only from the repository root never shows. Probe from the root and from a component, and record versions.
- **A probe that prints nothing proves nothing.** `claude --debug` writes nothing to the terminal (use `--debug-file`), and `timeout` does not exist on stock macOS, so a pipeline wrapped in it fails whole and every grep after it reports "not found". Check exit statuses; make each probe able to answer yes.
- **Ask from context, not from disk.** "Quote the last sentence of your instructions" proves the file was loaded only if the agent cannot read it with a tool: refuse the file tools for that probe.
- **Gemini CLI looks for project skills only in the session's own directory** (`<cwd>/.agents/skills`, one level deep). A session started in a subdirectory finds none of the root's skills, so teams on Gemini start sessions at the root.
- **Scaffolds write their own agent files.** A generator may already have put an AGENTS.md, a CLAUDE.md, a GEMINI.md or `.codex/` pointers in a component: `git mv CLAUDE.md AGENTS.md` then fails or clobbers the upstream file, and the next scaffold update can bring a deleted file back (the guard fails on it).
- **The links may be the repository's first tracked symlinks.** A Windows clone without `core.symlinks=true` checks them out as text files holding the target path; `root-links` and `stubs` catch it, but warn Windows users before the move.
- **The guard's own test fixtures look like citations.** Assemble skill paths from parts in fixtures, as the bundled tests do, or list the file in `CITATION_EXEMPT`, which is printed; never a silent carve-out in a regular expression.
- **Generic names collide when hoisted into one root.** `testing`, `swift`, `build-plugin` were unambiguous inside their components; in the shared root they take a namespace (`web-testing`, `swift-tdd`, `grafana-plugin-build`).
- **Linked worktrees on older branches keep the old layout.** Leave them alone; the guard skips `.claude/worktrees`.
- **A merge can break the layout with no pull-request diff to review.** Run the guard on pushes to the default branch, not only on pull requests.

## Files

| File | Read or run it when |
| --- | --- |
| [references/phases.md](references/phases.md) | executing the migration: steps, commands, exit gates and traps for each phase |
| [references/runtimes.md](references/runtimes.md) | choosing adapters or probing an agent: where each agent reads, measured behaviour with versions, probe commands |
| [references/shared-plugin.md](references/shared-plugin.md) | moving generic skills that several repositories share into a plugin |
| [references/report-template.md](references/report-template.md) | writing the pull request description |
| `scripts/inventory.py` | step 1, and after each phase to watch the findings shrink |
| `scripts/probe_fixture.py` | step 2, and whenever an agent's loader behaviour is in doubt |
| `scripts/check_agent_config.py`, `scripts/test_check_agent_config.py` | step 3: copied into the repository, configured, run in CI |
| `scripts/check_plugins_installed.py` | the shared-plugin step: a SessionStart hook naming plugins a machine lacks |

The scripts need Python 3.9 or later and git, nothing else.
