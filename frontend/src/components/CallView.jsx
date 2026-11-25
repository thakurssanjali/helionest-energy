import { useEffect, useRef, useState } from 'react'
import {
  Phone, PhoneOff, PhoneIncoming, Mic, MicOff, Keyboard, Send, Search, Database, CalendarCheck,
  CalendarDays, Headset, AlertTriangle, Sparkles, History, Trash2, Hand,
} from 'lucide-react'
import { api } from '../lib/api'
import { memory } from '../lib/storage'
import { VoiceEngine, playRingTone } from '../lib/voice'
import { LeadCard, SummaryCard } from './LeadPanels'

const STATE_LABEL = {
  idle: 'Your turn: hold the button to talk',
  listening: 'Listening…',
  recording: 'Hearing you…',
  processing: 'Thinking…',
  thinking: 'Thinking…',
  speaking: 'Priya is speaking',
  ptt: 'Recording… release to send',
}

const EVENT_ICON = { rag: Search, crm: Database, calendar: CalendarDays, booking: CalendarCheck, escalation: Headset, end: PhoneOff, error: AlertTriangle }

const SUGGESTIONS = [
  'How much does a 3 kW system cost?',
  "I'm from Jammu, how much subsidy will I get?",
  'मेरा बिल 3000 रुपये आता है, कौन सा सिस्टम लूं?',
  'Do I get power during a power cut?',
  'Book a free site survey for me',
]

function useTimer(running) {
  const [secs, setSecs] = useState(0)
  useEffect(() => {
    if (!running) return
    setSecs(0)
    const t = setInterval(() => setSecs((s) => s + 1), 1000)
    return () => clearInterval(t)
  }, [running])
  return `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`
}

