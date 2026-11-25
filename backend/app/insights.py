"""Business insights for the sales dashboard, plus demo seed data."""
from collections import Counter
from datetime import timedelta

from . import store, tools
from .scoring import apply_score


def compute() -> dict:
    leads, calls, bookings = store.list_leads(), store.list_calls(500), store.list_bookings(500)
    tiers = Counter(l.get("tier", "cold") for l in leads)
    sentiments = Counter(c["summary"].get("overall_sentiment", "neutral") for c in calls)
    outcomes = Counter(c["summary"].get("outcome", "follow_up_needed") for c in calls)
    languages = Counter(c["summary"].get("language_used", "english") for c in calls)
    objections = Counter(o.strip().capitalize() for c in calls for o in c["summary"].get("objections", []) if o)
    durations = [c["duration_s"] for c in calls if c.get("duration_s")]
    booked = sum(1 for c in calls if c["summary"].get("outcome") == "survey_booked")
    return {
        "totals": {"leads": len(leads), "calls": len(calls), "bookings": len(bookings),
                   "hot": tiers["hot"], "warm": tiers["warm"], "cold": tiers["cold"],
                   "conversion_rate": round(100 * booked / len(calls), 1) if calls else 0,
                   "avg_call_seconds": round(sum(durations) / len(durations)) if durations else 0},
        "sentiment": dict(sentiments), "outcomes": dict(outcomes), "languages": dict(languages),
        "top_objections": objections.most_common(5),
    }


def seed():
    """Sample web enquiries so the dashboard is not empty and outbound calls can be demoed."""
    if store.list_leads():
        return
    samples = [
        dict(name="Rahul Sharma", phone="+91 90000 11111", city="Ludhiana", state="Punjab", customer_type="home",
             monthly_bill=2800, interest="on_grid", notes="Web form: wants to cut summer AC bills."),
        dict(name="Simran Kaur", phone="+91 90000 22222", city="Jammu", state="Jammu & Kashmir", customer_type="home",
             monthly_bill=4200, interest="hybrid", notes="Web form: frequent power cuts, asked about battery."),
        dict(name="Gupta Textiles", phone="+91 90000 33333", city="Jalandhar", state="Punjab", customer_type="business",
             monthly_bill=45000, interest="commercial", notes="Web form: 60 kW factory roof."),
    ]
    for s in samples:
        lead = {"id": "L-demo" + s["phone"][-3:], "source": "web_form", "created_at": tools.now().isoformat(),
                "survey_booked": False, "call_ids": [], **s}
        lead["updated_at"] = (tools.now() - timedelta(minutes=len(s["name"]))).isoformat()
        apply_score(lead)
        store.save_lead(lead)
