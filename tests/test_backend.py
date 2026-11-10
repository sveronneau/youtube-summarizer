"""Unit tests for YouTube URL parsing, model resolution, and metadata retrieval."""

import asyncio
import os
import tempfile

import av
from PIL import Image

from app.llm_service import resolve_model_name
from app.transcription_service import extract_video_frames_base64
from app.youtube_service import (
    _has_meaningful_lyrics,
    close_youtube_client,
    extract_video_id,
    get_video_metadata,
    get_video_transcript,
)


def test_extract_video_id() -> None:
    """Verify 11-char video ID extraction across standard, short, shorts, and embed URLs."""
    test_urls = [
        ("https://www.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"),
        ("https://youtu.be/dQw4w9WgXcQ", "dQw4w9WgXcQ"),
        ("https://www.youtube.com/shorts/dQw4w9WgXcQ", "dQw4w9WgXcQ"),
        ("https://www.youtube.com/embed/dQw4w9WgXcQ", "dQw4w9WgXcQ"),
    ]
    for url, expected in test_urls:
        vid = extract_video_id(url)
        assert vid == expected, f"Failed for {url}: expected {expected}, got {vid}"
    print("✅ Video ID extraction tests passed.")


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


def test_song_lyrics_detection() -> None:
    """Verify detection of noise-only captions vs real song lyrics for 2nd-pass Song Mode."""
    assert not _has_meaningful_lyrics("")
    assert not _has_meaningful_lyrics("[Music]\n[Musique]\n♪ ♫\n[Applause]")
    assert _has_meaningful_lyrics(
        "We're no strangers to love, you know the rules and so do I. "
        "A full commitment's what I'm thinking of, you wouldn't get this from any other guy."
    )
    print("✅ Song Mode lyrics detection tests passed.")


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
    if transcript_res.get("success"):
        print("Transcript segment count:", transcript_res.get("segment_count"))
    else:
        print("Transcript info:", transcript_res.get("error"))
    await close_youtube_client()


def test_visual_video_frame_extraction() -> None:
    """Verify keyframe extraction from a silent MP4 video file when no transcript exists."""
    with tempfile.TemporaryDirectory() as tmp_dir:
        video_path = os.path.join(tmp_dir, "silent_demo.mp4")
        container = av.open(video_path, mode="w")
        stream = container.add_stream("mpeg4", rate=5)
        stream.width = 320
        stream.height = 240
        stream.pix_fmt = "yuv420p"

        for i in range(10):
            img = Image.new("RGB", (320, 240), color=(i * 20, 100, 180))
            frame = av.VideoFrame.from_image(img)
            for packet in stream.encode(frame):
                container.mux(packet)
        for packet in stream.encode():
            container.mux(packet)
        container.close()

        frames_b64 = extract_video_frames_base64(video_path, max_frames=4)
        assert len(frames_b64) > 0, "Expected extracted base64 frames from silent MP4"
        assert len(frames_b64) <= 4
        print(f"✅ Visual video frame extraction test passed ({len(frames_b64)} frames extracted).")


if __name__ == "__main__":
    test_extract_video_id()
    test_model_resolution()
    test_song_lyrics_detection()
    test_visual_video_frame_extraction()
    asyncio.run(test_youtube_metadata_and_transcript())
