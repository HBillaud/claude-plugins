---
name: plant-tree
description: Create an isolated git worktree for the current task under the repository's `.claude/worktrees/`, on a fresh branch named to the repo's conventions or on an existing branch or pull request, then finish the bootstrap (submodules, untracked local config, dependencies) and switch the session into it. Works from inside another worktree without nesting. TRIGGER when the user asks to work in / start / spin up a worktree, says "/devops:plant-tree" (or "/plant-tree"), or wants a task isolated from the primary checkout.
user-invocable: true
allowed-tools: Bash, Glob, Grep, Read, EnterWorktree
---

# Plant an Agent Worktree

Give the current task its own checkout under `<primary-checkout>/.claude/worktrees/<name>`, so the
primary checkout stays on its own branch and its own build state. The worktree is throwaway; the
branch it carries is not.

The counterpart is `/devops:prune-trees`, which deletes these later. Everything here is written so that
audit can succeed: one worktree per task, inside the conventional directory, on a real branch.

## Scope

**Always** `<primary-checkout>/.claude/worktrees/<name>`, never a sibling checkout (`../<repo>-<topic>`),
never `/tmp`. Resolve the primary checkout like this, because git lists it first from anywhere in the
repository:

```bash
git worktree list --porcelain | sed -n '1s/^worktree //p'
```

Do not use `git rev-parse --show-toplevel` for this. Inside a worktree it returns that worktree, and a
new one planted there is nested inside it, where deleting the outer one takes the inner one too.

If the user explicitly names a location outside that directory, use it, but say plainly that
`/devops:prune-trees` will not manage it. If the invoking directory is not a git repository, stop and
say so.

Shell state does not persist between commands. Below, `<top>`, `<dir>` and `<base>` stand for values you
have resolved: write them out in each command, with absolute paths for `<top>` and `<dir>`.

## Behavior

### 1. Decide what is being planted

`$ARGUMENTS`, when present, is a task description, an explicit name, an existing branch, or a pull
request (`#123` or its URL).

- **New task** (the usual case): go on with the naming rules below and step 2.
- **Existing branch**: plant it instead of branching. If `git worktree list` shows it already checked out
  somewhere, do not plant: name that path, and offer to enter it with `EnterWorktree(path: ...)`.
  ```bash
  git -C <top> worktree add <dir> <branch>
  ```
  A branch only on the remote needs `git -C <top> fetch origin <branch>:<branch>` first.
- **Pull request**: the same, using the head branch from `gh pr view <n> --json headRefName,isCrossRepository`.
  For a pull request from a fork, fetch `pull/<n>/head:pr-<n>` and plant `pr-<n>`. Say that pushing it back
  needs the fork's remote.

Skip step 2 for an existing branch or pull request. Its base is what it already is.

**Naming a new task:**

- **Worktree directory name**: a short kebab-case slug of the task (`add-login-retry`,
  `fix-cache-eviction`). No prefix: the directory is not the branch.
- **Branch name**: follow the repo's own convention, discovered rather than assumed:
  ```bash
  git branch -a --sort=-committerdate | head -30
  ```
  Many repos use `feature/`, `fix/`, `refactor/` + the same slug. Check CLAUDE.md or AGENTS.md for a stated
  rule and prefer it over what the branch list suggests.
- If the slug or branch name is already taken, pick a distinct slug and say why. Reuse an existing branch
  only when the user asked to continue it.

With no arguments, derive the slug from the task already in flight. Only ask the user when there is
no such task to name.

### 2. Choose the base ref deliberately

Default: branch from the **remote default branch** (`origin/main`, `origin/master`, …), not from
local HEAD. Stacking a task branch on whatever the primary checkout happens to be sitting on is how
unrelated work ends up inside a PR.

Resolve it rather than assuming `main`:

```bash
git fetch --quiet origin
base=$(git symbolic-ref --short -q refs/remotes/origin/HEAD) ||
  for b in origin/main origin/master; do git rev-parse -q --verify "$b" >/dev/null && base=$b && break; done
echo "$base"; git rev-parse --short "$base"
```

If the remote is not named `origin`, substitute its name (`git remote`). If the repo has no remote
at all, or none of these resolve, branch from the local default branch and say so in the report.

Branch from local HEAD only when the user asks for it, or when the work genuinely depends on
unmerged commits, and then say so in the report, because the eventual PR will contain them.

### 3. Create it

First make sure the directory is ignored, so worktrees never show up as untracked files. Probe a path
inside it, because `git check-ignore` reports a directory that does not exist yet as not ignored:

```bash
git -C <top> check-ignore -q .claude/worktrees/probe ||
  echo '.claude/worktrees/' >> "<top>/$(git -C <top> rev-parse --git-path info/exclude)"
```

That edits the local exclude file, not the project's `.gitignore`, so it needs no commit.

**Preferred: `EnterWorktree(name:)`.** It switches the session in one step, and it applies the project's
`.worktreeinclude`, `worktree.symlinkDirectories` and `worktree.sparsePaths`, which `git worktree add`
does not.

```text
EnterWorktree(name: "<slug>")
```

Two things to settle straight after:

1. **The branch name.** The tool names the branch `worktree-<slug>` and has no way to choose. Rename it
   to the one from step 1:
   ```bash
   git branch --show-current          # confirm what it was given
   git branch -m <given-name> <branch>
   ```
2. **The base.** The `worktree.baseRef` setting decides it: `fresh` (the default) starts from the remote
   default branch, `head` from local HEAD. Compare `git rev-parse HEAD` with `<base>`. A project that set
   `head` chose that, so keep it and say so in the report.

**Use the raw git path instead** when the tool cannot do the job: the session is already in a worktree,
you are planting an existing branch or pull request, the base is not what the tool would pick, or the
user wants the worktree created **without** moving the session into it.

```bash
git -C <top> worktree add -b <branch> <dir> <base>
```

Then enter it with `EnterWorktree(path: "<dir>")`, unless the session should stay put, in which case use
`git -C <dir>` and absolute paths for every later command. Do not `cd` and hope the session follows. A
worktree entered by path is not removed by `ExitWorktree`; cleanup goes through `/devops:prune-trees`.

### 4. Finish the bootstrap

Go through all of these. `EnterWorktree(name:)` may have done some of them, so check before repeating.

1. **Submodules are not populated.** If `.gitmodules` exists, the new checkout has empty submodule
   directories and builds will fail in confusing ways:
   ```bash
   git -C <dir> submodule update --init --recursive
   ```
2. **Untracked local config does not come along**: `.env.local`, `settings.local.json`, credential
   files, generated configs. On the raw git path, `.worktreeinclude` does not apply, so if the project has
   one, copy what it lists. Otherwise, find what the primary checkout has that the worktree lacks:
   ```bash
   git -C <top> status --porcelain --ignored=matching | grep '^!!' | head -40
   ```
   Copy only what the task actually needs, and **never** copy a secrets file without saying which file you
   copied and where from. Prefer regenerating it the project's documented way.
3. **Dependencies are per-checkout.** If the task will build, test or run the project, install from the
   lockfile with its frozen command (`npm ci`, `pnpm install --frozen-lockfile`, `yarn install --immutable`,
   `uv sync --frozen`, `bundle install`, …) unless `worktree.symlinkDirectories` already links them in. If
   the task only reads or edits, skip it. Installing runs the project's install scripts, so report it.
4. **Other build prerequisites.** If CLAUDE.md or AGENTS.md documents them (toolchain env vars, auth
   tokens), read them before the first build rather than after the first failure.
5. Do **not** copy the primary checkout's build directory in. It is stale, it is large, and it is
   the reason worktrees get pruned.

### 5. Verify

```bash
git worktree list
git -C <dir> status -sb
git -C <dir> log --oneline -1
git -C <dir> rev-list --count <base>..HEAD         # new branch: expect 0
git -C <dir> submodule status                      # no leading '-' (uninitialized)
```

A new worktree should be clean, on the intended branch, zero commits ahead of its base, with every
submodule populated, and directly under `<top>/.claude/worktrees/`. An existing branch or pull request
can be ahead, so skip that count there.

### 6. Report

- Worktree path, branch, base ref and its short SHA.
- Whether the session is now inside the worktree or still where it was.
- Anything copied in from the primary checkout, named explicitly, and any install that ran.
- Anything the task still needs before it can build or run (cold build, missing credential,
  submodule that had to be fetched).

## Notes

- **One worktree per task, one branch per worktree.** Do not plant a second worktree to continue the
  same work, and do not branch a new task off a task branch: go back to the remote default branch.
- Worktrees are cheap to create and expensive to keep, because each one grows a full build tree. When the
  work is merged or abandoned, hand cleanup to `/devops:prune-trees`; removing the checkout leaves the
  branch intact.
- Never `rm -rf` a worktree here. Creating is this skill's job; deleting is audited elsewhere.
