# 🌲⛰️ DevFest Sherbrooke • AI Video & Song Summarizer

Bilingual (**FR / EN**) AI-powered YouTube & local media (video/audio) summarizer built for **DevFest Sherbrooke** & **GDG Cloud Sherbrooke** (🎓 UdeS Campus • Cantons-de-l'Est, Québec).

---

## ✨ Features / Fonctionnalités

- **📺 YouTube & Local Media Support**: Summarize any YouTube link (watch, short, embed) or local video/audio file (`.mp4`, `.mov`, `.mkv`, `.webm`, `.mp3`, `.wav`, `.m4a`, `.flac`).
- **🎵 Song Mode (2nd-Pass Lyrics Extraction)**: Dedicated checkbox for songs and music videos — queries studio lyrics (`LRCLIB`) and runs a music-tuned `faster-whisper` 2nd pass (vocal VAD + chorus anti-repetition) when captions are missing.
- **🦙 Local Ollama (Gemma 4)**: Private local inference via Ollama (`gemma4:latest` 8B & `gemma4:12b`).
- **⚡ Google Gemini API**: Supports **Gemini 3.8 Flash** (`gemini-3.8-flash`) and **Gemini 4 Argon** (`gemini-4-argon` via the Google Interactions API with configurable `thinking_level`: `high`, `medium`, `low`).
- **🌐 Full Bilingual UI (`FR` / `FR-EN` / `EN`)**: Switch seamlessly between French, Bilingual, and English interfaces and summary outputs.

---

## 🚀 Quick Start / Démarrage rapide

### 1. Prerequisites
- **Python 3.10+** (Python 3.12 recommended)
- **Ollama** (optional, for local `gemma4:latest` or `gemma4:12b` inference)
- **Gemini API Key** (optional, via `GEMINI_API_KEY` in `.env` or entered directly in the UI)

### 2. Installation
```bash
python3.12 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

### 3. Run the Server (Local & LAN)
```bash
.venv/bin/python run.py
```
Then open `http://localhost:8000` (or the printed LAN IP `http://<LAN_IP>:8000`) in your browser.

---

## 🧪 Running Tests
```bash
.venv/bin/python -m tests.test_backend
.venv/bin/python -m tests.test_errors
```
