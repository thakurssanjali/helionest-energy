"""Tools the agent can call (OpenAI-style function calling) and their implementations.

Each implementation receives the live call `session` (which contains the lead) and the
arguments the LLM chose, and returns (result_for_llm: dict, event_for_ui: dict).
"""
import uuid
from datetime import datetime, timedelta

from . import config, rag, store
from .scoring import apply_score

TOOLS = [
    {"type": "function", "function": {
        "name": "search_knowledge_base",
        "description": "Search HelioNest's company documents (prices, subsidy, products, process, warranty, offers, FAQs). Use before stating any fact.",
        "parameters": {"type": "object", "properties": {
            "query": {"type": "string", "description": "Search query in English"}}, "required": ["query"]}}},
    {"type": "function", "function": {
        "name": "update_lead",
        "description": "Save details learned about the caller to the CRM. Send only the fields you learned.",
        "parameters": {"type": "object", "properties": {
            "name": {"type": "string"},
            "phone": {"type": "string"},
            "city": {"type": "string"},
            "state": {"type": "string"},
            "address": {"type": "string"},
            "customer_type": {"type": "string", "enum": ["home", "business", "society"]},
            "owner_or_decision_maker": {"type": "string", "enum": ["yes", "family_member", "no"]},
            "monthly_bill": {"type": "number", "description": "Monthly electricity bill in rupees"},
            "roof_type": {"type": "string"},
            "roof_area_sqft": {"type": "number"},
            "interest": {"type": "string", "enum": ["on_grid", "hybrid", "commercial", "society", "unsure"]},
            "payment_preference": {"type": "string", "enum": ["upfront", "emi", "unsure", "cannot_afford"]},
            "timeline": {"type": "string", "enum": ["within_1_month", "1_3_months", "over_3_months", "unsure"]},
            "notes": {"type": "string", "description": "Anything else useful for the sales team"}}}}},
    {"type": "function", "function": {
        "name": "check_available_slots",
        "description": "Get free site-survey slots. Optionally for one date (YYYY-MM-DD).",
        "parameters": {"type": "object", "properties": {"date": {"type": "string"}}}}},
    {"type": "function", "function": {
        "name": "book_site_survey",
        "description": "Book a free site survey after the caller confirmed date, time, name, phone and address.",
        "parameters": {"type": "object", "properties": {
            "date": {"type": "string", "description": "YYYY-MM-DD"},
            "time": {"type": "string", "enum": config.SURVEY_SLOTS},
            "name": {"type": "string"}, "phone": {"type": "string"},
            "address": {"type": "string"}, "city": {"type": "string"}},
            "required": ["date", "time", "name", "phone", "address", "city"]}}},
    {"type": "function", "function": {
        "name": "request_human_callback",
        "description": "Ask a human sales manager to call the customer back.",
        "parameters": {"type": "object", "properties": {
            "reason": {"type": "string"}, "preferred_time": {"type": "string"}}, "required": ["reason"]}}},
    {"type": "function", "function": {
        "name": "end_call",
        "description": "End the call after saying goodbye.",
        "parameters": {"type": "object", "properties": {"reason": {"type": "string"}}}}},
]

LEAD_FIELDS = {p for p in TOOLS[1]["function"]["parameters"]["properties"]}


def now() -> datetime:
    return datetime.now(config.TIMEZONE)


def _touch(lead: dict):
    lead["updated_at"] = now().isoformat()
    apply_score(lead)
    store.save_lead(lead)


# ---------------- implementations ----------------
def search_knowledge_base(session, query: str = ""):
    hits = rag.kb().search(query, k=3)
    results = [{"title": h["title"], "text": h["text"][:900]} for h in hits]
    return {"results": results}, {"type": "rag", "label": f"Searched knowledge base: “{query}”",
                                  "detail": [h["title"] for h in hits]}


