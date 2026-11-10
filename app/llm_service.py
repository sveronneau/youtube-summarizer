"""LLM orchestration service supporting local Ollama (Gemma 4) and Google Gemini APIs."""

import asyncio
import os
from typing import Any, Dict, Optional

import httpx
from google import genai
from google.genai import types

OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://127.0.0.1:11434")

MODEL_MAPPING = {
    "gemma4": "gemma4:latest",
    "gemma4:latest": "gemma4:latest",
    "gemma": "gemma4:latest",
    "ollama": "gemma4:latest",
    "flash": "gemini-3.8-flash",
    "argon": "gemini-4-argon",
    "gemini-argon": "gemini-4-argon",
    "gemini-4-argon": "gemini-4-argon",
    "pro": "gemini-4-argon",
    "gemini-flash": "gemini-3.8-flash",
    "gemini-3.8-flash": "gemini-3.8-flash",
}

_llm_http_client: Optional[httpx.AsyncClient] = None


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


def resolve_model_name(requested_model: str) -> str:
    """Resolve user selection to official model identifier."""
    if not requested_model:
        return "gemma4:latest"
    # Preserve explicit Ollama tag/variant (e.g. gemma4:26b, gemma4:latest)
    if ":" in requested_model:
        return requested_model.strip()
    req_lower = requested_model.strip().lower()
    if req_lower in MODEL_MAPPING:
        return MODEL_MAPPING[req_lower]
    if "gemma" in req_lower or "ollama" in req_lower:
        return "gemma4:latest"
    if "argon" in req_lower or "pro" in req_lower:
        return "gemini-4-argon"
    if "flash" in req_lower:
        return "gemini-3.8-flash"
    return requested_model


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
                        "context_length": details.get("context_length", 0),
                    }
                )

            # Sort Gemma models first, then alphabetically
            models.sort(key=lambda x: (not x["is_gemma"], x["name"]))

            return {"success": True, "models": models, "count": len(models)}
        return {
            "success": False,
            "error": f"Ollama HTTP {res.status_code}",
            "models": [],
        }
    except Exception as e:
        return {
            "success": False,
            "error": f"Could not connect to Ollama at {OLLAMA_HOST}: {str(e)}",
            "models": [],
        }


async def generate_summary_with_ollama(
    prompt: str, model_name: str = "gemma4:latest"
) -> Dict[str, Any]:
    """Call local Ollama instance with comprehensive error handling."""
    url = f"{OLLAMA_HOST.rstrip('/')}/api/generate"
    payload = {"model": model_name, "prompt": prompt, "stream": False}

    client = get_llm_http_client()
    try:
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
    except Exception as e:
        return {
            "success": False,
            "error": f"Local Ollama Unexpected Error: {str(e)}",
        }


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


def _sync_sdk_generate(
    api_key: str,
    model_name: str,
    prompt: str,
    is_argon: bool,
    thinking_level: str,
    youtube_url: Optional[str] = None,
) -> Optional[str]:
    """Run synchronous google-genai SDK calls inside a worker thread to avoid blocking the event loop."""
    client = genai.Client(api_key=api_key)
    if is_argon and hasattr(client, "interactions"):
        level = thinking_level if thinking_level in ("low", "medium", "high") else "high"
        interaction = client.interactions.create(
            model="gemini-4-argon",
            input=prompt,
            generation_config={"thinking_level": level},
        )
        return getattr(interaction, "output_text", None)

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
        except Exception:
            pass

    response = client.models.generate_content(model=model_name, contents=prompt)
    return getattr(response, "text", None)


