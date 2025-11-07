from __future__ import annotations

import asyncio
import json
import logging
import re
from collections import deque
from typing import Deque, List, Sequence

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .groq_utils import get_default_chat_model, iter_groq_clients

logger = logging.getLogger(__name__)

router = APIRouter()

RESPONSE_HISTORY: Deque[List[str]] = deque(maxlen=5)
_HISTORY_LOCK = asyncio.Lock()
_SYSTEM_PROMPT = (
    "You assist individuals who rely on eye-tracking to communicate. "
    "Given an incoming message, craft four empathetic, conversational reply options that "
    "help them continue the conversation."
    "\nGuidelines:\n"
    "- Each option must be no longer than 40 words.\n"
    "- Avoid numbered lists; prefix options with natural labels like 'Option A:' etc.\n"
    "- Keep tone warm, respectful, and collaborative.\n"
    "- Do not repeat any options that have already been suggested in recent turns.\n"
    "- Reply in JSON strictly as an array of four strings."
)


class ChatSuggestionRequest(BaseModel):
    message: str = Field(..., min_length=1, description="Incoming text directed to the patient.")


class ChatSuggestionResponse(BaseModel):
    options: List[str] = Field(..., description="Four candidate responses for the patient to choose from.")
    recent_history: List[List[str]] = Field(..., description="Last batches of suggested options (most recent last).")


async def _snapshot_history() -> List[List[str]]:
    async with _HISTORY_LOCK:
        return [batch[:] for batch in RESPONSE_HISTORY]


async def _add_to_history(options: Sequence[str]) -> None:
    async with _HISTORY_LOCK:
        RESPONSE_HISTORY.append(list(options))


def _build_user_prompt(message: str, history: Sequence[Sequence[str]]) -> str:
    history_text = ""
    if history:
        flattened = [item for batch in history for item in batch]
        if flattened:
            history_lines = "\n".join(f"- {entry}" for entry in flattened)
            history_text = (
                "Previously suggested replies to avoid repeating:\n"
                f"{history_lines}\n\n"
            )
    cleaned_message = message.strip()
    return "".join(
        [
            history_text,
            'Incoming message:\n"""\n',
            cleaned_message,
            '\n"""\nGenerate four fresh reply options as instructed above.',
        ]
    )


def _extract_options(raw_content: str) -> List[str]:
    content = raw_content.strip()
    if content.startswith("```"):
        match = re.search(r"```(?:json|JSON)?\s*(.*)```", content, re.DOTALL)
        if match:
            content = match.group(1).strip()
    try:
        parsed = json.loads(content)
    except json.JSONDecodeError as exc:
        logger.error("Failed to parse Groq response as JSON: %s", exc)
        raise
    if isinstance(parsed, dict) and "options" in parsed:
        parsed = parsed["options"]
    if not isinstance(parsed, list) or len(parsed) != 4:
        raise ValueError("Model did not return exactly four options.")
    options = []
    for item in parsed:
        if not isinstance(item, str):
            raise ValueError("Each option must be a string.")
        options.append(item.strip())
    return options


async def _request_options(prompt: str) -> List[str]:

    for api_key, client in iter_groq_clients():
        try:
            completion = await asyncio.to_thread(
                client.chat.completions.create,
                model="llama-3.3-70b-versatile",
                messages=[
                    {"role": "system", "content": _SYSTEM_PROMPT},
                    {"role": "user", "content": prompt},
                ],
                temperature=0.75,
                max_tokens=512,
            )
            choice = completion.choices[0]
            content = choice.message.content if choice.message else ""
            options = _extract_options(content)
            logger.info("Generated chat options using Groq key ending %s", api_key[-6:])
            return options
        except Exception as exc:  # pragma: no cover - defensive logging
            logger.warning("Groq chat request failed for key ending %s: %s", api_key[-6:], exc)
            continue
    raise RuntimeError("All Groq API keys failed to generate chat responses.")


@router.post("/chat/options", response_model=ChatSuggestionResponse)
async def generate_chat_suggestions(request: ChatSuggestionRequest) -> ChatSuggestionResponse:
    history_snapshot = await _snapshot_history()
    prompt = _build_user_prompt(request.message, history_snapshot)
    try:
        options = await _request_options(prompt)
    except Exception as exc:  # pragma: no cover - defensive logging
        logger.error("Unable to generate chat suggestions: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to generate chat suggestions") from exc
    await _add_to_history(options)
    recent_history = await _snapshot_history()
    return ChatSuggestionResponse(options=options, recent_history=recent_history)
