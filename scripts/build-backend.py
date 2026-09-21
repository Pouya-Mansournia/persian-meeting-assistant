"""Build a self-contained native Python sidecar, including FFmpeg and UI assets."""
from pathlib import Path
import shutil
import subprocess
import sys

root = Path(__file__).resolve().parents[1]
ffmpeg = shutil.which('ffmpeg')
if not ffmpeg:
    raise SystemExit('Install FFmpeg before building: brew install ffmpeg')
target = subprocess.check_output(['rustc', '--print', 'host-tuple'], text=True).strip()
subprocess.run([
    sys.executable, '-m', 'PyInstaller', '--noconfirm', '--clean', '--onefile',
    '--name', 'jalaseh-backend-' + target,
    '--distpath', str(root / 'src-tauri' / 'binaries'),
    '--workpath', str(root / 'build' / 'pyinstaller'),
    '--specpath', str(root / 'build'),
    '--paths', str(root),
    '--add-data', str(root / 'dist') + ':dist',
    '--add-binary', ffmpeg + ':bin',
    '--collect-all', 'faster_whisper', '--collect-all', 'ctranslate2',
    '--collect-all', 'tokenizers', '--collect-all', 'onnxruntime',
    '--collect-all', 'av', '--collect-all', 'uvicorn',
    '--hidden-import', 'backend.main',
    str(root / 'backend' / 'desktop.py'),
], cwd=root, check=True)
