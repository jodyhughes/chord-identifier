import {
  BasicPitch,
  noteFramesToTime,
  addPitchBendsToNoteEvents,
  outputToNotesPoly,
} from '@spotify/basic-pitch';
import { chromaToChord, getPassingTones, shouldSplit } from './chords.js';

const MODEL_URL = 'https://unpkg.com/@spotify/basic-pitch@1.0.1/model/model.json';
let model = null;

async function getModel() {
  if (!model) model = new BasicPitch(MODEL_URL);
  return model;
}

const TARGET_SAMPLE_RATE = 22050;

export async function decodeAudio(file) {
  const arrayBuffer = await file.arrayBuffer();
  const ctx = new AudioContext();
  const decoded = await ctx.decodeAudioData(arrayBuffer);

  if (decoded.sampleRate === TARGET_SAMPLE_RATE) return decoded;

  const numFrames = Math.ceil(decoded.duration * TARGET_SAMPLE_RATE);
  const offlineCtx = new OfflineAudioContext(1, numFrames, TARGET_SAMPLE_RATE);
  const source = offlineCtx.createBufferSource();
  source.buffer = decoded;
  source.connect(offlineCtx.destination);
  source.start();
  return offlineCtx.startRendering();
}

export async function runBasicPitch(audioBuffer, onProgress, options = {}) {
  const {
    onsetThresh  = 0.5,
    frameThresh  = 0.3,
    minNoteLen   = 5,
    minPitchMidi = 0,
    maxPitchMidi = 127,
  } = options;

  const bp = await getModel();

  const frames = [], onsets = [], contours = [];

  await bp.evaluateModel(
    audioBuffer,
    (f, o, c) => { frames.push(...f); onsets.push(...o); contours.push(...c); },
    onProgress,
  );

  let notes = noteFramesToTime(
    addPitchBendsToNoteEvents(
      contours,
      outputToNotesPoly(frames, onsets, onsetThresh, frameThresh, minNoteLen),
    ),
  );

  if (minPitchMidi > 0 || maxPitchMidi < 127) {
    notes = notes.filter(n => n.pitchMidi >= minPitchMidi && n.pitchMidi <= maxPitchMidi);
  }

  return notes;
}

// Estimate BPM from note onset times using a Gaussian scoring grid
function estimateBPM(notes) {
  const onsets = notes
    .map(n => n.startTimeSeconds)
    .sort((a, b) => a - b)
    .filter((t, i, arr) => i === 0 || t - arr[i - 1] > 0.05);

  if (onsets.length < 4) return { bpm: 120, beatPeriod: 0.5 };

  const sigma = 0.025;
  let bestBPM = 120, bestScore = -1;
  const allScores = new Map(); // Store scores for all BPMs

  for (let bpm = 60; bpm <= 200; bpm += 0.5) {
    const period = 60 / bpm;
    let score = 0;
    for (const t of onsets) {
      const phase = t % period;
      const dist = Math.min(phase, period - phase);
      score += Math.exp(-(dist * dist) / (2 * sigma * sigma));
    }
    allScores.set(bpm, score);
    if (score > bestScore) { bestScore = score; bestBPM = bpm; }
  }

  // Check if we're detecting double-beat: if half the BPM has similar score, use that instead
  const halfBPM = bestBPM / 2;
  if (halfBPM >= 60 && allScores.has(halfBPM)) {
    const halfScore = allScores.get(halfBPM);
    // If half-BPM score is within 85% of best, prefer the lower tempo (more natural)
    if (halfScore > bestScore * 0.85) {
      bestBPM = halfBPM;
    }
  }

  return { bpm: Math.round(bestBPM * 2) / 2, beatPeriod: 60 / bestBPM };
}

// Find the phase offset that best aligns the beat grid to note onsets
function bestPhase(onsets, beatPeriod) {
  const sigma = 0.025;
  let bestPhase = 0, bestScore = -1;

  for (let phase = 0; phase < beatPeriod; phase += 0.01) {
    let score = 0;
    for (const t of onsets) {
      const shifted = ((t - phase) % beatPeriod + beatPeriod) % beatPeriod;
      const dist = Math.min(shifted, beatPeriod - shifted);
      score += Math.exp(-(dist * dist) / (2 * sigma * sigma));
    }
    if (score > bestScore) { bestScore = score; bestPhase = phase; }
  }

  return bestPhase;
}

