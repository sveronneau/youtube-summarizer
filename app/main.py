"""FastAPI application routes and lifecycle management for Video Summarizer."""

import asyncio
from contextlib import asynccontextmanager
import json
import logging
import os
import shutil
import tempfile
from typing import Any, AsyncIterator, Dict, Optional

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from app.llm_service import (
    close_llm_client,
    generate_youtube_summary,
    get_ollama_models,
    stream_youtube_summary,
)
from app.transcription_service import (
    extract_video_frames_base64,
    transcribe_local_video,
)
from app.youtube_service import (
    close_youtube_client,
    extract_video_id,
    get_video_metadata,
    get_video_transcript,
)

logger = logging.getLogger(__name__)

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
        "Summarize YouTube videos & local media files using Ollama Gemma 4 & Gemini models "
        "- DevFest Sherbrooke & Eastern Townships Edition"
    ),
    version="2.2.0",
    lifespan=lifespan,
)


@app.middleware("http")
async def add_security_headers(request: Request, call_next: Any) -> Any:
    """Attach baseline security and referrer-privacy headers to all responses."""
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
    return response


# Mount static files
static_dir = os.path.join(os.path.dirname(__file__), "static")
os.makedirs(static_dir, exist_ok=True)
app.mount("/static", StaticFiles(directory=static_dir), name="static")


class VideoInfoRequest(BaseModel):
    """Request payload for fetching YouTube video preview metadata."""

    url: str = Field(..., max_length=2048)


class SummarizeRequest(BaseModel):
    """Request payload for summarizing a YouTube video."""

    url: str = Field(..., max_length=2048)
    model: str = Field(
        default="gemma4",
        max_length=128,
        description=(
            "Choice of model: 'gemma4' (Ollama Local), 'flash' (Gemini 3.8 Flash), "
            "'argon' (Gemini 4 Argon), or 'carbon' (Gemini 4 Carbon)"
        ),
    )
    custom_context: Optional[str] = Field(
        default="",
        max_length=8000,
        description="Extra expectations / context for summary",
    )
    api_key: Optional[str] = Field(
        default=None,
        max_length=512,
        description="Optional user-provided Gemini API key",
    )
    thinking_level: Optional[str] = Field(
        default="high",
        description="Reasoning depth for Gemini 3.8 Flash / Gemini 4 (Hydrogen, Argon, Carbon): 'low', 'medium', 'high', or 'xhigh' (Hydrogen)",
    )
    lang: Optional[str] = Field(
        default="bi", description="Interface language preference: 'fr', 'en', or 'bi'"
    )
    song_mode: bool = Field(
        default=False,
        description="Enable 2nd-pass audio lyrics extraction and music analysis when input is a song",
    )


async def _save_upload_file_nonblocking(
    upload_file: UploadFile, dest_path: str, max_bytes: int
) -> Optional[str]:
    """Stream uploaded file chunks to disk via worker thread to avoid blocking the event loop."""
    total_bytes = 0
    chunk_size = 1024 * 1024  # 1 MB chunks
    handle = await asyncio.to_thread(open, dest_path, "wb")
    try:
        while True:
            chunk = await upload_file.read(chunk_size)
            if not chunk:
                break
            total_bytes += len(chunk)
            if total_bytes > max_bytes:
                return f"Uploaded file exceeds maximum allowed size ({max_bytes // (1024 * 1024)} MB)."
            await asyncio.to_thread(handle.write, chunk)
    finally:
        await asyncio.to_thread(handle.close)
    return None


