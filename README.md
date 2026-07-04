# Inside the GameCube

Interactive, explorable teardowns of the Nintendo GameCube's hardware — part of
the [**oldmachines**](https://github.com/oldmachines) collection.

Each subsystem is a self-contained, dependency-free static site: no build step,
no framework, no tracking. Open it in a browser and it runs.

## Subsystems

| Subsystem | Status | Path |
| --- | --- | --- |
| **Audio & the DSP** | ✅ Ready — 13-module interactive course | [`audio/`](audio/) |
| Graphics & Flipper | 🛠 Planned | — |
| CPU & Gekko | 🛠 Planned | — |
| The disc drive | 🛠 Planned | — |

### Audio & the DSP

A course in three parts — digital signal processing fundamentals, the GameCube
DSP (ucodes, AX mixing, Dolby Pro Logic II), and how emulators reproduce it
(LLE vs HLE, ucode dispatch, the output path). Every module has an **integrated
sound player**: all audio is *synthesised live in the browser* with the Web
Audio API to demonstrate a concept — plus one short synthetic speech clip
("can you hear me?", `audio/canyouhearme.wav`) generated with the open-source
[Piper](https://github.com/rhasspy/piper) TTS (voice `jenny_dioco`) for the
surround-panning lab. **No copyrighted game audio is shipped.**

## Running locally

It's a plain static site. Open `index.html`, or serve the folder:

```sh
python3 -m http.server 8000
# → http://localhost:8000
```

Audio starts on first interaction (browsers require a user gesture before
playing sound).

## Deployment

Pushing to the default branch publishes to GitHub Pages via
`.github/workflows/pages.yml`. Enable Pages once under
**Settings → Pages → Source: GitHub Actions**. The site then lives at
`https://oldmachines.github.io/gamecube/`.

## Accuracy & credits

Technical content is grounded in the [Dolphin emulator](https://github.com/dolphin-emu/dolphin)
source — chiefly `Source/Core/Core/DSP/`, `Source/Core/Core/HW/DSPHLE/UCodes/`,
and `Source/Core/AudioCommon/`. These are educational explainers, not
authoritative specifications.

"Nintendo" and "GameCube" are trademarks of Nintendo. This is an independent,
non-commercial educational project and is not affiliated with or endorsed by
Nintendo.

## License

Code is released under the [MIT License](LICENSE). See the file for details.
