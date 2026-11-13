# Guidelines

Full wording for every rule in `SKILL.md`. **[S]** marks a supplement that is
not in the source article; everything else comes from the article.

Contents: [Failure patterns](#failure-patterns-f) ·
[Principles](#principles-p) · [Visual rules](#visual-rules-v) ·
[Standard vs. low-load](#standard-vs-low-load)

## Failure patterns (F)

### F1 Infinite scroll without stopping points

Endless feeds never give the brain a "task complete" signal, so someone looking
for one thing can scroll for an hour and find nothing.

- Prefer pagination or an explicit "Load more" button.
- Show the result count and the current position ("20 of 134").
- Keep the footer and anything below the list reachable.

### F2 Interruptions during a task

A promotional modal in the middle of a booking wipes the task from working
memory by the time it is closed.

- No promotional or unrelated modals, fly-ins, or toasts while a form or
  multi-step flow is in progress.
- Use a modal only when the user asked for it or the decision truly blocks the
  task. Prefer inline expansion otherwise.
- [S] Notifications are controllable, and non-urgent ones wait until the task
  ends.

### F3 Placeholder as the only label

Once the field is clicked the instruction is gone, and the form becomes
guesswork.

- Every field has a visible, persistent label outside the input.
- Format hints and constraints sit under or beside the field and stay visible
  while typing.
- A placeholder may show an example value, never the only instruction.
- Overlaps WCAG 3.3.2 (Labels or Instructions).

### F4 Autoplay and attention theft

Motion and sound capture attention involuntarily. A visitor who came to check
opening hours never finds them.

- No autoplaying video or audio. Media starts on user action.
- No looping animation, carousel, or ticker beside content the user must read.
- [S] Any motion that does exist has a pause control and respects
  `prefers-reduced-motion`. Overlaps WCAG 2.2.2 (Pause, Stop, Hide).

### F5 Multi-step flow with no progress indicator

Without a visible step count the user cannot budget effort, and long flows get
abandoned early.

- Show "Step 2 of 4" or an equivalent stepper on every step.
- Name the steps where possible so the user can see what is coming.
- Say up front what the user will need (documents, card, ID number).

### F6 Inconsistent navigation

Menus that move or change labels between pages stop the user from building a
mental model.

- Same navigation items, same order, same position on every page.
- One term per concept across the product ("Sign in" everywhere, not "Log in"
  on one page).
- Primary actions sit in a predictable place within a given kind of screen.
- Overlaps WCAG 3.2.3 (Consistent Navigation).

### F7 Vague error messages

"An error occurred." after a fifteen-minute application leaves the user
stranded, with no field highlighted and no next step.

- Say what went wrong, where, and how to fix it.
- Mark the specific field and move the user to it.
- Keep everything the user already entered.
- [S] Four-part shape: the problem, the cause, the fix, and no blame.
  "Email address is missing an @. Enter it like name@example.com." Not
  "Invalid input."

## Principles (P)

### P1 Progressive disclosure

Reveal information step by step. Each completed step is a small reward that
keeps the user moving. Layout cleanup alone is only a surface fix; the
structure of the flow matters more.

- One primary action per screen or section.
- Split long forms into short steps grouped by topic.
- Put advanced or rarely used options behind an explicit "More options"
  control. Do not hide anything the user needs to finish the current step:
  hidden and needed is a working-memory tax.

### P2 Persistent state

Autosave tells the user that distraction will not be punished.

- Save drafts and form input automatically; restore them on return, reload,
  and re-login.
- Show the saved state quietly ("Saved 2 minutes ago").
- Returning to a flow resumes at the step the user left.
- [S] Avoid session timeouts on in-progress work. If a timeout is required,
  warn ahead of it, let the user extend it, and preserve the input either way.
  Overlaps WCAG 2.2.1 (Timing Adjustable).
- [S] Do not ask for the same information twice in one flow; prefill it.
  Overlaps WCAG 3.3.7 (Redundant Entry).

### P3 Focus

Show only what the current moment requires, the way a distraction-free writing
view or a focused issue view does.

- During a core task, drop or collapse secondary panels, banners, and
  cross-promotion.
- One visually dominant primary action; secondary actions are visibly quieter.
- Offer a focus mode on dense screens such as editors and dashboards.

### P4 Sensible defaults

Every choice the interface forces has a cost, and the cost compounds into
drop-off.

- Preselect the most common option.
- Ask for the minimum up front; configuration can come later, in context.
- [S] When a choice is unavoidable, keep it to a handful of options and mark
  the recommended one.

### P5 Feedback

Without confirmation, users click the same button three times.

- Every action produces an immediate visible response: state change, status
  message, or colour change.
- Buttons show a pending state and cannot double-submit.
- Completion is stated explicitly ("Order placed"), not implied by a redirect.
- Keep feedback subtle. The source asks for a subtle animation or status
  change, not confetti; loud celebration competes for attention and conflicts
  with F4 and V7.

### P6 Forgiveness

Mistakes should lead to recovery, not punishment.

- Offer undo instead of "Are you sure?" where the action can be reversed.
- Back navigation never destroys input.
- Destructive actions are clearly distinct and recoverable for a period where
  possible.
- Errors follow F7.

### P7 Concrete time [S]

Time blindness makes "soon" and "a few minutes" meaningless.

- Give numbers: "About 3 minutes", "2 of 5 uploaded", a determinate progress
  bar instead of an endless spinner when the duration can be known.
- State deadlines as dates and times, not "expires soon".

### P8 Blame-free plain copy [S]

Copy that blames the user turns a small slip into a reason to quit, and it
lands hardest on people who already expect to get things wrong. The source's case study also stresses
jargon-free labels that can be understood at a glance.

- Describe the situation, not the user's failure: "That password doesn't
  match", not "You entered the wrong password".
- Short sentences, common words, active voice. Buttons name their outcome
  ("Save draft", not "OK").
- Headings and labels describe what is under them. Overlaps WCAG 2.4.6
  (Headings and Labels).

## Visual rules (V)

Typography, contrast, and space are cognitive tools here, not decoration.

### V1 Typeface

- Readable over decorative. Inter and Atkinson Hyperlegible are the named
  recommendations for UI text.
- Limit the weights on one screen (two is usually enough, three at most [S]).
  Too many weights fragment attention.

### V2 Measure and leading

- Line length 60–75 characters for body text: `max-width: 65ch` is a good
  default.
- Line height 1.5–1.6 for body text.
- [S] For Japanese and other full-width scripts, aim for roughly 35–40
  characters per line and a line height around 1.7–1.8; `ch` is measured on
  "0", so set the measure in `em` there.

### V3 Contrast

- Go beyond the WCAG minimum; higher contrast lowers the effort of separating
  text from background. The source gives no number.
- [S] Working target: body text at 7:1 (WCAG AAA) where the palette allows,
  never below 4.5:1. Do not dim secondary text until it is hard to read.

### V4 Colour as information

- Reserve red for errors and green for success, and use them consistently.
- [S] Never rely on colour alone; pair it with an icon or text.

### V5 Backgrounds

- No patterns, textures, or busy imagery behind text or controls.

### V6 White space

- Group related items tightly and separate unrelated groups clearly.
- Prefer spacing over borders and boxes to show structure.

### V7 Calm tone

From the source's case study of a product built for calm and focus:

- Soft, muted colours rather than high-energy ones. Save saturated colour for
  the one thing that needs attention.
- Rounded shapes and friendly typography, to build trust rather than pressure.
- Offer dark mode. Lower brightness helps many users focus, though not
  all, so make it a choice and follow the system setting by default [S].

## Standard vs. low-load

| Dimension | Standard UX | Low-load UX |
|---|---|---|
| Information delivery | All at once | Progressive disclosure |
| Progress saving | Manual or none | Automatic and persistent |
| Visual environment | Feature-rich interface | Focus mode available |
| Decision points | Multiple upfront choices | Sensible defaults preset |
| Error handling | Generic message | Specific, recoverable guidance |
