---
name: create-tasks
description: Create task lists from the requirements and code base.
disable-model-invocation: true
allowed-tools: Read Write Glob Grep
---

1. If `$ARGUMENTS[0]` is empty, stop and tell the user to provide the path to a
   requirements file.
2. Read `$ARGUMENTS[0]`, which describes the requirements of new features.
3. Create a task list for implementing these requirements based on the current
   code structure.
   - Output the task list in `tasks.md` at the top of repository.
   - For each subtask, write the code snippet for clarifying the rough structure
     of classes or methods.
   - `tasks.md` should be organized as `docs/task-format.md`
4. Write `tasks.md` following the writing rules in
   `.claude/skills/documentation/writing_rules.md`. Read that file before
   writing. The path is relative to the repository root, not to this skill
   directory. The elements of `tasks.md` are of the following kinds.
   - Title: the document title, and the title of each phase and task.
   - Short summary: each entry in "Short summaries of phases and tasks".
   - Paragraph: the task overview in "Overview". It is the only paragraph in
     the document.
   - Bullet: every item in "What to be implemented or updated", "Test", and
     "Dependencies".
   - No limit: the dependency graph and the code snippets.
   - When a task depends on no other task, write `None` in "Dependencies"
     (`なし` in a Japanese document).
5. Re-read `tasks.md` and fix it as the "Check before finishing" section of
   the writing rules says.
