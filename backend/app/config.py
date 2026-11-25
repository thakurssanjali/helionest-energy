"""All settings in one place. Values come from environment variables (or a .env file)."""
import os
from pathlib import Path
from zoneinfo import ZoneInfo

from dotenv import load_dotenv

ROOT_DIR = Path(__file__).resolve().parents[2]  # repo root
load_dotenv(ROOT_DIR / ".env")

GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")

# Models (all served by Groq)
LLM_MODEL = os.getenv("LLM_MODEL", "openai/gpt-oss-120b")
LLM_FALLBACK_MODEL = os.getenv("LLM_FALLBACK_MODEL", "openai/gpt-oss-20b")  # used when the main model is rate-limited
STT_MODEL = os.getenv("STT_MODEL", "whisper-large-v3")
TTS_MODEL = os.getenv("TTS_MODEL", "canopylabs/orpheus-v1-english")
TTS_VOICE = os.getenv("TTS_VOICE", "hannah")

# Storage: Redis if REDIS_URL is set, otherwise in-process memory
REDIS_URL = os.getenv("REDIS_URL", "")

# RAG: "auto" = vector embeddings if available, else BM25. Can force "bm25" or "vector".
RAG_BACKEND = os.getenv("RAG_BACKEND", "auto")
EMBED_MODEL = os.getenv("EMBED_MODEL", "BAAI/bge-small-en-v1.5")
EMBED_CACHE_DIR = os.getenv("EMBED_CACHE_DIR", str(ROOT_DIR / "models"))

# Paths
KB_DIR = ROOT_DIR / "knowledge_base"
PROMPTS_DIR = ROOT_DIR / "prompts"
FRONTEND_DIST = ROOT_DIR / "frontend" / "dist"

# Business settings
TIMEZONE = ZoneInfo("Asia/Kolkata")
SURVEY_SLOTS = ["10:00", "12:00", "14:00", "16:00"]  # Mon-Sat
MAX_TURNS_PER_CALL = 40
HISTORY_MESSAGES = 12  # how many past user/assistant messages the LLM sees (keeps tokens low)
SEED_DEMO_DATA = os.getenv("SEED_DEMO_DATA", "true").lower() == "true"
