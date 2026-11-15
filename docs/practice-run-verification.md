# TypeScript and JavaScript practice runs

Issue [#16](https://github.com/subculture-collective/stupen/issues/16) implements
version 1 of the [editable-case contract](decisions/001-editable-cases.md).

`GET /api/tracks/:track/lessons/:lesson/run` reports whether the owned lesson
has compatible metadata and runner support. `POST` at the same path accepts
`{version: 1, cases: [...]}`. The server derives the entry and schemas from the
lesson, snapshots starter/support source, and runs through `exec.practice`.
Practice shares the canonical checks quota and permits one batch per account.
It writes no progress, checks, submissions, cases or coaching history.

The case editor saves pending source before **Run selected case**, retains a
code/input identity and a monotonic edit revision for its result, and marks the
result stale after edits, including edits undone during execution.
Canonical **Run checks** remains available. Renaming it to Submit and expanding
the result interface belong to later roadmap issues.

Local and remote paths use the same adapter. Each case gets a fresh bubblewrap
sandbox with no network, account data, canonical tests, reference solution or
inherited app environment. The practice sandbox mounts toolchains and app
`node_modules` read-only, without mounting the host root or `/etc`. TypeScript
uses the existing strict, erasable-syntax check; JavaScript receives a syntax
check. These commands do not run package scripts or canonical test suites.
The synchronous exported function receives positional arguments from JSON data.
Its separate result file is untrusted and validated before comparison.

Execution limits: 20 cases, 60 seconds per batch, 20 seconds for compilation,
2 seconds per case, 16 KiB combined stdout/stderr per case, 64 KiB result per
case and 512 KiB response. The adapter also caps aggregate results and logs;
remaining cases are skipped when those budgets are exhausted. Print floods
terminate the case and flag truncated output. Process groups are killed and
scratch removed on completion, errors, timeouts and request disconnects.
Bubblewrap provides isolation; the runner VM's existing resource policy still
owns CPU, memory and disk limits.

## Repeatable checks

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm test
corepack pnpm build
node --test server/practice-run.test.ts
```

When bubblewrap is missing, the two real execution tests report unavailable.
That result does not establish isolation. Run the required fixture checks:

```sh
docker build -t stupen-practice-fixture:wave4 -f scripts/practice-fixture.Dockerfile .
docker run --rm --privileged --network none \
  -e PRACTICE_INTEGRATION=1 \
  -v "$(pwd -P):/workspace:ro,z" -w /workspace \
  stupen-practice-fixture:wave4 node --test server/practice-run.test.ts
```

The disposable container needs namespace privileges for nested bubblewrap.
It mounts only the checkout read-only and has no network at test time. Its Node
executable uses the runner VM’s `/opt/node` symlink layout. CI runs these same
required integration checks after the unit suite.
`PRACTICE_INTEGRATION=1` turns unavailable sandbox/agent checks into failures.
These tests run the local adapter and a real authenticated child runner agent,
including success, invalid inputs/output, compile/runtime errors, timeout,
print floods, hidden-file/credential exclusion, fresh case state, cleanup,
old-agent refusal, overlap rejection and unchanged graded metadata/tests.
HTTP tests also cover sessions, ownership, the app header, storage and byte
limits; quota tests check that practice and canonical checks share a counter.

For the browser check, start Vite on port 5198, then run:

```sh
BASE=http://127.0.0.1:5198 node scripts/verify-editor.ts
```

The browser uses isolated API fixtures, not model calls or production data.
It checks source-save ordering/failure, invalid-input gating, duplicate-click
prevention, actual output, edits during execution, stale code/input results,
old-runner messaging and unchanged canonical/coach behavior, alongside the
existing editor/layout/phone regressions.

## November 15, 2026 evidence and rollout boundary

On Dozor, all six focused practice tests passed inside the disposable fixture,
with no skips. The real child agent exercised `RUNNER_URL` over authenticated
HTTP; this is transport and sandbox evidence on one host, not a test of the
production runner VM. The editor browser check passed, including its practice
flow and existing desktop, phone, keyboard and reference-solution checks.

No host packages, production app or runner were changed. Deploy a compatible
runner first, read back `/v1/status.practice`, then enable the app in the later
rollout issue. An old, unavailable or sandbox-disabled runner cannot execute
practice and never causes a fallback onto a remote app host. Review this new
untrusted-input path and the integration evidence before production activation.

## Python adapter (#24)

Python uses the existing tools venv (`STUDY_TOOLS_DIR/py/bin/python`). Capability
is advertised only after that interpreter runs inside bubblewrap. Compilation
checks every allowed Python source with `compile(..., 'exec')` without executing
it. The maintained harness imports the declared module, calls its synchronous
function with parsed JSON arguments, and rejects non-JSON or unsafe numeric
returns. Tracebacks retain learner file/line locations. It never invokes pytest.

The disposable fixture now provisions a Python venv. Eight focused tests pass
with no skips, including Python local and authenticated remote runs, wrong
answers, missing expected output, scope/syntax errors, runtime exceptions,
timeouts, string encoding, serialization errors, nested relative imports, UTF-8 output bounds and fresh case state. The
browser fixture also exercises Python through the same Run/result controls.
Production deployment remains the later rollout checkpoint.

## Go adapter (#25)

Go capability requires a sandboxed Go 1.24-or-newer toolchain. The adapter
compiles an offline `module lesson` once, then copies that binary into a fresh
sandbox for every case. It never runs `go test` or canonical `_test.go` files.
Missing `go.mod` gets the maintained minimal offline module; existing manifests
remain in the scratch snapshot. Inputs remain JSON data, never generated source.

For object schemas, `goSchemaTypes` defines `StupenPracticeInput0`, subsequent
inputs, and `StupenPracticeOutput`. Nested names append `FieldN` or `Item`;
fields are `Field0`, `Field1`, etc. in schema property order. Generated lessons
include these definitions in read-only support `stupen_practice_types.go` beside
the entry file, so canonical checks can compile too. Practice excludes that
support copy and regenerates it from validated metadata. Both generated types
and the harness are formatted before compilation. JSON-tagged structs also
have explicit codecs for property names that Go tags cannot represent.

The result reader bounds Go's internal escaped wire representation separately
(up to six times the public limit), then enforces 64 KiB on the parsed actual
JSON value before returning it. This preserves valid HTML characters, Unicode
separators and literal backslash-u strings without weakening response limits.

The disposable fixture includes Go 1.24 and runs local and authenticated remote
Go execution. Coverage includes compile/runtime errors, timeout, wrong answers,
missing expected output, fresh case writes, protected-file exclusion, object
schemas and encoding bounds. The browser fixture exercises Go success, runtime
error and unavailable states through the shared controls. Production activation
still belongs to the separate rollout issue.
