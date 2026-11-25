import { useEffect, useState } from 'react'
import { Phone, LayoutGrid } from 'lucide-react'
import CallView from './components/CallView'
import Dashboard from './components/Dashboard'
import Logo from './components/Logo'
import { api } from './lib/api'

export default function App() {
  const [tab, setTab] = useState('call')
  const [outboundLead, setOutboundLead] = useState(null)
  const [health, setHealth] = useState(null)

  useEffect(() => { api.health().then(setHealth).catch(() => setHealth({ ok: false })) }, [])

  function callLead(lead) {
    setOutboundLead(lead)
    setTab('call')
  }

  const online = health?.ok && health?.groq_key_set
  const status = !health ? 'Connecting' : !health.ok ? 'Backend offline' : !health.groq_key_set ? 'API key missing' : 'Live'

  return (
    <div className="min-h-screen">
      {/* Floating pill navbar */}
      <header className="sticky top-4 z-20 px-4">
        <nav className="mx-auto flex max-w-3xl items-center gap-2 rounded-full border border-line bg-card/90 p-1.5 pl-2 shadow-[0_1px_2px_rgba(17,17,16,0.04),0_8px_24px_-12px_rgba(17,17,16,0.12)] backdrop-blur">
          <div className="flex items-center gap-2.5 pr-2">
            <Logo size={32} />
            <div className="leading-tight">
              <p className="text-[15px] font-semibold tracking-tight">HelioNest</p>
              <p className="text-[11px] text-muted">Sales voice agent</p>
            </div>
          </div>

          <div className="mx-auto flex rounded-full bg-paper p-1">
            {[['call', 'Call', Phone], ['dashboard', 'Dashboard', LayoutGrid]].map(([key, label, Icon]) => (
              <button key={key} onClick={() => setTab(key)}
                className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-medium transition ${tab === key ? 'bg-ink text-white' : 'text-ink-2 hover:text-ink'}`}>
                <Icon className="h-4 w-4" strokeWidth={2} /> {label}
              </button>
            ))}
          </div>

          <span title={health ? `storage: ${health.storage} · RAG: ${health.rag} · LLM: ${health.llm}` : ''}
            className={`hidden items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium sm:flex ${online ? 'bg-go-soft text-go-ink' : 'bg-stop-soft text-stop-ink'}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${online ? 'bg-go' : 'bg-stop'}`} />
            {status}
          </span>
        </nav>
      </header>

      <main className="mx-auto max-w-6xl px-5 pb-10 pt-10">
        {/* CallView stays mounted so a live call is not cut off when switching tabs */}
        <div className={tab === 'call' ? '' : 'hidden'}>
          <CallView outboundLead={outboundLead} clearOutbound={() => setOutboundLead(null)} />
        </div>
        {tab === 'dashboard' && <Dashboard onCallLead={callLead} />}
      </main>

      <footer className="pb-8 text-center text-xs text-faint">
        HelioNest Energy is a fictional company built for this demo · Groq Whisper · GPT-OSS-120B · Orpheus
      </footer>
    </div>
  )
}
