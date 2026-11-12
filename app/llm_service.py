"""LLM orchestration service supporting local Ollama (Gemma 4) and Google Gemini APIs (batch & streaming)."""

import asyncio
import base64
from collections import OrderedDict
import hashlib
import json
import logging
import os
from typing import Any, AsyncIterator, Dict, List, Optional

import httpx
from google import genai
from google.genai import types

logger = logging.getLogger(__name__)

OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://127.0.0.1:11434")
MAX_TRANSCRIPT_CHARS = int(os.getenv("MAX_TRANSCRIPT_CHARS", "120000"))

MODEL_MAPPING = {
    "gemma4": "gemma4:latest",
    "gemma4:latest": "gemma4:latest",
    "gemma": "gemma4:latest",
    "ollama": "gemma4:latest",
    "flash": "gemini-3.8-flash",
    "argon": "gemini-4-argon",
    "gemini-argon": "gemini-4-argon",
    "gemini-4-argon": "gemini-4-argon",
    "carbon": "gemini-4-carbon",
    "gemini-carbon": "gemini-4-carbon",
    "gemini-4-carbon": "gemini-4-carbon",
    "pro": "gemini-4-argon",
    "gemini-flash": "gemini-3.8-flash",
    "gemini-3.8-flash": "gemini-3.8-flash",
}

_llm_http_client: Optional[httpx.AsyncClient] = None
_gemini_clients: "OrderedDict[str, genai.Client]" = OrderedDict()
_ollama_context_lengths: Dict[str, int] = {}


def get_llm_http_client() -> httpx.AsyncClient:
    """Return a shared async HTTP client for LLM requests."""
    global _llm_http_client
    if _llm_http_client is None or _llm_http_client.is_closed:
        _llm_http_client = httpx.AsyncClient(timeout=180.0)
    return _llm_http_client


async def close_llm_client() -> None:
    """Close the shared async HTTP client on server shutdown."""
    global _llm_http_client
    if _llm_http_client is not None and not _llm_http_client.is_closed:
        await _llm_http_client.aclose()
        _llm_http_client = None
    _gemini_clients.clear()


def _get_gemini_client(api_key: str) -> genai.Client:
    """Return a cached google-genai Client keyed by hashed API key."""
    key_hash = hashlib.sha256(api_key.encode("utf-8")).hexdigest()
    if key_hash in _gemini_clients:
        _gemini_clients.move_to_end(key_hash)
        return _gemini_clients[key_hash]
    client = genai.Client(api_key=api_key)
    _gemini_clients[key_hash] = client
    while len(_gemini_clients) > 16:
        _gemini_clients.popitem(last=False)
    return client


def _scrub_secret(msg: str, secret: Optional[str]) -> str:
    """Ensure raw API keys never leak into logs or error strings."""
    if not msg:
        return ""
    if secret and len(secret) > 6 and secret in msg:
        return msg.replace(secret, "[REDACTED_API_KEY]")
    return msg


def resolve_model_name(requested_model: str) -> str:
    """Resolve user selection to official model identifier."""
    if not requested_model:
        return "gemma4:latest"
    if ":" in requested_model:
        return requested_model.strip()
    req_lower = requested_model.strip().lower()
    if req_lower in MODEL_MAPPING:
        return MODEL_MAPPING[req_lower]
    if "gemma" in req_lower or "ollama" in req_lower:
        return "gemma4:latest"
    if "carbon" in req_lower:
        return "gemini-4-carbon"
    if "argon" in req_lower or "pro" in req_lower:
        return "gemini-4-argon"
    if "flash" in req_lower:
        return "gemini-3.8-flash"
    return requested_model


def _is_gemini4_reasoning_model(model_name: str) -> bool:
    """Return True if the resolved model is Gemini 4 Argon or Gemini 4 Carbon."""
    low = model_name.lower()
    return "argon" in low or "carbon" in low


def _canonical_gemini4_model(model_name: str) -> str:
    """Normalize a Gemini 4 reasoning model name to its exact API model string."""
    return "gemini-4-carbon" if "carbon" in model_name.lower() else "gemini-4-argon"


