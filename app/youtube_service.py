"""YouTube metadata and caption extraction service with caching and yt-dlp fallback."""

from collections import OrderedDict
import json
import os
import re
import shutil
import tempfile
from typing import Any, Dict, List, Optional

import httpx
from youtube_transcript_api import YouTubeTranscriptApi

from app.transcription_service import (
    extract_video_frames_base64,
    transcribe_local_video,
)

# Bounded LRU caches to avoid redundant network calls between preview and summarization
_MAX_CACHE_SIZE = 128
_metadata_cache: "OrderedDict[str, Dict[str, Any]]" = OrderedDict()
_transcript_cache: "OrderedDict[str, Dict[str, Any]]" = OrderedDict()

_http_client: Optional[httpx.AsyncClient] = None


def get_http_client() -> httpx.AsyncClient:
    """Return a shared async HTTP client for YouTube metadata requests."""
    global _http_client
    if _http_client is None or _http_client.is_closed:
        _http_client = httpx.AsyncClient(timeout=5.0)
    return _http_client


async def close_youtube_client() -> None:
    """Close the shared async HTTP client on server shutdown."""
    global _http_client
    if _http_client is not None and not _http_client.is_closed:
        await _http_client.aclose()
        _http_client = None


def _cache_set(cache: OrderedDict, key: str, value: Dict[str, Any]) -> None:
    """Insert or update an entry in a bounded OrderedDict LRU cache."""
    if key in cache:
        cache.move_to_end(key)
    cache[key] = value
    if len(cache) > _MAX_CACHE_SIZE:
        cache.popitem(last=False)


def extract_video_id(url: str) -> Optional[str]:
    """Extract 11-character YouTube video ID from various YouTube URL formats."""
    if not url:
        return None
    url = url.strip()

    patterns = [
        r"(?:v=|\/)([0-9A-Za-z_-]{11}).*",
        r"(?:embed\/|v\/|watch\?v=|watch\?.+&v=|shorts\/|live\/)([^#\&\?]*).*",
        r"youtu\.be\/([0-9A-Za-z_-]{11})",
    ]

    for pattern in patterns:
        match = re.search(pattern, url)
        if match:
            v_id = match.group(1)
            if len(v_id) == 11:
                return v_id
    return None


async def get_video_metadata(video_id: str) -> Dict[str, Any]:
    """Fetch video metadata (title, author, thumbnail) using YouTube oEmbed with caching and reliable fallback."""
    if video_id in _metadata_cache:
        _metadata_cache.move_to_end(video_id)
        return _metadata_cache[video_id]

    oembed_url = (
        f"https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v={video_id}&format=json"
    )
    default_thumb = f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg"

    client = get_http_client()
    try:
        res = await client.get(oembed_url)
        if res.status_code == 200:
            data = res.json()
            meta = {
                "video_id": video_id,
                "title": data.get("title", f"YouTube Video ({video_id})"),
                "author_name": data.get("author_name", "Unknown Channel"),
                "author_url": data.get("author_url", ""),
                "thumbnail_url": data.get("thumbnail_url") or default_thumb,
                "url": f"https://www.youtube.com/watch?v={video_id}",
            }
            _cache_set(_metadata_cache, video_id, meta)
            return meta
    except Exception:
        pass

    return {
        "video_id": video_id,
        "title": f"YouTube Video ({video_id})",
        "author_name": "YouTube",
        "author_url": "",
        "thumbnail_url": default_thumb,
        "url": f"https://www.youtube.com/watch?v={video_id}",
    }


def _parse_vtt_or_json3(raw_content: str, ext: str) -> List[str]:
    """Parse subtitle content (json3 or vtt/srv) into clean text lines."""
    lines: List[str] = []
    if ext == "json3" or raw_content.lstrip().startswith("{"):
        try:
            data = json.loads(raw_content)
            for event in data.get("events", []):
                segs = event.get("segs", [])
                segment_text = "".join(s.get("utf8", "") for s in segs).strip()
                if segment_text and segment_text != "\n":
                    lines.append(segment_text.replace("\n", " "))
            if lines:
                return lines
        except Exception:
            pass

    # Fallback: VTT / SRT / XML tag stripping
    for line in raw_content.splitlines():
        line_s = line.strip()
        if (
            not line_s
            or line_s.startswith("WEBVTT")
            or "-->" in line_s
            or line_s.isdigit()
        ):
            continue
        if line_s.startswith(("Kind:", "Language:", "NOTE")):
            continue
        cleaned = re.sub(r"<[^>]+>", "", line_s).strip()
        if cleaned and (not lines or lines[-1] != cleaned):
            lines.append(cleaned)
    return lines


