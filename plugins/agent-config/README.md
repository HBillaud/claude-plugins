# agent-config

One skill, `canonical-agent-config`, that refactors a repository's coding-agent configuration into one canonical source with thin per-agent adapters: `AGENTS.md` holds the instructions and each `CLAUDE.md` is a relative symlink to it (or a stub importing it); `.agents/skills` holds the real skills and `.claude/skills` is a relative symlink to it; subagents are envelopes around skills; every rule a setting enforces is also stated where every agent reads it. Each step is checked by measuring what each agent actually loads, and a guard script keeps the layout in CI.

## Install

```text
/plugin marketplace add HBillaud/claude-plugins
/plugin install agent-config@hadrien-labs
```

## Use

Ask for what you need: "audit our agent config", "make our skills work in Codex too", "our CLAUDE.md is huge, clean it up", "move our generic skills into a shared plugin". The skill triggers on its own, or run `/agent-config:canonical-agent-config`.

It works through five steps: an inventory, the decisions that are yours to make (which agents you serve, how Claude Code receives AGENTS.md, whether to extract a shared plugin) with a probe of each agent in scope, a guard committed before anything moves, the migration as one commit per phase, and a pull request description that carries the evidence. An audit alone changes nothing in your repository.

## What is inside

| Path | What it is |
| --- | --- |
| `skills/canonical-agent-config/SKILL.md` | the method: end state, workflow, where each kind of content goes, the guard's rules, traps |
| `skills/canonical-agent-config/references/` | the eleven phases in detail, what each agent reads with measured versions and probes, shared-plugin extraction, the pull request template |
| `skills/canonical-agent-config/scripts/inventory.py` | read-only inventory of every agent file in a repository, with findings mapped to phases |
| `skills/canonical-agent-config/scripts/probe_fixture.py` | builds a throwaway repository full of canary tokens and prints the probe for each agent |
| `skills/canonical-agent-config/scripts/check_agent_config.py` | the guard, copied into your repository and run in CI; `--mode audit` lands it before the migration |
| `skills/canonical-agent-config/scripts/test_check_agent_config.py` | its hermetic test suite |
| `skills/canonical-agent-config/scripts/check_plugins_installed.py` | a SessionStart hook naming plugins a repository enables that a machine lacks |
| `evals/messy-repo-to-canonical/` | an end-to-end case: a scaffold builds a messy repository, the agent migrates it, nine graders check the result |

The scripts need Python 3.9 or later and git.

To re-run the end-to-end case after changing the skill (one full migration, about half an hour of agent time), from this directory:

```bash
claude plugin eval . --scaffold --ablation none --allow-tools Bash Write Edit
``` The skill follows the Agent Skills format, so its directory also works copied into a repository's `.agents/skills/` for agents other than Claude Code.

## Where it comes from

The method was distilled from a real migration of a large monorepo: 22 root skills; 26 nested ones, of which Claude Code could load 3, and those only in sessions started inside their component; nine component CLAUDE.md files; five skills roots; six subagents holding procedure; and an instruction file past the size Codex truncates at. Loader behaviour in `references/runtimes.md` was re-measured on Claude Code 2.1.308 and 2.1.309, Codex 0.154.0 and Gemini CLI 0.59.0, and the skill was then run end to end on a test repository by a model that had never seen the method.
