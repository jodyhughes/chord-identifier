import { decodeAudio, runBasicPitch, buildBarsAndChords } from './analysis.js';
import { chordNotes } from './chords.js';
import { exportChordsToMidi } from './export.js';

const dropZone    = document.getElementById('drop-zone');
const fileInput   = document.getElementById('file-input');
const analyzeBtn  = document.getElementById('analyze-btn');
const exportMidiBtn = document.getElementById('export-midi-btn');
const includeTempoCheckbox = document.getElementById('include-tempo');
const statusEl    = document.getElementById('status');
const progressWrap = document.getElementById('progress-wrap');
const progressBar = document.getElementById('progress-bar');
const tempoEl     = document.getElementById('tempo');
const tempoControls = document.getElementById('tempo-controls');
const bpmHalveBtn = document.getElementById('bpm-halve');
const bpmDoubleBtn = document.getElementById('bpm-double');
const methodLabel = document.getElementById('method-label');
const playerEl    = document.getElementById('player');
const audio       = document.getElementById('audio');
const resultsEl   = document.getElementById('results');
const resolution  = document.getElementById('resolution');
const limitNote   = document.getElementById('limitation-note');
let currentBpm    = 120;

const LIMITATION_NOTES = {
  '4': 'Bar mode: one chord per bar, with automatic splitting if a chord change is detected mid-bar.',
  '2': 'Half-bar mode: one chord per half-bar (every 2 beats).',
  '1': 'Beat mode: one chord per beat. More granular but more prone to noise.',
};

resolution.addEventListener('change', () => {
  limitNote.textContent = LIMITATION_NOTES[resolution.value];
});

exportMidiBtn.addEventListener('click', () => {
  if (chordData.length === 0) return;
  const filename = `chords-${new Date().toISOString().split('T')[0]}.mid`;
  const includeTempoEvent = includeTempoCheckbox.checked;
  
  exportChordsToMidi(chordData, currentBpm, filename, includeTempoEvent);
  statusEl.textContent = 'MIDI file downloaded!';
  setTimeout(() => { statusEl.textContent = ''; }, 3000);
});

function updateTempoDisplay() {
  tempoEl.innerHTML = `Tempo: <span>${currentBpm} BPM</span>`;
}

bpmHalveBtn.addEventListener('click', () => {
  currentBpm = parseFloat((currentBpm / 2).toFixed(1));
  updateTempoDisplay();
});

bpmDoubleBtn.addEventListener('click', () => {
  currentBpm = parseFloat((currentBpm * 2).toFixed(1));
  updateTempoDisplay();
});

let selectedFile = null;
let chordData = [];
let activeCard = null;

// --- File selection ---
dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    fileInput.click();
  }
});
fileInput.addEventListener('change', () => { if (fileInput.files[0]) setFile(fileInput.files[0]); });
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
  if (e.dataTransfer.files[0]) setFile(e.dataTransfer.files[0]);
});

function setFile(file) {
  selectedFile = file;
  dropZone.querySelector('.drop-label').innerHTML = `<span>${file.name}</span>`;
  analyzeBtn.disabled = false;
  reset();
}

function reset() {
  resultsEl.innerHTML = '';
  statusEl.textContent = '';
  tempoEl.innerHTML = '';
  methodLabel.textContent = '';
  playerEl.style.display = 'none';
  audio.src = '';
  chordData = [];
  activeCard = null;
  progressWrap.style.display = 'none';
  progressBar.style.width = '0%';
  exportMidiBtn.disabled = true;
  tempoControls.style.display = 'none';
}

