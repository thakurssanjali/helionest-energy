import { useEffect, useState } from 'react'
import { PhoneCall, RefreshCw, Users, Flame, CalendarCheck, Percent, Timer, PhoneOutgoing, Plus, ChevronDown } from 'lucide-react'
import { api } from '../lib/api'
import { TierBadge, SentimentIcon } from './LeadPanels'

export default function Dashboard({ onCallLead }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(null)

  async function load() {
    try {
      const [insights, leads, calls, bookings] = await Promise.all([api.insights(), api.leads(), api.calls(), api.bookings()])
      setData({ insights, leads, calls, bookings })
      setError('')
    } catch (e) { setError(e.message) }
  }
  useEffect(() => { load() }, [])

  if (!data) return <p className="text-slate-400">{error || 'Loading dashboard…'}</p>
  const { insights, leads, calls, bookings } = data
  const t = insights.totals

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Sales dashboard</h2>
          <p className="text-sm text-slate-400">Every call is qualified, scored and summarised automatically.</p>
        </div>
        <button onClick={load} className="flex items-center gap-2 rounded-lg bg-slate-800 px-3 py-2 text-sm hover:bg-slate-700"><RefreshCw className="h-4 w-4" /> Refresh</button>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi icon={PhoneCall} label="Calls handled" value={t.calls} />
        <Kpi icon={Users} label="Leads" value={t.leads} />
        <Kpi icon={Flame} label="Hot leads" value={t.hot} accent />
        <Kpi icon={CalendarCheck} label="Surveys booked" value={t.bookings} />
        <Kpi icon={Percent} label="Call → booking" value={`${t.conversion_rate}%`} />
        <Kpi icon={Timer} label="Avg call" value={`${Math.floor(t.avg_call_seconds / 60)}m ${t.avg_call_seconds % 60}s`} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
          <h3 className="font-semibold">Leads (CRM)</h3>
          <div className="scrollbar-thin mt-3 overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="text-[11px] uppercase tracking-wide text-slate-500">
                <tr><th className="py-2">Lead</th><th>City</th><th>Bill</th><th>Score</th><th>Status</th><th>Next action</th><th /></tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {leads.map((l) => (
                  <tr key={l.id} className="align-top">
                    <td className="py-2.5">
                      <p className="font-medium">{l.name || 'Unknown caller'}</p>
                      <p className="text-xs text-slate-500">{l.phone || l.id} · {l.source?.replaceAll('_', ' ')}</p>
                    </td>
                    <td className="py-2.5">{l.city || '—'}</td>
                    <td className="py-2.5">{l.monthly_bill ? `₹${Number(l.monthly_bill).toLocaleString('en-IN')}` : '—'}</td>
                    <td className="py-2.5"><TierBadge tier={l.tier} score={l.score} /></td>
                    <td className="py-2.5 text-xs text-slate-300">
                      {l.survey_booked ? `Survey ${l.booking?.date} ${l.booking?.time}` : l.callback_requested ? 'Callback requested' : l.call_ids?.length ? `${l.call_ids.length} call(s)` : 'New enquiry'}
                    </td>
                    <td className="max-w-[220px] py-2.5 text-xs text-slate-400">{l.next_action || l.notes || '—'}</td>
                    <td className="py-2.5 text-right">
                      <button onClick={() => onCallLead(l)} className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-medium hover:bg-emerald-500">
                        <PhoneOutgoing className="h-3.5 w-3.5" /> AI call
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <div className="space-y-6">
          <NewEnquiry onCreated={(lead) => { load(); onCallLead(lead) }} />
          <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
            <h3 className="font-semibold">Insights</h3>
            <Bars title="Call sentiment" data={insights.sentiment} colors={{ positive: 'bg-emerald-500', neutral: 'bg-slate-500', negative: 'bg-rose-500' }} />
            <Bars title="Call outcomes" data={insights.outcomes} />
            <Bars title="Languages" data={insights.languages} />
            <p className="mt-4 text-[11px] uppercase tracking-wide text-slate-500">Top objections</p>
            {insights.top_objections.length ? (
              <ul className="mt-1 space-y-1 text-sm text-slate-300">{insights.top_objections.map(([o, n]) => <li key={o}>{o} <span className="text-slate-500">×{n}</span></li>)}</ul>
            ) : <p className="text-sm text-slate-500">No calls yet.</p>}
          </section>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
          <h3 className="font-semibold">Recent calls</h3>
          {calls.length === 0 && <p className="mt-2 text-sm text-slate-500">No calls yet. Make one from the Call tab.</p>}
          <ul className="mt-3 space-y-2">
            {calls.map((c) => (
              <li key={c.id} className="rounded-xl border border-slate-800">
                <button onClick={() => setOpen(open === c.id ? null : c.id)} className="flex w-full items-center gap-3 p-3 text-left text-sm">
                  <SentimentIcon value={c.summary.overall_sentiment} />
                  <span className="flex-1">
                    <span className="font-medium">{c.lead_name || 'Unknown caller'}</span>
                    <span className="text-slate-500"> · {c.mode} · {new Date(c.started_at).toLocaleString()} · {Math.round(c.duration_s)}s</span>
                    <span className="block text-slate-400">{c.summary.summary}</span>
                  </span>
                  <TierBadge tier={c.tier} score={c.score} />
                  <ChevronDown className={`h-4 w-4 transition ${open === c.id ? 'rotate-180' : ''}`} />
                </button>
                {open === c.id && (
                  <div className="space-y-1.5 border-t border-slate-800 p-3 text-sm">
                    {c.transcript.map((m, i) => (
                      <p key={i}><span className={m.role === 'agent' ? 'text-amber-300' : 'text-emerald-300'}>{m.role === 'agent' ? 'Priya' : 'Caller'}:</span> {m.text}</p>
                    ))}
                    <p className="pt-2 text-xs text-slate-500">Tools used: {c.events.map((e) => e.label).join(' → ') || 'none'}</p>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
          <h3 className="font-semibold">Site survey bookings</h3>
          {bookings.length === 0 && <p className="mt-2 text-sm text-slate-500">No bookings yet.</p>}
          <ul className="mt-3 space-y-2 text-sm">
            {bookings.map((b) => (
              <li key={b.id} className="rounded-lg bg-slate-800/60 p-3">
                <p className="font-medium">{b.date} · {b.time}</p>
                <p className="text-slate-400">{b.name} · {b.phone}</p>
                <p className="text-xs text-slate-500">{b.address}, {b.city} · {b.id}</p>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  )
}

function Kpi({ icon: Icon, label, value, accent }) {
  return (
    <div className={`rounded-2xl border p-4 ${accent ? 'border-rose-500/30 bg-rose-500/10' : 'border-slate-800 bg-slate-900/60'}`}>
      <Icon className={`h-4 w-4 ${accent ? 'text-rose-300' : 'text-amber-400'}`} />
      <p className="mt-2 text-2xl font-semibold">{value}</p>
      <p className="text-xs text-slate-400">{label}</p>
    </div>
  )
}

function Bars({ title, data = {}, colors = {} }) {
  const total = Object.values(data).reduce((a, b) => a + b, 0)
  return (
    <div className="mt-4">
      <p className="text-[11px] uppercase tracking-wide text-slate-500">{title}</p>
      {total === 0 ? <p className="text-sm text-slate-500">No data yet.</p> : Object.entries(data).map(([k, v]) => (
        <div key={k} className="mt-1.5 flex items-center gap-2 text-xs">
          <span className="w-28 capitalize text-slate-400">{k.replaceAll('_', ' ')}</span>
          <div className="h-2 flex-1 rounded-full bg-slate-800"><div className={`h-2 rounded-full ${colors[k] || 'bg-amber-500'}`} style={{ width: `${(v / total) * 100}%` }} /></div>
          <span className="w-6 text-right text-slate-400">{v}</span>
        </div>
      ))}
    </div>
  )
}

function NewEnquiry({ onCreated }) {
  const [form, setForm] = useState({ name: '', phone: '', city: '', monthly_bill: '' })
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  async function submit(e) {
    e.preventDefault()
    if (!form.name || !form.phone || !form.city) return
    setBusy(true)
    try {
      const lead = await api.createLead({ ...form, monthly_bill: form.monthly_bill ? Number(form.monthly_bill) : null })
      setForm({ name: '', phone: '', city: '', monthly_bill: '' })
      onCreated(lead)
    } finally { setBusy(false) }
  }
  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
      <button onClick={() => setShow(!show)} className="flex w-full items-center justify-between font-semibold">
        <span>Simulate a website enquiry</span><Plus className={`h-4 w-4 transition ${show ? 'rotate-45' : ''}`} />
      </button>
      <p className="text-xs text-slate-500">Creates a lead, then Priya calls it back (outbound).</p>
      {show && (
        <form onSubmit={submit} className="mt-3 space-y-2">
          {[['name', 'Your name'], ['phone', 'Phone'], ['city', 'City'], ['monthly_bill', 'Monthly bill (₹)']].map(([k, ph]) => (
            <input key={k} value={form[k]} placeholder={ph} type={k === 'monthly_bill' ? 'number' : 'text'} required={k !== 'monthly_bill'}
              onChange={(e) => setForm({ ...form, [k]: e.target.value })}
              className="w-full rounded-lg bg-slate-800 px-3 py-2 text-sm outline-none ring-amber-400 focus:ring-2" />
          ))}
          <button disabled={busy} className="w-full rounded-lg bg-amber-500 py-2 text-sm font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-50">
            {busy ? 'Creating…' : 'Submit enquiry & get a call'}
          </button>
        </form>
      )}
    </section>
  )
}
