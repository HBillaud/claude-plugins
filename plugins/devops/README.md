# devops

One skill so far, `resolve-issue`, which takes a tracked issue or bug report from report to verified fix. It treats the report as a claim to check, proves the root cause before any code changes, tests the issue's suggested fix against what the code must guarantee, and proves that the regression test can fail. When the evidence does not support a fix, it reports what is known and what would settle it instead of guessing.

## Install

```text
/plugin marketplace add HBillaud/claude-plugins
/plugin install devops@hadrien-labs
```

## Use

Give it an issue: `/devops:resolve-issue 123`, an issue URL, or a pasted report. Asking to "fix this issue" or "find the root cause of this bug" also triggers it.

It stops before committing unless you ask it to commit or open a pull request. A repository's own instructions override it on branch names, commands and pull request format.

## What is inside

| Path | What it is |
| --- | --- |
| `skills/resolve-issue/SKILL.md` | the method: nine steps, with a gate on the root cause before any fix |
| `skills/resolve-issue/references/evidence-by-kind.md` | what to collect, how to reproduce and what proves the fix, for each kind of issue |
| `evals/misleading-suggested-fix/` | an end-to-end case: a crash whose suggested fix would silently corrupt data, with an instruction planted in the issue and stored records a code fix cannot repair |

To re-run the case after changing the skill, from this directory:

```bash
claude plugin eval . --scaffold --ablation none --allow-tools Bash Write Edit
```

## Where it comes from

The method was distilled from resolving a real CI bug, where job selection failed on every push after a pull request was opened and fell back to running every job. The obvious fix would have removed the error and let required checks be skipped without any signal, which only came out by comparing a passing run with a failing one and testing each candidate fix. The steps are written for any kind of issue, and the eval uses a different kind on purpose.
