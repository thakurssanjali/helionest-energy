import { useEffect, useRef, useState } from 'react'
import {
  Phone, PhoneOff, PhoneIncoming, Mic, MicOff, Keyboard, Send, Search, Database, CalendarCheck,
  CalendarDays, Headset, AlertTriangle, Sparkles, History, Trash2, Sun, Hand,
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
  const ringScale = 1 + Math.min(level * 12, 0.35)

  return (
    <div className="grid gap-6 lg:grid-cols-[400px_1fr] xl:grid-cols-[420px_1fr]">
      {/* ---------------- Phone ---------------- */}
      <div className="mx-auto w-full max-w-[400px]">
        <div className="relative flex h-[720px] flex-col overflow-hidden rounded-[3rem] border-[10px] border-slate-800 bg-gradient-to-b from-slate-900 to-slate-950 shadow-2xl shadow-amber-500/10">
          <div className="mx-auto mt-2 h-6 w-32 rounded-full bg-slate-800" />

          {/* Caller ID */}
          <div className="flex flex-col items-center px-6 pt-6">
            <div className="relative grid h-28 w-28 place-items-center">
              {(speaking || phase === 'ringing' || phase === 'incoming') && (
                <>
                  <span className="absolute inset-0 rounded-full bg-amber-400/40 animate-ring-pulse" />
                  <span className="absolute inset-0 rounded-full bg-amber-400/30 animate-ring-pulse [animation-delay:0.6s]" />
                </>
              )}
              {active && !speaking && (
                <span className="absolute inset-0 rounded-full bg-emerald-400/25 transition-transform duration-75"
                  style={{ transform: `scale(${ringScale})` }} />
              )}
              <div className={`relative grid h-24 w-24 place-items-center rounded-full bg-gradient-to-br from-amber-300 via-orange-400 to-rose-500 shadow-lg ${phase === 'incoming' ? 'animate-wiggle' : ''}`}>
                <Sun className="h-12 w-12 text-white" strokeWidth={1.6} />
              </div>
            </div>
            <h2 className="mt-4 text-2xl font-semibold">Priya</h2>
            <p className="text-sm text-slate-400">HelioNest Energy · AI sales assistant</p>
            <p className="mt-2 h-5 text-sm font-medium text-amber-300">
              {phase === 'idle' && 'Ready to call'}
              {phase === 'incoming' && `Incoming call for ${outboundLead?.name}…`}
              {phase === 'ringing' && 'Connecting…'}
              {active && `${timer} · ${muted ? 'Muted' : STATE_LABEL[agentState] || ''}`}
              {phase === 'ending' && 'Wrapping up the call…'}
              {phase === 'ended' && 'Call ended'}
            </p>
          </div>

          {/* Transcript */}
          <div ref={scroller} className="scrollbar-thin mt-4 flex-1 space-y-2 overflow-y-auto px-4 pb-2">
            {transcript.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'caller' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-snug ${m.role === 'caller' ? 'rounded-br-sm bg-emerald-600 text-white' : 'rounded-bl-sm bg-slate-800 text-slate-100'}`}>
                  {m.text}
                </div>
              </div>
            ))}
            {active && (agentState === 'thinking' || agentState === 'processing') && (
              <div className="flex gap-1 px-2 py-1">
                {[0, 1, 2].map((i) => <span key={i} className="h-2 w-2 animate-bounce rounded-full bg-slate-500" style={{ animationDelay: `${i * 0.15}s` }} />)}
              </div>
            )}
            {phase === 'idle' && (
              <div className="space-y-2 pt-6 text-center text-sm text-slate-400">
                <p>Tap the green button and just talk, in English or Hindi.</p>
                <p className="text-xs text-slate-500">Tip: headphones give the best experience.</p>
              </div>
            )}
          </div>

          {/* Typing fallback */}
          {active && typing && (
            <form onSubmit={sendTyped} className="mx-4 mb-2 flex gap-2">
              <input value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus placeholder="Type instead of speaking…"
                className="flex-1 rounded-full bg-slate-800 px-4 py-2 text-sm outline-none ring-amber-400 focus:ring-2" />
              <button className="grid h-9 w-9 place-items-center rounded-full bg-amber-500 text-slate-950"><Send className="h-4 w-4" /></button>
            </form>
          )}

          {/* Controls */}
          <div className="flex items-center justify-center gap-5 px-6 pb-8 pt-3">
            {phase === 'incoming' && (
              <>
                <RoundButton color="bg-rose-600" label="Decline" onClick={() => { clearOutbound?.(); setPhase('idle') }}><PhoneOff /></RoundButton>
                <RoundButton color="bg-emerald-500 animate-pulse" label="Accept" onClick={() => startCall('outbound')}><PhoneIncoming /></RoundButton>
              </>
            )}
            {(phase === 'idle' || phase === 'ended') && !isOutbound && (
              <RoundButton color="bg-emerald-500" big label="Call HelioNest" onClick={() => startCall('inbound')}><Phone /></RoundButton>
            )}
            {phase === 'ringing' && <RoundButton color="bg-rose-600" label="Cancel" onClick={() => window.location.reload()}><PhoneOff /></RoundButton>}
            {active && (
              <>
                <RoundButton color={muted ? 'bg-amber-500 text-slate-950' : 'bg-slate-700'} label={muted ? 'Unmute' : 'Mute'} onClick={toggleMute}>
                  {muted ? <MicOff /> : <Mic />}
                </RoundButton>
                {settings.turnMode === 'ptt' ? (
                  <RoundButton color={agentState === 'ptt' ? 'bg-emerald-500' : 'bg-sky-600'} big label="Hold to talk"
                    onPointerDown={() => engine.current?.pttDown()} onPointerUp={() => engine.current?.pttUp()}
                    onPointerLeave={() => engine.current?.pttUp()}><Hand /></RoundButton>
                ) : (
                  <RoundButton color="bg-rose-600" big label="End call" onClick={hangUp}><PhoneOff /></RoundButton>
                )}
                <RoundButton color={typing ? 'bg-amber-500 text-slate-950' : 'bg-slate-700'} label="Type" onClick={() => setTyping((t) => !t)}><Keyboard /></RoundButton>
                {settings.turnMode === 'ptt' && <RoundButton color="bg-rose-600" label="End" onClick={hangUp}><PhoneOff /></RoundButton>}
              </>
            )}
          </div>
        </div>
        {error && <p className="mt-3 rounded-lg bg-rose-500/15 px-3 py-2 text-sm text-rose-300">{error}</p>}
      </div>

      {/* ---------------- Live agent console ---------------- */}
      <div className="space-y-5">
        <Settings settings={settings} setSettings={setSettings} />

        {!active && phase !== 'ending' && !result && (
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
            <h3 className="flex items-center gap-2 font-semibold"><Sparkles className="h-4 w-4 text-amber-400" /> Things to try saying</h3>
            <div className="mt-3 flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => <span key={s} className="rounded-full bg-slate-800 px-3 py-1.5 text-sm text-slate-300">{s}</span>)}
            </div>
          </div>
        )}

        {result && <SummaryCard call={result.call} />}

        <div className="grid gap-5 xl:grid-cols-2">
          <LeadCard lead={lead} changed={changed} />
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
            <h3 className="font-semibold">Agent activity</h3>
            <p className="text-xs text-slate-500">Tools the AI agent called during this call</p>
            <ul className="scrollbar-thin mt-3 max-h-80 space-y-2 overflow-y-auto">
              {events.length === 0 && <li className="text-sm text-slate-500">Nothing yet.</li>}
              {events.map((e) => {
                const Icon = EVENT_ICON[e.type] || Sparkles
                return (
                  <li key={e.id} className="animate-flash flex gap-3 rounded-lg border border-slate-800 p-2.5 text-sm">
                    <Icon className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                    <div>
                      <p>{e.label}</p>
                      {Array.isArray(e.detail) && <p className="text-xs text-slate-500">{e.detail.join(' · ')}</p>}
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-2 font-semibold"><History className="h-4 w-4 text-amber-400" /> Your previous calls (saved in this browser)</h3>
            <button onClick={() => { memory.forget(); setHistory([]); setLead(null) }}
              className="flex items-center gap-1 text-xs text-slate-400 hover:text-rose-300"><Trash2 className="h-3.5 w-3.5" /> Forget me</button>
          </div>
          {history.length === 0 ? <p className="mt-2 text-sm text-slate-500">No calls yet. Call twice to see Priya remember you.</p> : (
            <ul className="mt-3 space-y-2">
              {history.map((h) => (
                <li key={h.id} className="rounded-lg bg-slate-800/60 p-3 text-sm">
                  <span className="text-xs text-slate-400">{new Date(h.at).toLocaleString()} · {h.tier} ({h.score})</span>
                  <p className="text-slate-300">{h.summary}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

function RoundButton({ children, color, big, label, ...props }) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <button aria-label={label} {...props}
        className={`grid select-none place-items-center rounded-full text-white shadow-lg transition active:scale-95 ${color} ${big ? 'h-16 w-16 [&_svg]:h-7 [&_svg]:w-7' : 'h-12 w-12 [&_svg]:h-5 [&_svg]:w-5'}`}>
        {children}
      </button>
      <span className="text-[11px] text-slate-400">{label}</span>
    </div>
  )
}

function Settings({ settings, setSettings }) {
  const set = (k, v) => setSettings({ ...settings, [k]: v })
  const Toggle = ({ k, options }) => (
    <div className="flex rounded-lg bg-slate-800 p-0.5">
      {options.map(([v, label]) => (
        <button key={v} onClick={() => set(k, v)}
          className={`rounded-md px-2.5 py-1 text-xs ${settings[k] === v ? 'bg-amber-500 font-medium text-slate-950' : 'text-slate-300'}`}>{label}</button>
      ))}
    </div>
  )
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-2xl border border-slate-800 bg-slate-900/60 px-5 py-3 text-sm">
      <label className="flex items-center gap-2 text-slate-400">Turn-taking <Toggle k="turnMode" options={[['auto', 'Auto (VAD)'], ['ptt', 'Push-to-talk']]} /></label>
      <label className="flex items-center gap-2 text-slate-400">Barge-in <Toggle k="bargeIn" options={[[true, 'On'], [false, 'Off']]} /></label>
      <label className="flex items-center gap-2 text-slate-400">Voice <Toggle k="voice" options={[['groq', 'Groq Orpheus'], ['browser', 'Browser']]} /></label>
    </div>
  )
}
