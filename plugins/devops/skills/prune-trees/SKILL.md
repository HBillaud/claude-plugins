---
name: prune-trees
description: Safely delete the current project's `.claude/worktrees/` checkouts with a script that fails closed. With no arguments it only shows the audit; `--keep`, `--only` and `--merged` choose what goes. Blocks on uncommitted work, ignored files found nowhere else, commits only a submodule holds, detached commits, locks, running processes and unverifiable state. Never deletes branches, and reports reclaimed disk. TRIGGER when the user asks to clean up / prune / remove agent worktrees, says "/devops:prune-trees" (or "/prune-trees"), or asks to reclaim the disk that worktrees are holding.
user-invocable: true
allowed-tools: Bash, Glob, Grep, Read
---

# Prune Agent Worktrees

Delete the throwaway worktrees under the repository's `.claude/worktrees/`. Agent worktrees each carry
a full build tree, so a stale set routinely holds tens of gigabytes, but they can also carry the only
copy of some work.

The contract: `scripts/prune_worktrees.py` decides what is safe, and anything it blocks stays on disk
and gets reported. Do not audit by hand, and do not delete anything the script did not delete. A check
that could not run counts as a failed check, because a failed git command prints nothing, which looks
exactly like a clean tree.

`<skill-dir>` below is the directory this SKILL.md is in.

## Scope

Only direct children of `<primary-checkout>/.claude/worktrees/`. The script finds the primary checkout
itself, so it works from inside a worktree too. Sibling checkouts (`../<repo>-<topic>`), worktrees under
`/tmp`, and the primary checkout are out of scope even when they look abandoned. If the user explicitly
names one of those, confirm before removing it.

## Behavior

### 1. Read the selection

| `$ARGUMENTS` | Selects | Then |
| --- | --- | --- |
| nothing | nothing | Show the audit and ask what to remove. Stop there |
| `--keep a b` | every worktree except these | Remove |
| `--only a b` | just these | Remove |
| `--merged` (optionally with `--keep a`) | worktrees whose work is merged | Remove |
| bare names (`/devops:prune-trees foo`) | nothing | Show the audit and ask whether they mean keep or only. Do not guess: the two readings delete opposite sets |

Translate a plain request the same way: "clean up everything except foo" is `--keep foo`, "remove foo" is
`--only foo`, "remove the merged ones" is `--merged`. If the request does not say, it is the first row.

### 2. Audit

Refresh remote-tracking refs first, so "merged" and "ahead" mean something, then audit. This step changes
nothing else:

```bash
git fetch --quiet origin
python3 <skill-dir>/scripts/prune_worktrees.py audit [--keep ... | --only ... | --merged]
```

`audit` exits 0 whatever it finds, so read its output for blockers. Exit 2 means nothing can safely be done,
such as an unknown name, no repository, or git older than 2.31. Report it and stop.

### 3. State the verdict

Say what will be removed, what stays, and why, before removing anything. The invocation authorizes the
removal of what passes, so proceed without asking unless step 4 applies.

### 4. Handle what the audit blocks

Never work around a blocker: no `--force`, no `git worktree unlock`, no `rm -rf`. Report it, and say what
would clear it:

| Blocker | What it means | What clears it |
| --- | --- | --- |
| `dirty` | Uncommitted or untracked files. A symlink from `worktree.symlinkDirectories` shows up here when the ignore rule has a trailing slash (`node_modules/`), which does not match a symlink | Commit or discard them. Do not commit such a symlink: deleting the link loses nothing, and dropping the slash from the rule stops it for good |
| `hidden-changes` | Files flagged skip-worktree or assume-unchanged, whose edits neither `git status` nor `git worktree remove` can see | Save them, or clear the flag with `git update-index --no-skip-worktree` or `--no-assume-unchanged` so the audit can check them |
| `changed` | The worktree's HEAD moved while this run was removing, so something is working in it | Run the audit again |
| `ignored-files` | Ignored files, like `.env.local`, found nowhere else | Save them, or see below |
| `locked` | Claude Code locks a running agent's worktree, so something may be using it. `-p` runs leave their lock until a later session's sweep | Wait for the agent or the sweep. If the user set the lock, `git worktree unlock` is theirs to run |
| `in-use`, `current-directory` | A process, or this session, is running inside it | Stop it, or leave the worktree first |
| `orphan-commits` | Detached commits that nothing else contains | Offer to branch them |
| `reflog-only-commits` | Commits only this worktree's HEAD reflog still reaches, like a detached commit left behind by a checkout. The removal deletes that reflog | Offer to branch them. If the user says they are abandoned, `git -C <worktree> reflog expire --expire=now HEAD` releases them |
| `submodule-commits`, `submodule-dirty`, `submodule-stash`, `submodule-ignored` | Work in a submodule, whose git directory is deleted with the worktree | Push it, or tell the user it will be lost |
| `in-progress` | An unfinished merge, rebase or similar | Finish or abort it |
| `contains-worktree` | Another worktree is nested inside | Deal with the inner one first |
| `not-registered` | Git does not know the directory | Inspect it with the user |
| `could-not-verify` | A git command failed | Report the error |

**Ignored files** are the one blocker the user can release. Show them the list, and only after they agree
that those files may be lost, add `--accept-ignored <name>` for that worktree. Do not offer this for a
file that looks like a credential without saying so.

### 5. Remove

```bash
python3 <skill-dir>/scripts/prune_worktrees.py remove [--keep ... | --only ... | --merged] [--accept-ignored ...]
```

It audits each candidate again immediately before deleting it, uses `git worktree remove` without
`--force`, falls back to deleting the directory only for git's blanket refusal on worktrees with
submodules, prunes git's bookkeeping, and confirms each branch still exists. Exit 1 means something was
blocked or failed, and the rest was still removed.

`git worktree prune` also clears registrations left by earlier sessions. That is expected, so mention it
in one line rather than presenting it as part of the requested deletion.

### 6. Report

- A table of what was removed: worktree, branch or detached SHA, size.
- Reclaimed disk as `before -> after`.
- What was blocked, why, and what would clear it.
- Any branch whose only copy is now local: name it and suggest pushing.
- Confirmation that the branches still exist and only the checkouts are gone.
- Anything surprising noticed in passing, like a concurrent session's worktree, flagged as *not* something
  this run did.

## Notes

- **Never delete branches.** Removing a worktree leaves its branch, commits and reflog intact. Deleting a
  branch is a separate, destructive act that needs its own explicit request.
- **Stashes do not block.** They belong to the whole repository and survive a removal, so the script only
  notes the ones made on the worktree's branch. Submodule stashes are the exception.
- **`--merged` stays on the safe side.** It skips a worktree that never had a commit, because being
  contained in the default branch is not the same as being finished. It finds squash merges through `gh`,
  matching the pull request's head SHA, so a commit added after the merge keeps the worktree. Without `gh`
  those stay as `unmerged`.
- Do not run builds, tests or formatters here. This skill only inspects and deletes.
- The size figures come from `du`, so they include build trees and other ignored files.
- `scripts/test_prune_worktrees.py` is the script's test suite, run with `python3`.
