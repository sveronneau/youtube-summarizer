"""FastAPI endpoint integration tests (JSON + NDJSON streaming + security headers + upload validation)."""

import asyncio
import io
import json
from typing import Any, AsyncIterator, Dict, List, Optional
from unittest.mock import patch

import av
import httpx
from PIL import Image

import app.main as main_mod
from app.main import app


def _make_silent_mp4_bytes() -> bytes:
    buf = io.BytesIO()
    container = av.open(buf, mode="w", format="mp4")
    stream = container.add_stream("mpeg4", rate=5)
    stream.width = 160
    stream.height = 120
    stream.pix_fmt = "yuv420p"
    for i in range(8):
        img = Image.new("RGB", (160, 120), color=(40 * i % 255, 120, 200))
        for packet in stream.encode(av.VideoFrame.from_image(img)):
            container.mux(packet)
    for packet in stream.encode():
        container.mux(packet)
    container.close()
    return buf.getvalue()


async def _fake_summary(
    video_metadata: Dict[str, Any],
    transcript_text: str,
    model_choice: str = "gemma4",
    video_frames: Optional[List[str]] = None,
    **_kwargs: Any,
) -> Dict[str, Any]:
    return {
        "success": True,
        "summary": f"## Summary\nFrames={len(video_frames or [])} TextLen={len(transcript_text)}",
        "model_used": f"Mock ({model_choice})",
        "video_title": video_metadata.get("title", ""),
        "channel": video_metadata.get("author_name", ""),
    }


async def _fake_stream_summary(
    model_choice: str = "gemma4",
    **_kwargs: Any,
) -> AsyncIterator[Dict[str, Any]]:
    yield {"type": "chunk", "delta": "## Live "}
    yield {"type": "chunk", "delta": "Streamed Summary"}
    yield {
        "type": "done_llm",
        "summary": "## Live Streamed Summary",
        "model_used": f"Mock ({model_choice})",
    }