export default function CallView({ outboundLead, clearOutbound }) {
  const [phase, setPhase] = useState(outboundLead ? 'incoming' : 'idle') // idle | incoming | ringing | active | ending | ended
  const [agentState, setAgentState] = useState('idle')
  const [transcript, setTranscript] = useState([])
  const [events, setEvents] = useState([])
  const [lead, setLead] = useState(null)
  const [changed, setChanged] = useState([])
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [level, setLevel] = useState(0)
  const [muted, setMuted] = useState(false)
  const [typing, setTyping] = useState(false)
  const [draft, setDraft] = useState('')
  const [settings, setSettings] = useState(memory.settings())
  const [history, setHistory] = useState(memory.history())

  const engine = useRef(null)
  const callId = useRef(null)
  const endedByAgent = useRef(false)
  const scroller = useRef(null)
  const timer = useTimer(phase === 'active')

  useEffect(() => {
    if (!outboundLead || callId.current) return // never interrupt a live call
    setPhase('incoming'); setResult(null); setTranscript([]); setEvents([]); setChanged([]); setError('')
    setLead(outboundLead)
  }, [outboundLead])
  useEffect(() => { scroller.current?.scrollTo({ top: 99999, behavior: 'smooth' }) }, [transcript, agentState])
  useEffect(() => () => engine.current?.destroy(), [])
  useEffect(() => { memory.saveSettings(settings); engine.current?.updateSettings(settings) }, [settings])

  const say = (role, text) => setTranscript((t) => [...t, { role, text }])

  function updateLead(next) {
    setLead((prev) => {
      if (prev) setChanged(Object.keys(next).filter((k) => JSON.stringify(next[k]) !== JSON.stringify(prev[k])))
      return next
    })
  }

  async function startCall(mode) {
    setError(''); setTranscript([]); setEvents([]); setResult(null); setChanged([]); endedByAgent.current = false
    setPhase('ringing')
    try {
      const eng = new VoiceEngine({
        settings,
        onState: setAgentState,
        onLevel: setLevel,
        onUtterance: (blob, name) => handleTurn(() => api.sendAudio(callId.current, blob, name)),
      })
      await eng.init() // asks for microphone permission
      engine.current = eng
      const leadId = mode === 'outbound' ? outboundLead?.id : memory.leadId()
      const [start] = await Promise.all([api.startCall(mode, leadId, memory.clientId()), mode === 'inbound' ? playRingTone(2) : null])
      callId.current = start.call_id
      if (mode === 'inbound') memory.setLeadId(start.lead.id)
      updateLead(start.lead)
      setPhase('active')
      say('agent', start.greeting)
      eng.speak(start.greeting_chunks)
    } catch (e) {
      engine.current?.destroy()
      setPhase('idle')
      setError(e.name === 'NotAllowedError' ? 'Microphone permission was blocked. Allow it in the address bar and try again.' : e.message)
    }
  }

  async function handleTurn(send) {
    setAgentState('thinking')
    try {
      const r = await send()
      if (r.empty) return engine.current?.startListening() // only noise or silence
      say('caller', r.user_text)
      say('agent', r.reply)
      setEvents((ev) => [...r.events.map((e) => ({ ...e, id: Math.random() })), ...ev])
      updateLead(r.lead)
      if (r.ended) endedByAgent.current = true
      await engine.current?.speak(r.reply_chunks, { listenAfter: !r.ended })
      if (r.ended) hangUp()
    } catch (e) {
      setError(`Hiccup: ${e.message}. Please say that again.`)
      engine.current?.startListening()
    }
  }

  async function hangUp() {
    if (!callId.current) return
    const id = callId.current
    callId.current = null
    engine.current?.destroy()
    engine.current = null
    setPhase('ending')
    try {
      const r = await api.endCall(id)
      setResult(r)
      updateLead(r.lead)
      memory.addCall({ id, at: r.call.started_at, tier: r.lead.tier, score: r.lead.score, summary: r.call.summary.summary })
      setHistory(memory.history())
    } catch (e) {
      setError(e.message)
    }
    setPhase('ended')
    clearOutbound?.()
  }

  function sendTyped(e) {
    e.preventDefault()
    const text = draft.trim()
    if (!text || !callId.current) return
    setDraft('')
    engine.current?.stopSpeaking()
    handleTurn(() => api.sendText(callId.current, text))
  }

  function toggleMute() {
    setMuted((m) => { engine.current?.setMuted(!m); return !m })
  }

  const active = phase === 'active'
  const isOutbound = Boolean(outboundLead) && phase !== 'ended'
  const speaking = agentState === 'speaking'
  const ringScale = 1 + Math.min(level * 10, 0.3)

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="label">Live demo</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Talk to Priya, HelioNest's sales agent</h1>
          <p className="mt-1.5 max-w-xl text-[15px] text-muted">She answers from company documents, qualifies you, books a free site survey and writes the CRM notes. Speak English or Hindi.</p>
        </div>
        <Settings settings={settings} setSettings={setSettings} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
        {/* ---------------- Phone ---------------- */}
        <div className="mx-auto w-full max-w-[360px]">
          <div className="rounded-[2.9rem] bg-phone p-2.5 shadow-[0_30px_60px_-30px_rgba(17,17,16,0.45)]">
            <div className="relative flex h-[680px] flex-col overflow-hidden rounded-[2.4rem] bg-phone text-white ring-1 ring-white/5">
              <div className="mx-auto mt-3 h-6 w-28 rounded-full bg-black" />

              {/* Caller ID */}
              <div className="flex flex-col items-center px-6 pt-7">
                <div className="relative grid h-24 w-24 place-items-center">
                  {(speaking || phase === 'ringing' || phase === 'incoming') && (
                    <>
                      <span className="absolute inset-0 rounded-full bg-sun/40 animate-ring-pulse" />
                      <span className="absolute inset-0 rounded-full bg-sun/30 animate-ring-pulse [animation-delay:0.6s]" />
                    </>
                  )}
                  {active && !speaking && (
                    <span className="absolute inset-0 rounded-full bg-white/10 transition-transform duration-75" style={{ transform: `scale(${ringScale})` }} />
                  )}
                  <div className={`relative grid h-[84px] w-[84px] place-items-center rounded-full bg-sun ${phase === 'incoming' ? 'animate-wiggle' : ''}`}>
                    <span className="text-[38px] font-semibold leading-none text-ink">P</span>
                  </div>
                </div>
                <h2 className="mt-4 text-[22px] font-semibold tracking-tight">Priya</h2>
                <p className="text-[13px] text-white/50">HelioNest Energy · AI assistant</p>
                <p className="mt-2.5 h-5 font-mono text-[13px] text-sun">
                  {phase === 'idle' && 'ready'}
                  {phase === 'incoming' && `incoming call for ${outboundLead?.name}`}
                  {phase === 'ringing' && 'connecting…'}
                  {active && `${timer} · ${muted ? 'muted' : (STATE_LABEL[agentState] || '').toLowerCase()}`}
                  {phase === 'ending' && 'writing call notes…'}
                  {phase === 'ended' && 'call ended'}
                </p>
              </div>

              {/* Transcript */}
              <div ref={scroller} className="scrollbar-thin mt-5 flex-1 space-y-2 overflow-y-auto px-4 pb-2">
                {transcript.map((m, i) => (
                  <div key={i} className={`flex ${m.role === 'caller' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[85%] rounded-[18px] px-3.5 py-2 text-[14px] leading-snug ${m.role === 'caller' ? 'rounded-br-md bg-sun text-ink' : 'rounded-bl-md bg-phone-2 text-white/90'}`}>
                      {m.text}
                    </div>
                  </div>
                ))}
                {active && (agentState === 'thinking' || agentState === 'processing') && (
                  <div className="flex w-fit gap-1 rounded-[18px] rounded-bl-md bg-phone-2 px-3.5 py-3">
                    {[0, 1, 2].map((i) => <span key={i} className="h-1.5 w-1.5 animate-bounce rounded-full bg-white/50" style={{ animationDelay: `${i * 0.15}s` }} />)}
                  </div>
                )}
                {phase === 'idle' && (
                  <p className="pt-8 text-center text-[13px] leading-relaxed text-white/45">Press call and just start talking.<br />Headphones work best.</p>
                )}
              </div>

              {/* Typing fallback */}
              {active && typing && (
                <form onSubmit={sendTyped} className="mx-4 mb-2 flex gap-2">
                  <input value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus placeholder="Type a message…"
                    className="flex-1 rounded-full bg-phone-2 px-4 py-2.5 text-sm text-white outline-none placeholder:text-white/35 focus:ring-2 focus:ring-sun" />
                  <button aria-label="Send" className="grid h-10 w-10 place-items-center rounded-full bg-sun text-ink"><Send className="h-4 w-4" /></button>
                </form>
              )}

              {/* Controls */}
              <div className="flex items-start justify-center gap-6 px-6 pb-9 pt-3">
                {phase === 'incoming' && (
                  <>
                    <RoundButton color="bg-stop text-white" label="Decline" onClick={() => { clearOutbound?.(); setPhase('idle') }}><PhoneOff /></RoundButton>
                    <RoundButton color="bg-go text-white" label="Accept" onClick={() => startCall('outbound')}><PhoneIncoming /></RoundButton>
                  </>
                )}
                {(phase === 'idle' || phase === 'ended') && !isOutbound && (
                  <RoundButton color="bg-go text-white" big label="Call" onClick={() => startCall('inbound')}><Phone /></RoundButton>
                )}
                {phase === 'ringing' && <RoundButton color="bg-stop text-white" label="Cancel" onClick={() => window.location.reload()}><PhoneOff /></RoundButton>}
                {active && (
                  <>
                    <RoundButton color={muted ? 'bg-white text-ink' : 'bg-phone-2 text-white'} label={muted ? 'Unmute' : 'Mute'} onClick={toggleMute}>
                      {muted ? <MicOff /> : <Mic />}
                    </RoundButton>
                    {settings.turnMode === 'ptt' ? (
                      <RoundButton color={agentState === 'ptt' ? 'bg-go text-white' : 'bg-sun text-ink'} big label="Hold to talk"
                        onPointerDown={() => engine.current?.pttDown()} onPointerUp={() => engine.current?.pttUp()}
                        onPointerLeave={() => engine.current?.pttUp()}><Hand /></RoundButton>
                    ) : (
                      <RoundButton color="bg-stop text-white" big label="End" onClick={hangUp}><PhoneOff /></RoundButton>
                    )}
                    <RoundButton color={typing ? 'bg-white text-ink' : 'bg-phone-2 text-white'} label="Type" onClick={() => setTyping((t) => !t)}><Keyboard /></RoundButton>
                    {settings.turnMode === 'ptt' && <RoundButton color="bg-stop text-white" label="End" onClick={hangUp}><PhoneOff /></RoundButton>}
                  </>
                )}
              </div>
            </div>
          </div>
          {error && <p className="mt-3 rounded-xl border border-stop/20 bg-stop-soft px-3.5 py-2.5 text-sm text-stop-ink">{error}</p>}
        </div>

        {/* ---------------- Live agent console ---------------- */}
        <div className="space-y-5">
          {!active && phase !== 'ending' && !result && (
            <div className="card p-5">
              <h3 className="flex items-center gap-2 font-semibold"><Sparkles className="h-4 w-4 text-sun-ink" /> Things to try saying</h3>
              <div className="mt-3 flex flex-wrap gap-2">
                {SUGGESTIONS.map((s) => <span key={s} className="rounded-full border border-line bg-paper px-3 py-1.5 text-[13px] text-ink-2">{s}</span>)}
              </div>
            </div>
          )}

          {result && <SummaryCard call={result.call} />}

          <div className="grid gap-5 xl:grid-cols-2">
            <LeadCard lead={lead} changed={changed} />
            <div className="card p-5">
              <h3 className="font-semibold">Agent activity</h3>
              <p className="text-[13px] text-muted">Tools Priya used during this call</p>
              <ul className="scrollbar-thin mt-4 max-h-[22rem] space-y-2 overflow-y-auto pr-1">
                {events.length === 0 && <li className="rounded-xl border border-dashed border-line px-3 py-6 text-center text-[13px] text-faint">Tool calls show up here live</li>}
                {events.map((e) => {
                  const Icon = EVENT_ICON[e.type] || Sparkles
                  return (
                    <li key={e.id} className="animate-flash flex gap-3 rounded-xl border border-line p-3 text-sm">
                      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-paper"><Icon className="h-3.5 w-3.5 text-ink" /></span>
                      <div className="min-w-0">
                        <p className="text-ink">{e.label}</p>
                        {Array.isArray(e.detail) && <p className="mt-0.5 text-xs text-muted">{e.detail.join(' · ')}</p>}
                      </div>
                    </li>
                  )
                })}
              </ul>
            </div>
          </div>

          <div className="card p-5">
            <div className="flex items-center justify-between">
              <h3 className="flex items-center gap-2 font-semibold"><History className="h-4 w-4 text-muted" /> Your previous calls</h3>
              <button onClick={() => { memory.forget(); setHistory([]); setLead(null) }}
                className="flex items-center gap-1 rounded-full px-2.5 py-1 text-xs text-muted hover:bg-stop-soft hover:text-stop-ink"><Trash2 className="h-3.5 w-3.5" /> Forget me</button>
            </div>
            <p className="text-[13px] text-muted">Saved in this browser. Call again and Priya will remember you.</p>
            {history.length > 0 && (
              <ul className="mt-3 divide-y divide-line">
                {history.map((h) => (
                  <li key={h.id} className="py-3 text-sm">
                    <span className="font-mono text-xs text-faint">{new Date(h.at).toLocaleString()} · {h.tier} {h.score}</span>
                    <p className="mt-0.5 text-ink-2">{h.summary}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function RoundButton({ children, color, big, label, ...props }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <button aria-label={label} {...props}
        className={`grid select-none place-items-center rounded-full transition hover:brightness-110 active:scale-95 ${color} ${big ? 'h-[68px] w-[68px] [&_svg]:h-7 [&_svg]:w-7' : 'h-[52px] w-[52px] [&_svg]:h-5 [&_svg]:w-5'}`}>
        {children}
      </button>
      <span className="text-[11px] text-white/55">{label}</span>
    </div>
  )
}

function Settings({ settings, setSettings }) {
  const set = (k, v) => setSettings({ ...settings, [k]: v })
  const Segmented = ({ k, label, options }) => (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted">{label}</span>
      <div className="flex rounded-full border border-line bg-card p-0.5">
        {options.map(([v, text]) => (
          <button key={String(v)} onClick={() => set(k, v)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition ${settings[k] === v ? 'bg-ink text-white' : 'text-ink-2 hover:text-ink'}`}>{text}</button>
        ))}
      </div>
    </div>
  )
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
      <Segmented k="turnMode" label="Turn-taking" options={[['auto', 'Auto'], ['ptt', 'Push-to-talk']]} />
      <Segmented k="bargeIn" label="Barge-in" options={[[true, 'On'], [false, 'Off']]} />
      <Segmented k="voice" label="Voice" options={[['groq', 'Groq'], ['browser', 'Browser']]} />
    </div>
  )
}
