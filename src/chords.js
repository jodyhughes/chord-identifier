export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

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

const CHORD_TEMPLATES = new Map();

for (let rootIdx = 0; rootIdx < 12; rootIdx++) {
  const root = NOTE_NAMES[rootIdx];
  for (const [quality, intervals] of Object.entries(INTERVALS)) {
    const template = new Float32Array(12);
    for (const interval of intervals) template[(rootIdx + interval) % 12] = 1;
    const label = quality === 'maj' ? root : `${root}${quality}`;
    CHORD_TEMPLATES.set(label, template);
  }
}

function vecNorm(v) {
  return Math.sqrt(v.reduce((s, x) => s + x * x, 0));
}

export function chromaToChord(chroma) {
  const n = vecNorm(chroma);
  if (n < 0.1) return 'N.C.';

  let bestChord = 'N.C.';
  let bestScore = -1;

  for (const [label, template] of CHORD_TEMPLATES) {
    const tn = vecNorm(template);
    const dot = chroma.reduce((s, v, i) => s + (v / n) * (template[i] / tn), 0);
    if (dot > bestScore) { bestScore = dot; bestChord = label; }
  }

  return bestChord;
}

export function getPassingTones(chordName, chroma) {
  if (chordName === 'N.C.' || !CHORD_TEMPLATES.has(chordName)) return [];
  const template = CHORD_TEMPLATES.get(chordName);
  const maxVal = Math.max(...chroma);
  if (maxVal < 0.1) return [];
  const normalized = Array.from(chroma).map(v => v / maxVal);
  return NOTE_NAMES.filter((_, i) => !template[i] && normalized[i] > 0.4);
}

export function chordNotes(chordName) {
  if (chordName === 'N.C.') return '';
  const match = chordName.match(/^([A-G]#?)(.*)$/);
  if (!match) return '';
  const root = match[1];
  const quality = match[2] || 'maj';
  const rootIdx = NOTE_NAMES.indexOf(root);
  if (rootIdx === -1) return '';
  const intervals = INTERVALS[quality] ?? INTERVALS.maj;
  return intervals.map(i => NOTE_NAMES[(rootIdx + i) % 12]).join(' · ');
}

export function shouldSplit(chromaA, chromaB, threshold = 0.25) {
  const na = vecNorm(chromaA);
  const nb = vecNorm(chromaB);
  if (na < 0.1 || nb < 0.1) return false;
  const dot = chromaA.reduce((s, v, i) => s + (v / na) * (chromaB[i] / nb), 0);
  return dot < (1 - threshold);
}
