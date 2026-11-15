# Editable cases, version 1

Decision for [#13](https://github.com/subculture-collective/stupen/issues/13),
November 15, 2026. This specifies future implementation; it does not enable
practice execution. Canonical checks and written grading remain unchanged.

## Lesson contract

Add optional `practice` metadata to `LessonMeta`. Absence means legacy behavior;
do not infer a callable from source code. Generate and validate metadata with the
lesson, before publishing it. Invalid metadata is omitted with a generation
warning; it must not make an otherwise usable lesson unreadable.

Generation wire format (#14): the model returns `practice` as a JSON-encoded
string, or an empty string for incompatible exercises. This keeps the provider's
closed response schema simple and lets validation reject duplicate keys before
parsing loses them. Stored metadata and the lesson API use the validated object
below, with no execution-capability flag. Publication requires successful
canonical reference/starter verification; it does not claim the samples have
been executed by a practice adapter.

```json
{
  "practice": {
    "version": 1,
    "entry": { "file": "solution.ts", "symbol": "twoSum" },
    "inputs": [
      { "name": "nums", "schema": { "type": "array", "items": { "type": "integer" } } },
      { "name": "target", "schema": { "type": "integer" } }
    ],
    "output": { "type": "array", "items": { "type": "integer" } },
    "cases": [
      { "id": "sample-1", "name": "Distinct values", "inputs": { "nums": [2, 7, 11, 15], "target": 9 }, "expected": [0, 1] }
    ]
  }
}
```

`entry.file` must be an existing learner-editable starter file of the track's
runtime. `symbol` and input names are ASCII identifiers, at most 64 characters;
names must be unique and not language keywords. Allow named top-level functions
only, with positional arguments ordered by `inputs`. No methods, classes, stdin
programs, async functions, generators or language translation in v1. The lesson
brief must state the callable signature and that array order matters.

Schema is a closed recursive subset, not arbitrary JSON Schema: `boolean`,
`string`, `integer`, `number`, `array` with one `items` schema, and `object` with
`properties` and a `required` array naming every property. No extra properties,
optional fields, unions, null values, references or recursive schemas in v1.
Maximum schema/value nesting is 8; at most 16 inputs, 64 properties per object,
1,000 elements per array and 8,192 UTF-8 bytes per string. Integers are within
±9,007,199,254,740,991; numbers must be finite binary64 values. Reject duplicate
JSON keys, unsafe integers, NaN and infinity at every boundary. A callable's
declared language types must match this schema. Go maps `integer` to `int64`,
`number` to `float64`, arrays to slices and objects to generated named structs
with JSON tags; no reflection-based guessing of learner types.

Cases have unique IDs (1–64 ASCII letters/digits/hyphens), names (1–80
characters), exact named `inputs`, and optional `expected`. A sample may omit
expected output, though generation should provide it. A custom case may omit it
to inspect actual output. Presence is tested by property ownership, not
truthiness: `false`, `0`, `""`, `[]` and `{}` are valid expected outputs when
their schema permits them. The UI retains sample IDs when edited; custom IDs
use a separate `custom-` prefix. Generation publishes 1–10 visible cases;
practice requests may include 1–20 cases in the requested order.

## Runtime examples

All three examples use the metadata above and the same named inputs/results.
Only the entry and callable declaration change. JavaScript uses the TypeScript
adapter with `entry.file: "solution.mjs"` and no annotations.

| Track | Entry payload | Callable signature |
| --- | --- | --- |
| TypeScript | `{"file":"solution.ts","symbol":"twoSum"}` | `export function twoSum(nums: number[], target: number): number[]` |
| Python | `{"file":"solution.py","symbol":"two_sum"}` | `def two_sum(nums: list[int], target: int) -> list[int]` |
| Go | `{"file":"solution.go","symbol":"TwoSum"}` | `func TwoSum(nums []int64, target int64) []int64` in `package lesson` |

Pass inputs as parsed data, never interpolate values into shell commands or
source. Adapters are maintained app/agent code, not generated model programs.
They load only the validated entry and allowed starter/support dependencies;
TypeScript uses the existing erasable-syntax rules, Python uses the runner's
tools venv, and Go uses the lesson's offline module. The Go adapter generates
schema types in a reserved harness file in the same package, with deterministic
names documented for the generator. Compile without canonical `_test.go` files;
do not invoke pytest or `node --test` for practice.

## App API and side effects

Add authenticated `POST /api/tracks/:track/lessons/:lesson/run`:

```json
{
  "version": 1,
  "cases": [
    { "id": "custom-1", "name": "Repeated values", "inputs": { "nums": [3, 3], "target": 6 } }
  ]
}
```

Read entry, schemas and runtime from the owned lesson/track, never from this
request. Validate the entire batch before execution. The client saves pending
source edits first, as checks already do; the server snapshots current source.
Run must not call `checkLesson`: no writes to attempts, status, passedAt,
lastChecks, failStreak, submissions, help usage or coach trigger history. The
existing `/check` endpoint remains canonical Submit; custom cases can never
change its tests or pass decision. Written lessons keep coach grading.

Reuse session ownership checks, CSRF/origin handling and storage enforcement.
Charge practice and canonical checks to the *same* existing per-account checks
quota (150/hour, with the existing admin exemption), rather than creating a
second quota. Permit one in-flight practice batch per account; return 429 for
overlap. Do not persist results in this slice. Later case persistence belongs
to #15 and submission history to #23.

## Runner boundary and capabilities

Source inspection: `exec.quickChecks` selects canonical commands via
`lessonCommands`; its overlay cannot supply a separate command. Reusing it
unchanged would run the canonical suite. `exec.sandboxed` already provides
local/remote execution, but the agent accepts only flat file names, runs one
command with a fixed 60-second timeout, merges stdout/stderr and has no
structured case result or output-truncation flag. Neither operation currently
advertises practice support. Do not reinterpret either operation's payload.

Add a backward-compatible `/v1/practice` agent operation and
`exec.practice(...)`, using the existing authenticated `call` transport and
sandbox primitive. Share validation, adapters and comparison between local and
remote execution. This is an extension of the current runner, not a second
execution service. Leave `quick`, `sandboxed`, containers and previews intact.

Extend `/v1/status` with optional
`practice: { version: 1, runtimes: ["typescript", "javascript"] }`, adding
`python` and `go` only once their adapters are implemented and integration
tested (#24/#25). Missing or malformed capability means no support, including
on an old agent. The app's cached status (currently one minute) may delay
enablement; never treat runner toolchain availability alone as practice
capability. Local mode calculates the same capability from implemented
adapters, installed toolchains and a working sandbox. Refuse practice when
sandboxing is disabled or unavailable; never fall back to app-process execution.

| Lesson/runtime | Editable-case UI and Run | Canonical action |
| --- | --- | --- |
| TS/JS with valid v1 metadata and matching agent capability | Enabled after #16/#19 | Existing checks as Submit |
| Python/Go with valid metadata | Disabled with reason until adapter capability exists | Existing checks as Submit |
| Legacy lesson without metadata, even TS/JS/Python/Go | No editable-case execution advertised | Existing checks |
| Rust, Java, C/C++, SQL, shell, other quick formats | Unsupported in v1 | Existing checks |
| Custom-command or container track | Unsupported in v1; preserve separate container preview | Existing configured checks |
| Written lesson | No code Run | Coach grading |
| Old/unreachable runner or unsupported metadata version | Disabled with reason; no speculative execution | Existing checks, with normal availability errors |

Package only starter/support source and necessary runtime manifests, never
canonical tests, `.reference`, `.meta`, `.cache` or app/user data. Apply the
existing pack exclusions to local *and* remote paths; local `runChecksIn`
currently excludes `.reference`/`.meta` but not `.cache`, so it must not simply
copy the lesson for practice. Use an allowlist built from the lesson file list,
safe relative paths and non-symlink regular files. Reserve the harness prefix
and reject collisions. Keep app credentials out of child environments. Create
a fresh throwaway sandbox for each case so globals and file writes do not leak
to the next; compile Go once per batch, then run its binary in fresh sandboxes.
Delete scratch files on success, timeout, disconnect and failure.

## Results, comparison and bounds

```json
{
  "version": 1,
  "sandboxed": true,
  "durationMs": 21,
  "results": [
    { "id": "custom-1", "status": "completed", "actual": [0, 1], "stdout": "", "stderr": "", "durationMs": 3, "outputTruncated": false }
  ]
}
```

Validate actual output against the declared schema before comparison. Use exact
structural JSON equality: types must match, strings compare Unicode code points
without normalization, arrays are order-sensitive, object key order is ignored
but key sets must match, and numbers compare their finite binary64 values
(`-0` equals `0`). There is no tolerance or unordered-array mode in v1.
With expected output present, use `passed` or `failed`; without it, use
`completed`, never passed. Never execute the protected solution to obtain an
expected answer. A practice “passed” result is not a graded submission.

Per-case states also include `compile_error`, `runtime_error`, `timeout`,
`invalid_output` (wrong schema, missing/oversized/malformed result or unsupported
return value), and `skipped` (batch budget exhausted). A build failure yields
`compile_error` for every requested case with shared bounded diagnostics.
Exceptions/panics are `runtime_error`; continue other cases while budget allows.
Transport/capability failure is a request error, never a failed test. App errors:
400 invalid contract/inputs; 404 ownership-safe missing lesson; 413 size limit;
422 unsupported lesson; 429 quota/concurrency; 503 missing capability or runner
outage; 502 malformed agent response. Preserve errors in the UI without losing
edited cases. Results retain request order and IDs.

Separate captured stdout/stderr from the harness result channel. Use a reserved
result file with bounded, no-symlink reads and strict decoding, not console
markers that collide with learner prints. The learner can still tamper with
practice output inside its sandbox: treat it as untrusted, never as progress or
a security assertion. Validate responses again at the app boundary.

Limits to implement (not claims about the current sandbox): 256 KiB UTF-8 case
request, 32 KiB per case including expected output, 64 KiB actual result per
case, 16 KiB combined stdout/stderr per case, 512 KiB entire response, 60 seconds
per batch including compilation, at most 20 seconds compilation and 2 seconds
execution per case. Enforce byte limits while capturing, kill the process group
on timeout, flag clipped diagnostics, and cap accumulated output. Metadata is
at most 64 KiB; keep the existing source-package limits (5 MB/file, 40 MB total)
and 60 MB agent body limit, with early rejection before decoding. Use the VM's
existing resource policy; do not claim bubblewrap alone imposes CPU/memory
limits. Runner integration must verify wall-time/output enforcement and cleanup.

## Delivery and compatibility order

1. #14 adds optional validated metadata and generation examples for all three
   runtime families, without advertising execution. #15 edits/persists cases.
2. #16 implements shared validation/results, TS/JS adapters, local sandbox
   execution, agent capability and `/practice`, then the authenticated app API.
   Deploy the compatible agent before enabling app Run; a newer app against an
   old agent must remain usable with canonical checks. Record real local and
   remote sandbox integration evidence, including hidden-file/credential
   exclusion, malformed input/output, print floods, timeout and cleanup.
3. #19/#22 expose distinct Run/Submit and results. #24/#25 add Python/Go adapters
   using this same contract and real sandbox verification before advertising
   each capability. Do not mark planned capabilities available prematurely.
4. #26 qualifies combined/legacy flows; #27 owns the human rollout checkpoint.
   Roll back the app first if needed; the extended agent remains backward
   compatible. Removing agent capability disables practice without changing
   lesson files, canonical checks or progress.

Evidence inspected: `server/{store,index,runners,exec,agent,sandbox,limits}.ts`.
No learner code, production runner or deployment was changed for this decision.
