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
const pianoRollCanvas   = document.getElementById('piano-roll');
const pianoRollSpinner  = document.getElementById('piano-roll-spinner');
const reAnalyzeBtn       = document.getElementById('re-analyze-btn');
const advancedModal      = document.getElementById('advanced-modal');
const controlsSecondary  = document.getElementById('controls-secondary');
const advancedToggleBtn  = document.getElementById('advanced-toggle');
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
  timeDisplay.textContent = '0:00 / 0:00';
  chordData = [];
  activeCard = null;
  progressWrap.style.display = 'none';
  progressBar.style.width = '0%';
  exportMidiBtn.disabled = true;
  advancedToggleBtn.style.display = 'none';
  controlsSecondary.style.display = 'none';
}

function showPostAnalysisControls() {
  advancedToggleBtn.style.display = '';
  controlsSecondary.style.display = 'flex';
}

function hidePostAnalysisControls() {
  advancedToggleBtn.style.display = 'none';
  controlsSecondary.style.display = 'none';
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

  // Header row with transpose controls
  const header = document.createElement('div');
  header.className = 'results-header';

  const h2 = document.createElement('h2');
  h2.textContent = 'Detected Chords';

  // Bar shift controls
  const barShiftWrap = document.createElement('div');
  barShiftWrap.className = 'transpose-controls';

  const barLabel = document.createElement('span');
  barLabel.className = 'transpose-label';
  barLabel.textContent = 'Bar';

  const barTip = document.createElement('span');
  barTip.className = 'info-tip';
  barTip.dataset.tooltip = 'Try adjusting this if the timing is off';
  barTip.setAttribute('tabindex', '0');
  barTip.setAttribute('aria-label', 'Bar shift info');
  barTip.textContent = 'ⓘ';

  const barDisplay = document.createElement('span');

  const updateBarDisplay = () => {
    const val = barShift !== null ? barShift : 0;
    const bpb = parseInt(resolution.value);
    const signed = val > bpb / 2 ? val - bpb : val;
    barDisplay.textContent = signed > 0 ? `+${signed}` : `${signed}`;
    barDisplay.className = 'transpose-display' + (val !== 0 ? ' active' : '');
  };
  updateBarDisplay();

  const barLeftBtn = document.createElement('button');
  barLeftBtn.className = 'transpose-btn';
  barLeftBtn.setAttribute('aria-label', 'Shift bar start left one beat');
  barLeftBtn.textContent = '←';
  barLeftBtn.addEventListener('click', () => {
    barLeftBtn.classList.add('btn-loading');
    const bpb = parseInt(resolution.value);
    const cur = barShift !== null ? barShift : detectedBarOffset;
    barShift = ((cur - 1) % bpb + bpb) % bpb;
    updateBarDisplay();
    setTimeout(() => rebuildChords(), 0);
  });

  const barRightBtn = document.createElement('button');
  barRightBtn.className = 'transpose-btn';
  barRightBtn.setAttribute('aria-label', 'Shift bar start right one beat');
  barRightBtn.textContent = '→';
  barRightBtn.addEventListener('click', () => {
    barRightBtn.classList.add('btn-loading');
    const bpb = parseInt(resolution.value);
    const cur = barShift !== null ? barShift : detectedBarOffset;
    barShift = (cur + 1) % bpb;
    updateBarDisplay();
    setTimeout(() => rebuildChords(), 0);
  });

  const barLabelGroup = document.createElement('span');
  barLabelGroup.append(barLabel, barTip);
  barShiftWrap.append(barLabelGroup, barLeftBtn, barDisplay, barRightBtn);

  // Transpose controls
  const transposeWrap = document.createElement('div');
  transposeWrap.className = 'transpose-controls';

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

  const transposeLabel = document.createElement('span');
  transposeLabel.className = 'transpose-label';
  transposeLabel.textContent = 'Transpose';
  transposeWrap.append(transposeLabel, downBtn, transposeDisplay, upBtn);

  const headerRight = document.createElement('div');
  headerRight.style.cssText = 'display:flex; align-items:center; gap:16px;';
  headerRight.append(barShiftWrap, transposeWrap);
  header.append(h2, headerRight);
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
  const canvas = pianoRollCanvas;
  const dpr  = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  if (!rect.width) return;

  canvas.width  = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const W = rect.width, H = rect.height;

  const s      = getComputedStyle(document.documentElement);
  const accent = s.getPropertyValue('--accent').trim();
  const muted  = s.getPropertyValue('--text-muted').trim();
  const bg     = s.getPropertyValue('--bg').trim();
  const isDark = document.documentElement.hasAttribute('data-theme');

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  if (!notes.length || !cachedAudioDuration) {
    ctx.fillStyle = muted;
    ctx.font = '13px -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Analyze a file to preview note detection', W / 2, H / 2);
    return;
  }

  const SHARPS = new Set([1, 3, 6, 8, 10]); // C# D# F# G# A#

  const pitches = notes.map(n => n.pitchMidi);
  const minP    = Math.max(0,   Math.min(...pitches) - 3);
  const maxP    = Math.min(127, Math.max(...pitches) + 3);
  const span    = maxP - minP + 1;
  const noteH   = H / span;

  // Layout
  const KEY_W  = 44;
  const ROLL_X = KEY_W + 1;
  const ROLL_W = W - ROLL_X;

  // Theme-aware key colours
  const whiteKey    = isDark ? '#c8c8c8' : '#f0f0f0';
  const blackKey    = isDark ? '#111'    : '#1e1e1e';
  const blackKeyBg  = isDark ? '#2c2c2c' : '#dcdcdc'; // white key area adjacent to black key
  const keyBorder   = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.09)';
  const sharpRowBg  = isDark ? 'rgba(0,0,0,0.22)'       : 'rgba(0,0,0,0.04)';
  const octaveLine  = isDark ? 'rgba(255,255,255,0.1)'   : 'rgba(0,0,0,0.1)';
  const dividerCol  = isDark ? '#333' : '#d0d0d0';

  // Draw keys + row backgrounds
  for (let p = minP; p <= maxP; p++) {
    const sharp = SHARPS.has(p % 12);
    const y = H - ((p - minP + 1) / span) * H;
    const h = noteH;

    // Tint sharp rows in the roll area
    if (sharp) {
      ctx.fillStyle = sharpRowBg;
      ctx.fillRect(ROLL_X, y, ROLL_W, h);
    }

    // Keyboard key
    if (sharp) {
      ctx.fillStyle = blackKey;
      ctx.fillRect(0, y, KEY_W * 0.62, h);
      ctx.fillStyle = blackKeyBg;
      ctx.fillRect(KEY_W * 0.62, y, KEY_W * 0.38, h);
    } else {
      ctx.fillStyle = whiteKey;
      ctx.fillRect(0, y, KEY_W, h);
    }

    // Thin border at every semitone boundary on the key
    ctx.fillStyle = keyBorder;
    ctx.fillRect(0, y, KEY_W, 0.5);

    // Octave line + C label in roll
    if (p % 12 === 0) {
      ctx.fillStyle = octaveLine;
      ctx.fillRect(ROLL_X, y, ROLL_W, 0.5);
      if (noteH >= 7) {
        const octave = Math.floor(p / 12) - 1;
        ctx.fillStyle = isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.3)';
        ctx.font = `${Math.min(10, Math.max(7, noteH * 0.65))}px -apple-system, sans-serif`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(`C${octave}`, KEY_W * 0.65, y + noteH / 2);
      }
    }
  }

  // Divider between keyboard and roll
  ctx.fillStyle = dividerCol;
  ctx.fillRect(KEY_W, 0, 1, H);

  // Notes
  ctx.fillStyle   = accent;
  ctx.globalAlpha = 0.85;
  for (const note of notes) {
    const x = ROLL_X + (note.startTimeSeconds / cachedAudioDuration) * ROLL_W;
    const w = Math.max(2, (note.durationSeconds / cachedAudioDuration) * ROLL_W);
    const y = H - ((note.pitchMidi - minP + 1) / span) * H;
    ctx.fillRect(x, y, w, Math.max(1, noteH - 0.5));
  }
  ctx.globalAlpha = 1;
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

audio.addEventListener('play',  () => setPlaying(true));
audio.addEventListener('pause', () => setPlaying(false));
audio.addEventListener('ended', () => setPlaying(false));

audio.addEventListener('loadedmetadata', () => {
  timeDisplay.textContent = `0:00 / ${formatPlayerTime(audio.duration)}`;
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