// --- Analysis ---
analyzeBtn.addEventListener('click', async () => {
  if (!selectedFile) return;

  analyzeBtn.disabled = true;
  reset();
  statusEl.textContent = 'Loading model and decoding audio…';
  progressWrap.style.display = 'block';

  try {
    const audioBuffer = await decodeAudio(selectedFile);
    statusEl.textContent = 'Analyzing with Basic Pitch…';

    const advancedOptions = {
      onsetThresh:  parseFloat(document.getElementById('onset-thresh').value),
      frameThresh:  parseFloat(document.getElementById('frame-thresh').value),
      minNoteLen:   parseInt(document.getElementById('min-note-len').value),
      minPitchMidi: parseInt(document.getElementById('min-pitch').value),
      maxPitchMidi: parseInt(document.getElementById('max-pitch').value),
    };

    const notes = await runBasicPitch(audioBuffer, progress => {
      progressBar.style.width = `${Math.round(progress * 100)}%`;
    }, advancedOptions);

    statusEl.textContent = 'Detecting chords…';
    const beatsPerBar = parseInt(resolution.value);
    const { bars, bpm } = buildBarsAndChords(notes, audioBuffer.duration, beatsPerBar);
    currentBpm = bpm;
    exportMidiBtn.disabled = false;
    tempoControls.style.display = 'flex';
    
    chordData = bars;
    tempoEl.innerHTML = `Tempo: <span>${bpm} BPM</span>`;
    methodLabel.textContent = 'Method: Basic Pitch';
    statusEl.textContent = `Found ${bars.length} chord segments.`;

    audio.src = URL.createObjectURL(selectedFile);
    playerEl.style.display = 'block';

    renderChords(bars);
  } catch (err) {
    statusEl.innerHTML = `<span class="error">Error: ${err.message}</span>`;
    console.error(err);
  } finally {
    analyzeBtn.disabled = false;
    progressWrap.style.display = 'none';
  }
});

// --- Rendering ---
function formatTime(s) {
  const m = Math.floor(s / 60);
  return `${m}:${(s % 60).toFixed(1).padStart(4, '0')}`;
}

function renderChords(chords) {
  const list = document.createElement('div');
  list.className = 'chord-list';

  const barMap = new Map();
  chords.forEach((item, i) => {
    if (!barMap.has(item.bar)) barMap.set(item.bar, []);
    barMap.get(item.bar).push({ ...item, index: i });
  });

  const barGroups = [...barMap.values()];
  barGroups.forEach((items, groupIdx) => {
    const wrap = document.createElement('div');
    wrap.className = 'bar-wrap';

    const group = document.createElement('div');
    group.className = 'bar-group';

    items.forEach(({ chord, start, end, passingTones, index }) => {
      const isNC = chord === 'N.C.';
      const notes = chordNotes(chord);
      const passing = passingTones?.length ? passingTones.join(' · ') : '';

      const card = document.createElement('div');
      card.className = 'chord-card';
      card.dataset.index = index;
      card.role = 'button';
      card.tabIndex = 0;
      card.setAttribute('aria-label', `${chord} chord, ${formatTime(start)} to ${formatTime(end)}`);
      card.innerHTML = `
        <div class="chord-name${isNC ? ' nc' : ''}">${chord}</div>
        ${notes  ? `<div class="chord-notes">${notes}</div>`   : ''}
        ${passing ? `<div class="chord-passing">${passing}</div>` : ''}
        <div class="chord-time">${formatTime(start)} – ${formatTime(end)}</div>
      `;
      const playChord = () => { audio.currentTime = start; audio.play(); };
      card.addEventListener('click', playChord);
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          playChord();
        }
      });
      group.appendChild(card);
    });

    wrap.appendChild(group);
    list.appendChild(wrap);

    if (groupIdx < barGroups.length - 1) {
      const div = document.createElement('div');
      div.className = 'bar-divider';
      list.appendChild(div);
    }
  });

  resultsEl.innerHTML = '<h2>Detected Chords</h2>';
  resultsEl.appendChild(list);
}

// --- Playback sync ---
function syncChords() {
  if (!audio.paused) {
    const t = audio.currentTime + 0.15;
    const i = chordData.findIndex(c => t >= c.start && t < c.end);
    if (i !== -1) {
      const cards = resultsEl.querySelectorAll('.chord-card');
      const match = [...cards].find(c => parseInt(c.dataset.index) === i);
      if (match && activeCard !== match) {
        if (activeCard) activeCard.classList.remove('active');
        activeCard = match;
        activeCard.classList.add('active');
        activeCard.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      }
    }
  }
  requestAnimationFrame(syncChords);
}
requestAnimationFrame(syncChords);