def update_lead(session, **fields):
    lead = session["lead"]
    clean = {k: v for k, v in fields.items() if k in LEAD_FIELDS and v not in (None, "")}
    if "notes" in clean and lead.get("notes"):
        clean["notes"] = f"{lead['notes']}; {clean['notes']}"
    lead.update(clean)
    _touch(lead)
    return ({"saved": list(clean), "lead_score": lead["score"], "tier": lead["tier"]},
            {"type": "crm", "label": "Updated CRM: " + ", ".join(clean) if clean else "CRM checked"})


def _free_slots_for(day) -> list:
    if day.weekday() == 6:  # Sunday closed
        return []
    out = []
    for t in config.SURVEY_SLOTS:
        start = datetime.combine(day, datetime.strptime(t, "%H:%M").time(), config.TIMEZONE)
        if start > now() + timedelta(hours=2) and not store.is_slot_taken(day.isoformat(), t):
            out.append(t)
    return out


def check_available_slots(session, date: str | None = None):
    days = []
    if date:
        try:
            days = [datetime.strptime(date, "%Y-%m-%d").date()]
        except ValueError:
            return {"error": "date must be YYYY-MM-DD"}, {"type": "calendar", "label": "Checked calendar (bad date)"}
    else:
        d = now().date() + timedelta(days=1)
        while len(days) < 3:
            if d.weekday() != 6:
                days.append(d)
            d += timedelta(days=1)
    slots = [{"date": d.isoformat(), "day": d.strftime("%A %d %B"), "times": _free_slots_for(d)} for d in days]
    if date and days[0].weekday() == 6:
        return {"slots": [], "note": "Closed on Sunday"}, {"type": "calendar", "label": f"Checked calendar for {date}"}
    return {"slots": slots}, {"type": "calendar", "label": "Checked calendar for free survey slots"}


def book_site_survey(session, date: str, time: str, name: str, phone: str, address: str, city: str):
    try:
        day = datetime.strptime(date, "%Y-%m-%d").date()
    except ValueError:
        return {"booked": False, "error": "date must be YYYY-MM-DD"}, {"type": "calendar", "label": "Booking failed: bad date"}
    if time not in config.SURVEY_SLOTS or time not in _free_slots_for(day):
        return ({"booked": False, "error": "Slot not available", "alternatives": check_available_slots(session)[0]},
                {"type": "calendar", "label": f"Slot {date} {time} unavailable"})
    lead = session["lead"]
    if not store.reserve_slot(date, time, lead["id"]):  # atomic, prevents double booking
        return {"booked": False, "error": "Slot just got taken"}, {"type": "calendar", "label": "Slot just got taken"}
    booking = {"id": "BK-" + uuid.uuid4().hex[:6].upper(), "lead_id": lead["id"], "name": name, "phone": phone,
               "address": address, "city": city, "date": date, "time": time, "created_at": now().isoformat()}
    store.add_booking(booking)
    lead.update(name=name, phone=phone, address=address, city=city, survey_booked=True, booking=booking)
    _touch(lead)
    return ({"booked": True, "booking_id": booking["id"], "date": day.strftime("%A %d %B %Y"), "time": time},
            {"type": "booking", "label": f"Booked site survey {day.strftime('%a %d %b')} at {time}", "detail": booking})


def request_human_callback(session, reason: str, preferred_time: str = ""):
    lead = session["lead"]
    lead["callback_requested"] = {"reason": reason, "preferred_time": preferred_time, "at": now().isoformat()}
    _touch(lead)
    return {"requested": True, "promise": "A human team member will call back within 2 working hours."}, \
        {"type": "escalation", "label": f"Human callback requested: {reason}"}


def end_call(session, reason: str = ""):
    session["ended"] = True
    return {"ok": True}, {"type": "end", "label": "Agent ended the call"}


REGISTRY = {f.__name__: f for f in [search_knowledge_base, update_lead, check_available_slots,
                                    book_site_survey, request_human_callback, end_call]}
