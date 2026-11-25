import { CalendarCheck, Smile, Meh, Frown, ArrowRight } from 'lucide-react'

const LABELS = {
  name: 'Name', phone: 'Phone', city: 'City', state: 'State', customer_type: 'Type', monthly_bill: 'Monthly bill',
  owner_or_decision_maker: 'Decision maker', interest: 'Interest', payment_preference: 'Payment',
  timeline: 'Timeline', roof_type: 'Roof', roof_area_sqft: 'Roof area',
}
const pretty = (k, v) => {
  if (v === undefined || v === null || v === '') return '—'
  if (k === 'monthly_bill') return `₹${Number(v).toLocaleString('en-IN')}`
  if (k === 'roof_area_sqft') return `${v} sq ft`
  return String(v).replaceAll('_', ' ')
}

const TIER_STYLE = {
  hot: 'bg-rose-500/20 text-rose-300 ring-rose-500/40',
  warm: 'bg-amber-500/20 text-amber-300 ring-amber-500/40',
  cold: 'bg-sky-500/20 text-sky-300 ring-sky-500/40',
}

export function TierBadge({ tier, score }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase ring-1 ${TIER_STYLE[tier] || TIER_STYLE.cold}`}>
      {tier || 'cold'}{score !== undefined && <span className="font-normal opacity-80">· {score}</span>}
    </span>
  )
}

export function SentimentIcon({ value, className = 'h-4 w-4' }) {
  if (value === 'positive') return <Smile className={`${className} text-emerald-400`} />
  if (value === 'negative') return <Frown className={`${className} text-rose-400`} />
  return <Meh className={`${className} text-slate-400`} />
}

const BANT = [['need', 'Need', 30], ['authority', 'Authority', 20], ['budget', 'Budget', 20], ['timeline', 'Timeline', 20], ['engagement', 'Engagement', 10]]

export function LeadCard({ lead, changed = [] }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold">Live CRM record</h3>
          <p className="text-xs text-slate-500">{lead ? `${lead.id} · source: ${lead.source?.replaceAll('_', ' ')}` : 'Fills in as Priya learns about the caller'}</p>
        </div>
        {lead && <TierBadge tier={lead.tier} score={lead.score} />}
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
        {Object.keys(LABELS).map((k) => (
          <div key={k + (changed.includes(k) ? String(lead?.[k]) : '')} className={`rounded px-1 ${changed.includes(k) ? 'animate-flash' : ''}`}>
            <dt className="text-[11px] uppercase tracking-wide text-slate-500">{LABELS[k]}</dt>
            <dd className="truncate capitalize text-slate-200">{pretty(k, lead?.[k])}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-4 space-y-1.5">
        <p className="text-[11px] uppercase tracking-wide text-slate-500">Lead score (BANT)</p>
        {BANT.map(([k, label, max]) => {
          const v = lead?.score_breakdown?.[k] || 0
          return (
            <div key={k} className="flex items-center gap-2 text-xs">
              <span className="w-20 text-slate-400">{label}</span>
              <div className="h-1.5 flex-1 rounded-full bg-slate-800">
                <div className="h-1.5 rounded-full bg-gradient-to-r from-amber-400 to-rose-500 transition-all duration-700" style={{ width: `${(v / max) * 100}%` }} />
              </div>
              <span className="w-10 text-right text-slate-400">{v}/{max}</span>
            </div>
          )
        })}
      </div>

      {lead?.booking && (
        <p className="mt-4 flex items-center gap-2 rounded-lg bg-emerald-500/15 px-3 py-2 text-sm text-emerald-300">
          <CalendarCheck className="h-4 w-4" /> Survey {lead.booking.id}: {lead.booking.date} at {lead.booking.time}
        </p>
      )}
    </div>
  )
}

export function SummaryCard({ call }) {
  const s = call.summary || {}
  return (
    <div className="rounded-2xl border border-amber-500/30 bg-gradient-to-br from-amber-500/10 to-slate-900/60 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">Post-call summary</h3>
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <SentimentIcon value={s.overall_sentiment} /> {s.overall_sentiment} ({s.sentiment_trend})
          <span>· {Math.round(call.duration_s / 60 * 10) / 10} min</span>
          <TierBadge tier={call.tier} score={call.score} />
        </div>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-slate-200">{s.summary}</p>
      <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
        <List title="Customer needs" items={s.customer_needs} />
        <List title="Objections" items={s.objections} />
      </div>
      {s.turn_sentiments?.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-slate-400">
          Sentiment by turn:
          {s.turn_sentiments.map((t) => <SentimentIcon key={t.turn} value={t.sentiment} />)}
        </div>
      )}
      <p className="mt-3 flex items-center gap-2 rounded-lg bg-slate-800/70 px-3 py-2 text-sm">
        <ArrowRight className="h-4 w-4 text-amber-400" />
        <span><span className="text-slate-400">Outcome:</span> {s.outcome?.replaceAll('_', ' ')} · <span className="text-slate-400">Next:</span> {s.next_action}</span>
      </p>
    </div>
  )
}

function List({ title, items = [] }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-slate-500">{title}</p>
      {items.length ? <ul className="list-inside list-disc text-slate-300">{items.map((i) => <li key={i}>{i}</li>)}</ul> : <p className="text-slate-500">None</p>}
    </div>
  )
}