def _has_meaningful_lyrics(text: str) -> bool:
    """Return True if caption text contains actual lyrics rather than only '[Music]' / '[Applause]' tags."""
    if not text:
        return False
    cleaned = re.sub(
        r"\[(?:music|musique|applause|applaudissements|instrumental|chanson|singing)\]",
        "",
        text,
        flags=re.IGNORECASE,
    )
    cleaned = re.sub(r"[♪♫♬\s]+", " ", cleaned).strip()
    return len(cleaned) >= 80


class _QuietYtdlpLogger:
    """Silence yt-dlp console and deprecation output."""

    def debug(self, msg: str) -> None:
        pass

    def info(self, msg: str) -> None:
        pass

    def warning(self, msg: str) -> None:
        pass

    def error(self, msg: str) -> None:
        pass


def _fetch_lrclib_lyrics(
    title: str, artist: str = "", description_fallback: str = ""
) -> Optional[Dict[str, Any]]:
    """
    Query the public LRCLIB lyrics database for exact, typo-free studio lyrics
    before falling back to phonetic audio transcription.
    """
    if not title:
        return None
    clean_title = re.sub(
        r"\((?:official|vidéo|video|audio|clip|lyrics|paroles|hd|4k)[^)]*\)",
        "",
        title,
        flags=re.IGNORECASE,
    )
    clean_title = re.sub(r"\[[^\]]*\]", "", clean_title).strip()
    clean_artist = re.sub(r"\s*-\s*Topic$", "", artist or "", flags=re.IGNORECASE).strip()

    queries = []
    if clean_artist and clean_artist.lower() not in clean_title.lower():
        queries.append(f"{clean_artist} {clean_title}")
    queries.append(clean_title)

    try:
        with httpx.Client(timeout=5.0) as client:
            for q in queries:
                res = client.get("https://lrclib.net/api/search", params={"q": q})
                if res.status_code == 200:
                    items = res.json()
                    if isinstance(items, list):
                        for item in items:
                            plain = (item.get("plainLyrics") or "").strip()
                            if len(plain) >= 80:
                                lines = [
                                    line.strip()
                                    for line in plain.splitlines()
                                    if line.strip()
                                ]
                                full_text = plain
                                if description_fallback:
                                    full_text = (
                                        f"### Paroles Officielles / Official Song Lyrics:\n{plain}\n\n"
                                        f"### Crédits & Description:\n{description_fallback}"
                                    )
                                return {
                                    "success": True,
                                    "transcript_text": full_text,
                                    "formatted_segments": [
                                        {"timestamp": "00:00", "seconds": 0, "text": l}
                                        for l in lines
                                    ],
                                    "language_code": "lyrics",
                                    "language_name": "🎵 Paroles / Lyrics",
                                    "segment_count": len(lines),
                                    "pass_used": 2,
                                }
    except Exception:
        pass
    return None


def _extract_youtube_song_audio_transcript(
    video_id: str,
    description_fallback: str = "",
    title: str = "",
    artist: str = "",
    song_mode: bool = False,
) -> Optional[Dict[str, Any]]:
    """
    Audio & visual media fallback for YouTube videos without captions:
    1. If song_mode=True, checks LRCLIB for exact, typo-free studio lyrics first.
    2. Downloads a lightweight video/audio stream via yt-dlp into a temporary folder
       and runs faster-whisper (in song_mode or standard speech mode).
    3. If the video has no spoken speech or lyrics at all, extracts visual keyframes
       so multimodal LLMs (Ollama Gemma 4 / Gemini) can visually read the video.
    """
    if song_mode:
        lrclib_res = _fetch_lrclib_lyrics(title, artist, description_fallback)
        if lrclib_res:
            return lrclib_res

    temp_dir = None
    try:
        import yt_dlp

        temp_dir = tempfile.mkdtemp(prefix="yt_media_")
        out_template = os.path.join(temp_dir, "media.%(ext)s")
        media_opts = {
            "format": "best[ext=mp4][height<=360]/best[ext=mp4][height<=480]/bestaudio[ext=m4a]/bestaudio/best[filesize<100M]",
            "outtmpl": out_template,
            "quiet": True,
            "no_warnings": True,
            "noplaylist": True,
            "logger": _QuietYtdlpLogger(),
        }
        url = f"https://www.youtube.com/watch?v={video_id}"
        with yt_dlp.YoutubeDL(media_opts) as ydl:
            ydl.download([url])

        downloaded_files = [
            os.path.join(temp_dir, f)
            for f in os.listdir(temp_dir)
            if not f.endswith(".part")
        ]
        if not downloaded_files:
            return None

        media_path = downloaded_files[0]
        whisper_res = transcribe_local_video(media_path, song_mode=song_mode)
        if whisper_res.get("success") and whisper_res.get("transcript_text"):
            lyrics_text = whisper_res["transcript_text"]
            header = (
                "### Extracted Song Lyrics (2nd-Pass Audio Transcription):"
                if song_mode
                else "### Extracted Audio Transcript (faster-whisper):"
            )
            if description_fallback:
                lyrics_text = (
                    f"{header}\n{lyrics_text}\n\n"
                    f"### Video Description / Credits:\n{description_fallback}"
                )
            lang_code = whisper_res.get("language_code", "en")
            lang_name = whisper_res.get("language_name") or (
                f"{lang_code.upper()} (🎵 2nd-Pass Lyrics)"
                if song_mode
                else f"{lang_code.upper()} (🎙️ Audio Whisper)"
            )
            return {
                "success": True,
                "transcript_text": lyrics_text,
                "formatted_segments": whisper_res.get("formatted_segments", []),
                "language_code": lang_code,
                "language_name": lang_name,
                "segment_count": whisper_res.get("segment_count", 0),
                "pass_used": whisper_res.get("pass_used", 1),
            }

        # No spoken speech/lyrics found -> extract visual keyframes from the video
        frames_b64 = extract_video_frames_base64(media_path, max_frames=8)
        if frames_b64:
            desc_text = (
                f"Video Description:\n{description_fallback}"
                if description_fallback
                else ""
            )
            return {
                "success": True,
                "transcript_text": desc_text,
                "formatted_segments": [],
                "language_code": "visual",
                "language_name": f"🎬 Visual Video ({len(frames_b64)} frames)",
                "segment_count": len(frames_b64),
                "video_frames": frames_b64,
            }
    except Exception:
        pass
    finally:
        if temp_dir and os.path.exists(temp_dir):
            shutil.rmtree(temp_dir, ignore_errors=True)
    return None


