# Chord Identifier

A local web app that analyzes an audio file and detects chords bar-by-bar, with real-time highlighting as the song plays.

## Features

- Upload an audio file (MP3, WAV, FLAC, OGG, M4A — up to 50MB)
- Detects tempo (BPM) and chord changes per bar
- Shows chord notes and passing tones for each bar
- Audio player with real-time chord highlighting synced to playback
- Two analysis methods you can compare side by side:
  - **Chroma (librosa)** — fast, frequency-energy based using Constant-Q Transform
  - **Basic Pitch** — note-event based using [Spotify's Basic Pitch](https://github.com/spotify/basic-pitch) ML model

## Chord types detected

Major, minor, dominant 7th, major 7th, minor 7th, diminished, sus2, sus4 — across all 12 roots.

## How it works

### Chroma method
1. Loads audio with librosa and extracts chroma features via CQT
2. Detects beat positions using librosa's beat tracker
3. Groups every 4 beats into a bar and averages the chroma over that window
4. Matches the averaged chroma vector against chord templates using cosine similarity
5. Identifies passing tones — non-chord pitch classes with significant energy

### Basic Pitch method
1. Runs Spotify's Basic Pitch model to detect individual note events (pitch, onset, offset)
2. Uses librosa for beat tracking to establish bar boundaries
3. Finds all notes active within each bar window
4. Maps those pitch classes to chord templates via the same matching logic

## Setup

Requires Python 3.9. Python 3.10+ has dependency issues with `llvmlite` (used by librosa's numba backend).

```bash
git clone https://github.com/jodyhughes/chord-identifier.git
cd chord-identifier

python3.9 -m venv venv
source venv/bin/activate

pip install -r requirements.txt
python app.py
```

Then open [http://localhost:5000](http://localhost:5000).

## Requirements

- Python 3.9
- See `requirements.txt` for Python dependencies
- On macOS, Basic Pitch runs via CoreML (no TensorFlow required)

## Accuracy notes

Results vary depending on the audio:

- Works best on recordings with clear harmonic content (piano, guitar, vocals)
- Struggles with dense mixes, heavy reverb, or atonal music
- The Basic Pitch method tends to be more accurate on polyphonic audio since it works from detected note events rather than raw frequency energy
- The Chroma method is faster and handles simpler recordings well

## Limitations / future ideas

- Bar grouping assumes 4/4 time signature — time signature detection is a planned improvement
- Chord detection is limited to the types listed above — no extended chords (9th, 11th, 13th) yet
- No key detection
