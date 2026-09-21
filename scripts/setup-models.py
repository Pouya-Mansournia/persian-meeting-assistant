"""Download local AI models. No meeting audio leaves the machine."""
import os
from pathlib import Path
import shutil
import subprocess
from urllib.request import urlopen
import time

root = Path(__file__).resolve().parents[1]
os.chdir(root)
os.environ.setdefault('HF_HOME', str(root / 'data/models/huggingface'))
os.environ.setdefault('HF_HUB_DISABLE_XET', '1')
if not shutil.which('ffmpeg') or not shutil.which('ollama'):
    raise SystemExit('Install FFmpeg and Ollama first: brew install ffmpeg ollama')
try:
    urlopen('http://127.0.0.1:11434/api/tags', timeout=2).close()
except Exception:
    log_path = root / 'data/ollama.log'
    log_path.parent.mkdir(parents=True, exist_ok=True)
    with log_path.open('a') as log:
        subprocess.Popen(['ollama', 'serve'], stdout=log, stderr=log, start_new_session=True)
    for _ in range(30):
        try:
            urlopen('http://127.0.0.1:11434/api/tags', timeout=1).close()
            break
        except Exception:
            time.sleep(1)
subprocess.run(['ollama', 'pull', os.environ.get('OLLAMA_MODEL', 'qwen2.5:7b')], check=True)
from faster_whisper import WhisperModel
model_name = os.environ.get('WHISPER_MODEL', 'large-v3')
print(f'Downloading speech model: {model_name}', flush=True)
WhisperModel(model_name, device='cpu', compute_type='int8')
print('Local models are ready.')
