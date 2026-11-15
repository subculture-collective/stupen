# Run and Submit

The workspace toolbar keeps both actions visible for code lessons:

- **Run** saves editable source, then tries all sample/custom cases.
  It never grades the lesson or fires grading coach triggers. Invalid case
  inputs or missing metadata/runner capability disable it with a visible reason.
- **Submit** saves source, then runs the original canonical lesson checks.
  Case edits cannot alter those tests. Only this path records attempts, graded
  results, fail streak and first-pass progress, and fires the existing coach
  check-pass/check-fail/stuck behavior.

On Windows/Linux, **Ctrl+Enter** submits and **Ctrl+Shift+Enter** runs practice.
On macOS, use **Command+Enter** and **Command+Shift+Enter**. These bindings work
inside the editor. Save, completion, multiple cursors and Tab focus mode retain
their existing bindings. The toolbar shows platform-specific shortcuts.

A shared execution lock prevents overlapping actions, including repeated
keyboard shortcuts. Results retain a stale notice after code edits, including
edits undone while the operation is pending. Practice and canonical results
have separate state. Save/runner failures keep the inputs and source available.

Legacy and unsupported code formats still use Submit; Run explains why it is
unavailable. Written lessons keep **Submit for grading** and the coach. Container
preview remains a separate action. The server still enforces account ownership,
authentication, quota and runtime availability.

Verified with the editor browser fixture: distinct toolbar/keyboard dispatch,
invalid-input gating, save failures, practice/canonical separation, busy controls,
edit/undo staleness and the existing layout/editor/reference regressions.

## Test Result

Run now tries all currently valid sample/custom cases in their displayed order.
It opens Test Result without moving editor focus. Select a result to inspect
that run's recorded named inputs, optional expected value, actual value, measured
case duration and bounded stdout/stderr. Switching result cases or returning to
Testcases does not alter code, inputs or selection in the case editor.

Before execution, Test Result explains its empty state. Running, comparison,
compile/runtime error, timeout, invalid output, skipped cases and infrastructure
failure each have text labels. A completed case without an expected value stays
ungraded; a matching practice result never changes lesson progress. Truncated
output is labelled. Learner file/line diagnostics use the existing problem parser
and navigate to the editor; Problems and canonical Check output remain available.

There is one practice outcome store, separate from canonical checks. Editing code
or any case retains the recorded result with a stale notice, including edit/undo
during a run. A later Submit cannot replace it. Short phone panes scroll to every
field and the result tabs wrap within the existing themed workspace.
