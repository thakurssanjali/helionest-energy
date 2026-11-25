import { useEffect, useState } from 'react'
import { Phone, LayoutDashboard, Sun } from 'lucide-react'
import CallView from './components/CallView'
import Dashboard from './components/Dashboard'
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

  return (
    <div className="min-h-screen bg-[radial-gradient(ellipse_at_top,_rgba(245,158,11,0.12),_transparent_55%)]">
      <header className="sticky top-0 z-10 border-b border-slate-800/80 bg-slate-950/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-5 py-3">
          <div className="flex items-center gap-2.5">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-amber-300 to-rose-500"><Sun className="h-5 w-5 text-white" /></div>
            <div>
              <p className="font-semibold leading-tight">HelioNest Energy</p>
              <p className="text-xs text-slate-400">AI Sales Voice Agent</p>
            </div>
          </div>
          <nav className="ml-auto flex rounded-xl bg-slate-900 p-1">
            {[['call', 'Call', Phone], ['dashboard', 'Dashboard', LayoutDashboard]].map(([key, label, Icon]) => (
              <button key={key} onClick={() => setTab(key)}
                className={`flex items-center gap-2 rounded-lg px-4 py-1.5 text-sm ${tab === key ? 'bg-amber-500 font-medium text-slate-950' : 'text-slate-300 hover:text-white'}`}>
                <Icon className="h-4 w-4" /> {label}
              </button>
            ))}
          </nav>
          {health && (
            <span title={JSON.stringify(health)} className={`hidden items-center gap-1.5 text-xs md:flex ${health.ok && health.groq_key_set ? 'text-emerald-400' : 'text-rose-400'}`}>
              <span className="h-2 w-2 rounded-full bg-current" />
              {health.ok ? (health.groq_key_set ? `Online · ${health.storage} · RAG ${health.rag}` : 'GROQ_API_KEY missing') : 'Backend offline'}
            </span>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-5 py-6">
        {/* CallView stays mounted so a live call is not cut off when switching tabs */}
        <div className={tab === 'call' ? '' : 'hidden'}>
          <CallView outboundLead={outboundLead} clearOutbound={() => setOutboundLead(null)} />
        </div>
        {tab === 'dashboard' && <Dashboard onCallLead={callLead} />}
      </main>

      <footer className="pb-6 text-center text-xs text-slate-600">
        Demo project · HelioNest Energy is a fictional company · Speech: Groq Whisper · Brain: GPT-OSS-120B on Groq · Voice: Groq Orpheus / browser
      </footer>
    </div>
  )
}