def _ndjson_line(payload: Dict[str, Any]) -> bytes:
    """Serialize a streaming event dict as a UTF-8 NDJSON line."""
    return (json.dumps(payload, ensure_ascii=False) + "\n").encode("utf-8")


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

        metadata_task = asyncio.create_task(get_video_metadata(video_id))
        transcript_task = asyncio.to_thread(
            get_video_transcript, video_id, None, req.song_mode
        )
        metadata, transcript_result = await asyncio.gather(
            metadata_task, transcript_task
        )

        # Refresh metadata from cache in case yt-dlp enriched a fallback placeholder
        if metadata.get("author_name") == "YouTube Creator":
            metadata = await get_video_metadata(video_id)

        transcript_text = transcript_result.get("transcript_text") or ""
        video_frames = transcript_result.get("video_frames") or []
        lang_label = transcript_result.get("language_name") or (
            f"🎬 Visual Video ({len(video_frames)} frames)"
            if video_frames and not transcript_text
            else ("No Captions" if not transcript_text else "Unknown")
        )
        seg_count = transcript_result.get("segment_count", 0)

        summary_result = await generate_youtube_summary(
            video_metadata=metadata,
            transcript_text=transcript_text,
            model_choice=req.model,
            custom_context=req.custom_context,
            api_key_override=req.api_key,
            thinking_level=req.thinking_level or "high",
            lang=req.lang or "bi",
            song_mode=req.song_mode,
            video_frames=video_frames if video_frames else None,
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
                    else (
                        f"[No spoken audio or captions — summarized by visually analyzing {len(video_frames)} keyframes from the video]"
                        if video_frames
                        else "[No captions/transcript available for this video — summarized directly from video & metadata]"
                    )
                ),
            },
        }
    except Exception as exc:
        logger.error("Error in /api/summarize: %s", exc)
        return {"success": False, "error": f"Server Processing Error: {str(exc)}"}


