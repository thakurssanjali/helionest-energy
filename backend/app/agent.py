"""The sales agent: builds the prompt, runs the tool-calling loop, and writes the post-call summary."""
import json
import logging
import uuid

from . import config, groq_client, store, tools
from .scoring import apply_score

log = logging.getLogger(__name__)
SYSTEM_TEMPLATE = (config.PROMPTS_DIR / "system_prompt.md").read_text(encoding="utf-8")
SUMMARY_TEMPLATE = (config.PROMPTS_DIR / "post_call_summary.md").read_text(encoding="utf-8")
MAX_TOOL_ROUNDS = 4
CONTEXT_FIELDS = ["name", "phone", "city", "state", "customer_type", "owner_or_decision_maker", "monthly_bill",
                  "roof_type", "interest", "payment_preference", "timeline", "survey_booked"]


def new_lead(source: str, **fields) -> dict:
    lead = {"id": "L-" + uuid.uuid4().hex[:8], "source": source, "created_at": tools.now().isoformat(),
            "survey_booked": False, "call_ids": [], **fields}
    tools._touch(lead)
    return lead


# ---------------- prompt building ----------------
def call_context(session) -> str:
    lead = session["lead"]
    known = {k: lead[k] for k in CONTEXT_FIELDS if lead.get(k) not in (None, "", False)}
    if session["mode"] == "outbound":
        kind = "OUTBOUND follow-up call. You called this lead because they submitted an enquiry on our website."
    elif lead.get("call_ids"):
        kind = "INBOUND call from a RETURNING caller. Greet them as someone you have spoken to before."
    else:
        kind = "INBOUND call from a new caller."
    lines = [f"- Call type: {kind}",
             f"- Current date and time: {tools.now().strftime('%A, %d %B %Y, %I:%M %p')} IST",
             f"- Known lead details: {json.dumps(known, ensure_ascii=False) if known else 'none yet'}"]
    if lead.get("last_summary"):
        lines.append(f"- Summary of the previous call: {lead['last_summary']}")
    return "\n".join(lines)


def system_message(session) -> dict:
    return {"role": "system", "content": SYSTEM_TEMPLATE.replace("{call_context}", call_context(session))}


def greeting(session) -> str:
    lead, name = session["lead"], session["lead"].get("name")
    if session["mode"] == "outbound":
        city = f" in {lead['city']}" if lead.get("city") else ""
        return (f"Hello {name or 'there'}, this is Priya, an AI assistant from HelioNest Energy. "
                f"You enquired on our website about rooftop solar for your property{city}. Is this a good time to talk?")
    if lead.get("call_ids"):
        return (f"Welcome back{' ' + name if name else ''}! This is Priya, HelioNest Energy's AI assistant. "
                f"How can I help you today?")
    return "Namaste! This is Priya, HelioNest Energy's AI assistant. How can I help you with rooftop solar today?"


# ---------------- call lifecycle ----------------
def start_call(mode: str, lead_id: str | None, client_id: str | None) -> dict:
    lead = store.get_lead(lead_id) if lead_id else None
    if not lead:
        lead = new_lead("inbound_call" if mode == "inbound" else "web_form", client_id=client_id)
    session = {"call_id": "C-" + uuid.uuid4().hex[:10], "mode": mode, "lead": lead, "client_id": client_id,
               "started_at": tools.now().isoformat(), "history": [], "transcript": [], "events": [],
               "turns": 0, "ended": False}
    text = greeting(session)
    session["history"].append({"role": "assistant", "content": text})
    session["transcript"].append({"role": "agent", "text": text, "at": tools.now().isoformat()})
    store.save_session(session)
    return {"call_id": session["call_id"], "lead": lead, "greeting": text,
            "greeting_chunks": groq_client.split_for_speech(text)}