async def generate_summary_with_gemini(
    prompt: str,
    model_name: str,
    api_key_override: Optional[str] = None,
    thinking_level: str = "high",
    youtube_url: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Call Google Gemini API with comprehensive error handling.
    For Gemini 4 Argon, uses the Interactions API with configurable thinking_level (low/medium/high)
    and strictly avoids deprecated parameters (temperature, top_p, top_k, thinking_budget).
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

    is_argon = "argon" in model_name.lower()
    output_text = None
    last_err = None

    if is_argon:
        # 1. Try SDK interactions if available on installed google-genai
        try:
            client = genai.Client(api_key=api_key)
            if hasattr(client, "interactions"):
                output_text = await asyncio.to_thread(
                    _sync_sdk_generate,
                    api_key,
                    "gemini-4-argon",
                    prompt,
                    True,
                    thinking_level,
                )
        except Exception as e:
            last_err = str(e)

        # 2. Direct HTTP REST call to Gemini Interactions API endpoint
        if not output_text and not _is_fatal_api_error(last_err or ""):
            try:
                headers = {
                    "x-goog-api-key": api_key,
                    "Content-Type": "application/json",
                }
                level = (
                    thinking_level
                    if thinking_level in ("low", "medium", "high")
                    else "high"
                )
                payload = {
                    "model": "gemini-4-argon",
                    "input": prompt,
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
            except Exception as e:
                last_err = f"Interactions REST request failed: {str(e)}"

        # 3. Fallback to generate_content only if no fatal auth/quota/network error occurred
        if not output_text and not _is_fatal_api_error(last_err or ""):
            try:
                output_text = await asyncio.to_thread(
                    _sync_sdk_generate,
                    api_key,
                    "gemini-4-argon",
                    prompt,
                    False,
                    thinking_level,
                    youtube_url,
                )
            except Exception as e:
                if not last_err:
                    last_err = str(e)
    else:
        # Standard models such as Gemini 3.8 Flash
        try:
            output_text = await asyncio.to_thread(
                _sync_sdk_generate,
                api_key,
                model_name,
                prompt,
                False,
                thinking_level,
                youtube_url,
            )
        except Exception as e:
            last_err = str(e)

    if output_text:
        return {
            "success": True,
            "summary": output_text.strip(),
            "model_used": f"Gemini ({model_name})",
        }

    err_msg = last_err or f"Gemini model ({model_name}) returned an empty response."
    if (
        "API_KEY_INVALID" in err_msg
        or "400" in err_msg
        or "403" in err_msg
        or "API key not valid" in err_msg
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
    return {
        "success": False,
        "error": f"Remote Gemini Model Error ({model_name}): {err_msg}",
    }


async def generate_youtube_summary(
    video_metadata: Dict[str, Any],
    transcript_text: str,
    model_choice: str = "gemma4",
    custom_context: Optional[str] = None,
    api_key_override: Optional[str] = None,
    thinking_level: str = "high",
    lang: str = "bi",
    song_mode: bool = False,
) -> Dict[str, Any]:
    """
    Generate structured summary using local Ollama (Gemma 4) or Gemini API with top-level try/except.
    Adapts output language to user selection ('fr', 'en', or 'bi') and supports Song/Lyrics mode.
    """
    try:
        model_name = resolve_model_name(model_choice)

        title = video_metadata.get("title", "YouTube Video")
        author = video_metadata.get("author_name", "Unknown Channel")
        url = video_metadata.get("url", "")

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

        if transcript_text and transcript_text.strip():
            heading = (
                "### Extracted Song Lyrics & Audio Content:"
                if song_mode
                else "### Transcript / Video Content:"
            )
            transcript_section = f"{heading}\n{transcript_text}"
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

        # Dispatch based on model choice: Local Ollama vs Remote Gemini
        if "gemma" in model_name.lower() or "ollama" in model_choice.lower():
            result = await generate_summary_with_ollama(prompt, model_name)
        else:
            result = await generate_summary_with_gemini(
                prompt=prompt,
                model_name=model_name,
                api_key_override=api_key_override,
                thinking_level=thinking_level,
                youtube_url=url if not (transcript_text and transcript_text.strip()) else None,
            )

        if result.get("success"):
            result["video_title"] = title
            result["channel"] = author

        return result
    except Exception as e:
        return {"success": False, "error": f"Summary Generation Error: {str(e)}"}
