"""Integration test for local Ollama summarization."""

import asyncio

from app.llm_service import close_llm_client, generate_youtube_summary


async def main() -> None:
    """Run a sample local summarization against Ollama."""
    print("Testing local Ollama connection...")
    sample_meta = {
        "title": "Short Test Video",
        "author_name": "Test Channel",
        "url": "https://www.youtube.com/watch?v=test",
    }
    sample_transcript = (
        "This is a quick demonstration of YouTube summarization "
        "using Gemma 4 running locally on Ollama."
    )

    result = await generate_youtube_summary(
        video_metadata=sample_meta,
        transcript_text=sample_transcript,
        model_choice="gemma4",
        custom_context="Highlight that it is running locally",
    )

    print("Success:", result.get("success"))
    print("Model Used:", result.get("model_used"))
    print("Summary Output:\n", result.get("summary"))
    await close_llm_client()


if __name__ == "__main__":
    asyncio.run(main())
