# Stupen marketing packet

Status: draft. Owner: SUBCULT (onnwee). Based on the [product context](context.md). Campaign: introducing the name and the site before any public release. Everything below needs the owner's approval, and the site and pack must be approved for public use first. Nothing here is a launch post for a release, because there is no release.

## Positioning

Stupen is a practice coach for people who want to get better at something themselves. You choose how much help it may give, from questions only to a full solution, and it builds every exercise only after solving it first.

## Short descriptions

- **One line:** A practice coach that gives you exactly as much help as you ask for.
- **Profile bio (160):** Stupen plans your practice, builds exercises it has already solved, and helps only as much as you allow. By SUBCULT. Not released yet.
- **Directory description:** Stupen is a web practice coach for any subject and level. It writes a plan, builds hands-on lessons, and its coach stays under a help limit you set from 0 to 6. In development; runs on SUBCULT's homelab.
- **Page title:** Stupen: exactly as much help as you ask for
- **Meta description:** Stupen is a practice coach for any subject at any level. It plans what to practise, builds exercises it has already solved, and helps only as much as you allow, on a help limit from 0 to 6.

## One-page product brief

**Headline:** Exactly as much help as you ask for.

When you're learning with a chat assistant, it's easy to get the answer before you've had the chance to find it. The practice that would have made it stick never happens.

Stupen helps people learning any subject practise at their own level. It writes a plan, builds each lesson with real tests or a written task, and coaches you in chat. Before it starts, you set a help limit from 0, questions only, to 6, a full solution. Every reply says which level it used.

Each coded exercise is checked before you see it: the hidden solution must pass and the starter must fail (C2). The coach can still be wrong. The limit is an instruction it follows, not a guarantee (C1).

Stupen is not released. It runs on SUBCULT's homelab for invited learners.

**Next step:** see how the help limit works at https://stupen.subcult.tv/#demo. **Contact:** https://subcult.tv.

## Landing page

The landing page in `site/index.html` follows this copy.

- **Hero:** Exactly as much help as you ask for.
- **Supporting copy:** Stupen is a practice coach for any subject at any level. It plans the steps, builds exercises it has already solved, and coaches you only as much as you allow, on a help limit from 0 to 6.
- **Primary button:** Try the help limit
- **Section 1, the help limit demo:** pick a step and see the same stuck moment answered at that level. Labelled as a mock-up.
- **Section 2, what it does:**
  - 7 help levels;
  - 2 checks before a lesson reaches you;
  - 12 quick formats;
  - 13 container environments;
  - 4 ways to add materials;
  - 13 prompts.
- **Evidence:** the verification rule (C2), stated with its exception.
- **Final action:** Read the docs.

## FAQ

1. **What does it do?** It plans what you practise, builds lessons with tests or written tasks that it has solved first, and coaches you in chat up to a help limit you choose.
2. **Who is it for?** Anyone practising a subject on their own, from brand new to expert. It suits programming best, because most formats have automated tests, but written answers work for any subject.
3. **What does it cost and what do I need?** It isn't available to the public. Invited learners need an account on SUBCULT's sign-in and a browser.
4. **How do I complete the first task?** Create a track, open the first lesson, write your solution and press Run checks. Ask the coach when you're stuck.
5. **What are its limits?** It isn't released. The coach is a language model and can be wrong. Lessons can contain mistakes, and a lesson that couldn't be verified says so.
6. **Where do I get help?** Invited learners ask SUBCULT directly. There's no public tracker yet.

## Channel copy

These posts introduce the name and the idea before a release. Pair each with the stair scene from `social/` in the pack, once the pack is approved.

**Short social post:** Most chat assistants hand you the answer. Stupen asks how much help you want first, from 0 (questions only) to 6 (full solution), and stays under that. Not released yet. How the help limit works: https://stupen.subcult.tv/#demo

**Demo thread:**

1. You're stuck on a failing test. How much help do you want? Stupen makes you choose, from 0 to 6, before it answers. [stair scene]
2. At 0 it only asks questions. At 3 it tells you what's wrong but not how to fix it. At 6 you get the full solution, and the attempt is closed. [demo capture at 0, 3 and 6]
3. Every exercise is solved before you see it: its hidden solution passes the tests and the starter fails them. If that can't be verified, the lesson says so.
4. It's not released yet; it runs on our homelab. Try the help limit on the site: https://stupen.subcult.tv/#demo

**Community introduction** (only where self-promotion is allowed; say up front that we built it): We're SUBCULT and we built Stupen, a practice coach with a help limit. You set how much the coach may help, and it labels each reply with the level it used. It isn't released. We'd like to know: when you learn with an assistant, would you set the limit once, or change it as you go? https://stupen.subcult.tv

**Newsletter:**
- Subject: A coach that asks how much help you want.
- Body: Stupen is a practice coach we've been building. Before it helps, you choose how much: questions only, a hint, a diagnosis, all the way to a full solution. Every exercise is solved before you see it. It isn't open yet; here's how the help limit works: https://stupen.subcult.tv/#demo

## Release note template (for the first public release)

Stupen [version], [date]

- **What's new:** [one line per change, from the commit log]
- **Who can use it:** [access terms once decided]
- **Known limits:** the coach can be wrong; lessons that couldn't be verified are labelled.
- **Read more:** https://stupen.subcult.tv/docs/

Do not use this before a release exists.

## Demo and media brief

**Goal:** show the help limit changing one answer.

**Source:** the app on the homelab, with a scratch track using synthetic content (a Python "count words" lesson). No real learner data.

| Segment | Actual capture | Caption or narration |
| --- | --- | --- |
| Opening | A failing check in the lesson | "Stuck. How much help do you want?" |
| Action | Set the help limit to 0, ask; then to 3, ask; then to 6 | "0 asks questions. 3 names the problem. 6 solves it, and closes the attempt." |
| Result | The coach replies, each labelled with its level | "Every reply says which level it used." |
| Close | `video/end-card` from the pack | "Exactly as much help as you ask for. stupen.subcult.tv" |

**Required assets:** a 1920×1080 screen recording and three stills (levels 0, 3 and 6), plus the pack's title card, end card, lower third and captions. Record capture dates and the alt text for each still.

## 30-day execution sheet

- **Start:** after the owner approves the pack and the site, and the site is deployed (America/Chicago).
- **Owner:** onnwee.
- **Weekly time:** 2 hours.
- **Spend:** $0.
- **Channels:** Bluesky and X, plus one community post where allowed, because the audience already discusses learning with assistants there.

| Period | Work | Owner | Completion evidence | Next decision |
| --- | --- | --- | --- | --- |
| Week 1 | Check the site and demo on phone and desktop; check the facts against the source; approve one post | onnwee | Journey and copy review notes | Ready, or fix first |
| Week 2 | Post the short post with the stair scene; answer replies | onnwee | Post links and replies | Which question got answers |
| Week 3 | Post the demo thread with real captures | onnwee | Thread link and replies | Whether to try the community post |
| Week 4 | Review feedback and time spent | onnwee | Dated note in this folder | Open sign-ups, keep invite-only, or stop |

## Publication readiness

- [ ] The owner approved the Stupen pack for website and social use.
- [ ] The site is deployed and checked at https://stupen.subcult.tv.
- [ ] The app shows the Stupen name and look, not "Study Coach".
- [ ] Every claim maps to C1–C4; no outcome claims.
- [ ] Captures use synthetic data; alt text and captions are written.
- [ ] Posting has the owner's go-ahead.
