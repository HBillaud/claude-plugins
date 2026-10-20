---
name: plant-tree
description: Create an isolated git worktree for the current task under the invoking project's `.claude/worktrees/`, on a fresh branch named to the repo's conventions, then finish the bootstrap `git worktree add` skips (submodules, untracked local config) and switch the session into it. TRIGGER when the user asks to work in / start / spin up a worktree, says "/worktrees:plant-tree" (or "/plant-tree"), or wants a task isolated from the primary checkout.
user-invocable: true
allowed-tools: Bash, Glob, Grep, Read, EnterWorktree
---

# Plant an Agent Worktree

Give the current task its own checkout under `<repo-top-level>/.claude/worktrees/<name>`, so the
primary checkout stays on its own branch and its own build state. The worktree is throwaway; the
branch it carries is not.

The counterpart is `/worktrees:prune-trees`, which deletes these later. Everything here is written so that
audit can succeed: one worktree per task, inside the conventional directory, on a real branch.

## Scope

**Always** `<repo-top-level>/.claude/worktrees/<name>`, resolved with
`git rev-parse --show-toplevel` from the invoking directory — never a sibling checkout
(`../<repo>-<topic>`), never `/tmp`, never a path relative to wherever the session happens to be
`cd`'d. If the user explicitly names a location outside that directory, use it, but say plainly
that `/worktrees:prune-trees` will not manage it.

If the invoking directory is not a git repository, stop and say so.

## Behavior

### 1. Name the worktree and the branch

`$ARGUMENTS`, when present, is the task description or an explicit name.

- **Worktree directory name**: a short kebab-case slug of the task (`add-login-retry`,
  `fix-cache-eviction`). No prefix — the directory is not the branch.
- **Branch name**: follow the repo's own convention, discovered rather than assumed:
  ```bash
  git branch -a --sort=-committerdate | head -30
  ```
  Many repos use `feature/`, `fix/`, `refactor/` + the same slug. Check CLAUDE.md for a stated
  rule and prefer it over what the branch list suggests.
- Refuse to reuse a name that already exists in `.claude/worktrees/` or an existing branch name —
  pick a distinct slug and say why.

With no arguments, derive the slug from the task already in flight. Only ask the user when there is
no such task to name.

### 2. Choose the base ref deliberately

Default: branch from the **remote default branch** (`origin/main`, `origin/master`, …), not from
local HEAD. Stacking a task branch on whatever the primary checkout happens to be sitting on is how
unrelated work ends up inside a PR.

Resolve it rather than assuming `main` — `<base>` below means this ref:

```bash
git fetch --quiet origin
base=$(git symbolic-ref --short -q refs/remotes/origin/HEAD) ||
  for b in origin/main origin/master; do git rev-parse -q --verify "$b" >/dev/null && base=$b && break; done
echo "$base"; git rev-parse --short "$base"
```

If the remote is not named `origin`, substitute its name (`git remote`). If the repo has no remote
at all, or none of these resolve, branch from the local default branch and say so in the report.

Branch from local HEAD only when the user asks for it, or when the work genuinely depends on
unmerged commits — and then say so in the report, because the eventual PR will contain them.

### 3. Create it

**Preferred — `EnterWorktree`.** It creates the worktree under `.claude/worktrees/` and switches the
session into it in one step, and its default base ref is `origin/<default-branch>`, which matches
step 2:

```text
EnterWorktree(name: "<slug>")
```

Use the raw git path instead when `EnterWorktree` does not fit: the session is already inside a
worktree, the branch name must differ from the directory name, the base ref is not the remote
default, or the user wants the worktree created **without** moving the session into it.

```bash
top=$(git rev-parse --show-toplevel)
git -C "$top" worktree add -b <branch> "$top/.claude/worktrees/<slug>" <base>
```

To then work in it, either pass the path to `EnterWorktree`, or use `git -C <dir>` / absolute paths
for every subsequent command. Do not `cd` and hope the session follows.

### 4. Finish the bootstrap git leaves undone

`git worktree add` gives you tracked files on a branch and nothing else. Complete it:

1. **Submodules — `git worktree add` does not populate them.** If `.gitmodules` exists, the new
   checkout has empty submodule directories and builds will fail in confusing ways:
   ```bash
   git -C "$dir" submodule update --init --recursive
   ```
2. **Untracked local config does not come along** — `.env.local`, `settings.local.json`, credential
   files, generated configs. Find what the primary checkout has that the worktree lacks:
   ```bash
   git -C "$top" status --porcelain --ignored=matching | grep '^!!' | head -40
   ```
   Copy only what the task actually needs, and **never** copy a secrets file without saying which
   file you copied and where from. Prefer regenerating it the project's documented way.
3. **Build/toolchain prerequisites are per-checkout.** Dependency caches, virtualenvs, and
   generated build trees are not shared; the first build in a fresh worktree is a cold one. If
   CLAUDE.md documents prerequisites (toolchain env vars, package-manager roots, auth tokens),
   read them before the first build rather than after the first failure.
4. Do **not** copy the primary checkout's build directory in. It is stale, it is large, and it is
   the reason worktrees get pruned.

### 5. Verify

```bash
git worktree list
git -C "$dir" status -sb
git -C "$dir" log --oneline -1
git -C "$dir" rev-list --count <base>..HEAD         # expect 0 on a fresh branch
git -C "$dir" submodule status                      # no leading '-' (uninitialized)
```

A fresh worktree should be clean, on the intended branch, zero commits ahead of its base, with every
submodule populated.

### 6. Report

- Worktree path, branch, base ref and its short SHA.
- Whether the session is now inside the worktree or still in the primary checkout.
- Anything copied in from the primary checkout, named explicitly.
- Anything the task still needs before it can build or run (cold build, missing credential,
  submodule that had to be fetched).

## Notes

- **One worktree per task, one branch per worktree.** Do not plant a second worktree to continue the
  same work, and do not branch a new task off a task branch — go back to the remote default branch.
- `.claude/worktrees/` should be ignored, and is usually already covered by `.git/info/exclude` or
  `.gitignore`. Check with `git check-ignore -v .claude/worktrees` and, if it is *not* ignored, add
  it to `.git/info/exclude` (a local concern, not a commit to the project's `.gitignore`).
- Worktrees are cheap to create and expensive to keep — each one grows a full build tree. When the
  work is merged or abandoned, hand cleanup to `/worktrees:prune-trees`; removing the checkout leaves the
  branch intact.
- Never `rm -rf` a worktree here. Creating is this skill's job; deleting is audited elsewhere.
