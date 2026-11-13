# Reviewing a design or implementation

Compliance checklists alone do not guarantee usability, so a review here
follows a task from start to finish and looks for the moments where a
distracted user would be lost. **[S]** marks supplements that are not in the
source article.

## Procedure

1. **Identify the tasks.** List the one to three things a user comes to this
   screen or flow to do. Review against those, not against the screen as a
   static picture.
2. **Walk each task.** Read the code, design, or running app in the order the
   user meets it, including the error, empty, and loading states. If the app
   can be run, run it; several rules (P2, P5, F2) cannot be judged from markup
   alone. Say which states you could not check.
3. **Run the distraction test** (below) on each task.
4. **Go through the checklist** for anything the walk did not surface.
5. **Report** in the format at the end of this file.

## The distraction test

The source's low-fi test, usable without recruiting anyone: open ten browser
tabs, get properly distracted, then come back and try to finish the task from
where you left off.

When you cannot do it literally, simulate it. Pick the midpoint of the flow,
assume the user leaves for twenty minutes, and answer:

- Is their input still there? After a reload? After the session expired?
- Can they tell which step they are on and how many remain?
- Can they tell what they were doing from the screen alone, without
  remembering anything from an earlier screen?
- Is the next action obvious within a few seconds?

Any "no" is a finding, usually against P2, F5, P1, or P3.

## Checklist

**Flow**

- [ ] Multi-step flows show the current step and the total (F5)
- [ ] Each screen has one obvious primary action (P1, P3)
- [ ] Nothing the user needs for this step is on a previous screen only (P1)
- [ ] Lists have stopping points and a visible count (F1)
- [ ] Input and progress survive reload, back, and return (P2)
- [ ] No silent timeout on in-progress work (P2)
- [ ] The same information is never asked for twice (P2)

**Attention**

- [ ] Nothing interrupts a task in progress (F2)
- [ ] Nothing moves or plays on its own (F4)
- [ ] Secondary content is quiet or hidden during core tasks (P3)

**Forms and errors**

- [ ] Every field has a persistent visible label; hints stay visible (F3)
- [ ] Common options are preselected; only essentials are asked up front (P4)
- [ ] Errors name the field, the problem, and the fix, and keep the input (F7)
- [ ] Reversible actions offer undo; back never destroys input (P6)

**Feedback and copy**

- [ ] Every action gives an immediate visible response (P5)
- [ ] Buttons show a pending state and cannot double-submit (P5)
- [ ] Waits and deadlines are stated in numbers (P7)
- [ ] Copy is plain and never blames the user (P8)

**Orientation**

- [ ] Navigation has the same items, order, and position on every page (F6)
- [ ] One term per concept across the product (F6)
- [ ] Headings and labels describe their content (P8)

**Visual**

- [ ] Readable typeface, few weights per screen (V1)
- [ ] Body text measure 60–75 characters, line height 1.5–1.6 (V2)
- [ ] Contrast comfortably above the WCAG minimum (V3)
- [ ] Red and green mean error and success, with a non-colour cue too (V4)
- [ ] No pattern or texture behind content (V5)
- [ ] Spacing shows the grouping (V6)
- [ ] Palette is calm; saturated colour is rare and meaningful (V7)

The source singles out three WCAG criteria for cognitive load: 2.4.6 Headings
and Labels, 3.2.3 Consistent Navigation, and 3.3.2 Labels or Instructions.
Mention the criterion when a finding also fails one of them.

## Severity

- **Blocker**: the user loses work or cannot finish the task. Lost input on
  error or timeout, an error with no way forward, a required instruction that
  disappears.
- **Major**: the user can finish, but a distracted user is likely to drop out
  or lose their place. No progress indicator on a long flow, an interrupting
  modal, autoplay beside the task, navigation that changes.
- **Minor**: adds friction without threatening the task. A measure that is too
  wide, an extra font weight, a default that is missing but easy to choose.

## Report format

Lead with the verdict, then the findings ordered by severity. Keep it short;
the reader wants to know what to change.

```markdown
## UX review: <what was reviewed>

**Verdict:** <one or two sentences: is it ready, and what is the main risk>

**Tasks walked:** <task 1>, <task 2>
**Not checked:** <states or behaviour you could not verify, or "none">

### Findings

| # | Severity | Rule | Where | Problem | Fix |
|---|---|---|---|---|---|
| 1 | Blocker | P2 | `SignupForm.svelte:42` | Validation error re-renders the form empty | Keep field values in state across the failed submit |
| 2 | Major | F5 | Checkout steps 1–4 | No indication of step count | Add "Step n of 4" stepper to the layout |

### What already works

- <rules the design handles well, briefly, so they are not regressed>
```

Rules for the report:

- Every finding cites a rule ID and a location a developer can open.
- The fix is concrete and sized to the problem. If two fixes are reasonable,
  recommend one.
- Do not pad. If there are no findings at a severity, leave it out. If the
  design is fine, say so in the verdict and stop.
- Mark anything you inferred rather than observed.

## Testing with real users

When the team can run a usability study, the source recommends:

- **Recruiting:** include participants who find it hard to sustain attention
  or who are easily distracted; they expose friction that other participants
  work around unnoticed. Self-report is enough for screening; no clinical
  diagnosis is required.
- **Tasks worth testing:** multi-step forms (do users know where they are and
  what remains?), navigation (can they predict where key actions live after
  moving between pages?), and error recovery (do they understand what went
  wrong and how to fix it without help?).
- **What to watch for:** hesitation before clicking, re-reading instructions,
  and losing track of the original goal.
- [S] **Questions to ask afterwards:** "What made you want to give up?",
  "When did you feel overwhelmed?", "Did anything discourage you?"
