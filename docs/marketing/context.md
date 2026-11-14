# Stupen marketing context

Prepared: November 14, 2026. Owner: SUBCULT (onnwee). Status: draft. Product revision: this repository after the container environments work (`c580013`) and the Stupen site. Deployment: the app runs at https://study.subcult.tv behind SUBCULT's sign-in. Last journey check: November 14, 2026, on a local copy (scratch data). Checked steps:
- create a track;
- generate a plan and a lesson;
- fail and pass the checks;
- get an automatic review;
- get a written answer graded.

A signed-in browser session through the public URL has not been checked.

## Product facts

- **Public name and canonical URL:** Stupen, https://stupen.subcult.tv for the site and https://stupen.subcult.tv/app/ for the app (open since November 14, 2026).
- **Product category and maturity:** a practice coach that runs on the web. It is in development, unreleased and self-hosted on SUBCULT's homelab.
- **One sentence:** Stupen helps people learning any subject practise at their own level. It plans the steps, builds exercises it has already solved, and coaches them up to a help limit they set.
- **Current offer:** a free account; the learner connects their own AI provider account or API key, which the provider bills. No price, no download.
- **Requirements:** an email address (or GitHub, or a passkey), an API key or OpenRouter account, and a modern browser.
- **Primary action:** read how the help limit works (https://stupen.subcult.tv/#demo). Invited learners can also sign in at https://study.subcult.tv.
- **Feedback and support destination:** https://subcult.tv/support for supporting the collective. Issues: https://github.com/subculture-collective/stupen/issues.

## Audience and positioning

**Primary audience (hypothesis):** self-taught learners who use chat assistants and notice they learn less when the assistant writes the answer. They range from beginners learning a first language to experienced developers picking up a new one.

**Job in their words:** "I want to get better at this myself, not watch something else do it."

**Current alternative:** asking a general chat assistant for help, which often gives the full answer at once; or course platforms with fixed exercises that don't adapt to the learner's level or goals. This is an assumption, not research.

**Reason to try this product:** the help limit. The learner decides how much help the coach may give, from questions only to a full solution, and every reply says which level it used (C-STUDY-02). Exercises are solved before they are shown (C-STUDY-03).

**Research basis:** an explicit hypothesis. There are no interviews or support threads yet. Question for the campaign: do learners change the help limit during a lesson, or set it once?

## Voice and visuals

Brand master: `studio/brands/stupen`, built November 14, 2026, pending approval. Voice source: the Stupen section of `studio/content/VOICE.md`.

- **Voice rule:** say exactly what the coach will and won't do. Example: "Level 3 means it tells you what is wrong, not how to fix it."
- **Vocabulary to use:** help limit, step, lesson, plan, checks, materials, prompts.
- **Wording to avoid:**
  - "AI tutor", "master any skill", "learn 10x faster": they claim outcomes there's no evidence for.
  - "personalized learning journey": empty.
- **Palette and type:** see `tokens.json` in the pack.
  - Plaster ground, ink text, dimension-blue links.
  - Nosing yellow is a fill only.
  - Manrope ExtraBold display, Manrope ExtraLight numerals, Golos Text body, Martian Mono labels.
- **Logo and layouts:** the Stair section mark and lockups in `logos/`, the stair scene in every layout, and social templates marked SAMPLE. None is approved for publishing yet.

## Claims and evidence

| ID | Proposed public claim | Evidence / revision / date | Status and qualification | Review trigger |
| --- | --- | --- | --- | --- |
| C1 | You set a help limit from 0 to 6; the coach stays under it and labels each reply with the level used | `LADDER` and `systemPrompt` in `server/coach.ts`; level parsed from replies in `HeaderParser`; C-STUDY-02 | Supported as behaviour of the instruction. It is not a guarantee: the model can exceed it, so always say so | Change to the coach prompt or ladder |
| C2 | Every coded exercise is solved before you see it: the reference passes, the starter fails | `lessonJob` in `server/jobs.ts`; checked with a Rust lesson and a React container lesson on November 14, 2026; C-STUDY-03 | Supported. Name the exception: a lesson that fails after one retry is shown marked "tests unverified" | Change to lesson generation |
| C3 | 12 quick formats and 13 container environments with any packages | `RUNNERS` in `server/runners.ts`; `PRESETS` in `server/environments.ts`; each preset passed a test with a real dependency on November 14, 2026; C-STUDY-04 | Supported for the homelab deployment; the toolchains must be installed on the server | A runner or preset is added or removed |
| C4 | Runs on Claude and ChatGPT subscriptions; the coach can search the web when you allow it | `server/providers/`; C-STUDY-05 | Supported. Do not name model versions | Provider change |
| C5 | Any outcome ("learn faster", "better retention") | none | Remove | Only with measured evidence |

**Excluded or planned capabilities:**
- pricing or a paid plan;
- mobile apps;
- teacher or classroom features;
- progress analytics beyond the coach's notes.

**Unresolved facts:**
- whether and when Stupen opens to the public, and on what terms (owner);

## Demonstration and measurement

**First-use journey:** create a track for Python at beginner level → open the first lesson → run checks (they fail) → choose "Explain the failure" → fix the code → run checks (they pass) → the automatic review arrives.

**Evidence:** local captures from November 14, 2026, on scratch data, using the real app with synthetic content. A capture through the public URL is still needed.

**Primary campaign outcome:** visitors who use the help-limit demo on the site.
- **Counted:** a step chosen in the demo.
- **Out of:** landing page visits.
- **Window:** 30 days after the site goes live.
- **Measurement source:** unavailable. The site has no analytics, so record this as unmeasured unless the owner adds a privacy-respecting counter.

**Baseline:** not yet measured.

**Next decision:** after 30 days, review sign-ups, limits and feedback, based on direct feedback rather than views.
