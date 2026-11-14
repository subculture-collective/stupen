# Stupen website

The landing page and user docs, as static HTML with no build step and no backend. It is meant for <https://stupen.subcult.tv> and is not deployed yet. `deploy/` holds the container and Caddy files for when it is.

## Preview

```sh
python3 -m http.server 18785 --bind 127.0.0.1 --directory site
```

Open `http://127.0.0.1:18785/` and `/docs/`.

## Keeping it accurate

Every count and name on the pages comes from this repository. Change the pages when these change:

| Fact on the page | Source |
| --- | --- |
| The seven help levels and their wording | `LADDER` in `server/coach.ts` |
| A lesson is shown only after its reference passes and its starter fails, with one retry | `lessonJob` in `server/jobs.ts` |
| 12 quick formats | `RUNNERS` in `server/runners.ts`, without `container` |
| 13 container environments | `PRESETS` in `server/environments.ts` |
| Upload formats and link rendering | `server/extract.ts`, `server/materials.ts` |
| 13 prompts and their six triggers | `DEFAULT_PROMPTS` and `TRIGGERS` in `server/prompts.ts` |
| Keys | `web/src/Editor.tsx`, `web/src/Coach.tsx`, `web/src/ui.tsx` |
| Default help limit by level | `trackFields` in `server/store.ts` |

The help-limit demo on the landing page is a mock-up: its replies were written for the page and are labelled as such. `app.js` runs only the demo; the page reads fully without it.

The page states that Stupen is not released and has no public source. Claims follow C-STUDY-01 to 06 in `studio/content/social/Product Claims Register.md` in `subcult-tv`.

## Brand

The marks, the stair drawing, `assets/og.png` and the icons come from `studio/brands/stupen` in `subcult-tv` (pack built November 14, 2026; not yet approved for website use). The fonts are Manrope, Golos Text and Martian Mono from google/fonts. They are subset to Latin and Cyrillic WOFF2 and keep their OFL texts in `fonts/`.

Support links go to `https://subcult.tv/support`, per `studio/content/patreon/support-redesign-2026-10/site-guidelines.md`. There is one support block on the landing page, a quiet footer link, no prices or tiers, and no ask on the error page.

The footer has no source-repository link because the source is not public.
