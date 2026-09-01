# Lessons

Corrections received during work, and the rule that prevents each from recurring.
Stated so compliance can be checked, never as "be careful with X".

## 2026-09-01 — Finished subagents were left running

**What went wrong:** During subagent-driven execution of the backend plan, the
implementer, reviewer and re-reviewer for Task 1 were all left alive after their work
was accepted. Their panes stayed on screen alongside the newly dispatched Task 2 agent,
and the terminal became unreadable.

**Why it happened:** Nothing in the process fails when finished agents accumulate, so
there is no feedback pushing back against it. The whole cost lands on the human reading
the terminal.

**Rule:** After writing the `Task <N>: complete` line in the SDD ledger, and before
dispatching the next task, run ListAgents and TaskStop every agent belonging to the
finished task. Never stop an implementer before its task is closed — fix-loop rounds 1
to 3 resume that same agent and depend on its context.
