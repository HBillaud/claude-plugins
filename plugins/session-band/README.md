# session-band

**Know what every Claude Code session is doing, where it's doing it, and how much runway you have left, without scrolling up once.**

You've got four terminal panes open. One is fixing a flaky test, one is in a worktree you don't remember creating, and one just edited eleven files while you were in a meeting. Then a session stops mid-task because you hit your usage limit.

session-band puts all of that in one quiet band just above the prompt:

```
  ◆ task   Add retries to the gateway uploads
  ⎇ repo   acme  on fix/login-timeout  ●2 ↑1  · worktree pr-42
  ◔ usage  ■■■■□□□□□□ 42%  resets in 2h 13m
  ▶ replay 7 edits                                              r replay
```

Glance down and you're oriented. No commands to remember.

---

## What you get

### ◆ task: what this session is about
Your latest request is summed up as a short, verb-led label, like *"Fix flaky replay test"* or *"Add retries to gateway uploads"*. Reply "yes, go ahead" and the label stays put. Change direction and it follows you. A session you resume, fork or reload labels itself from your last few prompts.

### ⎇ repo: where you actually are
Repository, branch and worktree, read from git, so it's never a guess. Changed files (`●`) and commits ahead or behind (`↑ ↓`) appear only when they're nonzero. If the session moves into another worktree, the band follows and a toast tells you so. Run `/worktree` for the full picture: paths, main checkout, upstream and sync state.

### ◔ usage: no more surprise limits
Your five-hour session window as a ten-segment meter, with the exact percentage and a live countdown to the reset. It redraws on its own, even while the session is idle.

### ▶ replay: see what Claude just changed
Every Edit and Write in the last turn is recorded. Press `r`, or type `/replay`, to step through them one diff at a time in a pane beside the chat. Recording never blocks or slows an edit.

---

## Built to stay out of your way

- **Quiet by default.** A row with nothing to say isn't drawn. Outside a repository there's no repo row, and with no edits there's no replay row.
- **Never slows you down.** Git reads, labels and recordings all run off the prompt's path. Git status runs without taking the index lock, so it never collides with the model's own git commands.
- **Fails gracefully.** If one row breaks, the others keep drawing and your session starts normally.
- **Looks right everywhere.** With a Nerd Font (or Ghostty, WezTerm or kitty, which ship the symbols) you get crisp icons. Everywhere else, clean Unicode stand-ins are drawn in the same colors. It works in the terminal and in the desktop app.
- **Plays well with others.** Rows from other mods stack neatly below the band, and the band steps aside when Claude Code shows a survey.

---

## You choose how the task label is written

| `taskLabel` | How it works | Cost |
| --- | --- | --- |
| `model` (default) | Claude Haiku sums up your latest message in about a second. | One tiny model call per prompt, counted in your usage. Your message (up to 4,000 characters) is sent to the model. |
| `local` | The label is read from your message itself: its first sentence, with "hey, can you please…" trimmed off. "yes, go ahead" keeps the current label. | Nothing. No model call, nothing leaves your machine. |
| `off` | No task row at all. | Nothing. |

You pick it when you install, and can change it any time in `/config`, where it's listed as **Task label**.

---

## Install

session-band is part of the **hadrien-labs** marketplace. At the prompt of a Claude Code terminal session:

```
/plugin marketplace add HBillaud/claude-plugins
/plugin install session-band@hadrien-labs
```

From a shell:

```bash
claude plugin install session-band --marketplace HBillaud/claude-plugins
```

In the desktop app: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `HBillaud/claude-plugins`, then **Add plugin**.

The band appears in your current session right away. No restart needed.

> The repository is private for now: you need read access to it on GitHub, and a git credential for github.com on your machine (an SSH key, or `gh auth login` then `gh auth setup-git`).

## Commands

| Command | What it does |
| --- | --- |
| `/worktree` | Where this session works: repository, branch, worktree, paths, changes and upstream. |
| `/replay` | Opens the replay pane on the last turn's edits. |

In the replay pane: **n** next, **p** previous, **c** close. Or click the diff and use **↑ ↓**.

## Requirements

- Claude Code 2.1.303 or later
- git, for the repo row
- Optional: a Nerd Font for the icons

## Uninstall

Run `/plugin`, choose **session-band**, then **Uninstall**.
