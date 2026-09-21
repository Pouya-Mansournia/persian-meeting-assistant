# جلسه · Jalaseh

دستیار محلی جلسه‌های فارسی: ضبط یا بارگذاری صدا، متن زمان‌دار، خلاصه، تصمیم‌ها و کارهای قابل پیگیری.

Jalaseh is a Persian-first post-meeting assistant built with React, FastAPI, SQLite, and Tauri. Audio processing and AI inference run locally. No cloud API key is needed.

## Desktop application

The macOS build is `artifacts/Jalaseh-macOS-arm64.dmg`. Open it and drag **Jalaseh** to Applications, or open `src-tauri/target/release/bundle/macos/Jalaseh.app` directly.

This build targets this machine's **Apple Silicon / macOS 27** environment. The bundled Homebrew FFmpeg libraries require macOS 27; the current artifact is not an older-macOS or Intel release. It is locally signed, not Apple Developer ID signed or notarized for public distribution.

The app starts its bundled Python backend automatically on an available loopback port, and starts an installed Ollama service if needed. Reopening it focuses the existing window. Closing it stops its own backend process group. Python, Node, and FFmpeg do not need to be separately installed to run the bundle; **Ollama and the model weights are external local prerequisites**.

Desktop data and logs live in:

```text
~/Library/Application Support/com.jalaseh.desktop/
```

Settings are stored in SQLite, so vocabulary and retention survive app restarts and port changes. The Whisper cache lives under `models/huggingface/` in the same data directory. Ollama uses its normal local model storage.

## Developer setup

Requires Node 20.19+ or 22.12+, Python 3.11+, FFmpeg, and Ollama. Desktop builds additionally require Rust and macOS command-line developer tools.

```sh
brew install ffmpeg ollama rust
npm ci
python3.11 -m venv .venv
.venv/bin/pip install -r backend/requirements-build.txt
npm run setup:models
```

Model setup downloads Whisper **large-v3** (~3.1 GB) and **Qwen 2.5 7B** (~4.7 GB). Setup needs internet; transcription thereafter opens cached weights with `local_files_only=True`. The initial small Whisper model was not selected because it performed poorly on the Persian smoke samples.

Start the local web version in two terminals:

```sh
.venv/bin/uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

```sh
npm run dev
```

Open http://127.0.0.1:5173. Microphone capture requires localhost or HTTPS and browser permission. Inform participants before recording. The app visibly shows recording and disables dialog dismissal while recording. Browser audio is buffered until stopped and saved.

Optional environment variables: `WHISPER_MODEL` (default `large-v3`, also accepts a local converted-model directory), `OLLAMA_MODEL` (default `qwen2.5:7b`), `JALASEH_DATA` (default `data` in web development), and `HF_HOME` (default `JALASEH_DATA/models/huggingface`). Changing model names requires downloading the corresponding weights first. `backend/requirements.lock` captures the validated development/build environment.

## Build the desktop app

```sh
npm run desktop:build
npm run desktop:package
```

The first command generates `.app`; the second also generates the DMG. PyInstaller bundles the backend, frontend assets, FFmpeg, and native runtime libraries. `src-tauri/Cargo.lock` and `package-lock.json` are checked in for reproducible dependency resolution. The script currently targets Apple Silicon macOS; other platforms require their own native builds and packaging.

Models are intentionally outside the installer. To reuse development weights in the desktop data directory, copy `data/models/huggingface` to the desktop's `models/huggingface` directory, preserving symlinks and existing files. Do not replace the desktop database when updating the app.

## Implemented

- Responsive Persian RTL UI with locally bundled Vazirmatn fonts.
- Microphone capture, audio upload up to 250 MB, visible recording state, and bounded recording size.
- FFmpeg mono/16 kHz preprocessing and loudness normalization.
- Local Whisper Persian transcription with vocabulary hints and timestamps.
- Local Ollama schema-constrained extraction, validated with Pydantic. Unknown owners/deadlines stay null; generated task completion is always false.
- Long transcripts processed in bounded chunks without truncating the tail; exact duplicate decisions/tasks are removed.
- SQLite history, title/transcript search, task completion with rollback on failure, Markdown export, audio playback, and meeting deletion.
- Optional audio deletion after successful transcription, even if summarization subsequently fails.
- Retry from saved transcripts, explicit errors, interrupted-job recovery, model readiness indicators, and persistent settings.
- Loopback-only backend, cross-site request rejection, and a content security policy for the packaged UI.

## Verification

Current validation: the production frontend build and 9 backend tests pass; 5 browser checks passed in the previous session. Real Whisper large-v3 inference completed on three public Persian clips (14.9% aggregate word error rate, versus 56.7% for small). The full AI integration check is **not yet passing**: the example did not produce the expected decisions, and the restarted Ollama service currently reports no installed language model despite the previous completed download log. Complete model setup and rerun `scripts/verify-ai.py` before treating the end-to-end AI flow as verified.

```sh
npm run build
.venv/bin/python -m pytest backend/tests -q
PLAYWRIGHT_CHANNEL=chrome npm run test:ui
```

The UI tests launch installed Chrome in an isolated test profile. Alternatively run `npx playwright install chromium` and omit `PLAYWRIGHT_CHANNEL`. They cover responsive layouts, settings, meeting tabs, tasks, Markdown contents, simulated microphone recording, and failed uploads. They do not record a physical microphone.

To check a running bundled backend too:

```sh
PLAYWRIGHT_CHANNEL=chrome PACKAGED_URL=http://127.0.0.1:8765 npm run test:ui
```

Real AI smoke checks use three public Persian speech clips and the product brief's example transcript:

```sh
.venv/bin/python scripts/download-samples.py
WHISPER_MODEL=large-v3 .venv/bin/python scripts/benchmark-speech.py
PYTHONPATH=. .venv/bin/python scripts/verify-ai.py
```

Results and screenshots are written to `artifacts/`. A three-clip read-speech smoke benchmark does not establish accuracy for noisy, mixed Persian/English, multi-speaker product meetings. Review generated text and extracted tasks before relying on them.

## Remaining product roadmap

Speaker diarization, speaker naming, calendar integrations, semantic cross-meeting search, live transcription, cloud processing, and automatic age-based retention are future milestones from the brief. Current search is literal title/transcript search. Normalization is implemented; specialized noise suppression is not.

Run a single API worker. Background processing is serialized, with retryable recovery rather than a distributed durable queue. Data is unencrypted on disk. Failed transcription retains audio for retries until explicitly deleted. Summaries for long meetings combine per-chunk summaries and may miss relationships spanning distant chunks. Vocabulary is a recognition hint, not a guarantee of exact spelling.

## References and test-data attribution

- [faster-whisper](https://github.com/SYSTRAN/faster-whisper)
- [Ollama structured output](https://ollama.com/blog/structured-outputs)
- [Tauri sidecars](https://v2.tauri.app/develop/sidecar/)
- [Google FLEURS](https://huggingface.co/datasets/google/fleurs), CC BY 4.0; the three `fa_ir` test clips are obtained from the [FluidInference mirror](https://huggingface.co/datasets/FluidInference/fleurs-full). Speech files are not included in source control.
