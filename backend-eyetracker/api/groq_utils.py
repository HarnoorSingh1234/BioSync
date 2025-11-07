"""Utility helpers for working with Groq API clients and environment setup."""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Iterator, List, Tuple

from dotenv import find_dotenv, load_dotenv
from groq import Groq

logger = logging.getLogger(__name__)

_GROQ_KEYS: List[str] | None = None


def _discover_env_file() -> None:
    """Load environment variables from the nearest `.env` file if available."""
    env_path = Path(__file__).with_name(".env")
    if env_path.exists():
        load_dotenv(dotenv_path=env_path, override=False)
        return
    fallback_path = find_dotenv(usecwd=True)
    if fallback_path:
        load_dotenv(dotenv_path=fallback_path, override=False)
    else:
        logger.debug("No .env file located for Groq configuration; relying on system env vars.")


def get_groq_api_keys() -> List[str]:
    """Return cached Groq API keys, loading them from environment if needed."""
    global _GROQ_KEYS
    if _GROQ_KEYS is None:
        _discover_env_file()
        raw_keys = [
            os.getenv("GROQ_API_KEY"),
            os.getenv("GROQ_API_KEY_ALT_1"),
            os.getenv("GROQ_API_KEY_ALT_2"),
            os.getenv("GROQ_API_KEY_ALT_3"),
            os.getenv("GROQ_API_KEY_ALT_4"),
        ]
        _GROQ_KEYS = [key for key in raw_keys if key]
        if not _GROQ_KEYS:
            logger.error("No Groq API keys found. Set GROQ_API_KEY or GROQ_API_KEY_ALT_* in environment.")
    return _GROQ_KEYS


def iter_groq_clients() -> Iterator[Tuple[str, Groq]]:
    """Yield Groq API clients for each configured key."""
    for api_key in get_groq_api_keys():
        yield api_key, Groq(api_key=api_key)


def get_default_chat_model() -> str:
    """Return the Groq chat model to use for response generation."""
    return os.getenv("GROQ_CHAT_MODEL", "llama-3.1-70b-versatile")
