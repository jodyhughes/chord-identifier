import { decodeAudio, runBasicPitch, notesFromOutput, buildBarsAndChords } from './analysis.js';
import { chordNotes, transposeChord, transposeNote } from './chords.js';
import { exportChordsToMidi } from './export.js';

const dropZone         = document.getElementById('drop-zone');
const fileInput        = document.getElementById('file-input');
const filePreview      = document.getElementById('file-preview');
const filePreviewName  = document.getElementById('file-preview-name');
const filePreviewMeta  = document.getElementById('file-preview-meta');
const filePreviewChange = document.getElementById('file-preview-change');
const waveformCanvas   = document.getElementById('waveform-canvas');
const waveformWrap     = document.getElementById('waveform-wrap');
const waveformProgress = document.getElementById('waveform-progress');
const pianoKeysCanvas        = document.getElementById('piano-keys');
const pianoRollCanvas        = document.getElementById('piano-roll');
const pianoRollSpinner       = document.getElementById('piano-roll-spinner');
const pianoRollWrap          = document.querySelector('.piano-roll-wrap');
const pianoRollPlayhead      = document.getElementById('piano-roll-playhead');
const pianoRollPlayBtn       = document.getElementById('piano-roll-play');
const pianoRollProgressWrap  = document.getElementById('piano-roll-progress-wrap');
const pianoRollProgress      = document.getElementById('piano-roll-progress');
const pianoRollTime          = document.getElementById('piano-roll-time');
const prIconPlay             = document.getElementById('pr-icon-play');
const prIconPause            = document.getElementById('pr-icon-pause');
const midiPlayBtn            = document.getElementById('midi-play-btn');
const midiIconPlay           = document.getElementById('midi-icon-play');
const midiIconStop           = document.getElementById('midi-icon-stop');
const reAnalyzeBtn       = document.getElementById('re-analyze-btn');
const advancedModal      = document.getElementById('advanced-modal');
const controlsSecondary    = document.getElementById('controls-secondary');
const advancedToggleBtn    = document.getElementById('advanced-toggle');
const barShiftControls     = document.getElementById('bar-shift-controls');
const barDisplayEl         = document.getElementById('bar-display');
const barLeftBtn           = document.getElementById('bar-left-btn');
const barRightBtn          = document.getElementById('bar-right-btn');
const analyzeBtn  = document.getElementById('analyze-btn');
const exportMidiBtn = document.getElementById('export-midi-btn');
const includeTempoCheckbox = document.getElementById('include-tempo');
const statusEl    = document.getElementById('status');
const progressWrap = document.getElementById('progress-wrap');
const progressBar = document.getElementById('progress-bar');
const tempoEl     = document.getElementById('tempo');
const bpmHalveBtn  = document.getElementById('bpm-halve');
const bpmDoubleBtn = document.getElementById('bpm-double');
const playerEl      = document.getElementById('player');
const audio         = document.getElementById('audio');
const playPauseBtn  = document.getElementById('play-pause-btn');
const iconPlay      = document.getElementById('icon-play');
const iconPause     = document.getElementById('icon-pause');
const timeDisplay   = document.getElementById('time-display');
const resultsEl   = document.getElementById('results');
const resolution     = document.getElementById('resolution');
const resolutionTip  = document.getElementById('resolution-tip');
let currentBpm          = 120;
let cachedModelOutput   = null;
let cachedAudioDuration = 0;
let barShift            = null;  // null = auto-detect; number = manual override
let detectedBarOffset   = 0;

const LIMITATION_NOTES = {
  '4': 'Bar mode: one chord per bar, with automatic splitting if a chord change is detected mid-bar.',
  '2': 'Half-bar mode: one chord per half-bar (every 2 beats).',
  '1': 'Beat mode: one chord per beat. More granular but more prone to noise.',
};

resolution.addEventListener('change', () => {
  resolutionTip.dataset.tooltip = LIMITATION_NOTES[resolution.value];
});

