"""FastAPI app: REST API for the call screen + dashboard, and serves the built React frontend."""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import agent, config, groq_client, insights, rag, store

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("app")

@asynccontextmanager
async def lifespan(_app):
    rag.kb()  # build the RAG index once at startup
    if config.SEED_DEMO_DATA:
        insights.seed()
    yield


app = FastAPI(title="HelioNest AI Sales Voice Agent", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
                   allow_methods=["*"], allow_headers=["*"])
MAX_AUDIO_BYTES = 10 * 1024 * 1024


# ---------------- models ----------------
class StartCall(BaseModel):
    mode: str = "inbound"  # inbound | outbound
    lead_id: str | None = None
    client_id: str | None = None


class TTSRequest(BaseModel):
    text: str


class NewLead(BaseModel):
    name: str
    phone: str
    city: str
    monthly_bill: float | None = None
    customer_type: str = "home"
    notes: str | None = None


def _session_or_404(call_id: str) -> dict:
    session = store.get_session(call_id)
    if not session:
        raise HTTPException(404, "Call not found or already ended")
    return session


# ---------------- call API ----------------
@app.get("/api/health")
def health():
    return {"ok": True, "storage": store.BACKEND, "rag": rag.kb().backend, "llm": config.LLM_MODEL,
            "groq_key_set": bool(config.GROQ_API_KEY)}


@app.post("/api/call/start")
def call_start(body: StartCall):
    if body.mode not in ("inbound", "outbound"):
        raise HTTPException(400, "mode must be inbound or outbound")
    return agent.start_call(body.mode, body.lead_id, body.client_id)


@app.post("/api/call/{call_id}/turn")
async def call_turn(call_id: str, audio: UploadFile | None = File(None), text: str | None = Form(None)):
    """One caller turn. Send recorded audio (normal) or typed text (fallback for noisy rooms)."""
    session = _session_or_404(call_id)
    if session["ended"]:
        raise HTTPException(409, "Call already ended")
    lang = "en"
    if audio is not None:
        data = await audio.read()
        if len(data) > MAX_AUDIO_BYTES:
            raise HTTPException(413, "Audio too large")
        stt = groq_client.transcribe(data, audio.filename or "speech.webm")
        text, lang = stt["text"], stt["language"]
    text = (text or "").strip()
    if not text:
        return {"user_text": "", "empty": True}  # silence/noise: the UI just keeps listening
    result = agent.run_turn(session, text, lang)
    return {"user_text": text, "user_lang": lang, **result}


@app.post("/api/call/{call_id}/end")
def call_end(call_id: str):
    return agent.end_call(_session_or_404(call_id))


@app.post("/api/tts")
def tts(body: TTSRequest):
    text = body.text.strip()[:400]
    if not text:
        raise HTTPException(400, "empty text")
    if groq_client.is_hindi(text):
        raise HTTPException(422, "Hindi text: use the browser voice")  # Orpheus on Groq is English-only
    try:
        return Response(groq_client.synthesize(text), media_type="audio/wav")
    except Exception as exc:  # noqa: BLE001  (rate limit, terms not accepted, etc.)
        log.warning("TTS failed: %s", exc)
        raise HTTPException(503, "TTS unavailable, use browser voice")


# ---------------- dashboard API ----------------
@app.get("/api/leads")
def leads():
    return store.list_leads()


@app.post("/api/leads")
def create_lead(body: NewLead):
    """Simulates a website enquiry form, so the agent can make an outbound follow-up call."""
    return agent.new_lead("web_form", **body.model_dump(exclude_none=True))


@app.get("/api/leads/{lead_id}")
def lead(lead_id: str):
    found = store.get_lead(lead_id)
    if not found:
        raise HTTPException(404, "Lead not found")
    calls = [store.get_call(c) for c in found.get("call_ids", [])]
    return {**found, "calls": [c for c in calls if c]}


@app.get("/api/calls")
def calls():
    return store.list_calls()


@app.get("/api/bookings")
def bookings():
    return store.list_bookings()


@app.get("/api/insights")
def get_insights():
    return insights.compute()


# ---------------- frontend ----------------
if config.FRONTEND_DIST.exists():
    app.mount("/assets", StaticFiles(directory=config.FRONTEND_DIST / "assets"), name="assets")

    @app.get("/{path:path}")
    def spa(path: str):
        file = (config.FRONTEND_DIST / path).resolve()
        safe = file.is_relative_to(config.FRONTEND_DIST.resolve()) and file.is_file()
        return FileResponse(file if path and safe else config.FRONTEND_DIST / "index.html")
