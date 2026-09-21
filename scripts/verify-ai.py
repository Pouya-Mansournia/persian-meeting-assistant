"""Verify real local inference and the bundled audio HTTP pipeline."""
import argparse
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import time

import httpx

ROOT = Path(__file__).resolve().parents[1]
os.chdir(ROOT)
sys.path.insert(0, str(ROOT))
os.environ.setdefault('HF_HOME', str(ROOT / 'data/models/huggingface'))
os.environ.setdefault('WHISPER_MODEL', 'large-v3')


def write_report(name, report):
    (ROOT / 'artifacts').mkdir(exist_ok=True)
    (ROOT / 'artifacts' / name).write_text(json.dumps(report, ensure_ascii=False, indent=2))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--skip-speech-benchmark', action='store_true')
    parser.add_argument('--base-url', help='Use an already running backend instead of starting the bundle')
    args = parser.parse_args()
    from backend.main import extract, health
    readiness = health()
    if not readiness['ready']:
        raise SystemExit(f'Local dependencies are not ready. Run npm run setup:models. Status: {readiness}')
    if not args.skip_speech_benchmark:
        subprocess.run([sys.executable, 'scripts/benchmark-speech.py'], check=True)

    sample = '''پویا: به نظرم باید نرخ تبدیل صفحه رستوران رو بررسی کنیم.
علی: من دیتای سه ماه اخیر رو تا دوشنبه درمیارم.
پویا: خوبه، بعد سگمنت کاربران جدید و قدیمی رو هم جدا کنیم.'''
    started = time.monotonic()
    intelligence = extract(sample)
    write_report('extraction-check.json', {'seconds': round(time.monotonic()-started, 2), 'source': sample, 'result': intelligence})
    assert intelligence['summary'], intelligence
    # The brief ends with a proposal, not an explicit acceptance. Test agreed
    # decisions separately so we do not reward hallucinated agreement.
    assert any(a['owner'] and 'علی' in a['owner'] and a['deadline'] and 'دوشنبه' in a['deadline'] for a in intelligence['actions']), intelligence
    assert not any(a['done'] for a in intelligence['actions'])
    decision_source = 'پویا: تصمیم گرفتیم کاربران جدید و قدیمی جداگانه تحلیل شوند. علی: موافقم. فعلاً برای این تحلیل مسئول و مهلت تعیین نکرده‌ایم.'
    decision_result = extract(decision_source)
    write_report('decision-check.json', {'source': decision_source, 'result': decision_result})
    assert decision_result['decisions'], decision_result
    assert all(a['owner'] is None and a['deadline'] is None for a in decision_result['actions']), decision_result
    print('Persian summary, explicit decision, owner, and deadline extraction passed.', flush=True)

    child = None
    log = None
    base = args.base_url
    try:
        if not base:
            with socket.socket() as sock:
                sock.bind(('127.0.0.1', 0))
                port = sock.getsockname()[1]
            storage = ROOT / 'artifacts/integration-data'
            storage.mkdir(parents=True, exist_ok=True)
            log = (ROOT / 'artifacts/integration-backend.log').open('w')
            child = subprocess.Popen([str(ROOT / 'src-tauri/binaries/jalaseh-backend-aarch64-apple-darwin'), '--port', str(port), '--data', str(storage)], env=os.environ, stdout=log, stderr=log)
            base = f'http://127.0.0.1:{port}'
        deadline = time.monotonic() + 120
        while time.monotonic() < deadline:
            try:
                if httpx.get(base+'/api/health', timeout=5).json().get('ready'):
                    break
            except httpx.HTTPError:
                pass
            if child and child.poll() is not None:
                raise RuntimeError('Bundled backend exited; inspect artifacts/integration-backend.log')
            time.sleep(1)
        else:
            raise RuntimeError('Backend did not become ready')
        with (ROOT / 'artifacts/audio/fa_ir_0002.wav').open('rb') as audio:
            response = httpx.post(base+'/api/meetings', data={'title':'نمونه عمومی فارسی — آزمون واقعی', 'delete_audio':'true'}, files={'audio':('public-persian.wav',audio,'audio/wav')},timeout=30)
        response.raise_for_status()
        mid = response.json()['id']
        started = time.monotonic()
        deadline = started + 600
        meeting = response.json()
        while time.monotonic() < deadline:
            meeting = httpx.get(base+'/api/meetings/'+mid, timeout=10).json()
            if meeting['status'] in ('ready', 'failed'):
                break
            time.sleep(2)
        write_report('full-pipeline-check.json', {'seconds':round(time.monotonic()-started, 2),'meeting':meeting})
        assert meeting['status']=='ready', meeting.get('error') or meeting['status']
        assert meeting['segments'] and meeting['intelligence']['summary']
        assert meeting['audio_path'] is None
        assert httpx.get(base+'/api/meetings/'+mid+'/audio').status_code==404
        print(f'Audio upload → FFmpeg → Whisper → Ollama → SQLite passed in {time.monotonic()-started:.1f}s.', flush=True)
    finally:
        if child:
            child.terminate()
            try:
                child.wait(timeout=15)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait()
        if log:
            log.close()


if __name__ == '__main__':
    main()