exportMidiBtn.addEventListener('click', () => {
  if (chordData.length === 0) return;
  const filename = `chords-${new Date().toISOString().split('T')[0]}.mid`;
  const includeTempoEvent = includeTempoCheckbox.checked;
  
  exportChordsToMidi(chordData, currentBpm, filename, includeTempoEvent, transposeAmount);
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

// Fast chord rebuild from cached notes — no ML re-inference needed.
function rebuildChords() {
  if (!cachedModelOutput) return;
  const notes = notesFromOutput(cachedModelOutput, getAdvancedOptions());
  const beatsPerBar = parseInt(resolution.value);
  const { bars, bpm, barOffset } = buildBarsAndChords(notes, cachedAudioDuration, beatsPerBar, barShift);
  detectedBarOffset = barOffset;
  currentBpm = bpm;
  updateTempoDisplay();
  chordData = bars;
  renderChords(bars);
}


let selectedFile = null;
let chordData = [];
let activeCard = null;
let transposeAmount = 0;

function updateBarDisplay() {
  const val = barShift !== null ? barShift : 0;
  const bpb = parseInt(resolution.value);
  const signed = val > bpb / 2 ? val - bpb : val;
  barDisplayEl.textContent = signed > 0 ? `+${signed}` : `${signed}`;
  barDisplayEl.className = 'transpose-display' + (val !== 0 ? ' active' : '');
}

barLeftBtn.addEventListener('click', () => {
  barLeftBtn.classList.add('btn-loading');
  const bpb = parseInt(resolution.value);
  const cur = barShift !== null ? barShift : detectedBarOffset;
  barShift = ((cur - 1) % bpb + bpb) % bpb;
  updateBarDisplay();
  setTimeout(() => rebuildChords(), 0);
});

barRightBtn.addEventListener('click', () => {
  barRightBtn.classList.add('btn-loading');
  const bpb = parseInt(resolution.value);
  const cur = barShift !== null ? barShift : detectedBarOffset;
  barShift = (cur + 1) % bpb;
  updateBarDisplay();
  setTimeout(() => rebuildChords(), 0);
});


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

function formatFileSize(bytes) {
  return bytes < 1024 * 1024
    ? (bytes / 1024).toFixed(1) + ' KB'
    : (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

async function drawWaveform(file, canvas) {
  const dpr  = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  if (!rect.width) return;
  canvas.width  = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const W = rect.width, H = rect.height;
  let buf;
  try {
    const ab = await file.arrayBuffer();
    const ac = new AudioContext();
    buf = await ac.decodeAudioData(ab);
    ac.close();
  } catch { return; }
  const data  = buf.getChannelData(0);
  const step  = Math.ceil(data.length / W);
  const amp   = H / 2;
  const color = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
  ctx.fillStyle   = color;
  ctx.globalAlpha = 0.55;
  for (let i = 0; i < W; i++) {
    let min = 1, max = -1;
    for (let j = 0; j < step; j++) {
      const v = data[i * step + j] || 0;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    ctx.fillRect(i, (1 + min) * amp, 1, Math.max(1, (max - min) * amp));
  }
}

function setFile(file) {
  selectedFile = file;
  analyzeBtn.disabled = false;
  reAnalyzeBtn.disabled = false;
  reset();
  dropZone.style.display = 'none';
  filePreview.style.display = 'flex';
  filePreviewName.textContent = file.name;
  filePreviewMeta.textContent = formatFileSize(file.size) + ' · ' + file.name.split('.').pop().toUpperCase();
  requestAnimationFrame(() => drawWaveform(file, waveformCanvas));
}

function clearFile() {
  selectedFile = null;
  transposeAmount = 0;
  barShift = null;
  detectedBarOffset = 0;
  analyzeBtn.disabled = true;
  reAnalyzeBtn.disabled = true;
  filePreview.style.display = 'none';
  dropZone.style.display = '';
  waveformProgress.style.width = '0%';
  waveformWrap.classList.remove('seekable');
  hidePostAnalysisControls();
  reset();
}

filePreviewChange.addEventListener('click', clearFile);

function reset() {
  resultsEl.innerHTML = '';
  statusEl.textContent = '';
  tempoEl.innerHTML = '';
  playerEl.style.display = 'none';
  audio.src = '';
  setPlaying(false);
  setPrPlaying(false);
  pianoRollPlayBtn.disabled = true;
  midiPlayBtn.disabled = true;
  stopMidi();
  pianoRollPlayhead.style.display = 'none';
  pianoRollProgress.style.width = '0%';
  pianoRollTime.textContent = '0:00 / 0:00';
  timeDisplay.textContent = '0:00 / 0:00';
  chordData = [];
  activeCard = null;
  transposeAmount = 0;
  barShift = null;
  updateBarDisplay();
  progressWrap.style.display = 'none';
  progressBar.style.width = '0%';
  exportMidiBtn.disabled = true;
  advancedToggleBtn.style.display = 'none';
  controlsSecondary.style.display = 'none';
}

function showPostAnalysisControls() {
  advancedToggleBtn.style.display = '';
  controlsSecondary.style.display = 'flex';
  barShiftControls.style.display = '';
}

function hidePostAnalysisControls() {
  advancedToggleBtn.style.display = 'none';
  controlsSecondary.style.display = 'none';
  barShiftControls.style.display = 'none';
}

function getAdvancedOptions() {
  return {
    onsetThresh:  parseFloat(document.getElementById('onset-thresh').value),
    frameThresh:  parseFloat(document.getElementById('frame-thresh').value),
    minNoteLen:   parseInt(document.getElementById('min-note-len').value),
    minPitchMidi: parseInt(document.getElementById('min-pitch').value),
    maxPitchMidi: parseInt(document.getElementById('max-pitch').value),
  };
}

// --- Analysis ---
async function runAnalysis() {
  barShift = null; // reset to auto-detect on every fresh analysis
  const savedOutput   = cachedModelOutput;
  const savedDuration = cachedAudioDuration;
  reset();

  let notes;
  if (savedOutput) {
    cachedModelOutput   = savedOutput;
    cachedAudioDuration = savedDuration;
    statusEl.textContent = 'Detecting chords…';
    notes = notesFromOutput(savedOutput, getAdvancedOptions());
    redrawPianoRoll();
  } else {
    progressWrap.style.display = 'block';
    statusEl.textContent = 'Loading model and decoding audio…';
    const audioBuffer = await decodeAudio(selectedFile);
    cachedAudioDuration = audioBuffer.duration;
    statusEl.textContent = 'Analyzing with Basic Pitch…';

    const result = await runBasicPitch(audioBuffer, progress => {
      progressBar.style.width = `${Math.round(progress * 100)}%`;
    }, getAdvancedOptions());

    cachedModelOutput = result.modelOutput;
    notes = result.notes;
    redrawPianoRoll();
  }

  statusEl.textContent = 'Detecting chords…';
  const beatsPerBar = parseInt(resolution.value);
  const { bars, bpm, barOffset } = buildBarsAndChords(notes, cachedAudioDuration, beatsPerBar, null);
  detectedBarOffset = barOffset;
  currentBpm = bpm;
  exportMidiBtn.disabled = false;
  chordData = bars;
  tempoEl.innerHTML = `Tempo: <span>${bpm} BPM</span>`;
  statusEl.textContent = '';
  audio.src = URL.createObjectURL(selectedFile);
  playerEl.style.display = 'flex';
  waveformWrap.classList.add('seekable');
  showPostAnalysisControls();
  renderChords(bars);
}

analyzeBtn.addEventListener('click', async () => {
  if (!selectedFile) return;
  analyzeBtn.disabled = true;
  try {
    await runAnalysis();
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
  resultsEl.innerHTML = '';
  updateBarDisplay();
  barLeftBtn.classList.remove('btn-loading');
  barRightBtn.classList.remove('btn-loading');

  // Header with transpose controls
  const header = document.createElement('div');
  header.className = 'results-header';
  const h2 = document.createElement('h2');
  h2.textContent = 'Detected Chords';

  const transposeWrap = document.createElement('div');
  transposeWrap.className = 'transpose-controls';
  const transposeLabel = document.createElement('span');
  transposeLabel.className = 'transpose-label';
  transposeLabel.textContent = 'Transpose';
  const downBtn = document.createElement('button');
  downBtn.className = 'transpose-btn';
  downBtn.setAttribute('aria-label', 'Transpose down one semitone');
  downBtn.textContent = '−';
  downBtn.addEventListener('click', () => { transposeAmount--; renderChords(chordData); });
  const transposeDisplay = document.createElement('span');
  transposeDisplay.className = 'transpose-display' + (transposeAmount !== 0 ? ' active' : '');
  transposeDisplay.textContent = transposeAmount > 0 ? `+${transposeAmount}` : `${transposeAmount}`;
  const upBtn = document.createElement('button');
  upBtn.className = 'transpose-btn';
  upBtn.setAttribute('aria-label', 'Transpose up one semitone');
  upBtn.textContent = '+';
  upBtn.addEventListener('click', () => { transposeAmount++; renderChords(chordData); });
  transposeWrap.append(transposeLabel, downBtn, transposeDisplay, upBtn);

  header.append(h2, transposeWrap);
  resultsEl.appendChild(header);

  const list = document.createElement('div');
  list.className = 'chord-list';

  const barMap = new Map();
  chords.forEach((item, i) => {
    if (!barMap.has(item.bar)) barMap.set(item.bar, []);
    barMap.get(item.bar).push({ ...item, index: i });
  });

  const barGroups = [...barMap.values()];
  barGroups.forEach((items) => {
    const wrap = document.createElement('div');
    wrap.className = 'bar-wrap';

    // 1 grid unit = 2 beats (half-bar). Full bar (4 beats) = span 2, half-bar = span 1.
    const totalBeats = items.reduce((sum, item) => sum + item.beats, 0);
    wrap.style.gridColumn = `span ${Math.max(1, Math.round(totalBeats / 2))}`;

    const group = document.createElement('div');
    group.className = 'bar-group';

    items.forEach(({ chord, start, end, passingTones, index }) => {
      const displayChord = transposeChord(chord, transposeAmount);
      const isNC = displayChord === 'N.C.';
      const notes = chordNotes(displayChord);
      const passing = passingTones?.length
        ? passingTones.map(n => transposeNote(n, transposeAmount)).join(' · ')
        : '';

      const card = document.createElement('div');
      card.className = 'chord-card';
      card.dataset.index = index;
      card.role = 'button';
      card.tabIndex = 0;
      card.setAttribute('aria-label', `${displayChord} chord, ${formatTime(start)} to ${formatTime(end)}`);
      card.innerHTML = `
        <div class="chord-name${isNC ? ' nc' : ''}">${displayChord}</div>
        ${notes  ? `<div class="chord-notes">${notes}</div>`   : ''}
        ${passing ? `<div class="chord-passing">${passing}</div>` : ''}
        <div class="chord-time">${formatTime(start)} – ${formatTime(end)}</div>
      `;
      const playChord = () => { audio.currentTime = start; audio.play().catch(() => {}); };
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
  });

  resultsEl.appendChild(list);
}

// --- Piano roll ---
function drawPianoRoll(notes) {
  const dpr = window.devicePixelRatio || 1;
  const s      = getComputedStyle(document.documentElement);
  const accent = s.getPropertyValue('--accent').trim();
  const muted  = s.getPropertyValue('--text-muted').trim();
  const bg     = s.getPropertyValue('--bg').trim();
  const isDark = document.documentElement.hasAttribute('data-theme');

  // --- Roll canvas ---
  const roll = pianoRollCanvas;
  const rollRect = roll.getBoundingClientRect();
  if (!rollRect.width) return;
  roll.width  = Math.round(rollRect.width * dpr);
  roll.height = Math.round(rollRect.height * dpr);
  const rc = roll.getContext('2d');
  rc.scale(dpr, dpr);
  const W = rollRect.width, H = rollRect.height;

  rc.fillStyle = bg;
  rc.fillRect(0, 0, W, H);

  if (!notes.length || !cachedAudioDuration) {
    rc.fillStyle = muted;
    rc.font = '13px -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif';
    rc.textAlign = 'center';
    rc.textBaseline = 'middle';
    rc.fillText('Analyze a file to preview note detection', W / 2, H / 2);
    // Clear keys canvas too
    const kc = pianoKeysCanvas.getContext('2d');
    pianoKeysCanvas.width  = Math.round(pianoKeysCanvas.offsetWidth * dpr);
    pianoKeysCanvas.height = Math.round(H * dpr);
    kc.scale(dpr, dpr);
    kc.fillStyle = bg;
    kc.fillRect(0, 0, pianoKeysCanvas.offsetWidth, H);
    return;
  }

  const SHARPS = new Set([1, 3, 6, 8, 10]);
  const pitches = notes.map(n => n.pitchMidi);
  const minP    = Math.max(0,   Math.min(...pitches) - 3);
  const maxP    = Math.min(127, Math.max(...pitches) + 3);
  const span    = maxP - minP + 1;
  const noteH   = H / span;

  const sharpRowBg = isDark ? 'rgba(0,0,0,0.22)' : 'rgba(0,0,0,0.04)';
  const octaveLine = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)';

  // Roll: row backgrounds, octave lines, bar lines, notes
  for (let p = minP; p <= maxP; p++) {
    const y = H - ((p - minP + 1) / span) * H;
    if (SHARPS.has(p % 12)) {
      rc.fillStyle = sharpRowBg;
      rc.fillRect(0, y, W, noteH);
    }
    if (p % 12 === 0) {
      rc.fillStyle = octaveLine;
      rc.fillRect(0, y, W, 0.5);
    }
  }

  if (chordData.length) {
    rc.fillStyle = isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.15)';
    for (const bar of chordData) {
      rc.fillRect((bar.start / cachedAudioDuration) * W, 0, 1, H);
    }
  }

  rc.fillStyle = accent;
  rc.globalAlpha = 0.85;
  for (const note of notes) {
    const x = (note.startTimeSeconds / cachedAudioDuration) * W;
    const w = Math.max(2, (note.durationSeconds / cachedAudioDuration) * W);
    const y = H - ((note.pitchMidi - minP + 1) / span) * H;
    rc.fillRect(x, y, w, Math.max(1, noteH - 0.5));
  }
  rc.globalAlpha = 1;

  // --- Keys canvas ---
  const KEY_W = pianoKeysCanvas.offsetWidth;
  pianoKeysCanvas.width  = Math.round(KEY_W * dpr);
  pianoKeysCanvas.height = Math.round(H * dpr);
  const kc = pianoKeysCanvas.getContext('2d');
  kc.scale(dpr, dpr);

  const whiteKey   = isDark ? '#c8c8c8' : '#f0f0f0';
  const blackKey   = isDark ? '#111'    : '#1e1e1e';
  const blackKeyBg = isDark ? '#2c2c2c' : '#dcdcdc';
  const keyBorder  = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.09)';
  const labelCol   = isDark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.45)';
  const dividerCol = isDark ? '#333' : '#d0d0d0';

  kc.fillStyle = bg;
  kc.fillRect(0, 0, KEY_W, H);

  for (let p = minP; p <= maxP; p++) {
    const sharp = SHARPS.has(p % 12);
    const y = H - ((p - minP + 1) / span) * H;
    if (sharp) {
      kc.fillStyle = blackKey;
      kc.fillRect(0, y, KEY_W * 0.62, noteH);
      kc.fillStyle = blackKeyBg;
      kc.fillRect(KEY_W * 0.62, y, KEY_W * 0.38, noteH);
    } else {
      kc.fillStyle = whiteKey;
      kc.fillRect(0, y, KEY_W, noteH);
    }
    kc.fillStyle = keyBorder;
    kc.fillRect(0, y, KEY_W, 0.5);
    if (p % 12 === 0) {
      const octave   = Math.floor(p / 12) - 1;
      const fontSize = Math.min(10, Math.max(7, noteH * 0.65));
      kc.fillStyle = labelCol;
      kc.font = `bold ${fontSize}px -apple-system, sans-serif`;
      kc.textAlign = 'left';
      kc.textBaseline = 'middle';
      kc.fillText(`C${octave}`, KEY_W * 0.65, y + noteH / 2);
    }
  }

  // Right-edge divider on keys canvas
  kc.fillStyle = dividerCol;
  kc.fillRect(KEY_W - 1, 0, 1, H);
}

function redrawPianoRoll() {
  const notes = cachedModelOutput
    ? notesFromOutput(cachedModelOutput, getAdvancedOptions())
    : [];
  drawPianoRoll(notes);
}

// Wire sliders to piano roll (debounced — notesFromOutput is expensive on large tensors)
let _pianoRollTimer = null;
function schedulePianoRoll() {
  pianoRollSpinner.classList.add('visible');
  clearTimeout(_pianoRollTimer);
  _pianoRollTimer = setTimeout(() => {
    redrawPianoRoll();
    pianoRollSpinner.classList.remove('visible');
  }, 250);
}
['onset-thresh', 'frame-thresh', 'min-note-len', 'min-pitch', 'max-pitch'].forEach(id => {
  document.getElementById(id).addEventListener('input', schedulePianoRoll);
});

// Draw piano roll when modal opens; show spinner if there's work to do
document.getElementById('advanced-toggle').addEventListener('click', () => {
  if (cachedModelOutput) {
    pianoRollSpinner.classList.add('visible');
    setTimeout(() => {
      redrawPianoRoll();
      pianoRollSpinner.classList.remove('visible');
    }, 50);
  } else {
    requestAnimationFrame(redrawPianoRoll);
  }
});

// Reanalyze: show spinner on button, run analysis, close modal when done
reAnalyzeBtn.addEventListener('click', async () => {
  if (!selectedFile) return;
  reAnalyzeBtn.disabled = true;
  reAnalyzeBtn.classList.add('btn-loading');
  try {
    await runAnalysis();
    advancedModal.classList.remove('open');
    document.getElementById('advanced-toggle').setAttribute('aria-expanded', 'false');
  } catch (err) {
    statusEl.innerHTML = `<span class="error">Error: ${err.message}</span>`;
    console.error(err);
  } finally {
    reAnalyzeBtn.classList.remove('btn-loading');
    reAnalyzeBtn.disabled = !selectedFile;
    progressWrap.style.display = 'none';
  }
});

// --- Custom player ---
function formatPlayerTime(s) {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

function setPlaying(playing) {
  iconPlay.style.display  = playing ? 'none' : '';
  iconPause.style.display = playing ? '' : 'none';
  playPauseBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
}

playPauseBtn.addEventListener('click', () => {
  audio.paused ? audio.play().catch(() => {}) : audio.pause();
});

function setPrPlaying(playing) {
  prIconPlay.style.display  = playing ? 'none' : '';
  prIconPause.style.display = playing ? '' : 'none';
  pianoRollPlayBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
}

audio.addEventListener('play',  () => { setPlaying(true);  setPrPlaying(true); });
audio.addEventListener('pause', () => { setPlaying(false); setPrPlaying(false); });
audio.addEventListener('ended', () => { setPlaying(false); setPrPlaying(false); });

audio.addEventListener('loadedmetadata', () => {
  timeDisplay.textContent = `0:00 / ${formatPlayerTime(audio.duration)}`;
  pianoRollPlayBtn.disabled = false;
  midiPlayBtn.disabled = false;
});

pianoRollPlayBtn.addEventListener('click', () => {
  audio.paused ? audio.play().catch(() => {}) : audio.pause();
});

pianoRollProgressWrap.addEventListener('click', e => {
  if (!audio.duration) return;
  const rect = pianoRollProgressWrap.getBoundingClientRect();
  audio.currentTime = ((e.clientX - rect.left) / rect.width) * audio.duration;
});

// --- Waveform progress ---
audio.addEventListener('timeupdate', () => {
  if (!audio.duration) return;
  waveformProgress.style.width = (audio.currentTime / audio.duration * 100) + '%';
  timeDisplay.textContent = `${formatPlayerTime(audio.currentTime)} / ${formatPlayerTime(audio.duration)}`;
});

waveformWrap.addEventListener('click', (e) => {
  if (!audio.duration) return;
  const rect = waveformWrap.getBoundingClientRect();
  audio.currentTime = ((e.clientX - rect.left) / rect.width) * audio.duration;
});

// --- MIDI synth ---
let midiCtx = null;
let midiOscillators = [];
let midiStartCtxTime = 0;
let midiAnimFrame = null;
let midiActive = false;

function setMidiPlaying(on) {
  midiActive = on;
  midiIconPlay.style.display = on ? 'none' : '';
  midiIconStop.style.display = on ? '' : 'none';
  midiPlayBtn.classList.toggle('active', on);
  midiPlayBtn.setAttribute('aria-label', on ? 'Stop MIDI' : 'Play MIDI');
}

function stopMidi() {
  for (const osc of midiOscillators) { try { osc.stop(0); } catch (_) {} }
  midiOscillators = [];
  if (midiAnimFrame) { cancelAnimationFrame(midiAnimFrame); midiAnimFrame = null; }
  setMidiPlaying(false);
  pianoRollPlayhead.style.display = 'none';
  pianoRollProgress.style.width = '0%';
  pianoRollTime.textContent = '0:00 / 0:00';
}

const MIDI_LOOKAHEAD = 2.0; // seconds to schedule ahead per frame

function startMidi() {
  const notes = cachedModelOutput ? notesFromOutput(cachedModelOutput, getAdvancedOptions()) : [];
  if (!notes.length || !cachedAudioDuration) return;
  stopMidi();

  if (!midiCtx) midiCtx = new AudioContext();
  if (midiCtx.state === 'suspended') midiCtx.resume();

  const t0 = midiCtx.currentTime + 0.05;
  midiStartCtxTime = t0;
  setMidiPlaying(true);

  const sorted = [...notes].sort((a, b) => a.startTimeSeconds - b.startTimeSeconds);
  let nextIdx = 0;
  const canvasW = pianoRollCanvas.offsetWidth; // cache — avoid layout reflow every frame
  const wrapW   = pianoRollWrap.clientWidth;
  const rel     = 0.25;

  function scheduleUpTo(horizon) {
    while (nextIdx < sorted.length && sorted[nextIdx].startTimeSeconds <= horizon) {
      const note = sorted[nextIdx++];
      const freq = 440 * Math.pow(2, (note.pitchMidi - 69) / 12);
      const when = t0 + note.startTimeSeconds;
      const dur  = note.durationSeconds;
      const vel  = Math.min(1, (note.amplitude ?? 0.8)) * 0.3;
      const osc  = midiCtx.createOscillator();
      const gain = midiCtx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, when);
      gain.gain.linearRampToValueAtTime(vel, when + 0.008);
      gain.gain.linearRampToValueAtTime(vel * 0.5, when + 0.008 + 0.12);
      gain.gain.setValueAtTime(vel * 0.5, when + dur);
      gain.gain.linearRampToValueAtTime(0, when + dur + rel);
      osc.connect(gain);
      gain.connect(midiCtx.destination);
      osc.start(when);
      osc.stop(when + dur + rel + 0.05);
      midiOscillators.push(osc);
    }
  }

  function tick() {
    if (!midiActive) return;
    const elapsed = midiCtx.currentTime - midiStartCtxTime;
    if (elapsed >= cachedAudioDuration) { stopMidi(); return; }
    scheduleUpTo(elapsed + MIDI_LOOKAHEAD);
    const frac = elapsed / cachedAudioDuration;
    const x = frac * canvasW;
    pianoRollPlayhead.style.left = x + 'px';
    pianoRollPlayhead.style.display = 'block';
    pianoRollProgress.style.width = (frac * 100) + '%';
    pianoRollTime.textContent = `${formatPlayerTime(elapsed)} / ${formatPlayerTime(cachedAudioDuration)}`;
    pianoRollWrap.scrollLeft = x - wrapW * 0.35;
    midiAnimFrame = requestAnimationFrame(tick);
  }

  scheduleUpTo(MIDI_LOOKAHEAD); // prime the first window before first frame
  midiAnimFrame = requestAnimationFrame(tick);
}

midiPlayBtn.addEventListener('click', () => { midiActive ? stopMidi() : startMidi(); });

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

  // Piano roll playhead + progress bar (skip when MIDI synth owns the playhead)
  if (!midiActive && advancedModal.classList.contains('open') && audio.duration) {
    const frac = audio.currentTime / audio.duration;
    const playheadX = frac * pianoRollCanvas.offsetWidth;
    pianoRollPlayhead.style.left = playheadX + 'px';
    pianoRollPlayhead.style.display = 'block';
    pianoRollProgress.style.width = (frac * 100) + '%';
    pianoRollTime.textContent = `${formatPlayerTime(audio.currentTime)} / ${formatPlayerTime(audio.duration)}`;
    if (!audio.paused) {
      pianoRollWrap.scrollLeft = playheadX - pianoRollWrap.clientWidth * 0.35;
    }
  }

  requestAnimationFrame(syncChords);
}
requestAnimationFrame(syncChords);

document.addEventListener('keydown', (e) => {
  if (!audio.src) return;
  if (['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;

  if (e.key === ' ') {
    e.preventDefault();
    audio.paused ? audio.play().catch(() => {}) : audio.pause();
  } else if (e.key === 'ArrowLeft' && chordData.length) {
    e.preventDefault();
    const t = audio.currentTime;
    const prev = [...chordData].reverse().find(c => c.start < t - 0.1);
    audio.currentTime = prev ? prev.start : chordData[0].start;
  } else if (e.key === 'ArrowRight' && chordData.length) {
    e.preventDefault();
    const t = audio.currentTime;
    const next = chordData.find(c => c.start > t + 0.1);
    if (next) audio.currentTime = next.start;
  }
});
