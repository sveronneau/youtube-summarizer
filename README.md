# 🎄✨ GDG Ottawa — Learn, Build & Jingle • AI Video & Song Summarizer

Bilingual (**FR / EN**) AI-powered YouTube and local media (video/audio) summarizer, updated for **"Prompt. Build. Ship."** at **GDG Ottawa — Learn, Build & Jingle** (**Dec 15, 2026 • 5:00–7:00 PM EST • Virtual Holiday Workshop**).

The talk takes one task—summarizing a video—and builds it five ways. **This repository is the app behind Ways 2 and 3.** Ways 1, 4, and 5 live elsewhere and are summarized below so you can reproduce the entire set.

📊 **Talk slides / Diapositives de la conférence :** [DECK.md](./DECK.md)

---

## 🖐️ One task, five ways / Une tâche, cinq façons

| # | Way / Façon | Interface | App | Video input | Model | Hosted |
|---|---|---|---|---|---|---|
| 1 | All-in on Google Cloud | Web form | Flask | YouTube URL (Gemini watches it) | `gemini-4-hydrogen` via Agent Platform | Cloud Run |
| 2 | Local + Gemini API (**this repo**) | HTML + JS | FastAPI | Captions → Whisper → keyframes | Gemini 4 Hydrogen · Neon · Argon · Carbon | `localhost:8000` |
| 3 | Local models, no Wi-Fi (**this repo**) | HTML + JS | FastAPI | Local file → Whisper → keyframes | Loaded local models via **Ollama** & **Lemonade Server** | Your laptop |
| 4 | Full SaaS | Generated | Generated | YouTube URL | `gemini-4-hydrogen` via Gemini API | Cloud Run (AI Studio) |
| 5 | Why build it at all? | `notebook.google` | — | YouTube source | Gemini (managed) | Google SaaS |

### Way 1 — All-in on Google Cloud (the codelab, finished)

**Stack:** Cloud Shell Editor, Cloud Code Flask template, Python + Flask, `google-genai` SDK on Agent Platform (formerly Vertex AI), `gemini-4-hydrogen`, Cloud Build, Cloud Run.

1. The form posts the YouTube link and an optional extra prompt to `/summarize`.
2. Flask wraps the link as a video part and sends it to Gemini with the prompt.
3. Gemini fetches the video itself and processes the frames and the audio.
4. The summary comes back and Flask renders it.
5. Deploy with `gcloud run deploy --source .` — Cloud Build makes the container (no Dockerfile), Cloud Run serves it.

Not in this repo. Follow the codelab: <https://codelabs.developers.google.com/devsite/codelabs/build-youtube-summarizer>.

**Three edits are needed for the codelab to work:**

| File | Codelab says | Change to |
|---|---|---|
| `app.py` | `PROJECT_ID = "REPLACE_WITH_YOUR_PROJECT_ID"` | your own Google Cloud project ID |
| `app.py` | client location `us-central1` | `global` |
| `templates/index.html` | model `gemini-2.0-flash-001` (retired) | `gemini-4-hydrogen` |

The first is expected and easy to miss; the other two are not in the codelab's instructions. The location is the one the app uses to call the model, not the Cloud Run region you deploy to.

### Way 2 — Local app + Gemini API (this repo, Wi-Fi on)

**Stack:** FastAPI + Uvicorn, zero-build HTML/CSS/JS frontend, `youtube-transcript-api`, `yt-dlp`, `faster-whisper`, PyAV + Pillow, `google-genai` SDK (Interactions API), key in `.env` (or optional UI key drawer).

1. The app validates the YouTube link and fetches the title and channel.
2. It fetches the captions (`youtube-transcript-api`).
3. No captions: it downloads the audio (`yt-dlp`) and transcribes it locally (`faster-whisper`).
4. No speech: it extracts up to 8 evenly spaced keyframes (PyAV + Pillow) for multimodal analysis.
5. It builds one structured prompt: executive summary, key points, your optional context, and output language.
6. It calls the chosen Gemini 4 model (**Hydrogen**, **Neon**, **Argon**, or **Carbon**) at the selected reasoning depth (`thinking_level`, defaulting to `medium`) and streams the answer over NDJSON.
7. The browser renders the Markdown safely offline (vendored `marked` + `DOMPurify`). "View Transcript" shows exactly what the model read.

An uploaded local file skips steps 1–2 and goes straight to Whisper / keyframe extraction.

### Way 3 — Local app + Ollama / Lemonade Server, Wi-Fi off (this repo)

**Stack:** The same FastAPI app, `faster-whisper` (cached on disk), plus your choice of two local model runtimes with **loaded-only model discovery**:
- **Ollama** (`127.0.0.1:11434`) — discovered live via `GET /api/ps` (and `/api/ollama/models`).
- **Lemonade Server** (`127.0.0.1:13305`) — discovered live via `GET /api/v1/health` (`all_models_loaded` with `model_loaded` fallback; exposed at `/api/lemonade/models`), generating/streaming via `POST /api/v1/chat/completions`.

1. The uploaded media file is saved to a temporary file.
2. Faster-Whisper transcribes the audio locally (or PyAV + Pillow extract up to 8 keyframes if there is no speech).
3. The same structured prompt as Way 2 is built.
4. It goes over localhost HTTP to whichever loaded model you picked in the **Ollama** or **Lemonade** selector, streaming tokens back to the browser.
5. The temporary file is deleted. Nothing leaves your machine.