async def run_endpoint_tests() -> None:
    """Exercise all FastAPI routes, security headers, upload checks, and NDJSON streaming."""
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
        # 1. Index & Security Headers
        res_index = await client.get("/")
        assert res_index.status_code == 200
        assert res_index.headers.get("X-Content-Type-Options") == "nosniff"
        assert res_index.headers.get("Referrer-Policy") == "strict-origin-when-cross-origin"
        assert res_index.headers.get("X-Frame-Options") == "SAMEORIGIN"
        assert 'name="text-scale" content="scale"' in res_index.text
        assert 'id="ollama-model-note" role="status"' in res_index.text
        assert 'value="Gemma-4-E4B-it-GGUF"' not in res_index.text
        assert "/static/vendor/marked.min.js" in res_index.text
        assert 'id="card-hydrogen"' in res_index.text
        assert 'value="hydrogen"' in res_index.text
        assert 'id="card-neon"' in res_index.text
        assert 'value="neon"' in res_index.text
        assert 'id="card-lemonade"' in res_index.text
        assert 'value="lemonade"' in res_index.text
        assert 'id="card-unsloth"' not in res_index.text
        assert 'Ollama Gemma 4' not in res_index.text
        assert 'Lemonade Gemma 4' not in res_index.text
        assert 'id="unsloth-api-key"' not in res_index.text
        assert 'data-i18n="tagArgon"' in res_index.text
        assert 'id="card-flash"' not in res_index.text
        assert 'id="card-carbon"' in res_index.text
        assert 'value="carbon"' in res_index.text
        assert 'value="medium" data-i18n="optThinkingMedium" selected' in res_index.text
        assert main_mod.SummarizeRequest(url="https://youtu.be/dQw4w9WgXcQ").thinking_level == "medium"
        print("✅ Index route & security headers verified.")

        # 1b. /api/lemonade/models discovery endpoint
        with patch(
            "app.main.get_lemonade_models",
            return_value={
                "success": True,
                "models": [
                    {
                        "name": "Gemma-4-E4B-it-GGUF",
                        "model": "Gemma-4-E4B-it-GGUF",
                        "label": "Gemma-4-E4B-it-GGUF (llamacpp • gpu)",
                        "recipe": "llamacpp",
                        "device": "gpu",
                        "is_gemma": True,
                        "is_vision": True,
                        "context_length": 32768,
                        "loaded": True,
                    }
                ],
                "count": 1,
                "host": "http://127.0.0.1:13305",
                "loaded_only": True,
            },
        ):
            res_lem_models = await client.get("/api/lemonade/models")
            assert res_lem_models.status_code == 200
            lem_json = res_lem_models.json()
            assert lem_json["success"] is True
            assert lem_json["models"][0]["name"] == "Gemma-4-E4B-it-GGUF"
        print("✅ /api/lemonade/models discovery endpoint verified.")

        # 2. Strict /api/video-info validation
        bad_info = await client.post(
            "/api/video-info", json={"url": "https://example.com/dQw4w9WgXcQ"}
        )
        assert bad_info.status_code == 400

        good_info = await client.post(
            "/api/video-info",
            json={"url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"},
        )
        assert good_info.status_code == 200
        assert good_info.json()["video_id"] == "dQw4w9WgXcQ"
        print("✅ /api/video-info strict URL validation verified.")

        # 3. /api/summarize & /api/summarize/stream with mocked LLM
        with (
            patch("app.main.generate_youtube_summary", new=_fake_summary),
            patch("app.main.stream_youtube_summary", new=_fake_stream_summary),
            patch(
                "app.main.get_video_transcript",
                return_value={
                    "success": True,
                    "transcript_text": "Bonjour Sherbrooke DevFest!",
                    "language_name": "French",
                    "segment_count": 1,
                },
            ),
        ):
            res_sum = await client.post(
                "/api/summarize",
                json={"url": "https://youtu.be/dQw4w9WgXcQ", "model": "carbon"},
            )
            assert res_sum.status_code == 200
            body = res_sum.json()
            assert body["success"] is True
            assert body["model_used"] == "Mock (carbon)"
            assert "TextLen=27" in body["summary"]

            res_stream = await client.post(
                "/api/summarize/stream",
                json={"url": "https://youtu.be/dQw4w9WgXcQ", "model": "gemma4:12b"},
            )
            assert res_stream.status_code == 200
            events = [
                json.loads(line)
                for line in res_stream.text.splitlines()
                if line.strip()
            ]
            event_types = [e["type"] for e in events]
            assert "stage" in event_types
            assert "meta" in event_types
            assert "chunk" in event_types
            assert events[-1]["type"] == "done"
            assert events[-1]["summary"] == "## Live Streamed Summary"
        print("✅ /api/summarize (JSON & NDJSON stream) verified.")

        # 3b. Lemonade routing dispatch (must go to Lemonade, NOT Ollama)
        async def _fake_lemonade_batch(
            prompt: str,
            model_name: str = "Gemma-4-E4B-it-GGUF",
            images_b64: Optional[List[str]] = None,
            api_key_override: Optional[str] = None,
        ) -> Dict[str, Any]:
            return {
                "success": True,
                "summary": f"## Lemonade Summary\nModel={model_name}",
                "model_used": f"Lemonade ({model_name})",
            }

        async def _fake_lemonade_stream(
            prompt: str,
            model_name: str = "Gemma-4-E4B-it-GGUF",
            images_b64: Optional[List[str]] = None,
            api_key_override: Optional[str] = None,
        ) -> AsyncIterator[Dict[str, Any]]:
            yield {"type": "chunk", "delta": "## Lemonade Live "}
            yield {"type": "chunk", "delta": "Stream"}
            yield {
                "type": "done_llm",
                "summary": "## Lemonade Live Stream",
                "model_used": f"Lemonade ({model_name})",
            }

        async def _fail_if_ollama(*_args: Any, **_kwargs: Any) -> Dict[str, Any]:
            raise AssertionError("Lemonade request erroneously routed to Ollama!")

        with (
            patch("app.llm_service.generate_summary_with_lemonade", new=_fake_lemonade_batch),
            patch("app.llm_service._stream_summary_with_lemonade", new=_fake_lemonade_stream),
            patch("app.llm_service.generate_summary_with_ollama", new=_fail_if_ollama),
            patch(
                "app.main.get_video_transcript",
                return_value={
                    "success": True,
                    "transcript_text": "Hello GDG Ottawa Lemonade workshop!",
                    "language_name": "English",
                    "segment_count": 1,
                },
            ),
        ):
            res_lem_sum = await client.post(
                "/api/summarize",
                json={"url": "https://youtu.be/dQw4w9WgXcQ", "model": "lemonade:Gemma-4-E4B-it-GGUF"},
            )
            assert res_lem_sum.status_code == 200
            lem_sum_body = res_lem_sum.json()
            assert lem_sum_body["success"] is True
            assert "Lemonade" in lem_sum_body["model_used"]
            assert "Gemma-4-E4B-it-GGUF" in lem_sum_body["model_used"]

            res_lem_stream = await client.post(
                "/api/summarize/stream",
                json={"url": "https://youtu.be/dQw4w9WgXcQ", "model": "lemonade:Gemma-4-E4B-it-GGUF"},
            )
            assert res_lem_stream.status_code == 200
            lem_events = [
                json.loads(line)
                for line in res_lem_stream.text.splitlines()
                if line.strip()
            ]
            assert lem_events[-1]["type"] == "done"
            assert lem_events[-1]["summary"] == "## Lemonade Live Stream"
            assert "Lemonade" in lem_events[-1]["model_used"]
        print("✅ Lemonade routing dispatch (batch & NDJSON stream) verified.")

        # 4. /api/summarize-upload: unsupported extension, size limit, and silent MP4 visual fallback
        bad_ext = await client.post(
            "/api/summarize-upload",
            files={"file": ("notes.txt", b"hello", "text/plain")},
        )
        assert bad_ext.json()["success"] is False
        assert "Unsupported media format" in bad_ext.json()["error"]

        with patch.object(main_mod, "MAX_UPLOAD_BYTES", 64):
            oversized = await client.post(
                "/api/summarize-upload",
                files={"file": ("clip.mp4", b"x" * 256, "video/mp4")},
            )
            assert oversized.json()["success"] is False
            assert "exceeds maximum allowed size" in oversized.json()["error"]

        mp4_bytes = _make_silent_mp4_bytes()
        with (
            patch("app.main.generate_youtube_summary", new=_fake_summary),
            patch(
                "app.main.transcribe_local_video",
                return_value={
                    "success": False,
                    "reason": "no_speech",
                    "error": "No speech",
                },
            ),
        ):
            silent_res = await client.post(
                "/api/summarize-upload",
                files={"file": ("silent.mp4", mp4_bytes, "video/mp4")},
                data={"model": "gemma4:12b", "lang": "fr"},
            )
            silent_json = silent_res.json()
            assert silent_json["success"] is True
            assert "🎬 Visual Video" in silent_json["transcript_info"]["language"]
            assert "Frames=0" not in silent_json["summary"]

        # 5. Offline Whisper model missing MUST fail loudly instead of faking Visual Video
        with patch(
            "app.main.transcribe_local_video",
            return_value={
                "success": False,
                "reason": "whisper_unavailable",
                "error": "Offline Speech Model Not Cached: Faster-Whisper model 'base' is not downloaded.",
            },
        ):
            missing_whisper_res = await client.post(
                "/api/summarize-upload",
                files={"file": ("talk_with_speech.mp4", mp4_bytes, "video/mp4")},
                data={"model": "gemma4:12b", "lang": "fr"},
            )
            mw_json = missing_whisper_res.json()
            assert mw_json["success"] is False
            assert "Offline Speech Model Not Cached" in mw_json["error"]

            missing_whisper_stream = await client.post(
                "/api/summarize-upload/stream",
                files={"file": ("talk_with_speech.mp4", mp4_bytes, "video/mp4")},
                data={"model": "gemma4:12b", "lang": "fr"},
            )
            stream_events = [
                json.loads(line)
                for line in missing_whisper_stream.text.splitlines()
                if line.strip()
            ]
            assert stream_events[-1]["type"] == "error"
            assert "Offline Speech Model Not Cached" in stream_events[-1]["error"]
        print("✅ /api/summarize-upload (extension, size limit, visual fallback & offline Whisper guard) verified.")


if __name__ == "__main__":
    asyncio.run(run_endpoint_tests())
