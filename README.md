# El Jardín

The portfolio and CV of David Guijarro Ventosa (Guija). A small walled garden at dusk, drawn in realtime with
three.js and finished like old hand-tinted film. Every project is a flower: walk between the beds, walk up to a
flower and its field notebook opens with the full case and a short film strip of the work.

There are three ways in, built from the same content:

- **Jardín**, the realtime garden (WebGL2).
- **Herbario**, the same CV as a pressed-flower album in plain semantic HTML. It works with no JavaScript, and it is
  where the site starts when WebGL2 is missing, when reduced motion or Save-Data is on, or when the device is too slow.
- **Print**, the Herbario's print stylesheet: a one-page A4 CV, also built as `cv.pdf`.

Static site, no backend. Runtime dependency: three only. English by default, Spanish with the language label.

## Run, build, test

Node 23.6 or newer.

```sh
npm install
npm run dev        # local dev server
npm run build      # static build in dist/, runs from any path
npm run preview    # serve dist/ locally
npm run check      # the full gate: run before every commit
```

`npm run check` runs, in order and stopping at the first failure: `typecheck`, `build`, `budgets`, `e2e` (unit
tests and every end-to-end flow) and `licence`. Each step also runs on its own:

```sh
npm run typecheck  # TypeScript only
npm run budgets    # download sizes and Lighthouse on the Herbario (builds first when dist/ is stale)
npm run e2e        # unit tests and Playwright flows on desktop, mobile and the two low tiers
npm run licence    # every shipped image, sound, video and font accounted for
```

To run one flow, or one project of the test run, pass Playwright arguments after `--`:

```sh
npm run e2e -- --project=desktop -g "showcase"
npm run e2e -- --project=unit
```

The projects are `desktop`, `mobile`, `desktop-low`, `mobile-low` and `unit`; `-g` matches part of a test name.
The flows live in `tests/e2e/`, the unit tests in `tests/unit/`.

Other scripts: `npm run fills` lists every open gap in the content, `npm run assets` rebuilds the atlases and the
credits, `npm run cvpdf` prints `dist/cv.pdf` after a build and fails unless it is exactly one page, `npm run perf`
measures frame times, `npm run stills` renders the reference shots.

## Content

### Words and projects

- `content/projects.json`: one entry per project (title, one-liner, case text, stack, status, links, media, which bed
  and which flower). A project with `"private": true` never shows a repo link and says "Private repo, walkthrough
  on request" instead.
- `content/profile.json`: name, headline, about, education, languages, contact links, the CV file.
- `content/strings.json`: every interface word, in `en` and `es`.
- `content/beds/*.json`: one file per bed, with its sprites and its flower slots (see The garden below).
- Gaps are written as `[FILL]` or `[FILL: hint]`. They show on the page as quiet pencil blanks, never as invented
  text, and a media entry whose `src` is a gap shows as a blank frame. `npm run fills` lists every one that is still
  open.

### Add a project

1. Copy an entry in `content/projects.json` and give it a new `id` (lowercase, dashes). Fill `title`, the `en` and
   `es` texts, `stack`, `status` (`idea`, `wip` or `shipped`), `importance` (1 to 3), `year` and `links`.
2. Pick its `bed` (`rosaleda`, `estanque` or `semillero`) and its `flower` (`rose`, `lily`, `pod` or `bud`).
3. That bed needs a free slot for that flower in `content/beds/<bed>.json` (`slots` with `"kind": "project"` and a
   matching `accepts`). Projects take the slots by importance, then year, biggest slot first. When no slot is free
   the build stops and names the bed: add a slot by copying one and moving its `x`, `y`, `z`.
4. Add its media (next section) and run `npm run check`.

### Project media: the film strip

The panel of each project shows its `media` as a short film strip that pulls on by itself; the Herbario shows the
same files in the case.

