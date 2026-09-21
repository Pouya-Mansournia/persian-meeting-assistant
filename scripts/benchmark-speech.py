"""Small reproducible smoke benchmark; not a meeting-quality certification."""
import json
import os
from pathlib import Path
import re
import time

os.environ.setdefault('HF_HOME', str(Path('data/models/huggingface').resolve()))
from faster_whisper import WhisperModel


def normalize(s):
    s = s.replace('ي', 'ی').replace('ك', 'ک').replace('\u200c', ' ')
    return re.sub(r'[^\w\s]', '', s).split()


def distance(a, b):
    prev = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        row = [i]
        for j, y in enumerate(b, 1):
            row.append(min(row[-1] + 1, prev[j] + 1, prev[j-1] + (x != y)))
        prev = row
    return prev[-1]


root = Path('artifacts/audio')
references = dict(line.split(' ', 1) for line in (root/'fa_ir.trans.txt').read_text().splitlines())
model = WhisperModel(os.environ.get('WHISPER_MODEL', 'small'), device='cpu', compute_type='int8', local_files_only=True)
results = []
for audio in sorted(root.glob('*.wav')):
    started = time.monotonic()
    segments, info = model.transcribe(str(audio), language='fa', vad_filter=True)
    transcript = ' '.join(s.text.strip() for s in segments)
    reference = references[audio.stem]
    ref, hyp = normalize(reference), normalize(transcript)
    result = dict(sample=audio.name, reference=reference, transcript=transcript, seconds=round(time.monotonic()-started,2), duration=info.duration, word_errors=distance(ref,hyp), reference_words=len(ref))
    results.append(result)
    print(json.dumps(result, ensure_ascii=False), flush=True)
model_name = os.environ.get('WHISPER_MODEL', 'small')
report = dict(model=model_name, dataset='FluidInference/fleurs-full (Google FLEURS fa_ir test)', samples=results, word_error_rate=sum(r['word_errors'] for r in results)/sum(r['reference_words'] for r in results))
Path(f'artifacts/speech-benchmark-{model_name}.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
print('Aggregate WER:', report['word_error_rate'])
