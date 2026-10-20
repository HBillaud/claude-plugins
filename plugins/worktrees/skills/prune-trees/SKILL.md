---
name: prune-trees
description: Safely delete the current project's `.claude/worktrees/` checkouts, keeping only the ones named as arguments — audits each for uncommitted work, dirty submodules, stashes, and unpushed commits before removing anything, never deletes branches, then prunes git's stale bookkeeping and reports reclaimed disk. TRIGGER when the user asks to clean up / prune / remove agent worktrees, says "/worktrees:prune-trees" (or "/prune-trees"), or asks to reclaim the disk that worktrees are holding.
user-invocable: true
allowed-tools: Bash, Glob, Grep, Read
---

# Prune Agent Worktrees

Delete the throwaway worktrees under the invoking project's `.claude/worktrees/`, keeping only
the ones the user names. Agent worktrees each carry a full build tree, so a stale set routinely
holds tens of gigabytes — but they also carry the only copy of some work, so **every deletion is
gated behind an audit, not a hope**.

The contract: no uncommitted work, no dirty submodule, no stash, and no unrecoverable commit is
ever destroyed. Anything that fails the audit is skipped and reported, not forced.

## Scope

Operate **only** on worktrees whose path is inside `<repo-top-level>/.claude/worktrees/`.

Resolve the repo root with `git rev-parse --show-toplevel` from the invoking directory. Do not
touch anything else `git worktree list` prints — sibling checkouts (`../<repo>-<topic>`),
scratchpad worktrees under `/tmp` or `/private/tmp`, or the primary checkout are all out of scope
even when they look abandoned. If the user explicitly names one of those, confirm before removing it.

If `.claude/worktrees/` does not exist or is empty, say so and stop.

## Behavior

### 1. Resolve the keep-list

`$ARGUMENTS` names the worktrees to **keep** (by directory name, matched case-insensitively; accept
a bare name, a path, or a comma/space-separated list).

- No arguments: enumerate the worktrees with their branch, HEAD, and size, then **ask** which to
  keep. Never assume "keep none".
- An argument matching nothing: stop and report the mismatch rather than deleting a superset of
  what the user meant.

### 2. Enumerate

```bash
git worktree list
ls -la "$(git rev-parse --show-toplevel)/.claude/worktrees/"
du -sh "$(git rev-parse --show-toplevel)"/.claude/worktrees/*
du -sh "$(git rev-parse --show-toplevel)/.claude/worktrees"
```

Record the pre-removal total — it is the baseline for the reclaimed-disk figure. Note which entries
`git worktree list` marks `prunable` (their directory is already gone; they need only bookkeeping).

### 3. Audit every removal candidate

Run all of these. A candidate is removable only when all five pass.

```bash
d=.claude/worktrees/<name>
git -C "$d" status --porcelain                                   # must be empty
git -C "$d" symbolic-ref --short -q HEAD || echo '(detached)'
git -C "$d" rev-parse --abbrev-ref --symbolic-full-name '@{u}'   # upstream, if any
base=$(git symbolic-ref --short -q refs/remotes/origin/HEAD) ||    # remote default branch
  for b in origin/main origin/master; do git rev-parse -q --verify "$b" >/dev/null && base=$b && break; done
git -C "$d" log --oneline "$base"..HEAD                          # commits not in the default branch
git -C "$d" submodule foreach --quiet \
  'echo "-- $sm_path @ $(git rev-parse --short HEAD)"; git status --porcelain; git stash list'
git -C "$d" stash list
```

1. **Working tree clean** — `status --porcelain` empty.
2. **Submodules clean** — no modifications, no stashes in any submodule.
3. **No stashes** in the worktree itself.
4. **Commits are recoverable.** For an attached branch, compare against its remote:
   ```bash
   git rev-list --left-right --count "<branch>...origin/<branch>"
   ```
   `0  0` means fully pushed. A branch that is ahead, or has no remote branch at all, is still
   **safe to remove** — removing a worktree does not delete its branch — but say so explicitly in
   the report so the user knows the local branch is the only copy.
5. **Detached HEAD is contained somewhere.** This is the one case that can truly orphan commits:
   ```bash
   git branch -a --contains <sha>
   ```
   If some other ref (ideally a remote one) contains the commit, it survives. If **nothing** does,
   do not remove it — report it and offer to branch the commit first.

Fetching is optional and read-only; if remote-tracking refs look stale, `git fetch --quiet origin`
before step 4 so the ahead/behind counts mean something.

### 4. State the verdict before deleting

Summarize what will be removed, what will be kept, and every audit fact that matters (unpushed
branches, detached HEADs and what contains them, anything skipped). Then proceed — the invocation
is the authorization. Only stop for confirmation when a candidate **fails** the audit and the user
would have to choose between losing work and keeping the worktree.

### 5. Remove

Try git's own removal first:

```bash
git worktree remove .claude/worktrees/<name>
```

**Expect this to fail on any repo with submodules** — git refuses with
`fatal: working trees containing submodules cannot be moved or removed`. That refusal is a blanket
structural rule, not a signal that this particular worktree is unsafe; the audit in step 3 is what
establishes safety. So for those, remove the directory directly and let git reconcile:

```bash
rm -rf .claude/worktrees/<name>
```

Never pass `--force` to `git worktree remove` to get around a dirty tree — a dirty tree means the
audit failed, and the answer is to skip it.

### 6. Prune bookkeeping and verify

```bash
git worktree prune -v
git worktree list
ls -la "$(git rev-parse --show-toplevel)/.claude/worktrees/"
du -sh "$(git rev-parse --show-toplevel)/.claude/worktrees"
```

`prune -v` also clears unrelated stale registrations (worktrees whose directories vanished with an
earlier session). That is expected and harmless — mention it in one line rather than presenting it
as part of the requested deletion.

Then confirm the branches outlived their checkouts:

```bash
git rev-parse --short -q <branch>   # for each removed worktree's branch
```

### 7. Report

- A table of what was removed: worktree, branch or detached SHA, size.
- Reclaimed disk as `before → after`.
- The audit facts that carry forward: any branch whose only copy is now local (name it, and suggest
  pushing), any detached commit's containing branch, anything skipped and why.
- Confirmation that all branches still exist and only the checkouts are gone.
- Any surprising repo-state change noticed in passing (e.g. the primary checkout sitting on a
  different branch than expected, a concurrent session's worktree) — one line, flagged as
  *not* something this run did.

## Notes

- **Never delete branches.** The ask is about checkouts and disk. Removing a worktree leaves its
  branch, its commits, and its reflog intact; deleting the branch is a separate, destructive act
  that requires its own explicit request.
- Do not run builds, tests, or formatters here — this skill only inspects and deletes.
- The size figures come from `du`, so they include build trees and other ignored files. That bulk is
  exactly what makes pruning worthwhile, and also why `git worktree remove` alone would not reclaim
  it if the directory were left behind.
