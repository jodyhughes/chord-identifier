# Chord Identifier

A fully client-side web app that analyzes an audio file and detects chords bar-by-bar, with real-time highlighting as the song plays. No server required — all processing runs in the browser.

## Features

- Upload an audio file (MP3, WAV, FLAC, OGG, M4A)
- Detects tempo (BPM) and chord changes per bar
- Three resolution modes: bar, half-bar, or beat
- Adaptive bar splitting — if a chord change is detected mid-bar, it splits automatically
- Shows chord notes and passing tones for each detected chord
- Audio player with real-time chord highlighting synced to playback
- Click any chord card to jump to that point in the song
- **Light / Dark / System theme** — toggle in the upper right corner; remembers your preference
- **Export as MIDI** — Export detected chords as a MIDI file for use in Logic Pro or other DAWs. Notes are quantized to the beat grid for perfect alignment with your project tempo.

## MIDI Export

After analyzing a song, you can export the detected chords as a MIDI file:

- **Export button** appears after analysis
- **Include tempo in MIDI** checkbox — uncheck to export without tempo data (recommended for use with your project's locked tempo)
- **÷2 / ×2 buttons** — adjust the detected BPM by a factor of 2 if the analyzer finds double-beat or half-beat
- **Beat quantization** — all notes snap to exact beat boundaries, so they align perfectly with your DAW's grid regardless of slight timing variations in the original audio

**Workflow:** Analyze → Adjust BPM if needed → Export → Import into Logic/Ableton/etc. → All three chord notes will sustain for the detected chord duration, locked to your project's beat grid.

## How it works

1. Audio is decoded in the browser via the Web Audio API and resampled to 22050 Hz
2. [Spotify's Basic Pitch](https://github.com/spotify/basic-pitch) ML model runs entirely in the browser to detect individual note events (pitch, onset, offset)
3. A custom BPM estimator uses Gaussian scoring on note onset times to find tempo, with adaptive beat tracking to handle tempo variations
4. Notes are grouped into bars, and chroma vectors (12-dimensional pitch class energy) are built for each bar
5. Chroma vectors are matched against chord templates using cosine similarity
6. Passing tones — non-chord pitch classes with significant energy — are identified and displayed

## Chord types detected

Major, minor, dominant 7th, major 7th, minor 7th, diminished, sus2, sus4 — across all 12 roots.

## Running locally

Requires Node 20+.

```bash
git clone https://github.com/jodyhughes/chord-identifier.git
cd chord-identifier
npm install
npm run dev
```

Then open [http://localhost:5173/chord-identifier/](http://localhost:5173/chord-identifier/).

The first analysis will download the Basic Pitch model weights (~20MB) from a CDN. After that they are cached.

## Accuracy notes

- Works best on recordings with clear harmonic content (piano, guitar, vocals over simple accompaniment)
- Struggles with dense mixes, heavy reverb, or atonal music
- Tempo changes mid-song may affect bar alignment, though the beat tracker adapts to gradual changes

## Limitations / future ideas

- Assumes 4/4 time — time signature detection would improve bar grouping
- Chord vocabulary is limited to the types listed above — no extended chords (9ths, 11ths, 13ths) yet
- No key detection
