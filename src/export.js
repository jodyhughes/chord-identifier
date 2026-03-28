import { NOTE_NAMES } from './chords.js';

const INTERVALS = {
  maj:  [0, 4, 7],
  min:  [0, 3, 7],
  '7':  [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  min7: [0, 3, 7, 10],
  dim:  [0, 3, 6],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
};

function getChordNoteNumbers(chordName, baseOctave = 4) {
  if (chordName === 'N.C.') return [];
  
  const match = chordName.match(/^([A-G]#?)(.*)$/);
  if (!match) return [];
  
  const root = match[1];
  const quality = match[2] || 'maj';
  const rootIdx = NOTE_NAMES.indexOf(root);
  
  if (rootIdx === -1) return [];
  
  const intervals = INTERVALS[quality] ?? INTERVALS.maj;
  return intervals.map(interval => {
    const noteIdx = (rootIdx + interval) % 12;
    return 12 + noteIdx + (baseOctave * 12); // MIDI note number (60 = middle C)
  });
}

function writeVarLength(value) {
  const bytes = [];
  let remaining = value & 0x7f;
  
  while (true) {
    bytes.unshift(remaining);
    if ((value >>= 7) === 0) break;
    remaining = (value & 0x7f) | 0x80;
  }
  
  return new Uint8Array(bytes);
}

function concatUint8Arrays(...arrays) {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

function buildMidiFile(bars, bpm, includeTempoEvent = true) {
  const ticksPerBeat = 480;
  const trackEvents = [];
  
  // Set tempo (microseconds per beat) - optional
  if (includeTempoEvent) {
    const microsecondsPerBeat = Math.round(60000000 / bpm);
    const tempoData = new Uint8Array([0xff, 0x51, 0x03, 
      (microsecondsPerBeat >> 16) & 0xff,
      (microsecondsPerBeat >> 8) & 0xff,
      microsecondsPerBeat & 0xff
    ]);
    trackEvents.push({ delta: 0, data: tempoData });
  }
  
  let lastAbsoluteTick = 0;
  
  // Build note events - quantize to beat grid
  for (const bar of bars) {
    // Calculate beat positions (quantized to nearest beat)
    const beatDuration = (60 / bpm); // seconds per beat
    const startBeat = Math.round(bar.start / beatDuration);
    const endBeat = Math.round(bar.end / beatDuration);
    
    const startTicks = startBeat * ticksPerBeat;
    const endTicks = endBeat * ticksPerBeat;
    const durationTicks = endTicks - startTicks;
    
    // Skip if duration is zero (shouldn't happen but safety check)
    if (durationTicks <= 0) continue;
    
    // Delta time from last event
    const delta = startTicks - lastAbsoluteTick;
    
    if (bar.chord === 'N.C.') {
      // No chord, just advance timeline
      lastAbsoluteTick = endTicks;
      continue;
    }
    
    const noteNumbers = getChordNoteNumbers(bar.chord);
    if (noteNumbers.length === 0) {
      // Unknown chord, just advance timeline
      lastAbsoluteTick = endTicks;
      continue;
    }
    
    // Note on events (all at once)
    for (let i = 0; i < noteNumbers.length; i++) {
      const noteOnData = new Uint8Array([0x90, noteNumbers[i] & 0x7f, 64]);
      trackEvents.push({ delta: i === 0 ? delta : 0, data: noteOnData });
    }
    
    // Note off events (all at the same time, after duration)
    for (let i = 0; i < noteNumbers.length; i++) {
      const noteOffData = new Uint8Array([0x80, noteNumbers[i] & 0x7f, 64]);
      trackEvents.push({ delta: i === 0 ? durationTicks : 0, data: noteOffData });
    }
    
    lastAbsoluteTick = endTicks;
  }
  
  // End of track
  const endOfTrackData = new Uint8Array([0xff, 0x2f, 0x00]);
  trackEvents.push({ delta: 0, data: endOfTrackData });
  
  // Build track chunk
  let trackData = new Uint8Array(0);
  
  for (const event of trackEvents) {
    const deltaBuffer = writeVarLength(event.delta);
    trackData = concatUint8Arrays(trackData, deltaBuffer, event.data);
  }
  
  const trackChunk = concatUint8Arrays(
    new Uint8Array([0x4d, 0x54, 0x72, 0x6b]), // MTrk
    new Uint8Array([
      (trackData.length >> 24) & 0xff,
      (trackData.length >> 16) & 0xff,
      (trackData.length >> 8) & 0xff,
      trackData.length & 0xff
    ]),
    trackData
  );
  
  // Build header chunk
  const headerChunk = new Uint8Array([
    0x4d, 0x54, 0x68, 0x64,  // MThd
    0x00, 0x00, 0x00, 0x06,  // header length
    0x00, 0x00,               // format type 0
    0x00, 0x01,               // 1 track
    (ticksPerBeat >> 8) & 0xff,  // ticks per beat
    ticksPerBeat & 0xff
  ]);
  
  return concatUint8Arrays(headerChunk, trackChunk);
}

export function exportChordsToMidi(bars, bpm, filename = 'chords.mid', includeTempoEvent = true) {
  try {
    const midiData = buildMidiFile(bars, bpm, includeTempoEvent);
    const blob = new Blob([midiData], { type: 'audio/midi' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error('Failed to export MIDI:', err);
  }
}
