"""FastAPI application routes and lifecycle management for Video Summarizer."""

import asyncio
import os
import shutil
import tempfile
from contextlib import asynccontextmanager
from typing import Any, Dict, Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from app.llm_service import (
    close_llm_client,
    generate_youtube_summary,
    get_ollama_models,
)
from app.transcription_service import transcribe_local_video
from app.youtube_service import (
    close_youtube_client,
    extract_video_id,
    get_video_metadata,
    get_video_transcript,
)

MAX_UPLOAD_BYTES = int(os.getenv("MAX_UPLOAD_MB", "500")) * 1024 * 1024
ALLOWED_VIDEO_EXTENSIONS = (
    ".mp4",
    ".mkv",
    ".mov",
    ".avi",
    ".webm",
    ".m4v",
    ".mp3",
    ".wav",
    ".m4a",
    ".flac",
    ".ogg",
    ".aac",
)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    """Manage startup and shutdown of shared async HTTP clients."""
    yield
    await close_youtube_client()
    await close_llm_client()


app = FastAPI(
    title="Video Summarizer • DevFest Sherbrooke",
    description=(
        "Summarize YouTube videos & local MP4 files using Ollama Gemma 4 & Gemini models "
        "- DevFest Sherbrooke & Eastern Townships Edition"
    ),
    version="2.1.0",
    lifespan=lifespan,
)

# Mount static files
static_dir = os.path.join(os.path.dirname(__file__), "static")
os.makedirs(static_dir, exist_ok=True)
app.mount("/static", StaticFiles(directory=static_dir), name="static")


class VideoInfoRequest(BaseModel):
    """Request payload for fetching YouTube video preview metadata."""

    url: str


class SummarizeRequest(BaseModel):
    """Request payload for summarizing a YouTube video."""

    url: str
    model: str = Field(
        default="gemma4",
        description="Choice of model: 'gemma4' (Ollama Local), 'flash' (Gemini 3.8 Flash), or 'argon' (Gemini 4 Argon)",
    )
    custom_context: Optional[str] = Field(
        default="", description="Extra expectations / context for summary"
    )
    api_key: Optional[str] = Field(
        default=None, description="Optional user-provided Gemini API key"
    )
    thinking_level: Optional[str] = Field(
        default="high",
        description="Reasoning depth for Gemini 4 Argon: 'low', 'medium', or 'high'",
    )
    lang: Optional[str] = Field(
        default="bi", description="Interface language preference: 'fr', 'en', or 'bi'"
    )
    song_mode: bool = Field(
        default=False,
        description="Enable 2nd-pass audio lyrics extraction and music analysis when input is a song",
    )


@app.get("/")
async def serve_index() -> Any:
    """Serve the main SPA index.html page."""
    index_path = os.path.join(static_dir, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path, headers={"Cache-Control": "no-cache"})
    return {
        "message": "Welcome to Video Summarizer (DevFest Sherbrooke • GDG Cloud Sherbrooke) API"
    }


@app.get("/favicon.ico", include_in_schema=False)
async def serve_favicon() -> Any:
    """Serve the GDG logo favicon.ico at the root path."""
    favicon_path = os.path.join(static_dir, "favicon.ico")
    if os.path.exists(favicon_path):
        return FileResponse(favicon_path, media_type="image/x-icon")
    raise HTTPException(status_code=404, detail="Favicon not found")


@app.get("/api/ollama/models")
async def list_ollama_models() -> Dict[str, Any]:
    """List models available on the local Ollama server."""
    return await get_ollama_models()


@app.post("/api/video-info")
async def get_info(req: VideoInfoRequest) -> Dict[str, Any]:
    """Extract video ID and fetch YouTube metadata for preview."""
    video_id = extract_video_id(req.url)
    if not video_id:
        raise HTTPException(
            status_code=400,
            detail="Invalid YouTube URL format. Please paste a valid YouTube link.",
        )

    metadata = await get_video_metadata(video_id)
    return {"success": True, "video_id": video_id, "metadata": metadata}


