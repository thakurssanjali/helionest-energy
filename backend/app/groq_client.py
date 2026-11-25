"""Thin wrappers around Groq: LLM chat (with model fallback), Whisper STT and Orpheus TTS."""
import logging
import re

from groq import BadRequestError, Groq, RateLimitError

from . import config

log = logging.getLogger(__name__)
_client = None


def client() -> Groq:
    global _client
    if _client is None:
        if not config.GROQ_API_KEY:
            raise RuntimeError("GROQ_API_KEY is not set")
        _client = Groq(api_key=config.GROQ_API_KEY, timeout=30, max_retries=1)
    return _client


# ---------------- LLM ----------------
def chat(messages: list, tools: list | None = None, json_mode: bool = False, max_tokens: int = 800):
    """Call the main model; if it is rate-limited, retry on the fallback model.

    Returns (message, model_used).
    """
    last_error = None
    for model in [config.LLM_MODEL, config.LLM_FALLBACK_MODEL]:
        kwargs = dict(model=model, messages=messages, temperature=0.4, max_completion_tokens=max_tokens)
        if tools:
            kwargs.update(tools=tools, tool_choice="auto")
        if json_mode:
            kwargs["response_format"] = {"type": "json_object"}
        if "gpt-oss" in model:
            kwargs["reasoning_effort"] = "low"  # less thinking = lower latency and fewer tokens
        for attempt in range(2):
            try:
                resp = client().chat.completions.create(**kwargs)
                return resp.choices[0].message, model
            except RateLimitError as exc:
                log.warning("Rate limited on %s: %s", model, exc)
                last_error = exc
                break  # go to fallback model
            except BadRequestError as exc:
                # gpt-oss occasionally produces a malformed tool call -> Groq returns tool_use_failed. Retry once.
                last_error = exc
                if "tool_use_failed" in str(exc) and attempt == 0:
                    log.warning("tool_use_failed, retrying once")
                    continue
                raise
    raise last_error


# ---------------- Speech to text ----------------
STT_PROMPT = "HelioNest Energy, rooftop solar, subsidy, kW, EMI, PM Surya Ghar. नमस्ते, मुझे solar के बारे में जानकारी चाहिए।"
HALLUCINATIONS = {"thank you.", "thanks for watching!", "thank you for watching.", "you", ".", "bye.",
                  "धन्यवाद।", "ध्यान देने के लिए धन्यवाद।", "subtitles by the amara.org community"}
LANG_CODES = {"english": "en", "hindi": "hi", "urdu": "hi", "punjabi": "pa"}


def transcribe(audio: bytes, filename: str) -> dict:
    resp = client().audio.transcriptions.create(
        file=(filename, audio), model=config.STT_MODEL, response_format="verbose_json",
        prompt=STT_PROMPT, temperature=0.0,
    )
    data = resp if isinstance(resp, dict) else resp.model_dump() if hasattr(resp, "model_dump") else vars(resp)
    text = (data.get("text") or "").strip()
    lang = LANG_CODES.get(str(data.get("language", "")).lower(), str(data.get("language", ""))[:2] or "en")

    # Drop silence / noise that Whisper "hallucinates" into text.
    segments = data.get("segments") or []
    if segments and all((s.get("no_speech_prob") or 0) > 0.6 for s in segments):
        text = ""
    if text.lower() in HALLUCINATIONS:
        text = ""
    return {"text": text, "language": lang}


# ---------------- Text to speech ----------------
DEVANAGARI = re.compile(r"[ऀ-ॿ]")


def is_hindi(text: str) -> bool:
    return bool(DEVANAGARI.search(text))


def split_for_speech(text: str, max_len: int = 190) -> list:
    """Split a reply into short sentence chunks: faster first audio, and stays under TTS input limits."""
    parts = [p.strip() for p in re.split(r"(?<=[.!?।])\s+", text) if p.strip()]
    chunks = []
    for p in parts:
        while len(p) > max_len:
            cut = p.rfind(" ", 0, max_len)
            cut = cut if cut > 0 else max_len
            chunks.append(p[:cut].strip())
            p = p[cut:].strip()
        if p:
            chunks.append(p)
    return chunks


def synthesize(text: str) -> bytes:
    """English TTS via Groq Orpheus. Hindi is spoken by the browser's built-in voice instead."""
    resp = client().audio.speech.create(model=config.TTS_MODEL, voice=config.TTS_VOICE,
                                        input=text, response_format="wav")
    return resp.read() if hasattr(resp, "read") else resp.content
