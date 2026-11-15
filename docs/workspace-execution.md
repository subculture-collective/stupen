# Run and Submit

The workspace toolbar keeps both actions visible for code lessons:

- **Run** saves editable source, then tries the selected sample/custom case.
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
