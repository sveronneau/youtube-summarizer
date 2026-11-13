# 🌲⛰️ DevFest Sherbrooke • AI Video & Song Summarizer

Bilingual (**FR / EN**) AI-powered YouTube and local media (video/audio) summarizer, built for the talk **"Prompt. Build. Ship."** at **DevFest Sherbrooke 2026** (GDG Cloud Sherbrooke • UdeS Campus • Cantons-de-l'Est, Québec).

The talk takes one task, summarizing a video, and does it five ways. **This repository is the app behind ways 2 and 3.** Ways 1, 4 and 5 live elsewhere and are described below so you can reproduce the whole set.

---

## 🖐️ One task, five ways / Une tâche, cinq façons

| # | Way / Façon | Interface | App | Video input | Model | Hosted |
|---|---|---|---|---|---|---|
| 1 | All-in on Google Cloud | Web form | Flask | YouTube URL (Gemini watches it) | `gemini-4-hydrogen` via Agent Platform | Cloud Run |
| 2 | Local + Gemini API (**this repo**) | HTML + JS | FastAPI | Captions → Whisper → keyframes | Gemini 4 Hydrogen · Argon · Carbon | `localhost:8000` |
| 3 | Local + Gemma 4, no Wi-Fi (**this repo**) | HTML + JS | FastAPI | Local file → Whisper → keyframes | `gemma4` via Ollama | Your laptop |
| 4 | Full SaaS | Generated | Generated | YouTube URL | `gemini-4-hydrogen` via Gemini API | Cloud Run (AI Studio) |
| 5 | Why build it at all? | notebook.google | — | YouTube source | Gemini (managed) | Google SaaS |

### Way 1 — All-in on Google Cloud (the codelab, finished)

**Stack:** Cloud Shell Editor, Cloud Code Flask template, Python + Flask, `google-genai` SDK on Agent Platform (formerly Vertex AI), `gemini-4-hydrogen`, Cloud Build, Cloud Run.

1. The form posts the YouTube link and an optional extra prompt to `/summarize`.
2. Flask wraps the link as a video part and sends it to Gemini with the prompt.
3. Gemini fetches the video itself and processes the frames and the audio.
4. The summary comes back and Flask renders it.
5. Deploy with `gcloud run deploy --source .` — Cloud Build makes the container (no Dockerfile), Cloud Run serves it.

Not in this repo. Follow the codelab: <https://codelabs.developers.google.com/devsite/codelabs/build-youtube-summarizer>. The codelab still offers `gemini-2.0-flash-001`, which is retired; change that one line in `templates/index.html` to `gemini-4-hydrogen`.

### Way 2 — Local app + Gemini API (this repo, Wi-Fi on)

**Stack:** FastAPI + uvicorn, static HTML/JS front end, `youtube-transcript-api`, `yt-dlp`, `faster-whisper`, PyAV + Pillow, `google-genai` SDK, key in `.env`. The code was written by the Antigravity agent from a six-line prompt.

1. The app validates the YouTube link and fetches the title and channel.
2. It fetches the captions (`youtube-transcript-api`).
3. No captions: it downloads the audio (`yt-dlp`) and transcribes it locally (`faster-whisper`).
4. No speech: it extracts up to 8 evenly spaced keyframes (PyAV + Pillow) for the model to look at.
5. It builds one structured prompt: executive summary, key points, your optional context, output language.
6. It calls the chosen Gemini 4 model at the chosen reasoning level and streams the answer (NDJSON).
7. The browser renders the Markdown. "View transcript" shows exactly what the model read.

An uploaded file skips steps 1–2 and goes straight to Whisper.

### Way 3 — Local app + Gemma 4, Wi-Fi off (this repo)

**Stack:** the same app, `faster-whisper` (cached on disk), Ollama on `127.0.0.1:11434`, `gemma4:latest` or `gemma4:12b`.

1. The uploaded file is saved to a temporary file.
2. Whisper transcribes the audio on the laptop (keyframes if there is no speech).
3. The same prompt as way 2 is built.
4. It goes to Ollama over local HTTP; Gemma 4 streams the summary back.
5. The temporary file is deleted. Nothing leaves the machine.

Offline means you load a file: a YouTube link needs the network. Before going offline, run `python run.py --warmup` once while online so the Whisper model is cached; the startup banner then shows `Whisper ASR: ✅ Cached offline`. The talk's demo runs on a MacBook Pro M2; plan for about 16 GB of RAM and 10 GB of disk for `gemma4`.

### Way 4 — Full SaaS (AI Studio Build)

**Stack:** AI Studio Build mode, a generated web app, the Gemini API (`gemini-4-hydrogen`), Cloud Run through the Starter Tier.

1. Describe the app in one sentence, for example: *"Build a web app that summarizes a YouTube video from a link, with a choice of style: short, detailed, or like I'm five."*
2. The agent generates the code and a live preview.
3. Test it and adjust by chatting.
4. Publish deploys it to Cloud Run and returns a public URL.

Not in this repo: <https://aistudio.google.com>.

### Way 5 — Why build it at all? (Gemini Notebook)

**Stack:** Gemini Notebook (formerly NotebookLM). No code.

1. Add the YouTube link as a source.
2. Notebook ingests it, mostly the transcript.
3. Ask for a summary; the answer cites the source.
4. Optionally, Audio Overview turns it into a two-host podcast.

Not in this repo: <https://notebook.google>.

---

## ✨ Features / Fonctionnalités

- **📺 YouTube & local media**: any YouTube link (watch, short, embed) or local file (`.mp4`, `.mov`, `.mkv`, `.webm`, `.mp3`, `.wav`, `.m4a`, `.flac`).
- **🎬 Audio and visual fallback**: no captions → local transcription (`faster-whisper`); no speech → keyframes (`PyAV` + `Pillow`), or the native YouTube video passed to Gemini.
- **🎵 Song mode**: studio lyrics lookup (`LRCLIB`) and a music-tuned second Whisper pass when captions are missing.
- **⚡ Streaming with cancel**: Markdown streams live over NDJSON (`/api/summarize/stream`, `/api/summarize-upload/stream`) with stage indicators and one-click cancel. The batch endpoints (`/api/summarize`, `/api/summarize-upload`) remain.
- **🦙 Local Ollama (Gemma 4, offline-ready)**: `gemma4:latest` and `gemma4:12b`, dynamic `num_ctx`, long-transcript sampling, cache-first Whisper loading, and locally bundled `marked` + `DOMPurify`.
- **☁️ Gemini API**: **Gemini 4 Hydrogen** (`gemini-4-hydrogen`), **Gemini 4 Argon** (`gemini-4-argon`) and **Gemini 4 Carbon** (`gemini-4-carbon`) with a configurable reasoning level (`low`, `medium`, `high`, and `xhigh` on Hydrogen). Argon and Carbon need a paid-tier key.
- **🌐 Bilingual UI (`FR` / `FR-EN` / `EN`)**: the summary follows the interface language. In bilingual mode the model writes the summary in French, then in English, which takes about twice as long on a local model.

---

## 🚀 Quick Start / Démarrage rapide

### 1. Prerequisites
- **Python 3.10+** (3.12 recommended)
- **Ollama** (optional, for way 3): `ollama pull gemma4`
- **Gemini API key** (optional, for way 2): `GEMINI_API_KEY` in `.env`, or entered in the UI for a single request

### 2. Installation
```bash
python3.12 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

### 3. Run
```bash
echo GEMINI_API_KEY=your-key > .env     # way 2 only
.venv/bin/python run.py --warmup        # once, online: caches the Whisper model
.venv/bin/python run.py
```
Open `http://localhost:8000`.

By default the server listens on `0.0.0.0`, so anyone on your network can reach it, and use your Gemini key through it. On a shared network, run it local-only:
```bash
HOST=127.0.0.1 .venv/bin/python run.py
```
Other settings: `PORT` (default `8000`), `DEV_RELOAD=1`, `MAX_CONCURRENT_TRANSCRIPTIONS` (default `2`). Keep `.env` out of Git.

---

## 🧪 Tests
```bash
.venv/bin/python -m tests.test_backend
.venv/bin/python -m tests.test_errors
.venv/bin/python -m tests.test_api_endpoints
```
