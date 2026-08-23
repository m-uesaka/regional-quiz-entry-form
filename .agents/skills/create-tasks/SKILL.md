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