Offline means uploading a local file—a YouTube link still requires internet access. Before going offline, run `python run.py --warmup` once while online so the Whisper model is cached; the startup banner then shows `Whisper ASR: ✅ Cached offline`. Plan for ~16 GB RAM and ~10 GB disk when running local models like Gemma 4 (`gemma4:12b` / `Gemma-4-E4B-it-GGUF`).

### Way 4 — Full SaaS (AI Studio Build)

**Stack:** AI Studio Build mode, a generated web app, the Gemini API (`gemini-4-hydrogen`), Cloud Run through the Starter Tier.

1. Describe the app in one sentence, for example: *"Build a web app that summarizes a YouTube video from a link, with a choice of style: short, detailed, or like I'm five."*
2. The agent generates the code and a live preview.
3. Test it and adjust by chatting.
4. *Publish* deploys it to Cloud Run and returns a public URL.

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

- **📺 YouTube & local media**: Any YouTube link (watch, shorts, live, youtu.be, embed) or local file (`.mp4`, `.mkv`, `.mov`, `.avi`, `.webm`, `.m4v`, `.mp3`, `.wav`, `.m4a`, `.flac`, `.ogg`, `.aac`).
- **🎬 Audio and visual fallback**: Captions → offline speech transcription (`faster-whisper`) → up to 8 visual keyframes (`PyAV` + `Pillow`) for silent videos, plus native YouTube multimodal fallback on Gemini.
- **🎵 Song mode**: Optional 2nd-pass lyrics extraction with `LRCLIB` lookup and a music-tuned Faster-Whisper pass when captions are missing.
- **🦙🍋 Local Ollama & Lemonade Server (loaded-only discovery)**: Only currently loaded LLM/vision models appear in the dropdowns (`/api/ollama/models` via `/api/ps`, `/api/lemonade/models` via `/api/v1/health`), with dynamic `num_ctx` sizing, long-transcript budgeting, and offline-vendored `marked` + `DOMPurify`.
- **☁️ Gemini 4 family (Interactions API)**: **Gemini 4 Hydrogen** (`gemini-4-hydrogen`), **Gemini 4 Neon** (`gemini-4-neon`), **Gemini 4 Argon** (`gemini-4-argon`), and **Gemini 4 Carbon** (`gemini-4-carbon`) with configurable `thinking_level` (`medium` default; `xhigh` unlocked on Hydrogen and Neon) and an optional per-request API key drawer. Neon, Argon, and Carbon require a paid-tier key.
- **⚡ Live NDJSON streaming & export**: Real-time Markdown streaming (`/api/summarize/stream`, `/api/summarize-upload/stream`) with stage announcements, one-click cancel, collapsible transcript viewer, clipboard copy, and `.md` download (batch JSON routes `/api/summarize` and `/api/summarize-upload` also included).
- **🌐 Accessible bilingual web UI (`FR` / `FR-EN` / `EN`)**: Zero-build HTML5/CSS3/ES6+ frontend with progressive enhancement (`:has()`, `appearance: base-select`, `field-sizing: content`, fluid `clamp()` typography, live status regions). In bilingual mode the model outputs French first, then English.

---

## 🚀 Quick Start / Démarrage rapide

### 1. Prerequisites
- **Python 3.10+** (**3.12** recommended)
- **Ollama** and/or **Lemonade Server** (optional, for Way 3): load a model in memory (e.g. `ollama run gemma4` or load a model in Lemonade Server on port `13305`) and click **Refresh** in the UI
- **Gemini API key** (optional, for Way 2): set `GEMINI_API_KEY` in `.env`, or paste it per request in the UI

### 2. Installation

**macOS / Linux:**
```bash
python3.12 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env
```

**Windows (PowerShell):**
```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
Copy-Item .env.example .env
```

### 3. Configuration & Run

Edit `.env` as needed (already gitignored):
- `GEMINI_API_KEY` — Gemini API key for Way 2 (optional if entered in the UI)
- `OLLAMA_HOST` — Ollama base URL (default `http://127.0.0.1:11434`)
- `LEMONADE_HOST` — Lemonade Server base URL (default `http://127.0.0.1:13305`)
- `LEMONADE_API_KEY` — Optional Bearer token if your Lemonade Server enables auth
- `HOST` / `PORT` / `DEV_RELOAD` / `MAX_CONCURRENT_TRANSCRIPTIONS` — server bind (`0.0.0.0:8000` by default), reload, and Whisper concurrency cap (`2`)

**macOS / Linux:**
```bash
.venv/bin/python run.py --warmup   # once while online: caches Faster-Whisper offline
.venv/bin/python run.py
```

**Windows (PowerShell):**
```powershell
.\.venv\Scripts\python.exe -X utf8 run.py --warmup   # once while online
.\.venv\Scripts\python.exe -X utf8 run.py
```

Open `http://localhost:8000`.

By default the server listens on `0.0.0.0`, so devices on your local network can reach it and use any configured `.env` keys. On an untrusted network, bind localhost only (`HOST=127.0.0.1`). Keep `.env` out of Git.

---

## 🧪 Tests

**macOS / Linux:**
```bash
.venv/bin/python -m tests.test_backend
.venv/bin/python -m tests.test_errors
.venv/bin/python -m tests.test_api_endpoints
```

**Windows (PowerShell):**
```powershell
.\.venv\Scripts\python.exe -X utf8 -m tests.test_backend
.\.venv\Scripts\python.exe -X utf8 -m tests.test_errors
.\.venv\Scripts\python.exe -X utf8 -m tests.test_api_endpoints
```
