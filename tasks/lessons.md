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

## 2026-09-03 — A formatter was run repo-wide over a configuration that did not parse

**What went wrong:** While adding an exclusion to `biome.json`, a `//` comment
was added with it. `biome.json` is strict JSON, not JSONC, so Biome silently
fell back to its built-in defaults — tabs, 80 columns — and
`biome check --write` then reformatted 170 files across the whole repository,
burying the change under way more diff than the change itself. Recovering meant
restoring every file from git and re-applying the intended edits by hand.

**Why it happened:** An unparseable configuration is not an error Biome reports
before doing work; it just stops being the configuration. Nothing between
"edit the config" and "rewrite every file in the repository" asked for
confirmation, and `--write` across a whole tree gives no preview.

**Rule:** After editing any configuration file consumed by a tool that can
rewrite source — `biome.json`, `tsconfig.json`, `.editorconfig`, a formatter's
config — run the tool in read-only mode first (`biome check`, no `--write`) and
read the file count and rule output before letting it write anything. If a
formatter reports a file count far larger than the number of files touched,
stop and check the config parses (`node -e "JSON.parse(...)"`) rather than
accepting the diff.
