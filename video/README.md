# Cloudesk product film

An 82-second, 1920×1080, 30 fps product film made with [Remotion](https://remotion.dev): Apple-style minimalism with
a quiet thriller atmosphere. No voice. One continuous shot: a line of light finds the brushed-metal emblem, the
emblem becomes the boot mark of a dark glass display, the camera glides through the real product close up, every
module emerges from the dark, and the film resolves on the signature.

```
npm install
node music.mjs     # the ambient soundtrack and sound design → public/music.wav
npm run studio     # preview and scrub
```

| File | What it does |
|---|---|
| `src/cues.js` | The film's timing in seconds: the acts, what the screen shows when, every sound cue, the pulse |
| `src/film.tsx` | The film: emblem, display, camera, title blocks, signature — on one clock |
| `music.mjs` | The original ambient soundtrack (drone, pads, resonances, swells, pulse, clicks) from the cue sheet |

Layout system: 160 px side margins; a single title block, centred, headline at y 132 and supporting line below it;
the display's screen at x 480–1440, y 330–930. Change a time in `src/cues.js`, then run `node music.mjs`.

## Rendering from the iCloud Desktop

Remotion's headless Chrome crashes ("icu_util … Check failed") inside this iCloud-synced folder. Copy it out once:

```
cp -R node_modules/.remotion/chrome-headless-shell/mac-arm64/chrome-headless-shell-mac-arm64 ~/remotion-chrome
npx remotion render src/index.ts Intro out/cloudesk-film.mp4 --crf=15 --audio-bitrate=320k --browser-executable=$HOME/remotion-chrome/chrome-headless-shell
```

## The other films in this project

| Composition | Film | Soundtrack |
|---|---|---|
| `Idea` | "What starts as an idea." — the Cloudesk launch film (60 fps, master rendered at 4K with `--scale=2`): `src/idea.tsx`, timing and cues in `src/idea-plan.js` | `node music-idea.mjs` → `public/music-idea.wav` |
| `MailLaunch` | The Mail launch film: `src/launch.tsx`, `src/launch-plan.js` | `node music-launch.mjs` |
| `MailUp` | The upbeat Mail film: `src/mail-up.tsx`, `src/up-plan.js` | `node music-up.mjs` |
| `Mail` | The calm Mail film: `src/mail.tsx`, `src/cues-mail.js` | `node music.mjs mail` |

Render any of them the same way, with its composition id, e.g.
`npx remotion render src/index.ts Idea out/cloudesk-idea-4k60.mp4 --crf=16 --scale=2 --audio-bitrate=320k --browser-executable=$HOME/remotion-chrome/chrome-headless-shell`.
The Idea film's assets are in `public/idea/` (real captures of Launch, the builder with its assistant, the AI IDE, the store picker's six templates and four finished storefronts, plus the site's own sunlit product photo as a backdrop).

## Licence

Music and sound effects are synthesised in `music.mjs` — original, no third-party samples. Remotion is free for
individuals and companies of up to 3 people; larger companies need a [company licence](https://remotion.pro/license).