@app.post("/api/summarize")
async def summarize_video(req: SummarizeRequest) -> Dict[str, Any]:
    """Fetch YouTube metadata & optional transcript, then generate a structured summary."""
    try:
        video_id = extract_video_id(req.url)
        if not video_id:
            return {
                "success": False,
                "error": "Invalid YouTube URL format. Please paste a valid YouTube watch link, short link, or shorts URL.",
            }

        # Fetch metadata and transcript concurrently (transcript is optional)
        metadata_task = asyncio.create_task(get_video_metadata(video_id))
        transcript_task = asyncio.to_thread(
            get_video_transcript, video_id, None, req.song_mode
        )
        metadata, transcript_result = await asyncio.gather(
            metadata_task, transcript_task
        )

        # Refresh metadata from cache in case yt-dlp enriched it during transcript lookup
        metadata = await get_video_metadata(video_id)

        transcript_text = transcript_result.get("transcript_text") or ""
        lang_label = transcript_result.get("language_name") or (
            "No Captions" if not transcript_text else "Unknown"
        )
        seg_count = transcript_result.get("segment_count", 0)

        # Call LLM Service (Ollama / Gemini) — works with or without a transcript
        summary_result = await generate_youtube_summary(
            video_metadata=metadata,
            transcript_text=transcript_text,
            model_choice=req.model,
            custom_context=req.custom_context,
            api_key_override=req.api_key,
            thinking_level=req.thinking_level or "high",
            lang=req.lang or "bi",
            song_mode=req.song_mode,
        )

        if not summary_result.get("success"):
            return {
                "success": False,
                "error": summary_result.get(
                    "error", "Model failed to generate summary."
                ),
                "metadata": metadata,
                "transcript_info": {
                    "segment_count": seg_count,
                    "language": lang_label,
                },
            }

        return {
            "success": True,
            "summary": summary_result["summary"],
            "model_used": summary_result["model_used"],
            "metadata": metadata,
            "transcript_info": {
                "segment_count": seg_count,
                "language": lang_label,
                "full_transcript": (
                    transcript_text
                    if transcript_text
                    else "[No captions/transcript available for this video — summarized directly from video & metadata]"
                ),
            },
        }
    except Exception as e:
        return {"success": False, "error": f"Server Processing Error: {str(e)}"}


@app.post("/api/summarize-upload")
async def summarize_uploaded_file(
    file: UploadFile = File(...),
    model: str = Form("gemma4"),
    custom_context: Optional[str] = Form(""),
    api_key: Optional[str] = Form(None),
    thinking_level: Optional[str] = Form("high"),
    lang: Optional[str] = Form("bi"),
    song_mode: bool = Form(False),
) -> Dict[str, Any]:
    """Transcribe an uploaded video or audio file (with optional 2nd-pass song mode) and generate a summary."""
    temp_dir = None
    try:
        raw_filename = os.path.basename(file.filename or "video.mp4")
        _, ext = os.path.splitext(raw_filename.lower())
        if ext not in ALLOWED_VIDEO_EXTENSIONS:
            return {
                "success": False,
                "error": "Unsupported media format. Please upload a video (.mp4, .mov, .mkv, .webm) or audio (.mp3, .wav, .m4a, .flac) file.",
            }

        # Save uploaded file safely with size check
        temp_dir = tempfile.mkdtemp()
        safe_temp_path = os.path.join(temp_dir, f"upload{ext}")

        total_bytes = 0
        chunk_size = 1024 * 1024  # 1 MB chunks
        with open(safe_temp_path, "wb") as buffer:
            while True:
                chunk = await file.read(chunk_size)
                if not chunk:
                    break
                total_bytes += len(chunk)
                if total_bytes > MAX_UPLOAD_BYTES:
                    return {
                        "success": False,
                        "error": f"Uploaded file exceeds maximum allowed size ({MAX_UPLOAD_BYTES // (1024 * 1024)} MB).",
                    }
                buffer.write(chunk)

        # Offload CPU-bound Whisper transcription to a worker thread (optional: do not fail if no speech)
        transcribe_res = await asyncio.to_thread(
            transcribe_local_video, safe_temp_path, song_mode
        )

        transcript_text = transcribe_res.get("transcript_text") or ""
        seg_count = transcribe_res.get("segment_count", 0)
        lang_label = (
            transcribe_res.get("language_name", "English")
            if transcribe_res.get("success")
            else "No Speech Track"
        )

        metadata = {
            "title": f"{'Local Song' if song_mode else 'Local Media'}: {raw_filename}",
            "author_name": "Local Audio / Video File",
            "thumbnail_url": "/static/video-placeholder.png",
            "url": raw_filename,
        }

        # Generate summary via Ollama / Gemini (even if transcript_text is empty)
        summary_result = await generate_youtube_summary(
            video_metadata=metadata,
            transcript_text=transcript_text,
            model_choice=model,
            custom_context=custom_context,
            api_key_override=api_key,
            thinking_level=thinking_level or "high",
            lang=lang or "bi",
            song_mode=song_mode,
        )

        if not summary_result.get("success"):
            return {
                "success": False,
                "error": summary_result.get(
                    "error", "Failed to generate summary."
                ),
                "metadata": metadata,
                "transcript_info": {
                    "segment_count": seg_count,
                    "language": lang_label,
                },
            }

        return {
            "success": True,
            "summary": summary_result["summary"],
            "model_used": summary_result["model_used"],
            "metadata": metadata,
            "transcript_info": {
                "segment_count": seg_count,
                "language": lang_label,
                "full_transcript": (
                    transcript_text
                    if transcript_text
                    else "[No spoken audio transcribed from this video file — summarized using video context & metadata]"
                ),
            },
        }
    except Exception as e:
        return {"success": False, "error": f"Upload Processing Error: {str(e)}"}
    finally:
        if temp_dir and os.path.exists(temp_dir):
            shutil.rmtree(temp_dir, ignore_errors=True)
