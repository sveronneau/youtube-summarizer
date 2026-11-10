"""Unit tests for YouTube URL parsing, model resolution, and metadata retrieval."""

import asyncio

from app.llm_service import resolve_model_name
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


if __name__ == "__main__":
    test_extract_video_id()
    test_model_resolution()
    test_song_lyrics_detection()
    asyncio.run(test_youtube_metadata_and_transcript())
