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

  if (!data) return <p className="text-muted">{error || 'Loading dashboard…'}</p>
  const { insights, leads, calls, bookings } = data
  const t = insights.totals

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="label">Sales team view</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Dashboard</h1>
          <p className="mt-1.5 text-[15px] text-muted">Every call is qualified, scored and summarised automatically.</p>
        </div>
        <button onClick={load} className="flex items-center gap-2 rounded-full border border-line bg-card px-4 py-2 text-sm font-medium hover:border-ink/30"><RefreshCw className="h-4 w-4" /> Refresh</button>
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
        <section className="card p-5">
          <h3 className="font-semibold">Leads (CRM)</h3>
          <div className="scrollbar-thin mt-3 overflow-x-auto">
            <table className="w-full min-w-[680px] text-left text-sm [&_td]:pr-4 [&_th]:pr-4 [&_th]:font-medium">
              <thead className="label">
                <tr><th className="py-2">Lead</th><th>City</th><th>Bill</th><th>Score</th><th>Status</th><th>Next action</th><th /></tr>
              </thead>
              <tbody className="divide-y divide-line">
                {leads.map((l) => (
                  <tr key={l.id} className="align-top">
                    <td className="py-2.5">
                      <p className="font-medium">{l.name || 'Unknown caller'}</p>
                      <p className="text-xs text-muted">{l.phone || l.id} · {l.source?.replaceAll('_', ' ')}</p>
                    </td>
                    <td className="py-2.5">{l.city || '—'}</td>
                    <td className="whitespace-nowrap py-2.5 font-mono text-[13px]">{l.monthly_bill ? `₹${Number(l.monthly_bill).toLocaleString('en-IN')}` : '—'}</td>
                    <td className="whitespace-nowrap py-2.5"><TierBadge tier={l.tier} score={l.score} /></td>
                    <td className="py-2.5 text-xs text-ink-2">
                      {l.survey_booked ? `Survey ${l.booking?.date} ${l.booking?.time}` : l.callback_requested ? 'Callback requested' : l.call_ids?.length ? `${l.call_ids.length} call(s)` : 'New enquiry'}
                    </td>
                    <td className="max-w-[220px] py-2.5 text-xs text-muted">{l.next_action || l.notes || '—'}</td>
                    <td className="py-2.5 text-right">
                      <button onClick={() => onCallLead(l)} className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-ink px-3 py-1.5 text-xs font-medium text-white hover:bg-ink-2">
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
          <section className="card p-5">
            <h3 className="font-semibold">Insights</h3>
            <Bars title="Call sentiment" data={insights.sentiment} colors={{ positive: 'bg-go', neutral: 'bg-faint', negative: 'bg-stop' }} />
            <Bars title="Call outcomes" data={insights.outcomes} />
            <Bars title="Languages" data={insights.languages} />
            <p className="mt-4 label">Top objections</p>
            {insights.top_objections.length ? (
              <ul className="mt-1 space-y-1 text-sm text-ink-2">{insights.top_objections.map(([o, n]) => <li key={o}>{o} <span className="text-muted">×{n}</span></li>)}</ul>
            ) : <p className="text-sm text-muted">No calls yet.</p>}
          </section>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <section className="card p-5">
          <h3 className="font-semibold">Recent calls</h3>
          {calls.length === 0 && <p className="mt-2 text-sm text-muted">No calls yet. Make one from the Call tab.</p>}
          <ul className="mt-3 space-y-2">
            {calls.map((c) => (
              <li key={c.id} className="rounded-xl border border-line">
                <button onClick={() => setOpen(open === c.id ? null : c.id)} className="flex w-full items-center gap-3 p-3 text-left text-sm">
                  <SentimentIcon value={c.summary.overall_sentiment} />
                  <span className="flex-1">
                    <span className="font-medium">{c.lead_name || 'Unknown caller'}</span>
                    <span className="font-mono text-xs text-muted"> · {c.mode} · {new Date(c.started_at).toLocaleString()} · {Math.round(c.duration_s)}s</span>
                    <span className="block text-muted">{c.summary.summary}</span>
                  </span>
                  <TierBadge tier={c.tier} score={c.score} />
                  <ChevronDown className={`h-4 w-4 transition ${open === c.id ? 'rotate-180' : ''}`} />
                </button>
                {open === c.id && (
                  <div className="space-y-1.5 border-t border-line p-3 text-sm">
                    {c.transcript.map((m, i) => (
                      <p key={i}><span className={m.role === 'agent' ? 'font-medium text-sun-ink' : 'font-medium text-go-ink'}>{m.role === 'agent' ? 'Priya' : 'Caller'}:</span> {m.text}</p>
                    ))}
                    <p className="pt-2 text-xs text-muted">Tools used: {c.events.map((e) => e.label).join(' → ') || 'none'}</p>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>

        <section className="card p-5">
          <h3 className="font-semibold">Site survey bookings</h3>
          {bookings.length === 0 && <p className="mt-2 text-sm text-muted">No bookings yet.</p>}
          <ul className="mt-3 space-y-2 text-sm">
            {bookings.map((b) => (
              <li key={b.id} className="rounded-xl border border-line p-3">
                <p className="font-medium">{b.date} · {b.time}</p>
                <p className="text-muted">{b.name} · {b.phone}</p>
                <p className="text-xs text-muted">{b.address}, {b.city} · {b.id}</p>
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
    <div className={`rounded-2xl border p-4 ${accent ? 'border-sun bg-sun-soft' : 'border-line bg-card'}`}>
      <Icon className={`h-4 w-4 ${accent ? 'text-sun-ink' : 'text-muted'}`} />
      <p className="mt-3 font-mono text-2xl font-medium tracking-tight">{value}</p>
      <p className="text-xs text-muted">{label}</p>
    </div>
  )
}

function Bars({ title, data = {}, colors = {} }) {
  const total = Object.values(data).reduce((a, b) => a + b, 0)
  return (
    <div className="mt-4">
      <p className="label">{title}</p>
      {total === 0 ? <p className="text-sm text-muted">No data yet.</p> : Object.entries(data).map(([k, v]) => (
        <div key={k} className="mt-1.5 flex items-center gap-2 text-xs">
          <span className="w-28 capitalize text-muted">{k.replaceAll('_', ' ')}</span>
          <div className="h-1.5 flex-1 rounded-full bg-paper"><div className={`h-1.5 rounded-full ${colors[k] || 'bg-ink'}`} style={{ width: `${(v / total) * 100}%` }} /></div>
          <span className="w-6 text-right text-muted">{v}</span>
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
    <section className="card p-5">
      <button onClick={() => setShow(!show)} className="flex w-full items-center justify-between font-semibold">
        <span>Simulate a website enquiry</span><Plus className={`h-4 w-4 transition ${show ? 'rotate-45' : ''}`} />
      </button>
      <p className="text-[13px] text-muted">Creates a lead, then Priya calls it back (outbound).</p>
      {show && (
        <form onSubmit={submit} className="mt-3 space-y-2">
          {[['name', 'Your name'], ['phone', 'Phone'], ['city', 'City'], ['monthly_bill', 'Monthly bill (₹)']].map(([k, ph]) => (
            <input key={k} value={form[k]} placeholder={ph} type={k === 'monthly_bill' ? 'number' : 'text'} required={k !== 'monthly_bill'}
              onChange={(e) => setForm({ ...form, [k]: e.target.value })}
              className="w-full rounded-xl border border-line bg-paper px-3.5 py-2.5 text-sm outline-none placeholder:text-faint focus:border-ink" />
          ))}
          <button disabled={busy} className="w-full rounded-full bg-sun py-2.5 text-sm font-semibold text-ink hover:brightness-95 disabled:opacity-50">
            {busy ? 'Creating…' : 'Submit enquiry & get a call'}
          </button>
        </form>
      )}
    </section>
  )
}
