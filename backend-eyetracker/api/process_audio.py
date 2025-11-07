import logging
from io import BytesIO
from typing import List

from fastapi import APIRouter, UploadFile, File
from fastapi.responses import JSONResponse

from .groq_utils import get_groq_api_keys
from groq import Groq

logger = logging.getLogger(__name__)

router = APIRouter()
GROQ_API_KEYS = get_groq_api_keys()

async def transcribe_audio(audio_file: UploadFile) -> str:
    audio_buffer = BytesIO(await audio_file.read())
    audio_buffer.name = audio_file.filename
    if not GROQ_API_KEYS:
        raise RuntimeError("No Groq API keys configured.")
    for api_key in GROQ_API_KEYS:
        client = Groq(api_key=api_key)
        try:
            logger.info(f"Trying transcription with key ending: {api_key[-6:]}")
            transcription = client.audio.transcriptions.create(
                file=(audio_buffer.name, audio_buffer.getvalue()),
                model="whisper-large-v3",
                response_format="json"
            )
            return transcription.text
        except Exception as e:
            logger.warning(f"Transcription failed with key ending {api_key[-6:]}, error: {e}")
            continue
    raise RuntimeError("All Groq API keys failed for transcription.")

@router.post("/audio/transcribe")
async def audio_transcribe(file: UploadFile = File(...)):
    """
    Upload an audio file and get transcription as plain text.
    """
    try:
        text = await transcribe_audio(file)
        return JSONResponse(content={"text": text})
    except Exception as e:
        logger.error(f"Transcription error: {e}")
        return JSONResponse(status_code=500, content={"error": str(e)})
