# devops

Four skills for engineering operations: taking a tracked issue from report to verified fix, planting and safely pruning git worktrees, and refactoring a repository's coding-agent configuration into one canonical source.

## Install

```text
/plugin marketplace add HBillaud/claude-plugins
/plugin install devops@hadrien-labs
```

## Use

| Skill | Ask for | What it does |
| --- | --- | --- |
| `resolve-issue` | "fix this issue", "find the root cause of this bug", `/devops:resolve-issue 123`, an issue URL or a pasted report | Treats the report as a claim to check, proves the root cause before any code changes, tests the issue's suggested fix against what the code must guarantee, and proves that the regression test can fail. When the evidence does not support a fix, it reports what is known and what would settle it instead of guessing |
| `plant-tree` | "work in a worktree", `/devops:plant-tree <task>` | Gives a task its own checkout under `.claude/worktrees/` on a fresh branch named to the repository's conventions, finishes the bootstrap `git worktree add` skips, and switches the session into it |
| `prune-trees` | "clean up the worktrees", `/devops:prune-trees <names to keep>` | Audits each worktree under `.claude/worktrees/` before deleting it, never deletes branches, and reports the disk reclaimed |
| `canonical-agent-config` | "audit our agent config", "make our skills work in Codex too", "our CLAUDE.md is huge, clean it up", `/devops:canonical-agent-config` | Refactors a repository's agent configuration into one canonical source with thin per-agent adapters, measures what each agent actually loads, and keeps the layout in CI with a guard script |

`resolve-issue` stops before committing unless you ask it to commit or open a pull request. A repository's own instructions override it on branch names, commands and pull request format.

`canonical-agent-config` works through five steps: an inventory, the decisions that are yours to make (which agents you serve, how Claude Code receives AGENTS.md, whether to extract a shared plugin) with a probe of each agent in scope, a guard committed before anything moves, the migration as one commit per phase, and a pull request description that carries the evidence. An audit alone changes nothing in your repository. Its end state: `AGENTS.md` holds the instructions and each `CLAUDE.md` is a relative symlink to it (or a stub importing it); `.agents/skills` holds the real skills and `.claude/skills` is a relative symlink to it; subagents are envelopes around skills; every rule a setting enforces is also stated where every agent reads it.

## What is inside

| Path | What it is |
| --- | --- |
| `skills/resolve-issue/SKILL.md` | the method: nine steps, with a gate on the root cause before any fix |
| `skills/resolve-issue/references/evidence-by-kind.md` | what to collect, how to reproduce and what proves the fix, for each kind of issue |
| `skills/plant-tree/SKILL.md` | creating a worktree: name, base ref, bootstrap, verification |
| `skills/prune-trees/SKILL.md` | deleting worktrees: keep-list, audit, removal, report |
| `skills/canonical-agent-config/SKILL.md` | the method: end state, workflow, where each kind of content goes, the guard's rules, traps |
| `skills/canonical-agent-config/references/` | the eleven phases in detail, what each agent reads with measured versions and probes, shared-plugin extraction, the pull request template |
| `skills/canonical-agent-config/scripts/inventory.py` | read-only inventory of every agent file in a repository, with findings mapped to phases |
| `skills/canonical-agent-config/scripts/probe_fixture.py` | builds a throwaway repository full of canary tokens and prints the probe for each agent |
| `skills/canonical-agent-config/scripts/check_agent_config.py` | the guard, copied into your repository and run in CI; `--mode audit` lands it before the migration |
| `skills/canonical-agent-config/scripts/test_check_agent_config.py` | its hermetic test suite |
| `skills/canonical-agent-config/scripts/check_plugins_installed.py` | a SessionStart hook naming plugins a repository enables that a machine lacks |
| `evals/misleading-suggested-fix/` | an end-to-end case for `resolve-issue`: a crash whose suggested fix would silently corrupt data, with an instruction planted in the issue and stored records a code fix cannot repair |
| `evals/messy-repo-to-canonical/` | an end-to-end case for `canonical-agent-config`: a scaffold builds a messy repository, the agent migrates it, nine graders check the result |

The `canonical-agent-config` scripts need Python 3.9 or later and git. The skill follows the Agent Skills format, so its directory also works copied into a repository's `.agents/skills/` for agents other than Claude Code.

To re-run a case after changing its skill, from this directory. Without `--case`, the command runs both, and `messy-repo-to-canonical` is one full migration, about half an hour of agent time.

```bash
claude plugin eval . --scaffold --ablation none --allow-tools Bash Write Edit --case misleading-suggested-fix
claude plugin eval . --scaffold --ablation none --allow-tools Bash Write Edit --case messy-repo-to-canonical
```

## Where it comes from

`resolve-issue` was distilled from resolving a real CI bug, where job selection failed on every push after a pull request was opened and fell back to running every job. The obvious fix would have removed the error and let required checks be skipped without any signal, which only came out by comparing a passing run with a failing one and testing each candidate fix. The steps are written for any kind of issue, and the eval uses a different kind on purpose.

`canonical-agent-config` was distilled from a real migration of a large monorepo: 22 root skills; 26 nested ones, of which Claude Code could load 3, and those only in sessions started inside their component; nine component CLAUDE.md files; five skills roots; six subagents holding procedure; and an instruction file past the size Codex truncates at. Loader behaviour in `references/runtimes.md` was re-measured on Claude Code 2.1.308 and 2.1.309, Codex 0.154.0 and Gemini CLI 0.59.0, and the skill was then run end to end on a test repository by a model that had never seen the method.
