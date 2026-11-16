# Coding workspace release and recovery

The app and runner use practice protocol v1. Deploy the reviewed runner extension
before the app. `/v1/status` must advertise `practice.version = 1` and the
`typescript`, `javascript`, `python`, `go` runtimes, with a working sandbox.
The app uses `RUNNER_URL`; an old or unavailable agent disables practice and
never redirects learner execution onto the app host. Ordinary canonical checks
remain available on legacy lessons.

Before activation:

1. Require green CI for the release head, including browser qualification at
   `/` and `/app`, and all 11 required real sandbox/remote-agent tests.
2. Build `BASE_PATH=/app pnpm build`. Record the Git revision and hashes of
   source/build files. Retain the current app and agent releases and service
   configuration; take the existing Stupen backup without exposing its contents.
3. Stage versioned releases on Kvant and in the runner VM. Reuse dependencies
   only when package and lockfile hashes match; otherwise install from the lock.
4. Atomically switch `/opt/stupen/current` in the VM, restart only
   `stupen-agent.service`, and check authenticated status/capabilities. Leave the
   QEMU VM and egress service running. Then switch Kvant's
   `~/.local/share/stupen/current` and restart only `study-coach.service`.

Run the authorized disposable learner smoke from the app release, using the
existing private environment file:

```sh
ROLLOUT_SMOKE=1 node --env-file=/home/onnwee/.config/study-coach/env scripts/verify-workspace-rollout.ts
```

It creates a random non-admin account/session, sends authenticated requests
through the configured public `/app` origin, and creates deterministic lessons
for TypeScript, Python and Go. Deliberately mismatched custom practice must leave
lesson metadata/history unchanged. Canonical pass and fail submissions must
update progress and retain their actual outcomes. The account is denied the
owner's subscription models. Account deletion removes its files and sessions;
exception cleanup is limited to that generated account. It does not test email
or OAuth login exchange. Never print or archive session cookies or environment
values in the receipt.

Verify public HTML, JS, CSS and the language worker hashes against the release;
confirm anonymous account APIs remain 401 and direct socket calls without the
edge secret remain 403. Run
`BASE=https://stupen.subcult.tv/app node scripts/verify-editor.ts` for the public
assets/UI with isolated API fixtures. Record real account/provider, coach,
written grading and container preview evidence separately from fixture results.

Recovery is a code switch, never a database restore. After checking for later
changes, atomically point `~/.local/share/stupen/current` at the retained app
release and restart `study-coach.service`. Leave the compatible new runner in
place for an app-only rollback. To revert the runner too, first revert the app,
then atomically restore `/opt/stupen/current` and restart `stupen-agent.service`.
Do not stop QEMU, change credentials, or overwrite learner data. Case drafts and
submission history are additive lesson `.meta` data; retain them across recovery.
Old code can read the lesson/progress but does not expose the new history UI.

Keep exact live revisions, previous symlink targets, runtime/config hashes,
asset manifests, smoke results, limits and validated recovery commands in the
private release receipt and canonical Machinum Kvant/Stupen notes. A pushed
release or UI fixture alone does not close the live rollout issue.

## November 16, 2026 UTC activation

App and runner were activated at merged revision
`8d3631cdc25252aad9989cc5a2ec95665d86d04a` after #40 and #41 passed hosted CI.
The production `/app` build has 19 files, all hash-matched through the public
URL, including the language worker. Both services use their versioned
`8d3631-workspace` releases. The runner was activated and checked before the app.

Live public authenticated tests passed for custom practice and canonical pass/fail
submissions in TypeScript, Python and Go. Practice left metadata/history unchanged;
Submit persisted progress and personal results. The disposable account was removed.
A real container preview and ChatGPT-backed written grading also passed. The owner
retained subscription/provider access; the disposable account was excluded.
The full UI fixture suite passed against the public build in both themes and at
all three required viewport sizes. Anonymous API access stayed 401; direct socket
access without the edge secret stayed 403.

The existing backup job completed successfully before activation. Runtime inputs
and the original 18 learner files were checked against the before manifest; only
the authorized written-smoke event was appended to the owner's coach log, with
its prior bytes retained. QEMU and egress PIDs stayed unchanged. Previous releases
`0e6caab-editor` (app) and `f2fdc16` (runner) remain available. Recovery commands
were syntax/path checked; an actual production rollback was not performed.
Fresh email/GitHub/passkey credential exchange was not exercised.

Private receipt on Kvant: `~/.local/state/stupen-workspace-20261115/`, including
before/deployment manifests, public asset hashes, account/provider/browser smoke
logs and `rollback.sh`. The smoke tooling ran from its staged operations release;
it was separate from the deployed app/runner runtime revision above.
