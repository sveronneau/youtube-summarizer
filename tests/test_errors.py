"""Unit tests for LLM error handling (missing API keys and missing local models)."""

import asyncio

from app.llm_service import (
    close_llm_client,
    generate_summary_with_gemini,
    generate_summary_with_ollama,
)


async def test_error_handling() -> None:
    """Verify clear error messages for missing credentials and unreachable models."""
    print("--- Testing Remote Model without API Key ---")
    res_gemini = await generate_summary_with_gemini(
        "test prompt", "gemini-3.8-flash", api_key_override=None
    )
    print("Gemini result:", res_gemini)
    assert not res_gemini["success"]
    assert "Gemini API key is missing" in res_gemini["error"]
    print("✅ Missing Gemini API key caught cleanly.")

    print("\n--- Testing Local Model with invalid model name ---")
    res_ollama_404 = await generate_summary_with_ollama(
        "test prompt", "non_existent_model_12345"
    )
    print("Ollama 404 result:", res_ollama_404)
    assert not res_ollama_404["success"]
    assert (
        "not installed in Ollama" in res_ollama_404["error"]
        or "HTTP 404" in res_ollama_404["error"]
        or "Connection Error" in res_ollama_404["error"]
        or "Unexpected Error" in res_ollama_404["error"]
    )
    print("✅ Model not found error caught cleanly.")
    await close_llm_client()

    print("\n✅ All error scenarios handled gracefully!")


if __name__ == "__main__":
    asyncio.run(test_error_handling())
