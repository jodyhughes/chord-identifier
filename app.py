import os
import numpy as np
import librosa
from flask import Flask, request, jsonify, render_template
from werkzeug.utils import secure_filename

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024  # 50MB limit
UPLOAD_FOLDER = '/tmp/chord-identifier'
ALLOWED_EXTENSIONS = {'mp3', 'wav', 'flac', 'ogg', 'm4a'}

os.makedirs(UPLOAD_FOLDER, exist_ok=True)

# Chord templates: 12 pitch classes (C C# D D# E F F# G G# A A# B)
CHORD_TEMPLATES = {}
NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

def build_templates():
    intervals = {
        'maj':  [1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0],
        'min':  [1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0],
        '7':    [1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0],
        'maj7': [1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1],
        'min7': [1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0],
        'dim':  [1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0],
        'sus2': [1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0],
        'sus4': [1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0],
    }
    for root_idx, root in enumerate(NOTE_NAMES):
        for quality, template in intervals.items():
            rotated = template[12 - root_idx:] + template[:12 - root_idx]
            label = root if quality == 'maj' else f'{root}{quality}'
            CHORD_TEMPLATES[label] = np.array(rotated, dtype=float)

build_templates()


def chroma_to_chord(chroma_vector):
    chroma = np.array(chroma_vector, dtype=float)
    norm = np.linalg.norm(chroma)
    if norm < 0.1:
        return 'N.C.'  # No chord / silence
    chroma = chroma / norm

    best_chord = 'N.C.'
    best_score = -1
    for label, template in CHORD_TEMPLATES.items():
        score = np.dot(chroma, template / np.linalg.norm(template))
        if score > best_score:
            best_score = score
            best_chord = label

    return best_chord


def get_passing_tones(chord_name, chroma_vector):
    if chord_name == 'N.C.' or chord_name not in CHORD_TEMPLATES:
        return []
    template = CHORD_TEMPLATES[chord_name]
    chroma = np.array(chroma_vector, dtype=float)
    norm = np.linalg.norm(chroma)
    if norm < 0.1:
        return []
    chroma = chroma / chroma.max()
    # Non-chord tones with energy above 40% of the strongest pitch class
    return [
        NOTE_NAMES[i] for i, (in_chord, energy) in enumerate(zip(template, chroma))
        if not in_chord and energy > 0.4
    ]


def detect_chords(filepath, beats_per_bar=4):
    hop_length = 512
    y, sr = librosa.load(filepath, mono=True)

    chroma = librosa.feature.chroma_cqt(y=y, sr=sr, hop_length=hop_length)
    tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr, hop_length=hop_length)
    tempo = float(np.atleast_1d(tempo)[0])

    bars = []
    beat_frames = list(beat_frames)

    for i in range(0, len(beat_frames) - beats_per_bar + 1, beats_per_bar):
        bar_start_frame = beat_frames[i]
        bar_end_frame = beat_frames[i + beats_per_bar] if (i + beats_per_bar) < len(beat_frames) else chroma.shape[1]

        bar_chroma = chroma[:, bar_start_frame:bar_end_frame].mean(axis=1)
        chord = chroma_to_chord(bar_chroma)
        passing = get_passing_tones(chord, bar_chroma)

        start_time = librosa.frames_to_time(bar_start_frame, sr=sr, hop_length=hop_length)
        end_time = librosa.frames_to_time(bar_end_frame, sr=sr, hop_length=hop_length)

        bars.append({
            'chord': chord,
            'start': round(float(start_time), 2),
            'end': round(float(end_time), 2),
            'passing_tones': passing,
        })

    return bars, round(tempo, 1)


def detect_chords_basic_pitch(filepath, beats_per_bar=4):
    from basic_pitch.inference import predict
    from basic_pitch import ICASSP_2022_MODEL_PATH

    _, midi_data, _ = predict(filepath, ICASSP_2022_MODEL_PATH)

    # Collect all note events as (start, end, pitch_class)
    notes = []
    for instrument in midi_data.instruments:
        for note in instrument.notes:
            notes.append((note.start, note.end, note.pitch % 12))

    # Use librosa for beat tracking
    hop_length = 512
    y, sr = librosa.load(filepath, mono=True)
    tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr, hop_length=hop_length)
    tempo = float(np.atleast_1d(tempo)[0])
    beat_times = librosa.frames_to_time(beat_frames, sr=sr, hop_length=hop_length).tolist()

    bars = []
    for i in range(0, len(beat_times) - beats_per_bar + 1, beats_per_bar):
        bar_start = float(beat_times[i])
        bar_end = float(beat_times[i + beats_per_bar]) if (i + beats_per_bar) < len(beat_times) else float(beat_times[-1])

        # Build chroma from notes active in this bar
        chroma = np.zeros(12)
        for note_start, note_end, pitch_class in notes:
            if note_start < bar_end and note_end > bar_start:
                chroma[pitch_class] += 1.0

        chord = chroma_to_chord(chroma)
        passing = get_passing_tones(chord, chroma)

        bars.append({
            'chord': chord,
            'start': round(bar_start, 2),
            'end': round(bar_end, 2),
            'passing_tones': passing,
        })

    return bars, round(tempo, 1)


def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/analyze', methods=['POST'])
def analyze():
    if 'file' not in request.files:
        return jsonify({'error': 'No file provided'}), 400

    file = request.files['file']
    if not file.filename:
        return jsonify({'error': 'No file selected'}), 400
    if not allowed_file(file.filename):
        return jsonify({'error': f'Unsupported file type. Allowed: {", ".join(ALLOWED_EXTENSIONS)}'}), 400

    filename = secure_filename(file.filename)
    filepath = os.path.join(UPLOAD_FOLDER, filename)
    file.save(filepath)

    try:
        chords, tempo = detect_chords(filepath)
        return jsonify({'chords': chords, 'tempo': tempo})
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        os.remove(filepath)


@app.route('/analyze-basic-pitch', methods=['POST'])
def analyze_basic_pitch():
    if 'file' not in request.files:
        return jsonify({'error': 'No file provided'}), 400

    file = request.files['file']
    if not file.filename:
        return jsonify({'error': 'No file selected'}), 400
    if not allowed_file(file.filename):
        return jsonify({'error': f'Unsupported file type. Allowed: {", ".join(ALLOWED_EXTENSIONS)}'}), 400

    filename = secure_filename(file.filename)
    filepath = os.path.join(UPLOAD_FOLDER, filename)
    file.save(filepath)

    try:
        chords, tempo = detect_chords_basic_pitch(filepath)
        return jsonify({'chords': chords, 'tempo': tempo})
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        os.remove(filepath)


if __name__ == '__main__':
    app.run(debug=True)
