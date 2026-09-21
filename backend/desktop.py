"""Packaged backend entry point. Frontend and API share one loopback origin."""
from __future__ import annotations
import argparse
import atexit
import os
from pathlib import Path
import shutil
import subprocess
import sys
from urllib.request import urlopen


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, required=True)
    parser.add_argument('--data', required=True)
    args = parser.parse_args()
    root = Path(getattr(sys, '_MEIPASS', Path(__file__).resolve().parents[1]))
    os.environ['JALASEH_DATA'] = args.data
    os.environ.setdefault('HF_HOME', str(Path(args.data) / 'models' / 'huggingface'))
    os.environ['PATH'] = os.pathsep.join([str(root / 'bin'), '/opt/homebrew/bin', '/usr/local/bin', os.environ.get('PATH', '')])
    # Ollama is shared with the local installation. Only stop processes we start.
    try:
        urlopen('http://127.0.0.1:11434/api/tags', timeout=2).close()
    except Exception:
        executable = shutil.which('ollama')
        if executable:
            log = open(Path(args.data) / 'ollama.log', 'a')
            child = subprocess.Popen([executable, 'serve'], stdout=log, stderr=log)
            atexit.register(child.terminate)
    from backend.main import app
    from fastapi.staticfiles import StaticFiles
    import uvicorn
    app.mount('/', StaticFiles(directory=str(root / 'dist'), html=True), name='frontend')
    uvicorn.run(app, host='127.0.0.1', port=args.port, log_level='info', timeout_graceful_shutdown=5)


if __name__ == '__main__':
    import multiprocessing
    multiprocessing.freeze_support()
    main()
