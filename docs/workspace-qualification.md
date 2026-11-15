# Workspace qualification

Run the deterministic browser suite against a production build:

```sh
pnpm build
pnpm exec vite preview --host 127.0.0.1 --port 5198 --strictPort
# In a second terminal:
BASE=http://127.0.0.1:5198 node scripts/verify-editor.ts
# Stop preview, rebuild, and restart it with the public base path:
BASE_PATH=/app pnpm build
BASE_PATH=/app pnpm exec vite preview --host 127.0.0.1 --port 5198 --strictPort
# In a second terminal:
BASE=http://127.0.0.1:5198/app node scripts/verify-editor.ts
```

Use `CHROMIUM=/path/to/chrome` if needed. Otherwise the suite uses local Chrome
or the browser installed by `pnpm exec playwright-core install chromium`.
CI installs Chromium and runs both base paths, in addition to unit/build checks
and the required real local/remote practice sandbox tests.

The suite covers 1440×900, 1153×814 and 390×844 in light and dark themes;
long reading, result/history text, short panes and rotation; independent scroll,
Problem List navigation, retained editor selections/undo/drafts and coach drafts;
maximize/restore/reset; read-only tests and TypeScript/Go/Python assistance;
keyboard case editing/selection, Run, Submit, history and editor focus return;
and empty/loading/invalid/running/pass/mismatch/compiler/runtime/timeout,
runner-unavailable, failed-save, expired-session and stale-result states.
Legacy lessons retain canonical Submit, written tasks keep coach grading, and
container previews remain reachable in an opaque-origin sandboxed iframe.

Browser API responses are isolated fixtures, including grading and preview.
They prove UI dispatch, composition and state handling, not actual backend
execution, model behavior or production authentication. Real sandbox evidence
comes from `PRACTICE_INTEGRATION=1 node --test server/practice-run.test.ts` in the
disposable verification container. Live account/runner evidence is recorded
separately at rollout. No browser fixture edits production learner data.
