# Demo script (5 minutes) and interview notes

## Before you present
- Open the Render URL 2 minutes early (wakes the free server) and check that the header says **Online**.
- Use headphones if you can (better voice detection, no echo). Keep the **Type** button as a backup in a noisy room.
- Keep a local copy running and a 2-minute screen recording of a successful call as backups.

## Demo flow
1. **Problem (30 s):** sales teams miss enquiries, waste time on unqualified calls, and the CRM stays empty.
2. **Inbound call:** click the green button. Ask: *"How much does a 3 kW system cost?"* → point at **Agent activity** (RAG search).
3. *"I'm from Jammu, how much subsidy will I get?"* → Priya says ₹85,800 (special-category state), not ₹78,000. That's RAG accuracy.
4. Give details: *"My bill is about ₹3,500, it's my own house, I'd prefer EMI, I want it this month."* → the **Live CRM** card fills in and the BANT score rises.
5. *"Book a site survey for Saturday."* → Priya checks slots and books, and the booking appears.
6. Switch to Hindi: *"क्या बिजली जाने पर भी चलेगा?"* → she replies in Hindi.
7. Hang up → **post-call summary**: sentiment, objections, outcome, next action.
8. **Dashboard:** KPIs, the Hot lead, the booking, insights. Then **Simulate a website enquiry** → Priya calls you (outbound) and greets you by name.
9. Call again from the Call tab → *"Welcome back"* (memory from Redis + localStorage).

## Likely questions and short answers
- **Why GPT-OSS-120B on Groq?** Open-weight, strong tool calling, and very fast inference on Groq, which matters for voice latency. There's a 20B fallback for rate limits.
- **How does RAG work here?** Docs are split by section → embedded with bge-small (ONNX) → cosine similarity blended with BM25 keyword scores → top-3 sections go to the LLM through the `search_knowledge_base` tool. The prompt forbids stating facts without searching.
- **Why compute the score in code?** It's deterministic, explainable and tunable by the business. The LLM only extracts facts.
- **How do you stop hallucinations?** Facts only from tool results, fixed offers, escalation to a human, low temperature, short replies.
- **Latency?** STT about 0.5 s, LLM with a tool round about 1–2 s, TTS per sentence. To improve: streaming STT/LLM/TTS over WebSockets and starting TTS on the first sentence.
- **Scaling to 1 lakh users?** Stateless API, state in Redis, horizontal autoscaling, a queue for summaries, Postgres + a vector DB, paid API tiers with multi-provider fallback. See REPORT.md.
- **Real phone calls?** Twilio/Exotel media streams → a WebSocket into the same agent loop. The agent and tools don't change, only the audio transport.
- **Security?** Keys on the server only, private Redis, no sensitive data collected, AI disclosure, DPDP consent and deletion, DND checks for outbound calls.
- **Cost per call?** About ₹4–7 for AI services in a 4-minute call, versus ₹60+ for a human rep (assumptions in REPORT.md).

## Live-coding warm-ups (practise once)
- Add a new tool: write the schema in `TOOLS` and a function in `tools.py`, then add it to `REGISTRY`.
- Change the persona: edit `prompts/system_prompt.md`.
- Change scoring weights: `backend/app/scoring.py`.
- Add knowledge: drop a new `.md` file in `knowledge_base/` with `##` sections and restart.
- Change silence timeout: `SILENCE_MS` in `frontend/src/lib/voice.js`.
