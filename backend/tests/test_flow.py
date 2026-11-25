"""End-to-end test of the call flow with Groq mocked out (no API key needed).

Run:  RAG_BACKEND=bm25 GROQ_API_KEY=test python -m pytest backend/tests -q
"""
import json
import os
from types import SimpleNamespace as NS

os.environ.setdefault("RAG_BACKEND", "bm25")
os.environ.setdefault("GROQ_API_KEY", "test")

from fastapi.testclient import TestClient  # noqa: E402

from backend.app import groq_client, main
from backend.app import tools as agent_tools  # noqa: E402


def tool_call(name, args, i=0):
    return NS(id=f"call_{name}_{i}", function=NS(name=name, arguments=json.dumps(args)))


class FakeLLM:
    """Scripted LLM: replies depend on the last user message, using tools like the real model would."""

    def __call__(self, messages, tools=None, json_mode=False, max_tokens=800):
        if json_mode:
            return NS(content=json.dumps({
                "summary": "Caller from Jammu asked about subsidy and booked a survey.",
                "customer_needs": ["Reduce bill"], "objections": ["Price"], "turn_sentiments": [],
                "overall_sentiment": "positive", "sentiment_trend": "improving", "outcome": "survey_booked",
                "next_action": "Do the survey", "follow_up_date": None, "language_used": "english"}),
                tool_calls=None), "fake"
        last_user = [m for m in messages if m["role"] == "user"][-1]["content"].lower()
        tool_results = [m for m in messages if m["role"] == "tool"]
        if tool_results:  # second round: answer using tool output
            return NS(content="Done. Anything else I can help with?", tool_calls=None), "fake"
        if "subsidy" in last_user:
            return NS(content="", tool_calls=[tool_call("search_knowledge_base", {"query": "subsidy Jammu"}),
                                              tool_call("update_lead", {"city": "Jammu", "monthly_bill": 3500,
                                                                        "owner_or_decision_maker": "yes",
                                                                        "timeline": "within_1_month",
                                                                        "payment_preference": "emi"})]), "fake"
        if "slots" in last_user:
            return NS(content="", tool_calls=[tool_call("check_available_slots", {})]), "fake"
        if "book" in last_user:
            slots = agent_tools.check_available_slots(None)[0]["slots"]
            first = next(s for s in slots if s["times"])
            return NS(content="", tool_calls=[tool_call("book_site_survey", {
                "date": first["date"], "time": first["times"][0], "name": "Aman", "phone": "9999999999",
                "address": "12 Gandhi Nagar", "city": "Jammu"})]), "fake"
        return NS(content="नमस्ते! मैं आपकी कैसे मदद कर सकती हूँ?", tool_calls=None), "fake"


def setup_module():
    groq_client.chat = FakeLLM()
    main.groq_client.transcribe = lambda data, name: {"text": "What subsidy do I get?", "language": "en"}


def test_full_call():
    with TestClient(main.app) as c:
        assert c.get("/api/health").json()["ok"]
        start = c.post("/api/call/start", json={"mode": "inbound", "client_id": "test"}).json()
        cid = start["call_id"]
        assert "Priya" in start["greeting"]

        r = c.post(f"/api/call/{cid}/turn", files={"audio": ("a.webm", b"fakeaudio", "audio/webm")}).json()
        assert r["user_text"] == "What subsidy do I get?"
        assert [e["type"] for e in r["events"]] == ["rag", "crm"]
        assert r["lead"]["city"] == "Jammu" and r["lead"]["tier"] == "hot"

        r = c.post(f"/api/call/{cid}/turn", data={"text": "any slots?"}).json()
        assert r["events"][0]["type"] == "calendar"
        r = c.post(f"/api/call/{cid}/turn", data={"text": "please book it"}).json()
        assert r["events"][0]["type"] == "booking", r["events"]
        assert r["lead"]["survey_booked"] is True

        r = c.post(f"/api/call/{cid}/turn", data={"text": "hindi please"}).json()
        assert r["reply_lang"] == "hi"

        end = c.post(f"/api/call/{cid}/end").json()
        assert end["call"]["summary"]["outcome"] == "survey_booked"
        assert end["lead"]["score"] == 100

        # Returning caller is recognised
        again = c.post("/api/call/start", json={"mode": "inbound", "lead_id": end["lead"]["id"]}).json()
        assert again["greeting"].startswith("Welcome back")

        ins = c.get("/api/insights").json()
        assert ins["totals"]["bookings"] == 1 and ins["totals"]["calls"] == 1
        assert len(c.get("/api/leads").json()) >= 4  # 3 seeded + caller

        # Outbound call to a seeded lead
        lead = next(l for l in c.get("/api/leads").json() if l["source"] == "web_form")
        out = c.post("/api/call/start", json={"mode": "outbound", "lead_id": lead["id"]}).json()
        assert lead["name"] in out["greeting"]

        # Hindi text is refused by Groq TTS so the browser voice is used
        assert c.post("/api/tts", json={"text": "नमस्ते"}).status_code == 422


def test_double_booking_prevented():
    from backend.app import store
    assert store.reserve_slot("2030-01-01", "10:00", "A")
    assert not store.reserve_slot("2030-01-01", "10:00", "B")