def get_video_transcript(
    video_id: str,
    languages: Optional[List[str]] = None,
    song_mode: bool = False,
) -> Dict[str, Any]:
    """
    Fetch the transcript for a YouTube video using youtube-transcript-api with yt-dlp fallback.
    When song_mode=True and captions are missing or only '[Music]' tags, runs a 2nd-pass
    audio download + faster-whisper lyrics transcription.
    """
    cache_key = f"{video_id}:song" if song_mode else video_id
    if cache_key in _transcript_cache:
        _transcript_cache.move_to_end(cache_key)
        return _transcript_cache[cache_key]

    if languages is None:
        languages = ["fr", "en", "es", "de", "pt", "it", "ja", "ko", "zh"]

    api_instance = YouTubeTranscriptApi()

    # Attempt 1: Try youtube-transcript-api instance list & fetch
    try:
        try:
            transcript_list = api_instance.list(video_id)
            try:
                transcript = transcript_list.find_transcript(languages)
            except Exception:
                try:
                    transcript = transcript_list.find_manually_created_transcript(
                        languages
                    )
                except Exception:
                    try:
                        transcript = transcript_list.find_generated_transcript(
                            languages
                        )
                    except Exception:
                        transcript = next(iter(transcript_list))

            fetched = transcript.fetch()
            language_code = getattr(transcript, "language_code", "en")
            language_name = getattr(transcript, "language", "English")
        except Exception:
            fetched = api_instance.fetch(video_id, languages=languages)
            language_code = "en"
            language_name = "English"

        if fetched:
            text_parts = []
            formatted_segments = []

            for item in fetched:
                if hasattr(item, "start"):
                    start_sec = int(item.start)
                    text = str(item.text).strip()
                elif isinstance(item, dict):
                    start_sec = int(item.get("start", 0))
                    text = str(item.get("text", "")).strip()
                else:
                    continue

                if not text:
                    continue

                minutes = start_sec // 60
                seconds = start_sec % 60
                timestamp = f"{minutes:02d}:{seconds:02d}"

                text_parts.append(text)
                formatted_segments.append(
                    {"timestamp": timestamp, "seconds": start_sec, "text": text}
                )

            full_text = "\n".join(text_parts)

            if full_text.strip() and (
                not song_mode or _has_meaningful_lyrics(full_text)
            ):
                result = {
                    "success": True,
                    "transcript_text": full_text,
                    "formatted_segments": formatted_segments,
                    "language_code": language_code,
                    "language_name": language_name,
                    "segment_count": len(formatted_segments),
                }
                _cache_set(_transcript_cache, cache_key, result)
                return result

    except Exception:
        pass

    # Attempt 2: Fallback to yt-dlp subtitles, 2nd-pass song audio extraction, or description/chapters
    description_text = ""
    try:
        import yt_dlp

        ydl_opts = {
            "skip_download": True,
            "writesub": True,
            "writeautomaticsub": True,
            "subtitleslangs": languages,
            "quiet": True,
            "no_warnings": True,
            "logger": _QuietYtdlpLogger(),
        }
        url = f"https://www.youtube.com/watch?v={video_id}"
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            if info:
                # Update metadata cache with rich yt-dlp info if available
                if info.get("title"):
                    _cache_set(
                        _metadata_cache,
                        video_id,
                        {
                            "video_id": video_id,
                            "title": info.get("title", f"YouTube Video ({video_id})"),
                            "author_name": info.get("uploader")
                            or info.get("channel")
                            or "YouTube",
                            "author_url": info.get("uploader_url", ""),
                            "thumbnail_url": info.get("thumbnail")
                            or f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg",
                            "url": url,
                        },
                    )

                description_text = (info.get("description") or "").strip()

                subtitles = (
                    info.get("subtitles") or info.get("automatic_captions") or {}
                )
                if subtitles:
                    chosen_lang = None
                    for lang in languages:
                        if lang in subtitles and subtitles[lang]:
                            chosen_lang = lang
                            break
                    if not chosen_lang:
                        chosen_lang = next(iter(subtitles.keys()), None)

                    if chosen_lang and subtitles.get(chosen_lang):
                        sub_formats = subtitles[chosen_lang]
                        chosen_track = None
                        for pref_ext in ("json3", "vtt", "srv1", "ttml"):
                            for track in sub_formats:
                                if track.get("ext") == pref_ext and track.get("url"):
                                    chosen_track = track
                                    break
                            if chosen_track:
                                break
                        if not chosen_track and sub_formats:
                            chosen_track = sub_formats[0]

                        if chosen_track and chosen_track.get("url"):
                            with httpx.Client(timeout=10.0) as sync_client:
                                sub_res = sync_client.get(chosen_track["url"])
                                if sub_res.status_code == 200 and sub_res.text.strip():
                                    parsed_lines = _parse_vtt_or_json3(
                                        sub_res.text, chosen_track.get("ext", "")
                                    )
                                    if parsed_lines:
                                        full_text = "\n".join(parsed_lines)
                                        if not song_mode or _has_meaningful_lyrics(
                                            full_text
                                        ):
                                            result = {
                                                "success": True,
                                                "transcript_text": full_text,
                                                "formatted_segments": [
                                                    {
                                                        "timestamp": "00:00",
                                                        "seconds": 0,
                                                        "text": line,
                                                    }
                                                    for line in parsed_lines
                                                ],
                                                "language_code": chosen_lang,
                                                "language_name": chosen_lang.upper(),
                                                "segment_count": len(parsed_lines),
                                            }
                                            _cache_set(
                                                _transcript_cache, cache_key, result
                                            )
                                            return result

                # Attempt 2B: When captions are missing (or '[Music]' only in song_mode),
                # fall back to audio transcription (faster-whisper) and visual frame extraction
                song_title = (
                    info.get("track") or info.get("title") or ""
                ).strip()
                song_artist = (
                    info.get("artist")
                    or info.get("uploader")
                    or info.get("channel")
                    or ""
                ).strip()
                song_audio_res = _extract_youtube_song_audio_transcript(
                    video_id,
                    description_fallback=description_text,
                    title=song_title,
                    artist=song_artist,
                    song_mode=song_mode,
                )
                if song_audio_res:
                    _cache_set(_transcript_cache, cache_key, song_audio_res)
                    return song_audio_res

                # If video has no subtitles or audio/frames, use description and chapters if present
                chapters = info.get("chapters") or []
                fallback_parts = []
                if description_text:
                    fallback_parts.append(f"Video Description:\n{description_text}")
                if chapters:
                    chapter_lines = [
                        f"- {int(c.get('start_time', 0)) // 60:02d}:{int(c.get('start_time', 0)) % 60:02d} {c.get('title', '')}"
                        for c in chapters
                    ]
                    fallback_parts.append("Video Chapters:\n" + "\n".join(chapter_lines))

                if fallback_parts:
                    combined = "\n\n".join(fallback_parts)
                    result = {
                        "success": True,
                        "transcript_text": combined,
                        "formatted_segments": [],
                        "language_code": "meta",
                        "language_name": "Description & Chapters",
                        "segment_count": len(combined.splitlines()),
                    }
                    _cache_set(_transcript_cache, cache_key, result)
                    return result
    except Exception:
        pass

    # If yt-dlp metadata extraction had an issue in song_mode, still try direct 2nd-pass audio download
    if song_mode:
        song_audio_res = _extract_youtube_song_audio_transcript(
            video_id, description_fallback=description_text, song_mode=song_mode
        )
        if song_audio_res:
            _cache_set(_transcript_cache, cache_key, song_audio_res)
            return song_audio_res

    # Return graceful empty transcript so summarization can still proceed without captions
    return {
        "success": False,
        "transcript_text": "",
        "formatted_segments": [],
        "language_code": "none",
        "language_name": "No Captions",
        "segment_count": 0,
        "error": f"No transcript or captions were found for video ({video_id}).",
    }
