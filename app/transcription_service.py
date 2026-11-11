"""Local video audio transcription and visual frame extraction service."""

import base64
import io
import logging
import os
import threading
from typing import Any, Dict, List

logger = logging.getLogger(__name__)

# Cache model instance to avoid re-loading weights on every request
_whisper_model = None
_model_lock = threading.Lock()
_pyav_patched = False

# Bound simultaneous heavy CPU/media jobs when serving multiple LAN clients
_MAX_CONCURRENT_JOBS = max(1, int(os.getenv("MAX_CONCURRENT_TRANSCRIPTIONS", "2")))
_transcription_semaphore = threading.BoundedSemaphore(_MAX_CONCURRENT_JOBS)


def _ensure_pyav_compat() -> None:
    """
    Shim av.open for PyAV >= 17 compatibility where 'metadata_errors' was removed,
    which faster-whisper 1.2.1 still passes inside decode_audio().
    """
    global _pyav_patched
    if _pyav_patched:
        return
    try:
        import av

        orig_open = av.open

        def _compat_open(*args: Any, **kwargs: Any) -> Any:
            try:
                return orig_open(*args, **kwargs)
            except TypeError:
                kwargs.pop("metadata_errors", None)
                return orig_open(*args, **kwargs)

        av.open = _compat_open
        _pyav_patched = True
    except Exception as exc:
        logger.debug("PyAV shim skipped: %s", exc)


