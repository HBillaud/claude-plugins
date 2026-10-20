/** What the session is working on, as the task row draws it. */
export type Hint = {
  /** The phrase: the model's summary, or the message's first line while that is on its way. */
  text: string
  /** True while `text` is the message's own first line, standing in until the summary lands. */
  isProvisional: boolean
}

/** Where the session works, as the repo row draws it. */
export type Where = {
  /** The session's project root, absolute: where it started, or where /cd or a worktree move took it. */
  root: string
  /** The top of the working tree that holds `root`, as git spells it; `root` itself outside a repository. */
  top: string
  /** The top's last path segment: the worktree's name, or the repository's. */
  name: string
  /** The main working tree's root; null outside a git repository. */
  repoRoot: string | null
  /** The repository's name, the main working tree's last path segment; null outside a git repository. */
  repo: string | null
  /** True when `top` is a linked worktree of `repoRoot` rather than the main checkout. */
  isWorktree: boolean
  /** The checked-out branch, `detached @ <sha>` on a detached HEAD, or null when git could not say. */
  branch: string | null
  /** Paths changed in the working tree, untracked included; null when git status could not be read. */
  changed: number | null
  /** The branch's upstream (`origin/main`); null when it has none or status could not be read. */
  upstream: string | null
  /** Commits on the branch and not on its upstream; null without an upstream that still exists. */
  ahead: number | null
  /** Commits on the upstream and not on the branch; null without an upstream that still exists. */
  behind: number | null
}

/** One line of a step's diff: kept, added, removed, or `~` for a skipped run of kept lines. */
export type DiffLine = { op: ' ' | '+' | '-' | '~'; t: string }

/** One step of the replay: one edit, or one edit of a MultiEdit. */
export type ReplayStep = {
  tool: 'Edit' | 'Write' | 'MultiEdit'
  file: string
  diff: DiffLine[]
  note: string
}

declare module 'claude-code' {
  interface PluginState {
    'session-band': {
      hint: Hint | null
      where: Where | null
      /** The last finished main-loop turn's edits, the ones the replay pane shows. */
      replay: ReplayStep[]
    }
  }
}
