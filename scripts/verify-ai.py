"""Real inference checks after setup: speech, extraction, and the bundled HTTP API."""
import json
import os
from pathlib import Path
import subprocess
import time
import httpx

ROOT = Path(__file__).resolve().parents[1]
os.chdir(ROOT)
os.environ.setdefault('HF_HOME', str(ROOT / 'data/models/huggingface'))
os.environ['WHISPER_MODEL'] = 'large-v3'

# Finalize the locally verified resumable download, if used.
cache = ROOT / 'data/models/huggingface/hub/models--Systran--faster-whisper-large-v3'
blob = cache / 'blobs/69f74147e3334731bc3a76048724833325d2ec74642fb52620eda87352e3d4f1'
print('Waiting for speech model...', flush=True)
while not blob.exists():
    time.sleep(15)
revision = (cache / 'refs/main').read_text().strip()
link = cache / 'snapshots' / revision / 'model.bin'
if not link.exists():
    link.symlink_to('../../blobs/' + blob.name)
subprocess.run([str(ROOT / '.venv/bin/python'), 'scripts/benchmark-speech.py'], check=True)
print('Speech benchmark finished. Waiting for local language model...', flush=True)
while True:
    try:
        tags = httpx.get('http://127.0.0.1:11434/api/tags', timeout=5).json()
        if any(m['name'] == 'qwen2.5:7b' for m in tags['models']):
            break
    except Exception:
        pass
    time.sleep(15)

from backend.main import extract
sample = '''پویا: به نظرم باید نرخ تبدیل صفحه رستوران رو بررسی کنیم.
علی: من دیتای سه ماه اخیر رو تا دوشنبه درمیارم.
پویا: خوبه، بعد سگمنت کاربران جدید و قدیمی رو هم جدا کنیم.'''
started = time.monotonic()
intelligence = extract(sample)
assert intelligence['summary'] and intelligence['decisions']
assert any(a['owner'] and 'علی' in a['owner'] and a['deadline'] and 'دوشنبه' in a['deadline'] for a in intelligence['actions']), intelligence
assert not any(a['done'] for a in intelligence['actions'])
(ROOT / 'artifacts/extraction-check.json').write_text(json.dumps({'seconds':round(time.monotonic()-started,2),'source':sample,'result':intelligence}, ensure_ascii=False, indent=2))
print('Persian owner/deadline extraction passed.', flush=True)

port = 8767
storage = ROOT / 'artifacts/integration-data'
storage.mkdir(parents=True, exist_ok=True)
log = (ROOT / 'artifacts/integration-backend.log').open('w')
child = subprocess.Popen([str(ROOT / 'src-tauri/binaries/jalaseh-backend-aarch64-apple-darwin'), '--port', str(port), '--data', str(storage)], env=os.environ, stdout=log, stderr=log)
base = f'http://127.0.0.1:{port}'
try:
    for _ in range(120):
        try:
            if httpx.get(base+'/api/health', timeout=5).json().get('ready'):
                break
        except Exception:
            pass
        time.sleep(1)
    else:
        raise RuntimeError('Bundled backend did not become ready')
    with (ROOT / 'artifacts/audio/fa_ir_0002.wav').open('rb') as audio:
        response = httpx.post(base+'/api/meetings', data={'title':'نمونه عمومی فارسی — آزمون واقعی', 'delete_audio':'true'}, files={'audio':('public-persian.wav',audio,'audio/wav')},timeout=30)
    response.raise_for_status()
    mid = response.json()['id']
    started = time.monotonic()
    for _ in range(300):
        meeting = httpx.get(base+'/api/meetings/'+mid,timeout=10).json()
        if meeting['status'] in ('ready','failed'):
            break
        time.sleep(2)
    assert meeting['status']=='ready', meeting.get('error')
    assert meeting['segments'] and meeting['intelligence']['summary']
    assert meeting['audio_path'] is None
    assert httpx.get(base+'/api/meetings/'+mid+'/audio').status_code==404
    (ROOT / 'artifacts/full-pipeline-check.json').write_text(json.dumps({'seconds':round(time.monotonic()-started,2),'meeting':meeting},ensure_ascii=False,indent=2))
    print(f'Bundled audio upload → FFmpeg → Whisper → Ollama → SQLite passed in {time.monotonic()-started:.1f}s.',flush=True)
    print(f'Preview available at {base}; backend PID {child.pid}',flush=True)
except BaseException:
    child.terminate()
    raise