def get_whisper_model() -> Any:
    """Lazily initialize and cache the faster-whisper model in a thread-safe manner."""
    global _whisper_model
    _ensure_pyav_compat()
    if _whisper_model is None:
        with _model_lock:
            if _whisper_model is None:
                try:
                    from faster_whisper import WhisperModel

                    model_size = os.getenv("WHISPER_MODEL_SIZE", "base")
                    compute_type = os.getenv("WHISPER_COMPUTE_TYPE", "int8")
                    cpu_threads = max(1, (os.cpu_count() or 4) // _MAX_CONCURRENT_JOBS)
                    _whisper_model = WhisperModel(
                        model_size,
                        device="cpu",
                        compute_type=compute_type,
                        cpu_threads=cpu_threads,
                    )
                except Exception as exc:
                    logger.error("Failed to load WhisperModel: %s", exc)
                    raise
    return _whisper_model


def _extract_segments(
    segments: Any, deduplicate_repeats: bool = False
) -> tuple[list[str], list[Dict[str, Any]]]:
    """Collect non-empty text lines and timestamped segment dicts from a Whisper generator."""
    text_parts: list[str] = []
    formatted_segments: list[Dict[str, Any]] = []
    repeat_count = 0
    last_norm = ""

    for segment in segments:
        start_sec = int(segment.start)
        minutes = start_sec // 60
        seconds = start_sec % 60
        timestamp = f"{minutes:02d}:{seconds:02d}"
        text = segment.text.strip()

        if text:
            norm = text.lower().strip(" .,!?♪♫")
            if deduplicate_repeats and norm == last_norm:
                repeat_count += 1
                if repeat_count >= 2:
                    continue
            else:
                repeat_count = 0
                last_norm = norm

            text_parts.append(text)
            formatted_segments.append(
                {"timestamp": timestamp, "seconds": start_sec, "text": text}
            )
    return text_parts, formatted_segments


def transcribe_local_video(
    file_path: str, song_mode: bool = False
) -> Dict[str, Any]:
    """
    Transcribe a local video or audio file using faster-whisper.
    When song_mode=True, uses music-tuned vocal detection (low VAD threshold=0.25,
    chorus anti-repetition penalty, no_repeat_ngram_size=3) and falls back to
    unfiltered audio if needed.
    """
    if not os.path.exists(file_path):
        return {"success": False, "error": "Uploaded media file not found."}

    with _transcription_semaphore:
        try:
            model = get_whisper_model()

            if song_mode:
                segments_song, info = model.transcribe(
                    file_path,
                    beam_size=5,
                    vad_filter=True,
                    vad_parameters={
                        "threshold": 0.25,
                        "min_silence_duration_ms": 1500,
                        "speech_pad_ms": 400,
                    },
                    condition_on_previous_text=False,
                    repetition_penalty=1.15,
                    no_repeat_ngram_size=3,
                )
                text_parts, formatted_segments = _extract_segments(
                    segments_song, deduplicate_repeats=True
                )
                pass_used = 2

                if len(formatted_segments) < 3:
                    segments_unfiltered, info = model.transcribe(
                        file_path,
                        beam_size=5,
                        vad_filter=False,
                        condition_on_previous_text=False,
                        repetition_penalty=1.2,
                        no_repeat_ngram_size=3,
                    )
                    text_parts, formatted_segments = _extract_segments(
                        segments_unfiltered, deduplicate_repeats=True
                    )
            else:
                segments_p1, info = model.transcribe(
                    file_path,
                    beam_size=5,
                    vad_filter=True,
                    vad_parameters={"min_silence_duration_ms": 500},
                )
                text_parts, formatted_segments = _extract_segments(segments_p1)
                pass_used = 1

            full_text = "\n".join(text_parts)

            if not full_text.strip():
                return {
                    "success": False,
                    "error": "No spoken speech or sung lyrics could be transcribed from the audio.",
                }

            lang_code = getattr(info, "language", "en")
            lang_name = getattr(info, "language", "English").upper()
            if pass_used == 2:
                lang_name = f"{lang_name} (🎵 2nd-Pass Lyrics)"

            return {
                "success": True,
                "transcript_text": full_text,
                "formatted_segments": formatted_segments,
                "language_code": lang_code,
                "language_name": lang_name,
                "duration": getattr(info, "duration", 0),
                "segment_count": len(formatted_segments),
                "pass_used": pass_used,
            }

        except Exception as exc:
            logger.warning("Local audio transcription failed for %s: %s", file_path, exc)
            return {"success": False, "error": f"Transcription error: {str(exc)}"}


def _encode_pil_to_jpeg_b64(img: Any) -> str:
    """Downscale a PIL image immediately to 768x768 max and encode as base64 JPEG."""
    rgb_img = img.convert("RGB")
    rgb_img.thumbnail((768, 768))
    buf = io.BytesIO()
    rgb_img.save(buf, format="JPEG", quality=80)
    return base64.b64encode(buf.getvalue()).decode("ascii")


def extract_video_frames_base64(
    file_path: str, max_frames: int = 8
) -> List[str]:
    """
    Extract up to `max_frames` evenly spaced keyframes across the full duration of a
    local video file as base64-encoded JPEGs with minimal RAM footprint.
    """
    if not file_path or not os.path.exists(file_path) or max_frames <= 0:
        return []

    _ensure_pyav_compat()
    frames_b64: List[str] = []

    with _transcription_semaphore:
        try:
            import av

            with av.open(file_path, mode="r") as container:
                if not container.streams.video:
                    return []

                video_stream = container.streams.video[0]
                duration_us = container.duration  # in av.time_base (microseconds)

                # Strategy 1: Seek evenly across full video duration for >3s videos (low RAM, 100% coverage)
                if duration_us and duration_us > 3_000_000 and max_frames > 1:
                    seen_pts: set[int] = set()
                    for i in range(max_frames):
                        frac = 0.05 + 0.90 * (i / (max_frames - 1))
                        target_us = int(duration_us * frac)
                        try:
                            container.seek(target_us, backward=True, any_frame=False)
                            for frame in container.decode(video_stream):
                                pts = frame.pts if frame.pts is not None else i
                                if pts not in seen_pts:
                                    seen_pts.add(pts)
                                    frames_b64.append(
                                        _encode_pil_to_jpeg_b64(frame.to_image())
                                    )
                                break
                        except Exception:
                            continue

                    if frames_b64:
                        return frames_b64

                # Strategy 2: Short clips or unseekable streams — downscale immediately per frame
                container.seek(0)
                video_stream.codec_context.skip_frame = "NONKEY"
                encoded_candidates: List[str] = []
                for frame in container.decode(video_stream):
                    encoded_candidates.append(_encode_pil_to_jpeg_b64(frame.to_image()))
                    if len(encoded_candidates) >= max_frames * 4:
                        break

                if not encoded_candidates:
                    container.seek(0)
                    video_stream.codec_context.skip_frame = "DEFAULT"
                    for idx, frame in enumerate(container.decode(video_stream)):
                        if idx % 10 == 0:
                            encoded_candidates.append(
                                _encode_pil_to_jpeg_b64(frame.to_image())
                            )
                        if len(encoded_candidates) >= max_frames * 3:
                            break

                if not encoded_candidates:
                    return []

                total = len(encoded_candidates)
                if total <= max_frames:
                    return encoded_candidates

                indices = [
                    int(round(i * (total - 1) / (max_frames - 1)))
                    for i in range(max_frames)
                ]
                frames_b64 = [encoded_candidates[idx] for idx in indices]
        except Exception as exc:
            logger.warning("Could not extract video frames from %s: %s", file_path, exc)

    return frames_b64
