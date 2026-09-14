---
name: write-improvement-todo
description: Turn a user's improvement request (a feature idea, "it'd be nice if...", a UX complaint) into a well-scoped todo/*.md planning file for peitho-studio. Use whenever the user asks to add something to todo/, wants an improvement captured for later implementation, or during a planning conversation before any code changes begin. Not for tracking in-conversation steps (use TodoWrite for that) — this produces the persistent, git-committed todo/ files a separate autonomous loop later consumes one at a time.
---

# Writing a todo/ planning file

`todo/` holds per-task work ledgers: Markdown planning docs meant to be
picked up later — by a human, or by a separate autonomous loop the user
runs largely without re-reading the surrounding code — and implemented one
at a time. That consumer won't stop mid-task to ask "wait, what did you
mean?", so the quality of the file itself is what keeps a task from
drifting off-scope, stalling on an ambiguous instruction, or silently
declaring victory on the wrong thing. This skill is about writing that
file well — not about implementing the task it describes.

## 0. Investigate before writing a single line of plan

Never draft a plan from the request text alone — a request phrased as a
one-liner ("GUI化してほしい", "エラーを出してほしい") routinely turns out
to already be half-implemented, or to hit a constraint in `peitho-core`
that reshapes the whole fix. Read the actual files the request touches
before writing anything:

- Grep the relevant `domain/`/`components/`/`state/` files and, when the
  request could involve peitho-core's own behavior (build errors, layout
  matching, parser rules), the `peitho-core` crate under the `mizzy/peitho`
  working directory too.
- Check `todo/` and `todo/archive/` for a related or overlapping plan
  first. Extend an existing file rather than creating a near-duplicate —
  archived plans often record a design decision or a rejected approach
  that still applies.

## 1. Ask vs. just write it down

Ask the user (`AskUserQuestion`) only when the request is ambiguous in a
way that would produce a **materially different plan** depending on the
answer — not to seek permission for something the request already implies.
Signs a question is worth asking:

- The request names a UI behavior ("show an error", "make it configurable")
  without saying which of several plausible triggers or scopes it means.
- Two implementation approaches differ enough in size (a small UI tweak vs.
  a cross-layer rewrite) that the user should pick before a file gets
  written committing to one.
- The request assumes a capability whose existence you haven't verified
  yet (e.g. "let me set the app icon" — of what, and can the underlying
  platform even do that at runtime?).

Batch independent questions into one `AskUserQuestion` call (max 4 per
call); split across multiple calls if there are more. Don't ask about
things a quick grep would have answered.

## 2. One file per independently-completable unit of work

Split by what can be picked up, implemented, and marked done on its own —
not by who asked for it or which single component it touches. Two
requests that share one UI pattern (e.g. two kinds of status badge on the
same thumbnail) can share a file; two requests that happen to touch the
same component but are otherwise unrelated should not.

## 3. Template

`todo/_TEMPLATE.md` is the canonical template — read it and copy its
structure rather than reproducing it here (keeping one copy avoids the two
drifting apart). Write the new file in Japanese (matching this project's
existing `todo/*.md` and `docs/architecture.ja.md` convention), following
the layering rules in this repo's `CLAUDE.md` (pure `domain/`/`engine/`
functions vs. stateful `.tsx`/`peitho.rs`) when filling in "レイヤー配置".

The `_` prefix on `_TEMPLATE.md` is a convention: any script or loop that
mechanically walks `todo/*.md` as a task list must skip filenames starting
with `_` (match `todo/[^_]*.md`, or check `startsWith('_')` before
treating a file as a task) — this file itself is never a task.

## 4. `status` frontmatter

Every `todo/*.md` carries a frontmatter block (`status`/`description`/
`tags` — see `todo/_TEMPLATE.md`). `status` is one of:

- `inbox` — unrefined, not yet investigated or walked through with the
  user. May be nothing more than the "発端" line.
- `todo` — refined: investigated (§0) and, where needed, walked through
  with the user (§1). Ready for an implementer to pick up.
- `wip` — implementation in progress.
- `done` — finished (every item under both 完了条件 headings checked).
- `rejected` — decided against; the reason should be written into the
  file body before it's archived.

This skill writes/updates files at `status: todo` — that's the whole
point of "refining" a request into a plan. If asked to just jot an idea
down for later, write `status: inbox` with only what's actually known yet
(don't force-fill 背景・要調査/方針 with guesses to make it look refined).

## 5. After writing

- If the new plan supersedes or extends something in `todo/archive/`, say
  so in the "発端" line rather than leaving the relationship implicit.
- When a file reaches `status: done` or `status: rejected`, move it to
  `todo/archive/` — `git mv`, not a copy-then-delete, so history follows
  the file.
- Don't create an index/README file listing all `todo/*.md` files unless
  asked — `ls todo/` already does that job.
