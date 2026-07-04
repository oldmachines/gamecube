# Inside the GameCube

Interactive, explorable teardowns of the Nintendo GameCube's hardware — part of
the [**oldmachines**](https://github.com/oldmachines) collection.

Each subsystem is a self-contained, dependency-free static site: no build step,
no framework, no tracking. Open it in a browser and it runs.

## Subsystems

| Subsystem | Status | Path |
| --- | --- | --- |
| **Audio & the DSP** | ✅ Ready — 16-module interactive course | [`audio/`](audio/) |
| **Graphics & Flipper** | ✅ Ready — 16-module interactive course | [`graphics/`](graphics/) |
| **CPU & Gekko** | ✅ Ready — 15-module interactive course | [`cpu/`](cpu/) |
| **The disc drive** | ✅ Ready — 13-module interactive course | [`disc/`](disc/) |

Every course follows the same arc: **Part I** teaches the field's fundamentals
from absolute zero, **Part II** tears down the GameCube's take on it, and
**Part III** shows how the [Dolphin emulator](https://github.com/dolphin-emu/dolphin)
reproduces it. Each module ships **interactive labs** — everything is drawn and
synthesised live in the browser; no game assets are included.

### Audio & the DSP

A course in three parts — digital signal processing fundamentals, the GameCube
DSP (ucodes, AX mixing, Dolby Pro Logic II), and how emulators reproduce it
(LLE vs HLE, ucode dispatch, the output path). Every module has an **integrated
sound player**: all audio is *synthesised live in the browser* with the Web
Audio API to demonstrate a concept — plus one short synthetic speech clip
("can you hear me?", `audio/canyouhearme.wav`) generated with the open-source
[Piper](https://github.com/rhasspy/piper) TTS (voice `jenny_dioco`) for the
surround-panning lab. **No copyrighted game audio is shipped.**

### Graphics & Flipper

3D rendering fundamentals from zero (pixels, triangles, transforms,
rasterisation, texturing, lighting, the Z-buffer), then the Flipper GPU — the
embedded 1T-SRAM framebuffer, the command processor and FIFO, hardware T&L,
the 16-stage TEV combiner pipeline, tiled textures and CMPR compression, and
the EFB→XFB→TV path — and finally how Dolphin translates a fixed-function GPU
into shaders (including ubershaders). Labs include a draggable-vertex software
rasteriser, a live TEV stage combiner, and a CMPR block-compression explorer.

### CPU & Gekko

How CPUs work from zero (fetch–decode–execute, floating point, pipelines,
superscalar issue, caches), then Gekko — the PowerPC 750CXe derivative and its
game-specific mods: paired singles, quantised loads/stores and the GQRs, the
write-gather pipe, the locked cache with DMA, and the 1T-SRAM/ARAM memory
system — and finally how Dolphin JIT-compiles PowerPC and where accuracy gets
hard. Labs include a steppable toy CPU, an IEEE-754 bit explorer, a pipeline
visualiser, a cache simulator and an interpreter-vs-JIT race.

### The disc drive

Optical storage from zero (pits and lands, CLV vs CAV, error correction), then
the GameCube's 8 cm miniDVD — what's on the disc (apploader, DOL, FST), the DI
command/DMA interface, the deliberately off-spec format that doubled as copy
protection, and how games streamed data and hid loads — and finally disc images
(GCM/ISO, GCZ, RVZ) and why Dolphin emulates realistic drive timing. Labs
include a laser-readout scope, a scratch-and-interleaving simulator, a seek
visualiser and a streaming-buffer playground.

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
source — chiefly `Source/Core/Core/DSP/`, `Source/Core/Core/HW/DSPHLE/UCodes/`
and `Source/Core/AudioCommon/` for audio; `Source/Core/VideoCommon/` for
graphics; `Source/Core/Core/PowerPC/` for the CPU; and
`Source/Core/Core/HW/DVD/` plus `Source/Core/DiscIO/` for the disc drive.
These are educational explainers, not authoritative specifications.

"Nintendo" and "GameCube" are trademarks of Nintendo. This is an independent,
non-commercial educational project and is not affiliated with or endorsed by
Nintendo.

## License

Code is released under the [MIT License](LICENSE). See the file for details.