@app.post("/api/summarize/stream")
async def summarize_video_stream(req: SummarizeRequest) -> StreamingResponse:
    """Stream progress stages and live summary tokens for a YouTube video as NDJSON."""
    video_id = extract_video_id(req.url)
    if not video_id:

        async def _invalid_gen() -> AsyncIterator[bytes]:
            yield _ndjson_line(
                {
                    "type": "error",
                    "error": "Invalid YouTube URL format. Please paste a valid YouTube watch link, short link, or shorts URL.",
                }
            )

        return StreamingResponse(_invalid_gen(), media_type="application/x-ndjson")

    async def _event_stream() -> AsyncIterator[bytes]:
        try:
            yield _ndjson_line({"type": "stage", "stage": "transcript"})
            metadata_task = asyncio.create_task(get_video_metadata(video_id))
            transcript_task = asyncio.to_thread(
                get_video_transcript, video_id, None, req.song_mode
            )
            metadata, transcript_result = await asyncio.gather(
                metadata_task, transcript_task
            )
            if metadata.get("author_name") == "YouTube Creator":
                metadata = await get_video_metadata(video_id)

            transcript_text = transcript_result.get("transcript_text") or ""
            video_frames = transcript_result.get("video_frames") or []
            lang_label = transcript_result.get("language_name") or (
                f"🎬 Visual Video ({len(video_frames)} frames)"
                if video_frames and not transcript_text
                else ("No Captions" if not transcript_text else "Unknown")
            )
            seg_count = transcript_result.get("segment_count", 0)
            full_transcript_display = (
                transcript_text
                if transcript_text
                else (
                    f"[No spoken audio or captions — summarized by visually analyzing {len(video_frames)} keyframes from the video]"
                    if video_frames
                    else "[No captions/transcript available for this video — summarized directly from video & metadata]"
                )
            )
            transcript_info = {
                "segment_count": seg_count,
                "language": lang_label,
                "full_transcript": full_transcript_display,
            }

            yield _ndjson_line(
                {
                    "type": "meta",
                    "metadata": metadata,
                    "transcript_info": transcript_info,
                }
            )
            yield _ndjson_line({"type": "stage", "stage": "llm"})

            async for ev in stream_youtube_summary(
                video_metadata=metadata,
                transcript_text=transcript_text,
                model_choice=req.model,
                custom_context=req.custom_context,
                api_key_override=req.api_key,
                thinking_level=req.thinking_level or "high",
                lang=req.lang or "bi",
                song_mode=req.song_mode,
                video_frames=video_frames if video_frames else None,
            ):
                if ev["type"] == "chunk":
                    yield _ndjson_line(ev)
                elif ev["type"] == "done_llm":
                    yield _ndjson_line(
                        {
                            "type": "done",
                            "success": True,
                            "summary": ev["summary"],
                            "model_used": ev["model_used"],
                            "metadata": metadata,
                            "transcript_info": transcript_info,
                        }
                    )
                elif ev["type"] == "error":
                    yield _ndjson_line(ev)
        except Exception as exc:
            logger.error("Error in /api/summarize/stream: %s", exc)
            yield _ndjson_line(
                {"type": "error", "error": f"Server Processing Error: {str(exc)}"}
            )

    return StreamingResponse(
        _event_stream(),
        media_type="application/x-ndjson",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


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

        temp_dir = tempfile.mkdtemp(prefix="upload_media_")
        safe_temp_path = os.path.join(temp_dir, f"upload{ext}")

        size_err = await _save_upload_file_nonblocking(
            file, safe_temp_path, MAX_UPLOAD_BYTES
        )
        if size_err:
            return {"success": False, "error": size_err}

        transcribe_res = await asyncio.to_thread(
            transcribe_local_video, safe_temp_path, song_mode
        )
        if transcribe_res.get("reason") == "whisper_unavailable":
            return {
                "success": False,
                "error": transcribe_res.get(
                    "error",
                    "Offline Speech Model Not Cached: Faster-Whisper weights are missing.",
                ),
            }

        transcript_text = transcribe_res.get("transcript_text") or ""
        seg_count = transcribe_res.get("segment_count", 0)
        video_frames = []

        if not transcript_text.strip():
            video_frames = await asyncio.to_thread(
                extract_video_frames_base64, safe_temp_path, 8
            )

        if transcribe_res.get("success") and transcript_text.strip():
            lang_label = transcribe_res.get("language_name", "English")
        elif video_frames:
            lang_label = f"🎬 Visual Video ({len(video_frames)} frames)"
            seg_count = len(video_frames)
        else:
            lang_label = "No Speech Track"

        metadata = {
            "title": f"{'Local Song' if song_mode else 'Local Media'}: {raw_filename}",
            "author_name": "Local Audio / Video File",
            "thumbnail_url": "/static/video-placeholder.png",
            "url": raw_filename,
        }

        summary_result = await generate_youtube_summary(
            video_metadata=metadata,
            transcript_text=transcript_text,
            model_choice=model,
            custom_context=custom_context,
            api_key_override=api_key,
            thinking_level=thinking_level or "high",
            lang=lang or "bi",
            song_mode=song_mode,
            video_frames=video_frames if video_frames else None,
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
                    else (
                        f"[No spoken audio — summarized by visually analyzing {len(video_frames)} keyframes extracted from the video file]"
                        if video_frames
                        else "[No spoken audio transcribed from this video file — summarized using video context & metadata]"
                    )
                ),
            },
        }
    except Exception as exc:
        logger.error("Error in /api/summarize-upload: %s", exc)
        return {"success": False, "error": f"Upload Processing Error: {str(exc)}"}
    finally:
        if temp_dir and os.path.exists(temp_dir):
            shutil.rmtree(temp_dir, ignore_errors=True)


