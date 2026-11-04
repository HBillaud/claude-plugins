# The pull request description

A layout invariant does not show in a diff: a reviewer sees files moving, not whether every agent still loads every skill. The description is where the proof lives, so it carries the evidence, not a summary of it. Keep the prose in the present tense, say what the tree does now and why, and put a version on every measurement.

## Template

````markdown
<The end state in one sentence: one real skills tree at `.agents/skills`, `.claude/skills` a relative
symlink to it, AGENTS.md canonical, each CLAUDE.md a stub importing it.> No content exists twice.

Closes #<issue>

## What changed, by phase

| Commit | Phase | Change |
| --- | --- | --- |
| `<sha>` | 0 | The guard and its tests, in audit mode |
| `<sha>` | 1 | <n> skills moved to `.agents/skills`; `.claude/skills` a relative symlink (mode 120000) |
| … | … | … |

## Decisions

- **Agents served:** <list>, and the adapter each gets.
- **Where the real tree lives:** <location>, and why.
- **How Claude Code receives AGENTS.md:** <stubs, or its built-in reader>, and why.
- <Every choice made where the plan was silent or ambiguous, with the reason.>

## Verification, per phase

**Phase <n>: <the claim, e.g. "every agent sees the moved tree">**

```text
$ <command>
<the output lines that prove it>
```

## Drift: where measurement contradicted the plan or the documentation

| Expected | Observed | Version |
| --- | --- | --- |
| <what the plan, an issue thread or the docs said> | <what the probe showed> | <agent and version> |

## Discovered: problems nobody had listed

1. <The problem, where it is, and what was done about it.>

## Not done

- <Each open item: the chain-cap decision, an agent not verified, a follow-up issue with its link.>

## Revert

The phases revert cleanly in reverse order: to undo one, revert it and every phase after it, newest first.

| To undo | Revert |
| --- | --- |
| <phase> | `<sha>` |

## Final check

```text
python3 scripts/agents/test_check_agent_config.py   → All cases passed
python3 scripts/agents/check_agent_config.py        → OK
<one probe line per agent in scope, with its version>
```
````

## What makes the evidence convincing

- **Output, not adjectives.** `Loaded 34 unique skills (19 unconditional, 15 conditional, … project: 34)` says more than "all skills load".
- **A before and an after** for anything that changed what an agent sees: the count of skills listed from the repository root before and after the hoist.
- **The probe that could have failed.** A canary question asked with the file tools refused; the last sentence of the file, which truncation would remove.
- **Drift reported, not reconciled.** When a measurement contradicts the plan, the table says so and the work follows the measurement. A reviewer learns more from one drift row than from a page of agreement.
- **Discoveries kept.** Problems found along the way (a `.gitignore` hiding an instruction file, a scaffold's own AGENTS.md, a citation to a path that never existed) are the part of the work nobody asked for and everyone benefits from.