- Put the files in `public/`, for example `public/shots/garagic-1.avif` or `public/shots/garagic-2.mp4`.
- List them in that project's `media` in `content/projects.json`, in order, as `{ "type", "src", "alt": { "en",
  "es" } }`. `type` is `image` or `video`. `src` is the path inside `public/` without a leading slash, so it works
  from any path: `"shots/garagic-1.avif"`.
- Videos play muted, looped and inline, with no controls: keep them short screen recordings with no sound.
- The strip shows 2 to 4 frames: entries after the fourth are left out, and blank frames pad a project with fewer
  than 2.
- Any `src` still written as `[FILL]` stays a blank frame. An `alt` that is a gap is read as the project's title.
- Your own screenshots and recordings must be declared in `archive/OWN.json` (for example `["public/shots/*"]`), or
  `npm run licence` fails on them.

### The garden

- `content/beds/*.json`: each sprite in `layers[].items` has `sprite`, `x`, `y`, `z`, `scale` and `w`: move it by
  changing the position, resize it with `scale`, or swap it by naming another sprite id from the atlas. `slots` are
  the project flowers, the links and the props.
- `content/garden.json`: the order of the beds, the garden path and the walk between them.

## Retouch

### The dusk level

How light or dark the garden reads while walking. Each is a constant at the top of its file:

- `ROAM_SKY` in `src/garden/place.ts`: the sky's top and horizon colours over every bed.
- `ROAM_DUSK` in `src/garden/place.ts`: the ambient light of each bed; raise it to lift the whole bed.
- `ROAM_MOON` in `src/gl/lights.ts`: colour and strength of the moonlight, the main key light on the beds.
- `ROAM_RIM` in `src/gl/lights.ts`: colour and strength of the rim light on edges and leaves.
- `LAMP_CEIL` in `src/gl/shaders/ground.frag.glsl`: how bright a lantern pool on the ground may get before it rolls off.
- `CARRIED_POOL` in `src/gl/shaders/ground.frag.glsl`: how much brighter the carried lantern's pool is than the others.
- `STAND_GAIN` in `src/gl/shaders/lights.glsl`: brightness of the standing lanterns along the beds.
- `STAND_REACH` in `src/gl/shaders/lights.glsl`: how far the standing lanterns throw their light, in metres.

The grotto keeps its own light. After a change, look at the garden on the dev server and run `npm run check`.

### The look

- Film layer (grain, vignette, dust, exposure, tone and the lifted black): constants at the top of
  `src/gl/film.pass.ts`, shader in `src/gl/shaders/film.frag.glsl`.
- Halation (the warm bloom around lights): `src/gl/halation.ts` and `HALATION_GAIN` in `src/gl/film.drive.ts`.
- Moonlight, haze and shadow: `src/gl/lights.ts`; sky and moon: `src/gl/sky.ts`; colour helpers: `src/gl/colour.ts`.
- Palette of the interface (zinc labels, notebook paper, ink, rose): the tokens at the top of
  `src/ui/styles/base.css`. The interface never gets grain or tint: it stays crisp on its own paper.

### Images

- Every image starts as an archival plate. `archive/recipes/*.json` says how each sprite is cut, split and
  re-tinted from its plates. `npm run assets` rebuilds the atlases in `public/atlas/`, the Herbario specimens in
  `public/thumbs/`, `archive/SOURCES.json` and the credits.

### Behaviour

- One state machine drives everything: `src/core/machine.ts` (states and events), `src/core/transitions.ts` (camera,
  iris and panel timings), `src/core/router.ts` (the URL), `src/core/motion.ts` (eases and durations).
- Any change there, or in `src/world/residency.ts`, needs a full `npm run check`: the transition budgets are measured,
  not eyeballed.
- Free roam is the default way through the garden: the visitor walks (`src/world/roam.ts`, `src/garden/roam.drive.ts`)
  and signposts, the plan and Tab walk them to a bed or a flower (`src/world/assist.ts`). Keys and pointer are in
  `src/core/input.ts`. `?roam=0` keeps the older rail camera for one release. The stills S01 to S12 are rail shots;
  S13 to S18 are free roam shots.

## Controls

- **Walk**: arrow keys or WASD. With a mouse, click the ground to walk there, or hold and drag to steer. On touch,
  tap the ground to walk there, or drag to steer.
- **Flowers**: walk up to a flower and its tag shows; click, tap or Enter opens it. Esc backs out one level: panel to
  flower, flower to bed, bed to the whole garden.
- **Film strip**: the arrow keys pull it frame by frame; pointing at it holds it. With reduced motion it never moves
  by itself and frames change at once.
- **Assisted walks**: a signpost walks the visitor along the path to the next bed; the plan (the "Projects" tag)
  unfolds a map of every bed and walks there. Any steering cancels an assisted walk at once.
- **Keyboard and screen reader**: every signpost, plan place and flower is a Tab stop. Tab onto a flower out of reach
  walks the visitor there and announces it on arrival; Enter opens it, Esc returns focus to it. Every project opens
  this way without steering. The "Exit to the CV album" button switches to the Herbario, the same content as plain
  HTML.

## Budgets

Measured by `npm run check`. `npm run budgets` gates the downloads and the Herbario; the e2e flows gate the frames,
draw calls and memory (counts are the gate; frame times are from the dev machine and only inform):

| Metric | High tier | Low tier |
|---|---|---|
| Draw calls, p95 | 80 or fewer | 40 or fewer |
| GPU texture memory | 128 MB | 48 MB |
| Frame time p95, 1080p | 8 ms | 25 ms with 4x CPU throttle |
| Panel open and close, travel | no frame over 25 ms | at most 2 frames over 50 ms |
| Garden and Herbario switch | no frame over 100 ms | no frame over 150 ms |

Also checked:

- First load: 3 MB or less, everything fetched until the garden is ready, fonts excluded.
- Each further bed: 2 MB or less (its atlas manifest and pages).
- App JavaScript: 150 KB gzip or less, without three.js.
- No long task over 100 ms.
- Herbario under Lighthouse (simulated fast 4G, 4x CPU): performance 90 or more, accessibility 95 or more, CLS 0,
  LCP 1.8 s or less.
- A five minute walk keeps heap and texture memory flat.

## Assets and licences

- Only public domain, CC0, CC BY and CC BY-SA, always with attribution. Never NC (non-commercial) or ND (no
  derivatives), never "all rights reserved" or an unclear licence.
- Every plate needs an entry in `archive/sources/*.json` with its source, creator, institution and licence.
  `npm run assets` merges them into `archive/SOURCES.json`, the one list the checks read.
- `npm run licence` fails on any shipped image, sound, video or font in `public/` or `dist/` that is not in
  `archive/SOURCES.json`, drawn by the build's own code, or declared as the owner's own in `archive/OWN.json`.
- The credits page data is `src/content/credits.json`, written from `archive/SOURCES.json` by `npm run assets`; never
  edit it by hand.
- Fonts: Kalnia and Schibsted Grotesk, both under the SIL Open Font License (`public/fonts/LICENSES/`).

## Not done yet

- Polish of the grotto mini-game.
- The stereoscope depth portrait.
- The mandala sundial strobe.
- The moth beyond its first stub.
- Music, parked on purpose: the album and the producer line sit in `content/parked/music.json` with the steps to bring them back.
- Audio (the system exists, off by default; no recordings yet).
- CI files and deploy. Nothing is published.
