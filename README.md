# Hadrien Labs

Skills and mods for Claude Code, published as one marketplace: `hadrien-labs`.

## Install

At the prompt of a Claude Code terminal session, add the marketplace once:

```
/plugin marketplace add HBillaud/hadrien-labs
```

Then install what you want from it:

```
/plugin install session-band@hadrien-labs
/plugin install worktrees@hadrien-labs
```

From a shell, the same works as `claude plugin install session-band --marketplace HBillaud/hadrien-labs`.

In the desktop app, where `/plugin` does not run: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `HBillaud/hadrien-labs`, then **Add plugin**.

To pick up new versions: `/plugin marketplace update hadrien-labs`.

## What's inside

| Plugin | Kind | What it does |
| --- | --- | --- |
| [session-band](plugins/session-band) | mod | One band above the prompt: what the session works on, where, how much of the session limit is used, and a replay of the last turn's edits. Adds `/worktree` and `/replay`. The task label can use Claude Haiku, local parsing with no model call, or be turned off. |
| [worktrees](plugins/worktrees) | skills | `/worktrees:plant-tree` gives a task its own git worktree under `.claude/worktrees/`; `/worktrees:prune-trees` safely deletes the ones you no longer need. |

## Developing

Each plugin lives in `plugins/<name>/` and is listed in `.claude-plugin/marketplace.json`.

Run a plugin from this folder without installing it:

```
claude --plugin-dir plugins/session-band
```

Before a release, bump `version` in the plugin's `.claude-plugin/plugin.json`, then check:

```
claude plugin validate .
claude plugin validate plugins/<name>
claude plugin test plugins/<name>
```

Mods are built against the Claude Code engine API; session-band was last tested on Claude Code 2.1.303.