@app.post("/api/summarize-upload/stream")
async def summarize_uploaded_file_stream(
    file: UploadFile = File(...),
    model: str = Form("gemma4"),
    custom_context: Optional[str] = Form(""),
    api_key: Optional[str] = Form(None),
    thinking_level: Optional[str] = Form("high"),
    lang: Optional[str] = Form("bi"),
    song_mode: bool = Form(False),
) -> StreamingResponse:
    """Save uploaded media before streaming response starts, then stream stages & tokens."""
    raw_filename = os.path.basename(file.filename or "video.mp4")
    _, ext = os.path.splitext(raw_filename.lower())
    if ext not in ALLOWED_VIDEO_EXTENSIONS:

        async def _ext_err() -> AsyncIterator[bytes]:
            yield _ndjson_line(
                {
                    "type": "error",
                    "error": "Unsupported media format. Please upload a video (.mp4, .mov, .mkv, .webm) or audio (.mp3, .wav, .m4a, .flac) file.",
                }
            )

        return StreamingResponse(_ext_err(), media_type="application/x-ndjson")

    temp_dir = tempfile.mkdtemp(prefix="upload_stream_")
    safe_temp_path = os.path.join(temp_dir, f"upload{ext}")
    size_err = await _save_upload_file_nonblocking(file, safe_temp_path, MAX_UPLOAD_BYTES)
    if size_err:
        shutil.rmtree(temp_dir, ignore_errors=True)

        async def _size_err() -> AsyncIterator[bytes]:
            yield _ndjson_line({"type": "error", "error": size_err})

        return StreamingResponse(_size_err(), media_type="application/x-ndjson")

    async def _upload_event_stream() -> AsyncIterator[bytes]:
        try:
            yield _ndjson_line({"type": "stage", "stage": "transcript"})
            transcribe_res = await asyncio.to_thread(
                transcribe_local_video, safe_temp_path, song_mode
            )
            if transcribe_res.get("reason") == "whisper_unavailable":
                yield _ndjson_line(
                    {
                        "type": "error",
                        "error": transcribe_res.get(
                            "error",
                            "Offline Speech Model Not Cached: Faster-Whisper weights are missing.",
                        ),
                    }
                )
                return

            transcript_text = transcribe_res.get("transcript_text") or ""
            seg_count = transcribe_res.get("segment_count", 0)
            video_frames = []

            if not transcript_text.strip():
                yield _ndjson_line({"type": "stage", "stage": "frames"})
                video_frames = await asyncio.to_thread(
                    extract_video_frames_base64, safe_temp_path, 8
                )

            if transcribe_res.get("success") and transcript_text.strip():
                lang_label = transcribe_res.get("language_name", "English")
            elif video_frames:
                lang_label = f"🎬 Visual Video ({len(video_frames)} frames)"
                seg_count = len(video_frames)
            else:
                lang_label = "No Speech Track"

            metadata = {
                "title": f"{'Local Song' if song_mode else 'Local Media'}: {raw_filename}",
                "author_name": "Local Audio / Video File",
                "thumbnail_url": "/static/video-placeholder.png",
                "url": raw_filename,
            }
            full_transcript_display = (
                transcript_text
                if transcript_text
                else (
                    f"[No spoken audio — summarized by visually analyzing {len(video_frames)} keyframes extracted from the video file]"
                    if video_frames
                    else "[No spoken audio transcribed from this video file — summarized using video context & metadata]"
                )
            )
            transcript_info = {
                "segment_count": seg_count,
                "language": lang_label,
                "full_transcript": full_transcript_display,
            }

            yield _ndjson_line(
                {
                    "type": "meta",
                    "metadata": metadata,
                    "transcript_info": transcript_info,
                }
            )
            yield _ndjson_line({"type": "stage", "stage": "llm"})

            async for ev in stream_youtube_summary(
                video_metadata=metadata,
                transcript_text=transcript_text,
                model_choice=model,
                custom_context=custom_context,
                api_key_override=api_key,
                thinking_level=thinking_level or "high",
                lang=lang or "bi",
                song_mode=song_mode,
                video_frames=video_frames if video_frames else None,
            ):
                if ev["type"] == "chunk":
                    yield _ndjson_line(ev)
                elif ev["type"] == "done_llm":
                    yield _ndjson_line(
                        {
                            "type": "done",
                            "success": True,
                            "summary": ev["summary"],
                            "model_used": ev["model_used"],
                            "metadata": metadata,
                            "transcript_info": transcript_info,
                        }
                    )
                elif ev["type"] == "error":
                    yield _ndjson_line(ev)
        except Exception as exc:
            logger.error("Error in /api/summarize-upload/stream: %s", exc)
            yield _ndjson_line(
                {"type": "error", "error": f"Upload Processing Error: {str(exc)}"}
            )
        finally:
            if temp_dir and os.path.exists(temp_dir):
                shutil.rmtree(temp_dir, ignore_errors=True)

    return StreamingResponse(
        _upload_event_stream(),
        media_type="application/x-ndjson",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
