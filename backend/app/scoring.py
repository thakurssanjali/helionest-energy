"""Rule-based BANT lead scoring (see docs/lead_scoring.md).

The LLM only extracts facts; the score is computed here so it is consistent and explainable.
"""


def score_lead(lead: dict) -> dict:
    breakdown = {}

    # Need (max 30)
    bill = lead.get("monthly_bill") or 0
    if lead.get("customer_type") in ("business", "society") or bill >= 3000:
        breakdown["need"] = 30
    elif bill >= 1500:
        breakdown["need"] = 20
    elif bill >= 800:
        breakdown["need"] = 10
    else:
        breakdown["need"] = 0

    # Authority (max 20)
    breakdown["authority"] = {"yes": 20, "family_member": 10}.get(lead.get("owner_or_decision_maker"), 0)

    # Budget (max 20)
    breakdown["budget"] = {"upfront": 20, "emi": 20, "unsure": 10}.get(lead.get("payment_preference"), 0)

    # Timeline (max 20)
    breakdown["timeline"] = {"within_1_month": 20, "1_3_months": 12, "over_3_months": 5}.get(lead.get("timeline"), 0)

    # Engagement (max 10)
    if lead.get("survey_booked"):
        breakdown["engagement"] = 10
    elif lead.get("last_sentiment") == "positive":
        breakdown["engagement"] = 5
    else:
        breakdown["engagement"] = 0

    score = sum(breakdown.values())
    tier = "hot" if score >= 70 else "warm" if score >= 40 else "cold"
    return {"score": score, "tier": tier, "breakdown": breakdown}


def apply_score(lead: dict) -> dict:
    result = score_lead(lead)
    lead["score"], lead["tier"], lead["score_breakdown"] = result["score"], result["tier"], result["breakdown"]
    return lead
