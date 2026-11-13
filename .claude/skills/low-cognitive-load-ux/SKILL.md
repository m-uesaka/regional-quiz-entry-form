---
name: low-cognitive-load-ux
description: The UI/UX design standard for this project — interfaces that keep cognitive load low and prevent user error (progressive disclosure, persistent state, focus, sensible defaults, feedback, forgiving errors, readable typography, calm visuals). Load this whenever you design, build, restyle, or review anything a user sees or interacts with — pages, components, forms, wizards, navigation, modals, error messages, loading and empty states, onboarding, UI copy — even when the request never mentions usability or accessibility. Also load for a UX review, design critique, usability audit, or "is this screen OK?" question. Load once per task; skip for backend-only work with no user-facing surface.
metadata:
  based-on:
    - https://www.designmonks.co/blog/ui-ux-and-adhd
    - https://github.com/curiositech/some_claude_skills (MIT)
    - https://github.com/Community-Access/accessibility-agents (cognitive-accessibility, MIT)
---

# Low-Cognitive-Load UI/UX Standard

This is the design standard for all user-facing work. It assumes the user on
an ordinary bad day: interrupted mid-task, tired, on a phone, doing two things
at once. Attention is unreliable, working memory is small, and time passes
unnoticed for everyone, to different degrees and at different moments. An
interface that holds up under those conditions produces fewer mistakes and
less effort for every user, so these rules apply to every screen, not to a
special mode or audience.

When a user drops out of a flow or makes an error, assume the interface
failed, not the user.

Rules marked **[S]** are supplements to the primary source listed in the
frontmatter. Where a supplement and the primary source disagree, the primary
source wins.

## Why each rule exists

Every rule traces back to one of five limits on human attention. Use this
table to reason about cases the rules do not cover.

| Limit | What happens in the interface | Design response |
|---|---|---|
| Motivation fades on tedious work | Long or repetitive screens get abandoned | Small steps with visible wins; never a wall of work |
| Working memory is small | Instructions that leave the screen are forgotten; the user loses their place | Keep needed information visible; never make the user carry it between screens |
| Starting and switching cost effort | Each unclear next step and each forced decision adds to drop-off | One obvious next action; decisions made in advance via defaults |
| Time perception is unreliable | Timeouts and auto-logouts catch people out; "soon" means nothing | Autosave, no silent expiry, concrete durations |
| Deep focus is valuable and fragile | A structured, rewarding interface earns sustained engagement; one interruption ends it | Protect flow: no interruptions, no attention theft |

## The rules at a glance

Rule IDs are stable; cite them in reviews. Full wording, rationale, and
implementation hints are in `references/guidelines.md`.

**Failure patterns to remove (F)**

- **F1** Infinite scroll without stopping points
- **F2** Modals, pop-ups, or toasts that interrupt a task in progress
- **F3** Placeholder text used as the only label or instruction
- **F4** Autoplaying video, audio, or attention-grabbing motion
- **F5** Multi-step flows with no progress indicator
- **F6** Navigation that moves or is relabelled between pages
- **F7** Vague error messages ("An error occurred.")

**Principles to apply (P)**

- **P1** Progressive disclosure: reveal step by step, each step a small win
- **P2** Persistent state: autosave, so distraction is never punished
- **P3** Focus: show only what the current moment requires
- **P4** Sensible defaults: preselect the common option, limit upfront configuration
- **P5** Feedback: every action visibly confirms that it worked
- **P6** Forgiveness: undo, specific recoverable errors, safe back navigation
- **P7** [S] Concrete time: durations and remaining steps in numbers, no silent timeouts
- **P8** [S] Blame-free copy: plain words, never shaming

**Visual rules (V)**

- **V1** Readable typeface (Inter, Atkinson Hyperlegible), few weights per screen
- **V2** Line length 60–75 characters, line height 1.5–1.6
- **V3** Contrast above the WCAG minimum, not just at it
- **V4** Colour carries meaning (error, success), not decoration
- **V5** Plain backgrounds: no patterns or textures behind content
- **V6** White space separates ideas and guides the eye
- **V7** Calm tone: muted palette, rounded friendly shapes, dark mode offered

## When building

1. Read `references/guidelines.md` before writing markup or styles. It is short
   and the hints save rework.
2. Follow the project's existing design system, tokens, and components first.
   This standard constrains how they are used; it does not replace them. If the
   design system itself violates a rule (for example, body text at a 100-character
   measure), say so instead of silently overriding it.
3. Design the unhappy paths together with the happy one: the error state, the
   empty state, the loading state, and "the user left for twenty minutes and came
   back". Most F and P violations live there, and they are cheap to get right at
   build time and expensive later.
4. Before finishing, run the distraction test from `references/review.md`
   against what you built and fix what it exposes.
5. In the final summary, name the rule IDs that shaped non-obvious decisions
   ("kept labels above fields rather than placeholders: F3"). One line is enough.

A rule can be outweighed by a real constraint, such as a legal requirement to
show a consent modal. When you break one, say which rule and why, and reduce the
damage (the consent modal still autosaves the form behind it).

## When reviewing

Read `references/review.md`. It has the procedure, the checklist, severity
definitions, and the report format. In short: walk the actual task flow rather
than judging screens in isolation, cite a rule ID for every finding, and give
the concrete fix, not just the complaint.

## Scope

This standard covers cognitive load, attention, and error prevention. It does
not replace a general accessibility audit: keyboard access, screen reader
semantics, and ARIA are separate work, though the overlap with WCAG is noted in
the reference files.

Respond in the language the user is writing in. Rule IDs stay as they are.