def run_turn(session: dict, user_text: str, user_lang: str = "en") -> dict:
    """One caller utterance -> agent reply (possibly after several tool calls)."""
    session["turns"] += 1
    session["history"].append({"role": "user", "content": user_text})
    session["transcript"].append({"role": "caller", "text": user_text, "lang": user_lang, "at": tools.now().isoformat()})

    # Only the last N plain messages are sent: keeps tokens (and Groq rate limits) under control.
    messages = [system_message(session)] + session["history"][-config.HISTORY_MESSAGES:]
    events, reply = [], ""
    for _ in range(MAX_TOOL_ROUNDS):
        msg, model = groq_client.chat(messages, tools=tools.TOOLS)
        if not msg.tool_calls:
            reply = (msg.content or "").strip()
            break
        messages.append({"role": "assistant", "content": msg.content or "",
                         "tool_calls": [{"id": tc.id, "type": "function",
                                         "function": {"name": tc.function.name, "arguments": tc.function.arguments}}
                                        for tc in msg.tool_calls]})
        for tc in msg.tool_calls:
            result, event = execute_tool(session, tc.function.name, tc.function.arguments)
            events.append(event)
            messages.append({"role": "tool", "tool_call_id": tc.id, "content": json.dumps(result, ensure_ascii=False)})
    if not reply:
        reply = "Sorry, could you please say that again?"

    if session["turns"] >= config.MAX_TURNS_PER_CALL:
        session["ended"] = True
    session["history"].append({"role": "assistant", "content": reply})
    session["transcript"].append({"role": "agent", "text": reply, "at": tools.now().isoformat()})
    session["events"].extend(events)
    store.save_session(session)
    return {"reply": reply, "reply_chunks": groq_client.split_for_speech(reply),
            "reply_lang": "hi" if groq_client.is_hindi(reply) else "en",
            "events": events, "lead": session["lead"], "ended": session["ended"]}


def execute_tool(session, name: str, raw_args: str):
    fn = tools.REGISTRY.get(name)
    if not fn:
        return {"error": f"unknown tool {name}"}, {"type": "error", "label": f"Unknown tool {name}"}
    try:
        args = json.loads(raw_args or "{}")
        return fn(session, **args)
    except TypeError as exc:
        return {"error": f"bad arguments: {exc}"}, {"type": "error", "label": f"{name}: bad arguments"}
    except Exception as exc:  # noqa: BLE001
        log.exception("Tool %s failed", name)
        return {"error": str(exc)}, {"type": "error", "label": f"{name} failed"}


def summarize(session: dict) -> dict:
    caller_turns = [t for t in session["transcript"] if t["role"] == "caller"]
    if not caller_turns:
        return {"summary": "The call ended before the caller said anything.", "customer_needs": [], "objections": [],
                "turn_sentiments": [], "overall_sentiment": "neutral", "sentiment_trend": "stable",
                "outcome": "follow_up_needed", "next_action": "Try calling again later.",
                "follow_up_date": None, "language_used": "english"}
    transcript = "\n".join(f"{'Priya' if t['role'] == 'agent' else 'Caller'}: {t['text']}" for t in session["transcript"])
    lead_fields = {k: v for k, v in session["lead"].items() if k in tools.LEAD_FIELDS or k == "survey_booked"}
    prompt = SUMMARY_TEMPLATE.replace("{lead_fields}", json.dumps(lead_fields, ensure_ascii=False)) \
                             .replace("{transcript}", transcript[-12000:])
    try:
        msg, _ = groq_client.chat([{"role": "user", "content": prompt}], json_mode=True, max_tokens=1200)
        return json.loads(msg.content)
    except Exception as exc:  # noqa: BLE001
        log.exception("Summary failed")
        return {"summary": f"Automatic summary unavailable ({type(exc).__name__}).", "customer_needs": [],
                "objections": [], "turn_sentiments": [], "overall_sentiment": "neutral", "sentiment_trend": "stable",
                "outcome": "follow_up_needed", "next_action": "Review the transcript manually.",
                "follow_up_date": None, "language_used": "unknown"}


def end_call(session: dict) -> dict:
    summary = summarize(session)
    lead = session["lead"]
    lead["last_summary"] = summary.get("summary")
    lead["last_sentiment"] = summary.get("overall_sentiment")
    lead["last_outcome"] = summary.get("outcome")
    lead["next_action"] = summary.get("next_action")
    lead.setdefault("call_ids", []).append(session["call_id"])
    apply_score(lead)
    tools._touch(lead)

    started = session["started_at"]
    ended = tools.now()
    from datetime import datetime
    duration = int((ended - datetime.fromisoformat(started)).total_seconds())
    call = {"id": session["call_id"], "lead_id": lead["id"], "lead_name": lead.get("name"), "mode": session["mode"],
            "started_at": started, "ended_at": ended.isoformat(), "duration_s": duration,
            "transcript": session["transcript"], "events": session["events"], "summary": summary,
            "score": lead["score"], "tier": lead["tier"]}
    store.save_call(call)
    store.delete_session(session["call_id"])
    return {"call": call, "lead": lead}
