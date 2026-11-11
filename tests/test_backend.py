"""Unit tests for YouTube URL parsing, model resolution, context budgeting, and frame extraction."""

import asyncio
import os
import tempfile

import av
from PIL import Image

from app.llm_service import (
    _compute_ollama_options,
    _fit_transcript_to_budget,
    _format_gemini_error,
    resolve_model_name,
)
from app.transcription_service import extract_video_frames_base64
from app.youtube_service import (
    _has_meaningful_lyrics,
    close_youtube_client,
    extract_video_id,
    get_video_metadata,
    get_video_transcript,
)


def test_extract_video_id() -> None:
    """Verify strict 11-char video ID extraction and rejection of non-video/non-YouTube URLs."""
    valid_urls = [
        ("https://www.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"),
        ("https://music.youtube.com/watch?v=pjd86X7Zx2s&feature=share", "pjd86X7Zx2s"),
        ("https://youtu.be/dQw4w9WgXcQ?t=42", "dQw4w9WgXcQ"),
        ("youtu.be/dQw4w9WgXcQ", "dQw4w9WgXcQ"),
        ("https://www.youtube.com/shorts/dQw4w9WgXcQ", "dQw4w9WgXcQ"),
        ("https://www.youtube.com/embed/dQw4w9WgXcQ", "dQw4w9WgXcQ"),
        ("https://www.youtube.com/live/dQw4w9WgXcQ", "dQw4w9WgXcQ"),
    ]
    for url, expected in valid_urls:
        vid = extract_video_id(url)
        assert vid == expected, f"Failed for {url}: expected {expected}, got {vid}"

    invalid_urls = [
        "",
        "https://example.com/dQw4w9WgXcQ",
        "https://www.youtube.com/channel/UC_x5XG1OV2P6uZZ5FSM9Ttw",
        "https://www.youtube.com/@GoogleDevelopers",
        "https://www.youtube.com/playlist?list=PL12345678901",
        "https://www.youtube.com/watch?v=too_short",
        "https://www.youtube.com/watch?v=way_too_long_video_id_123",
    ]
    for bad_url in invalid_urls:
        assert extract_video_id(bad_url) is None, f"Expected None for {bad_url}"

    print("✅ Strict Video ID extraction tests passed.")


def test_model_resolution() -> None:
    """Verify model alias resolution for local Ollama and remote Gemini models."""
    assert resolve_model_name("gemma4") == "gemma4:latest"
    assert resolve_model_name("gemma4:12b") == "gemma4:12b"
    assert resolve_model_name("gemma4:26b") == "gemma4:26b"
    assert resolve_model_name("flash") == "gemini-3.8-flash"
    assert resolve_model_name("argon") == "gemini-4-argon"
    assert resolve_model_name("pro") == "gemini-4-argon"
    assert resolve_model_name("gemini-3.8-flash") == "gemini-3.8-flash"
    assert resolve_model_name("gemini-4-argon") == "gemini-4-argon"
    print("✅ Model resolution tests passed.")


def test_context_budget_and_gemini_error_classification() -> None:
    """Verify long transcript fitting, Ollama num_ctx scaling, and HTTP 400 vs Auth classification."""
    long_text = "\n".join(f"Line {i}: conference content segment" for i in range(6000))
    fitted = _fit_transcript_to_budget(long_text, max_chars=4000)
    assert len(fitted) <= 4500
    assert "Line 0:" in fitted
    assert "Line 5999:" in fitted

    assert _compute_ollama_options("short prompt", "gemma4:latest") is None
    opts = _compute_ollama_options("x" * 30000, "gemma4:latest")
    assert opts is not None and opts["num_ctx"] >= 10240

    # Non-auth HTTP 400 must NOT claim the API key is invalid
    req_err = _format_gemini_error(
        "gemini-3.8-flash", "400 INVALID_ARGUMENT: Unsupported video URI", "AIzaSecretKey123"
    )
    assert "Request Error" in req_err["error"]
    assert "Authentication Error" not in req_err["error"]

    # Auth error must scrub leaked secret and classify as Authentication Error
    auth_err = _format_gemini_error(
        "gemini-3.8-flash", "400 API_KEY_INVALID for key AIzaSecretKey123", "AIzaSecretKey123"
    )
    assert "Authentication Error" in auth_err["error"]
    assert "AIzaSecretKey123" not in auth_err["error"]
    print("✅ Context budget & Gemini error classification tests passed.")


def test_song_lyrics_detection() -> None:
    """Verify detection of noise-only captions vs real song lyrics for 2nd-pass Song Mode."""
    assert not _has_meaningful_lyrics("")
    assert not _has_meaningful_lyrics("[Music]\n[Musique]\n♪ ♫\n[Applause]")
    assert _has_meaningful_lyrics(
        "We're no strangers to love, you know the rules and so do I. "
        "A full commitment's what I'm thinking of, you wouldn't get this from any other guy."
    )
    print("✅ Song Mode lyrics detection tests passed.")


def test_visual_video_frame_extraction() -> None:
    """Verify keyframe extraction from both short (<3s) and longer (>4s seekable) MP4 videos."""
    with tempfile.TemporaryDirectory() as tmp_dir:
        for name, total_frames in (("short_demo.mp4", 10), ("seekable_demo.mp4", 30)):
            video_path = os.path.join(tmp_dir, name)
            container = av.open(video_path, mode="w")
            stream = container.add_stream("mpeg4", rate=5)
            stream.width = 320
            stream.height = 240
            stream.pix_fmt = "yuv420p"

            for i in range(total_frames):
                img = Image.new("RGB", (320, 240), color=((i * 15) % 255, 100, 180))
                frame = av.VideoFrame.from_image(img)
                for packet in stream.encode(frame):
                    container.mux(packet)
            for packet in stream.encode():
                container.mux(packet)
            container.close()

            frames_b64 = extract_video_frames_base64(video_path, max_frames=4)
            assert 0 < len(frames_b64) <= 4, f"Unexpected frame count for {name}"

    print("✅ Visual video frame extraction tests (short & seekable) passed.")


async def test_youtube_metadata_and_transcript() -> None:
    """Verify metadata structure and fallback transcript handling."""
    test_id = "dQw4w9WgXcQ"
    meta = await get_video_metadata(test_id)
    assert meta["video_id"] == test_id
    assert "title" in meta
    assert "thumbnail_url" in meta
    print("✅ Metadata fetch test passed:", meta["title"])

    transcript_res = get_video_transcript(test_id)
    print("Transcript test result success:", transcript_res.get("success"))
    await close_youtube_client()


if __name__ == "__main__":
    test_extract_video_id()
    test_model_resolution()
    test_context_budget_and_gemini_error_classification()
    test_song_lyrics_detection()
    test_visual_video_frame_extraction()
    asyncio.run(test_youtube_metadata_and_transcript())
