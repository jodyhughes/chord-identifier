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


def detect_chords(filepath):
    y, sr = librosa.load(filepath, mono=True)
    hop_length = 4096
    chroma = librosa.feature.chroma_cqt(y=y, sr=sr, hop_length=hop_length)

    times = librosa.frames_to_time(np.arange(chroma.shape[1]), sr=sr, hop_length=hop_length)
    raw_chords = [chroma_to_chord(chroma[:, i]) for i in range(chroma.shape[1])]

    # Group consecutive identical chords
    grouped = []
    if not raw_chords:
        return grouped

    current_chord = raw_chords[0]
    start_time = float(times[0])

    for i in range(1, len(raw_chords)):
        if raw_chords[i] != current_chord:
            grouped.append({
                'chord': current_chord,
                'start': round(start_time, 2),
                'end': round(float(times[i]), 2),
            })
            current_chord = raw_chords[i]
            start_time = float(times[i])

    grouped.append({
        'chord': current_chord,
        'start': round(start_time, 2),
        'end': round(float(times[-1]), 2),
    })

    return grouped


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
        chords = detect_chords(filepath)
        return jsonify({'chords': chords})
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        os.remove(filepath)


if __name__ == '__main__':
    app.run(debug=True)
