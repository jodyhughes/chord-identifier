# AGENTS.md

This file provides guidance to AI coding assistants when working with code in this repository.

## Commands

```bash
npm run dev      # Start dev server at http://localhost:5173/
npm run build    # Build to dist/
npm run preview  # Preview production build locally
```

Requires Node 20+. No test suite.

## Architecture

This is a fully client-side Vite app — no backend at runtime.

**Data flow:**

1. User drops an audio file → `src/main.js` handles UI and coordinates the pipeline
2. `decodeAudio()` (analysis.js) — decodes audio via Web Audio API, resamples to 22050 Hz
3. `runBasicPitch()` (analysis.js) — runs Spotify's Basic Pitch ML model in-browser (model weights ~20MB, fetched from unpkg CDN on first use and then browser-cached)
4. `buildBarsAndChords()` (analysis.js) — estimates BPM via Gaussian scoring on note onsets, generates an adaptive beat grid, groups notes into bars, builds 12-dimensional chroma vectors per bar
5. `chromaToChord()` (chords.js) — matches chroma vectors against chord templates using cosine similarity; `shouldSplit()` detects mid-bar chord changes and splits bars adaptively
6. Results render in `main.js` as chord cards; playback sync uses `requestAnimationFrame` to highlight the active chord

**Source files:**
- `src/main.js` — UI, event handling, rendering, playback sync
- `src/analysis.js` — audio decoding, Basic Pitch inference, BPM estimation, beat tracking, bar/chord building
- `src/chords.js` — chord templates, cosine similarity matching, passing tone detection
- `src/export.js` — MIDI file generation (raw bytes, no library dependency); notes are beat-quantized to 480 ticks/beat

## Deployment

Push to `main` → GitHub Actions builds and syncs `dist/` to S3 (`chord-identifier-jodyhughes/`), then invalidates CloudFront distribution `E3OOJ9P5N6LIL`. `index.html` is deployed with `no-cache`; all other assets with 1-year immutable cache headers. Live at [chords.jodyhughes.com](https://chords.jodyhughes.com).