function generateBeatTimes(notes, duration, beatPeriod) {
  const onsets = notes.map(n => n.startTimeSeconds).sort((a, b) => a - b);
  const phase = bestPhase(onsets, beatPeriod);

  // Start slightly before the first onset
  let expectedT = phase - Math.ceil(phase / beatPeriod) * beatPeriod;
  if (expectedT < 0) expectedT += beatPeriod;

  const beats = [];
  let localPeriod = beatPeriod;
  const snapWindow = beatPeriod * 0.3; // snap if onset is within 30% of a beat period

  while (expectedT <= duration + localPeriod) {
    // Find nearest onset within the snap window
    let bestOnset = null, bestDist = Infinity;
    for (const t of onsets) {
      const d = Math.abs(t - expectedT);
      if (d < snapWindow && d < bestDist) { bestDist = d; bestOnset = t; }
    }

    const actualT = bestOnset ?? expectedT;
    beats.push(parseFloat(actualT.toFixed(3)));

    // Smoothly update local period when we snapped to a real onset
    if (bestOnset !== null && beats.length >= 2) {
      const measured = actualT - beats[beats.length - 2];
      if (measured > beatPeriod * 0.7 && measured < beatPeriod * 1.3) {
        localPeriod = 0.85 * localPeriod + 0.15 * measured;
      }
    }

    expectedT = actualT + localPeriod;
  }

  return beats;
}

function notesToChroma(noteEvents, start, end) {
  const chroma = new Float32Array(12);
  for (const { startTime, endTime, pitchClass } of noteEvents) {
    if (startTime < end && endTime > start) chroma[pitchClass] += 1;
  }
  return chroma;
}

function makeBar(chord, passingTones, start, end, barNum) {
  return {
    chord,
    passingTones,
    start: parseFloat(start.toFixed(2)),
    end: parseFloat(end.toFixed(2)),
    bar: barNum,
  };
}

export function buildBarsAndChords(notes, duration, beatsPerBar) {
  const { bpm, beatPeriod } = estimateBPM(notes);
  const beatTimes = generateBeatTimes(notes, duration, beatPeriod);

  const noteEvents = notes.map(n => ({
    startTime: n.startTimeSeconds,
    endTime: n.startTimeSeconds + n.durationSeconds,
    pitchClass: n.pitchMidi % 12,
  }));

  const bars = [];
  const doAdaptive = beatsPerBar >= 4;

  for (let i = 0; i <= beatTimes.length - beatsPerBar; i += beatsPerBar) {
    const barNum = Math.floor(i / 4);
    const barStart = beatTimes[i];
    const barEnd = (i + beatsPerBar) < beatTimes.length
      ? beatTimes[i + beatsPerBar]
      : duration;

    if (doAdaptive) {
      const midIdx = i + Math.floor(beatsPerBar / 2);
      const barMid = midIdx < beatTimes.length ? beatTimes[midIdx] : (barStart + barEnd) / 2;
      const chromaA = notesToChroma(noteEvents, barStart, barMid);
      const chromaB = notesToChroma(noteEvents, barMid, barEnd);

      if (shouldSplit(chromaA, chromaB)) {
        const chordA = chromaToChord(chromaA);
        const chordB = chromaToChord(chromaB);
        if (chordA !== chordB) {
          bars.push(makeBar(chordA, getPassingTones(chordA, chromaA), barStart, barMid, barNum));
          bars.push(makeBar(chordB, getPassingTones(chordB, chromaB), barMid, barEnd, barNum));
          continue;
        }
      }
    }

    const chroma = notesToChroma(noteEvents, barStart, barEnd);
    const chord = chromaToChord(chroma);
    bars.push(makeBar(chord, getPassingTones(chord, chroma), barStart, barEnd, barNum));
  }

  return { bars, bpm };
}