def _fit_transcript_to_budget(
    transcript_text: str, max_chars: int = MAX_TRANSCRIPT_CHARS
) -> str:
    """
    Preserve transcripts up to `max_chars` verbatim; for multi-hour marathon transcripts,
    proportionally sample intro, evenly spaced middle sections, and conclusion so the
    entire video timeline is represented without overflowing context windows.
    """
    if not transcript_text or len(transcript_text) <= max_chars:
        return transcript_text

    lines = transcript_text.splitlines()
    if len(lines) <= 20:
        half = max_chars // 2
        return (
            transcript_text[:half]
            + "\n\n[... middle section condensed to fit context window ...]\n\n"
            + transcript_text[-half:]
        )

    # Keep 25% intro, 5 evenly spaced middle windows (50% total), and 25% conclusion
    intro_budget = int(max_chars * 0.25)
    outro_budget = int(max_chars * 0.25)
    mid_windows = 5
    window_budget = int((max_chars * 0.45) / mid_windows)

    intro_text = transcript_text[:intro_budget].rsplit("\n", 1)[0]
    outro_text = transcript_text[-outro_budget:]
    if "\n" in outro_text:
        outro_text = outro_text.split("\n", 1)[1]

    middle_region = transcript_text[intro_budget : len(transcript_text) - outro_budget]
    sampled_mids: List[str] = []
    if len(middle_region) > window_budget:
        step = max(1, (len(middle_region) - window_budget) // max(1, mid_windows - 1))
        for i in range(mid_windows):
            start = min(i * step, max(0, len(middle_region) - window_budget))
            chunk = middle_region[start : start + window_budget]
            sampled_mids.append(chunk.strip())

    parts = [intro_text.strip(), *sampled_mids, outro_text.strip()]
    return "\n\n[...]\n\n".join(p for p in parts if p)


def _compute_ollama_options(prompt: str, model_name: str) -> Optional[Dict[str, Any]]:
    """Compute an appropriate Ollama `num_ctx` when the prompt exceeds default 4k context."""
    approx_tokens = len(prompt) // 3 + 1536
    if approx_tokens <= 4096:
        return None
    max_model_ctx = _ollama_context_lengths.get(model_name, 32768) or 32768
    # Snap up to clean power/step capped at model's advertised context length (max 65536 for RAM safety)
    cap = min(max_model_ctx, 65536)
    target_ctx = min(cap, max(8192, ((approx_tokens + 2047) // 2048) * 2048))
    return {"num_ctx": target_ctx}


async def get_ollama_models() -> Dict[str, Any]:
    """Retrieve list of available models from local Ollama instance."""
    url = f"{OLLAMA_HOST.rstrip('/')}/api/tags"
    client = get_llm_http_client()
    try:
        res = await client.get(url, timeout=10.0)
        if res.status_code == 200:
            data = res.json()
            models = []
            for m in data.get("models", []):
                name = m.get("name", "")
                details = m.get("details", {})
                param_size = details.get("parameter_size", "")
                size_bytes = m.get("size", 0)
                size_gb = round(size_bytes / (1024 ** 3), 1) if size_bytes else 0
                ctx_len = details.get("context_length", 0)
                if name and ctx_len:
                    _ollama_context_lengths[name] = int(ctx_len)

                is_gemma = (
                    "gemma" in name.lower()
                    or "gemma" in details.get("family", "").lower()
                )

                label = name
                if param_size:
                    label += f" ({param_size}"
                    if any(tag in name.lower() for tag in ("12b", "26b", "27b")):
                        label += " - More Powerful"
                    elif "latest" in name.lower() or "8b" in name.lower():
                        label += " - Fast & Balanced"
                    label += ")"

                models.append(
                    {
                        "name": name,
                        "model": m.get("model", name),
                        "label": label,
                        "parameter_size": param_size,
                        "size_gb": size_gb,
                        "is_gemma": is_gemma,
                        "context_length": ctx_len,
                    }
                )

            models.sort(key=lambda x: (not x["is_gemma"], x["name"]))
            return {"success": True, "models": models, "count": len(models)}
        return {
            "success": False,
            "error": f"Ollama HTTP {res.status_code}",
            "models": [],
        }
    except Exception as exc:
        logger.debug("Could not query Ollama /api/tags: %s", exc)
        return {
            "success": False,
            "error": f"Could not connect to Ollama at {OLLAMA_HOST}: {str(exc)}",
            "models": [],
        }


async def generate_summary_with_ollama(
    prompt: str,
    model_name: str = "gemma4:latest",
    images_b64: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """Call local Ollama instance with comprehensive error handling and optional vision keyframes."""
    url = f"{OLLAMA_HOST.rstrip('/')}/api/generate"
    payload: Dict[str, Any] = {"model": model_name, "prompt": prompt, "stream": False}
    options = _compute_ollama_options(prompt, model_name)
    if options:
        payload["options"] = options
    if images_b64:
        payload["images"] = images_b64

    client = get_llm_http_client()
    try:
        res = await client.post(url, json=payload, timeout=180.0)

        if res.status_code not in (200, 404) and images_b64:
            payload.pop("images", None)
            res = await client.post(url, json=payload, timeout=180.0)

        if res.status_code == 200:
            data = res.json()
            response_text = data.get("response", "").strip()
            if response_text:
                return {
                    "success": True,
                    "summary": response_text,
                    "model_used": f"Ollama ({model_name})",
                }
            return {
                "success": False,
                "error": (
                    f"Local Ollama Model Error: Model '{model_name}' completed the request "
                    "but returned an empty response."
                ),
            }
        if res.status_code == 404:
            return {
                "success": False,
                "error": (
                    f"Local Model Not Found: Model '{model_name}' is not installed in Ollama. "
                    f"Run 'ollama pull {model_name}' in your terminal to download it."
                ),
            }
        return {
            "success": False,
            "error": f"Local Ollama Server Error (HTTP {res.status_code}): {res.text}",
        }
    except httpx.ConnectError:
        return {
            "success": False,
            "error": (
                f"Local Ollama Connection Error: Could not connect to Ollama at {OLLAMA_HOST}. "
                "Please verify that Ollama is running on your machine (e.g. run 'ollama serve' in your terminal)."
            ),
        }
    except httpx.TimeoutException:
        return {
            "success": False,
            "error": (
                f"Local Ollama Timeout: Model '{model_name}' took longer than 180 seconds to respond. "
                "The video transcript may be very long or your system resources may be constrained."
            ),
        }
    except Exception as exc:
        logger.warning("Unexpected Ollama error: %s", exc)
        return {
            "success": False,
            "error": f"Local Ollama Unexpected Error: {str(exc)}",
        }


async def _stream_summary_with_ollama(
    prompt: str,
    model_name: str = "gemma4:latest",
    images_b64: Optional[List[str]] = None,
) -> AsyncIterator[Dict[str, Any]]:
    """Stream tokens incrementally from local Ollama `/api/generate`."""
    url = f"{OLLAMA_HOST.rstrip('/')}/api/generate"
    payload: Dict[str, Any] = {"model": model_name, "prompt": prompt, "stream": True}
    options = _compute_ollama_options(prompt, model_name)
    if options:
        payload["options"] = options
    if images_b64:
        payload["images"] = images_b64

    client = get_llm_http_client()
    full_chunks: List[str] = []

    try:
        async with client.stream("POST", url, json=payload, timeout=180.0) as res:
            if res.status_code == 404:
                yield {
                    "type": "error",
                    "error": (
                        f"Local Model Not Found: Model '{model_name}' is not installed in Ollama. "
                        f"Run 'ollama pull {model_name}' in your terminal to download it."
                    ),
                }
                return

            if res.status_code != 200 and images_b64:
                # Retry non-vision fallback via batch generator
                fallback = await generate_summary_with_ollama(
                    prompt, model_name, images_b64=None
                )
                if fallback.get("success"):
                    yield {"type": "chunk", "delta": fallback["summary"]}
                    yield {
                        "type": "done_llm",
                        "summary": fallback["summary"],
                        "model_used": fallback["model_used"],
                    }
                else:
                    yield {"type": "error", "error": fallback.get("error", "Ollama error")}
                return

            if res.status_code != 200:
                body = (await res.aread()).decode("utf-8", errors="replace")
                yield {
                    "type": "error",
                    "error": f"Local Ollama Server Error (HTTP {res.status_code}): {body}",
                }
                return

            async for line in res.aiter_lines():
                if not line.strip():
                    continue
                try:
                    chunk_obj = json.loads(line)
                except Exception:
                    continue
                piece = chunk_obj.get("response", "")
                if piece:
                    full_chunks.append(piece)
                    yield {"type": "chunk", "delta": piece}
                if chunk_obj.get("done"):
                    break

        final_text = "".join(full_chunks).strip()
        if final_text:
            yield {
                "type": "done_llm",
                "summary": final_text,
                "model_used": f"Ollama ({model_name})",
            }
        else:
            yield {
                "type": "error",
                "error": (
                    f"Local Ollama Model Error: Model '{model_name}' completed the request "
                    "but returned an empty response."
                ),
            }
    except httpx.ConnectError:
        yield {
            "type": "error",
            "error": (
                f"Local Ollama Connection Error: Could not connect to Ollama at {OLLAMA_HOST}. "
                "Please verify that Ollama is running on your machine (e.g. run 'ollama serve' in your terminal)."
            ),
        }
    except httpx.TimeoutException:
        yield {
            "type": "error",
            "error": (
                f"Local Ollama Timeout: Model '{model_name}' took longer than 180 seconds to respond."
            ),
        }
    except Exception as exc:
        logger.warning("Unexpected Ollama stream error: %s", exc)
        yield {"type": "error", "error": f"Local Ollama Unexpected Error: {str(exc)}"}


def _is_fatal_api_error(err_msg: str) -> bool:
    """Detect authentication, permission, quota, or DNS errors that should not trigger fallback retries."""
    if not err_msg:
        return False
    fatal_markers = (
        "API_KEY_INVALID",
        "API key not valid",
        "401",
        "403",
        "429",
        "RESOURCE_EXHAUSTED",
        "quota",
        "nodename nor servname",
        "getaddrinfo failed",
        "Errno 8",
    )
    err_lower = err_msg.lower()
    return any(marker.lower() in err_lower for marker in fatal_markers)


def _format_gemini_error(model_name: str, last_err: Optional[str], api_key: str) -> Dict[str, Any]:
    """Map raw Gemini SDK/REST exceptions to user-friendly, secret-scrubbed error dicts."""
    err_msg = _scrub_secret(
        last_err or f"Gemini model ({model_name}) returned an empty response.",
        api_key,
    )
    if (
        "API_KEY_INVALID" in err_msg
        or "API key not valid" in err_msg
        or "401" in err_msg
        or "403" in err_msg
    ):
        return {
            "success": False,
            "error": (
                "Remote Gemini Authentication Error: Your Gemini API key appears to be "
                f"invalid or unauthorized. Details: {err_msg}"
            ),
        }
    if "429" in err_msg or "RESOURCE_EXHAUSTED" in err_msg or "quota" in err_msg.lower():
        return {
            "success": False,
            "error": (
                "Remote Gemini Rate Limit / Quota Exceeded (HTTP 429): You have hit the request "
                "quota limit for Gemini. Please wait a moment or check your Google AI Studio account."
            ),
        }
    if (
        "nodename nor servname provided" in err_msg
        or "getaddrinfo failed" in err_msg
        or "Errno 8" in err_msg
        or "ConnectError" in err_msg
    ):
        return {
            "success": False,
            "error": (
                "Remote Gemini Network / DNS Error: Unable to resolve or reach "
                "'generativelanguage.googleapis.com'. Please check your internet connection "
                "or ensure the web server has outbound internet access enabled."
            ),
        }
    if "400" in err_msg or "INVALID_ARGUMENT" in err_msg:
        return {
            "success": False,
            "error": f"Remote Gemini Request Error ({model_name}): {err_msg}",
        }
    return {
        "success": False,
        "error": f"Remote Gemini Model Error ({model_name}): {err_msg}",
    }


def _build_interactions_input(
    prompt: str, images_b64: Optional[List[str]] = None
) -> Any:
    """Format prompt and optional inline base64 keyframes for the Google Interactions API."""
    if not images_b64:
        return prompt
    content_items: List[Dict[str, str]] = [
        {"type": "image", "data": b64, "mime_type": "image/jpeg"}
        for b64 in images_b64
    ]
    content_items.append({"type": "text", "text": prompt})
    return content_items


def _sync_sdk_generate(
    api_key: str,
    model_name: str,
    prompt: str,
    use_interactions: bool,
    thinking_level: str,
    youtube_url: Optional[str] = None,
    images_b64: Optional[List[str]] = None,
) -> Optional[str]:
    """Run synchronous google-genai SDK calls inside a worker thread to avoid blocking the event loop."""
    client = _get_gemini_client(api_key)
    if use_interactions and hasattr(client, "interactions") and not youtube_url:
        level = thinking_level if thinking_level in ("low", "medium", "high") else "high"
        target_model = _canonical_gemini4_model(model_name)
        interaction = client.interactions.create(
            model=target_model,
            input=_build_interactions_input(prompt, images_b64),
            generation_config={"thinking_level": level},
        )
        return getattr(interaction, "output_text", None)

    if images_b64:
        try:
            image_parts = [
                types.Part.from_bytes(
                    data=base64.b64decode(b64), mime_type="image/jpeg"
                )
                for b64 in images_b64
            ]
            response = client.models.generate_content(
                model=model_name, contents=[*image_parts, prompt]
            )
            text = getattr(response, "text", None)
            if text:
                return text
        except Exception as exc:
            logger.debug(
                "Gemini multimodal image_parts call failed: %s",
                _scrub_secret(str(exc), api_key),
            )

    if youtube_url and youtube_url.startswith("http"):
        try:
            video_part = types.Part.from_uri(
                file_uri=youtube_url, mime_type="video/mp4"
            )
            response = client.models.generate_content(
                model=model_name, contents=[video_part, prompt]
            )
            text = getattr(response, "text", None)
            if text:
                return text
        except Exception as exc:
            logger.debug(
                "Gemini YouTube URI call failed, falling back to text prompt: %s",
                _scrub_secret(str(exc), api_key),
            )

    response = client.models.generate_content(model=model_name, contents=prompt)
    return getattr(response, "text", None)


async def generate_summary_with_gemini(
    prompt: str,
    model_name: str,
    api_key_override: Optional[str] = None,
    thinking_level: str = "high",
    youtube_url: Optional[str] = None,
    images_b64: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """
    Call Google Gemini API with comprehensive error handling.
    For Gemini 4 Argon (`gemini-4-argon`) and Gemini 4 Carbon (`gemini-4-carbon`), uses the
    Interactions API with configurable `thinking_level` (`low`, `medium`, `high`) and avoids
    deprecated parameters (`temperature`, `top_p`, `top_k`, `thinking_budget`).
    """
    api_key = (
        api_key_override
        or os.getenv("GEMINI_API_KEY")
        or os.getenv("GOOGLE_API_KEY")
    )
    if not api_key:
        return {
            "success": False,
            "error": (
                "Remote Gemini Error: Gemini API key is missing. Please set the GEMINI_API_KEY "
                "environment variable or paste your API key in the 'Use Custom Gemini API Key' drawer."
            ),
        }

    is_gemini4 = _is_gemini4_reasoning_model(model_name)
    target_model = _canonical_gemini4_model(model_name) if is_gemini4 else model_name
    output_text = None
    last_err = None

    if is_gemini4:
        try:
            client = _get_gemini_client(api_key)
            if hasattr(client, "interactions") and not youtube_url:
                output_text = await asyncio.to_thread(
                    _sync_sdk_generate,
                    api_key,
                    target_model,
                    prompt,
                    True,
                    thinking_level,
                    youtube_url,
                    images_b64,
                )
        except Exception as exc:
            last_err = _scrub_secret(str(exc), api_key)

        if not output_text and not youtube_url and not _is_fatal_api_error(last_err or ""):
            try:
                headers = {
                    "x-goog-api-key": api_key,
                    "Api-Revision": "2026-05-20",
                    "Content-Type": "application/json",
                }
                level = (
                    thinking_level
                    if thinking_level in ("low", "medium", "high")
                    else "high"
                )
                payload = {
                    "model": target_model,
                    "input": _build_interactions_input(prompt, images_b64),
                    "generation_config": {"thinking_level": level},
                }
                http_client = get_llm_http_client()
                res = await http_client.post(
                    "https://generativelanguage.googleapis.com/v1beta/interactions",
                    headers=headers,
                    json=payload,
                    timeout=180.0,
                )
                if res.status_code == 200:
                    data = res.json()
                    output_text = data.get("output_text")
                    if (
                        not output_text
                        and isinstance(data, dict)
                        and "interaction" in data
                    ):
                        output_text = data["interaction"].get("output_text")
                else:
                    try:
                        err_json = res.json()
                        if (
                            isinstance(err_json, list)
                            and len(err_json) > 0
                            and "error" in err_json[0]
                        ):
                            msg = err_json[0]["error"].get("message", res.text)
                            last_err = f"Interactions API Error (HTTP {res.status_code}): {msg}"
                        elif isinstance(err_json, dict) and "error" in err_json:
                            msg = err_json["error"].get("message", res.text)
                            last_err = f"Interactions API Error (HTTP {res.status_code}): {msg}"
                        else:
                            last_err = f"Interactions API HTTP {res.status_code}: {res.text}"
                    except Exception:
                        last_err = f"Interactions API HTTP {res.status_code}: {res.text}"
            except Exception as exc:
                last_err = f"Interactions REST request failed: {_scrub_secret(str(exc), api_key)}"

        if not output_text and not _is_fatal_api_error(last_err or ""):
            try:
                output_text = await asyncio.to_thread(
                    _sync_sdk_generate,
                    api_key,
                    target_model,
                    prompt,
                    False,
                    thinking_level,
                    youtube_url,
                    images_b64,
                )
            except Exception as exc:
                if not last_err:
                    last_err = _scrub_secret(str(exc), api_key)
    else:
        try:
            output_text = await asyncio.to_thread(
                _sync_sdk_generate,
                api_key,
                target_model,
                prompt,
                False,
                thinking_level,
                youtube_url,
                images_b64,
            )
        except Exception as exc:
            last_err = _scrub_secret(str(exc), api_key)

    if output_text:
        model_label = (
            f"Gemini ({target_model} • reasoning: {thinking_level})"
            if is_gemini4
            else f"Gemini ({target_model})"
        )
        return {
            "success": True,
            "summary": output_text.strip(),
            "model_used": model_label,
        }

    return _format_gemini_error(target_model, last_err, api_key)


async def _stream_summary_with_gemini(
    prompt: str,
    model_name: str,
    api_key_override: Optional[str] = None,
    thinking_level: str = "high",
    youtube_url: Optional[str] = None,
    images_b64: Optional[List[str]] = None,
) -> AsyncIterator[Dict[str, Any]]:
    """Stream tokens from Gemini Flash, Gemini 4 Argon, or Gemini 4 Carbon."""
    api_key = (
        api_key_override
        or os.getenv("GEMINI_API_KEY")
        or os.getenv("GOOGLE_API_KEY")
    )
    if not api_key:
        yield {
            "type": "error",
            "error": (
                "Remote Gemini Error: Gemini API key is missing. Please set the GEMINI_API_KEY "
                "environment variable or paste your API key in the 'Use Custom Gemini API Key' drawer."
            ),
        }
        return

    is_gemini4 = _is_gemini4_reasoning_model(model_name)
    target_model = _canonical_gemini4_model(model_name) if is_gemini4 else model_name
    if is_gemini4:
        res = await generate_summary_with_gemini(
            prompt=prompt,
            model_name=target_model,
            api_key_override=api_key,
            thinking_level=thinking_level,
            youtube_url=youtube_url,
            images_b64=images_b64,
        )
        if res.get("success"):
            yield {"type": "chunk", "delta": res["summary"]}
            yield {
                "type": "done_llm",
                "summary": res["summary"],
                "model_used": res["model_used"],
            }
        else:
            yield {"type": "error", "error": res.get("error", "Gemini error")}
        return

    queue: "asyncio.Queue[Dict[str, Any]]" = asyncio.Queue()
    loop = asyncio.get_running_loop()

    def _produce_stream() -> None:
        client = _get_gemini_client(api_key)
        contents: Any = prompt
        if images_b64:
            image_parts = [
                types.Part.from_bytes(
                    data=base64.b64decode(b64), mime_type="image/jpeg"
                )
                for b64 in images_b64
            ]
            contents = [*image_parts, prompt]
        elif youtube_url and youtube_url.startswith("http"):
            contents = [
                types.Part.from_uri(file_uri=youtube_url, mime_type="video/mp4"),
                prompt,
            ]

        collected: List[str] = []
        try:
            stream_iter = client.models.generate_content_stream(
                model=model_name, contents=contents
            )
            for chunk in stream_iter:
                txt = getattr(chunk, "text", None)
                if txt:
                    collected.append(txt)
                    loop.call_soon_threadsafe(
                        queue.put_nowait, {"type": "chunk", "delta": txt}
                    )
            final = "".join(collected).strip()
            if final:
                loop.call_soon_threadsafe(
                    queue.put_nowait,
                    {
                        "type": "done_llm",
                        "summary": final,
                        "model_used": f"Gemini ({model_name})",
                    },
                )
            else:
                loop.call_soon_threadsafe(
                    queue.put_nowait,
                    {
                        "type": "error",
                        "error": f"Remote Gemini Model Error ({model_name}): Empty response.",
                    },
                )
        except Exception as exc:
            # If YouTube URI failed in stream mode, fall back cleanly to standard call
            if youtube_url and not collected:
                loop.call_soon_threadsafe(queue.put_nowait, {"type": "fallback"})
                return
            err_dict = _format_gemini_error(model_name, str(exc), api_key)
            loop.call_soon_threadsafe(
                queue.put_nowait, {"type": "error", "error": err_dict["error"]}
            )

    threading_task = asyncio.create_task(asyncio.to_thread(_produce_stream))
    try:
        while True:
            item = await queue.get()
            if item["type"] == "fallback":
                res = await generate_summary_with_gemini(
                    prompt=prompt,
                    model_name=model_name,
                    api_key_override=api_key,
                    thinking_level=thinking_level,
                    youtube_url=None,
                    images_b64=images_b64,
                )
                if res.get("success"):
                    yield {"type": "chunk", "delta": res["summary"]}
                    yield {
                        "type": "done_llm",
                        "summary": res["summary"],
                        "model_used": res["model_used"],
                    }
                else:
                    yield {"type": "error", "error": res.get("error", "Gemini error")}
                break
            yield item
            if item["type"] in ("done_llm", "error"):
                break
    finally:
        await asyncio.gather(threading_task, return_exceptions=True)


def _build_summary_prompt(
    video_metadata: Dict[str, Any],
    transcript_text: str,
    custom_context: Optional[str],
    lang: str,
    song_mode: bool,
    video_frames: Optional[List[str]],
) -> tuple[str, str, str, str]:
    """Construct the localized prompt and return (prompt, title, author, url)."""
    title = video_metadata.get("title", "YouTube Video")
    author = video_metadata.get("author_name", "Unknown Channel")
    url = video_metadata.get("url", "")

    fitted_transcript = _fit_transcript_to_budget(transcript_text or "")

    if song_mode:
        if lang == "fr":
            lang_instruction = (
                "Write the entire analysis in **French (Français)**. "
                "Use the section headings: `## 🎵 Aperçu & Sens de la Chanson`, `## 🎤 Thèmes, Ambiance & Paroles Clés`, "
                "and if custom context is provided, `## Analyse Contextuelle`."
            )
        elif lang == "en":
            lang_instruction = (
                "Write the entire analysis in **English**. "
                "Use the section headings: `## 🎵 Song Overview & Meaning`, `## 🎤 Themes, Mood & Standout Lyrics`, "
                "and if custom context is provided, `## Custom Context Insights`."
            )
        else:
            lang_instruction = (
                "Write the analysis in the **same language as the song/lyrics** (or Bilingual French/English if appropriate), "
                "with bilingual section headings: `## 🎵 Aperçu & Sens / Song Overview & Meaning`, "
                "`## 🎤 Thèmes & Paroles Clés / Themes & Standout Lyrics`, and if applicable `## Contexte / Custom Context Insights`."
            )
    else:
        if lang == "fr":
            lang_instruction = (
                "Write the entire summary in **French (Français)**. "
                "Use the section headings: `## Résumé Exécutif`, `## Points Clés & Concepts Principaux`, "
                "and if custom context is provided, `## Analyse Contextuelle`."
            )
        elif lang == "en":
            lang_instruction = (
                "Write the entire summary in **English**. "
                "Use the section headings: `## Executive Summary`, `## Key Takeaways & Core Concepts`, "
                "and if custom context is provided, `## Custom Context Insights`."
            )
        else:
            lang_instruction = (
                "Write the summary in the **same language as the transcript** (or Bilingual French/English if appropriate), "
                "with bilingual section headings: `## Résumé Exécutif / Executive Summary`, "
                "`## Points Clés / Key Takeaways`, and if applicable `## Contexte / Custom Context Insights`."
            )

    default_context = (
        "Analyze the song's meaning, narrative/story, musical mood, and standout lyrics."
        if song_mode
        else "Provide a comprehensive, high-quality summary focusing on key insights and main takeaways."
    )
    context_block = (
        custom_context.strip()
        if custom_context and custom_context.strip()
        else default_context
    )

    if fitted_transcript and fitted_transcript.strip():
        heading = (
            "### Extracted Song Lyrics & Audio Content:"
            if song_mode
            else "### Transcript / Video Content:"
        )
        transcript_section = f"{heading}\n{fitted_transcript}"
        if video_frames:
            transcript_section += (
                f"\n\n*(Note: {len(video_frames)} evenly spaced keyframes from the video are also attached visually. "
                "Combine the visual scenes, slides, and on-screen text with the text above.)*"
            )
    elif video_frames:
        transcript_section = (
            "### Visual Video Frames (No Spoken Audio / Captions):\n"
            f"[{len(video_frames)} evenly spaced keyframes extracted directly from the video are attached to this prompt. "
            "Carefully examine the visual scenes, actions, slides, diagrams, and any on-screen text across the frames, "
            "and combine them with the media details and user context above to produce a rich, accurate summary.]"
        )
    else:
        transcript_section = (
            "### Transcript / Video Content:\n"
            "[No caption track or spoken transcript was provided for this media. "
            "Please synthesize a helpful summary and key takeaways based on the URL, title, "
            "creator/artist, and the user's expectations/context above.]"
        )

    role_intro = (
        "You are an expert music and lyrics analyst providing structured insights into songs, their lyrics, themes, and emotional narrative."
        if song_mode
        else "You are an expert video summarizer providing clean, structured summaries for video content."
    )

    prompt = f"""{role_intro}

### Media Details:
- **Title**: {title}
- **Channel / Artist**: {author}
- **URL**: {url}
- **Mode**: {"Song / Lyrics 2nd-Pass Analysis" if song_mode else "Standard Video Summary"}

### User Expectations & Added Context:
{context_block}

---

{transcript_section}

---

### Response Formatting & Language Instructions:
1. {lang_instruction}
2. Provide a concise **Overview** (2-3 sentences explaining what the {"song" if song_mode else "video"} is about).
3. Detail the **{"Themes, Narrative & Standout Lyrics" if song_mode else "Key Takeaways & Core Concepts"}** using bullet points.
4. If applicable based on user expectations, address their specific questions or focus areas in a dedicated section.
5. Use clean Markdown formatting with clear section headers, bold text for key terms, and bullet points.
"""
    return prompt, title, author, url


async def generate_youtube_summary(
    video_metadata: Dict[str, Any],
    transcript_text: str,
    model_choice: str = "gemma4",
    custom_context: Optional[str] = None,
    api_key_override: Optional[str] = None,
    thinking_level: str = "high",
    lang: str = "bi",
    song_mode: bool = False,
    video_frames: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """
    Generate structured summary using local Ollama (Gemma 4) or Gemini API with top-level try/except.
    Adapts output language to user selection ('fr', 'en', or 'bi') and supports Song/Lyrics mode
    as well as multimodal visual video keyframes when no captions or spoken audio are present.
    """
    try:
        model_name = resolve_model_name(model_choice)
        prompt, title, author, url = _build_summary_prompt(
            video_metadata=video_metadata,
            transcript_text=transcript_text,
            custom_context=custom_context,
            lang=lang,
            song_mode=song_mode,
            video_frames=video_frames,
        )

        if "gemma" in model_name.lower() or "ollama" in model_choice.lower():
            result = await generate_summary_with_ollama(
                prompt, model_name, images_b64=video_frames
            )
        else:
            result = await generate_summary_with_gemini(
                prompt=prompt,
                model_name=model_name,
                api_key_override=api_key_override,
                thinking_level=thinking_level,
                youtube_url=url
                if not (transcript_text and transcript_text.strip())
                else None,
                images_b64=video_frames,
            )

        if result.get("success"):
            result["video_title"] = title
            result["channel"] = author

        return result
    except Exception as exc:
        logger.error("Summary generation failed: %s", _scrub_secret(str(exc), api_key_override))
        return {
            "success": False,
            "error": f"Summary Generation Error: {_scrub_secret(str(exc), api_key_override)}",
        }


async def stream_youtube_summary(
    video_metadata: Dict[str, Any],
    transcript_text: str,
    model_choice: str = "gemma4",
    custom_context: Optional[str] = None,
    api_key_override: Optional[str] = None,
    thinking_level: str = "high",
    lang: str = "bi",
    song_mode: bool = False,
    video_frames: Optional[List[str]] = None,
) -> AsyncIterator[Dict[str, Any]]:
    """Stream summary generation chunks as dicts (`chunk`, `done_llm`, `error`)."""
    try:
        model_name = resolve_model_name(model_choice)
        prompt, _, _, url = _build_summary_prompt(
            video_metadata=video_metadata,
            transcript_text=transcript_text,
            custom_context=custom_context,
            lang=lang,
            song_mode=song_mode,
            video_frames=video_frames,
        )

        if "gemma" in model_name.lower() or "ollama" in model_choice.lower():
            async for event in _stream_summary_with_ollama(
                prompt, model_name, images_b64=video_frames
            ):
                yield event
        else:
            async for event in _stream_summary_with_gemini(
                prompt=prompt,
                model_name=model_name,
                api_key_override=api_key_override,
                thinking_level=thinking_level,
                youtube_url=url
                if not (transcript_text and transcript_text.strip())
                else None,
                images_b64=video_frames,
            ):
                yield event
    except Exception as exc:
        yield {
            "type": "error",
            "error": f"Summary Generation Error: {_scrub_secret(str(exc), api_key_override)}",
        }
