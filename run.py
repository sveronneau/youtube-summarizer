#!/usr/bin/env python3
"""Entry point for the DevFest Sherbrooke Video Summarizer FastAPI server."""

import os
from pathlib import Path
import socket
import subprocess
import sys
import warnings

# Automatically switch to the project's Python 3.12+ virtualenv if invoked outside .venv
_VENV_DIR = Path(__file__).resolve().parent / ".venv"
_VENV_PYTHON = (
    _VENV_DIR / "Scripts" / "python.exe"
    if os.name == "nt"
    else _VENV_DIR / "bin" / "python"
)
if (
    __name__ == "__main__"
    and _VENV_PYTHON.exists()
    and Path(sys.prefix).resolve() != _VENV_DIR.resolve()
):
    if os.name == "nt":
        sys.exit(
            subprocess.call(
                [str(_VENV_PYTHON), str(Path(__file__).resolve()), *sys.argv[1:]]
            )
        )
    os.execv(
        str(_VENV_PYTHON),
        [str(_VENV_PYTHON), str(Path(__file__).resolve()), *sys.argv[1:]],
    )

# Suppress noisy warnings if ever run outside a 3.10+ environment
warnings.filterwarnings("ignore", category=FutureWarning, module="google.*")
warnings.filterwarnings("ignore", message=".*urllib3 v2 only supports OpenSSL.*")

import uvicorn  # noqa: E402
from dotenv import load_dotenv  # noqa: E402

load_dotenv()


def get_lan_ip() -> str:
    """Retrieve the primary local area network (LAN) IPv4 address."""
    if sys.platform == "darwin":
        for iface in ("en0", "en1"):
            try:
                ip = (
                    subprocess.check_output(
                        ["ipconfig", "getifaddr", iface], stderr=subprocess.DEVNULL
                    )
                    .decode()
                    .strip()
                )
                if ip:
                    return ip
            except Exception:
                pass
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            return s.getsockname()[0]
    except Exception:
        return "127.0.0.1"


if __name__ == "__main__":
    from app.transcription_service import get_whisper_model, is_whisper_model_cached

    whisper_size = os.getenv("WHISPER_MODEL_SIZE", "base")
    if "--warmup" in sys.argv:
        print(f"⏳ Pre-downloading / verifying Faster-Whisper model '{whisper_size}' for offline use...")
        get_whisper_model()
        print(f"✅ Faster-Whisper '{whisper_size}' is cached locally and ready for 100% offline transcription!")
        sys.exit(0)

    lan_ip = get_lan_ip()
    port = int(os.getenv("PORT", "8000"))
    host = os.getenv("HOST", "0.0.0.0")
    reload_enabled = os.getenv("DEV_RELOAD", "true").lower() in ("1", "true", "yes")
    app_dir = str(Path(__file__).resolve().parent / "app")
    whisper_ready = is_whisper_model_cached(whisper_size)

    print("=" * 64)
    print(" 🌲⛰️  Video Summarizer • DevFest Sherbrooke")
    print("     GDG Cloud Sherbrooke • Eastern Townships Edition")
    print("=" * 64)
    print(f" > Local URL:     http://localhost:{port}")
    if lan_ip and lan_ip != "127.0.0.1" and host == "0.0.0.0":
        print(f" > Network (LAN): http://{lan_ip}:{port}")
    print(f" > Listening on:  {host}:{port} (reload={'on' if reload_enabled else 'off'})")
    print(f" > Python:        {sys.version.split()[0]} ({sys.executable})")
    print(
        f" > Whisper ASR:   "
        f"{'✅ Cached offline (' + whisper_size + ')' if whisper_ready else '⚠️  Not cached yet — run `python run.py --warmup` while online'}"
    )
    print(" Models: 🦙 Gemma 4 (Local) | ⚡ Gemini Flash | ⚛️ Gemini 4 Hydrogen | 🧠 Gemini 4 Argon | 💎 Gemini 4 Carbon")
    print("=" * 64)

    uvicorn.run(
        "app.main:app",
        host=host,
        port=port,
        reload=reload_enabled,
        reload_dirs=[app_dir] if reload_enabled else None,
    )
