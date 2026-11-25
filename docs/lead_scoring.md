# Lead qualification and scoring

The LLM's job is only to **extract** facts from the conversation, through the `update_lead` tool.
The **score is calculated in code** with fixed rules. This makes scoring consistent,
explainable to a sales manager, and easy to audit or tune, unlike asking the LLM "is this lead hot?".

## Fields captured during the call
name, phone, city, state, customer_type (home / business / society), owner_or_decision_maker,
monthly_bill, roof_type, roof_area_sqft, interest (on-grid / hybrid / commercial),
payment_preference (upfront / emi / unsure), timeline, survey_booked, callback_requested.

## Scoring (0–100)

| Dimension (BANT) | Rule | Points |
|---|---|---|
| **Need** (max 30) | Monthly bill ≥ ₹3,000 or business | 30 |
| | ₹1,500 – ₹2,999 | 20 |
| | ₹800 – ₹1,499 | 10 |
| | Below ₹800 or unknown | 0 |
| **Authority** (max 20) | Owner / decision maker | 20 |
| | Family member who will involve the owner | 10 |
| | Tenant / no authority / unknown | 0 |
| **Budget** (max 20) | Ready to pay upfront or happy with EMI | 20 |
| | Unsure | 10 |
| | Says they cannot afford it / unknown | 0 |
| **Timeline** (max 20) | Within 1 month | 20 |
| | 1–3 months | 12 |
| | More than 3 months | 5 |
| | Unknown | 0 |
| **Engagement** (max 10) | Site survey booked | 10 |
| | Not booked, but positive overall sentiment | 5 |

## Tiers
- **Hot**: 70 or more → sales team calls within 2 hours.
- **Warm**: 40 to 69 → nurture with a follow-up in 2–3 days.
- **Cold**: below 40 → monthly newsletter / remarketing only.
