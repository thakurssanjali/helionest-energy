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
  hot: 'bg-stop-soft text-stop-ink',
  warm: 'bg-sun-soft text-sun-ink',
  cold: 'bg-sky-soft text-sky-ink',
}
const TIER_DOT = { hot: 'bg-stop', warm: 'bg-sun', cold: 'bg-sky-ink' }

export function TierBadge({ tier = 'cold', score }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium capitalize ${TIER_STYLE[tier] || TIER_STYLE.cold}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${TIER_DOT[tier] || TIER_DOT.cold}`} />
      {tier}{score !== undefined && <span className="font-mono opacity-75">{score}</span>}
    </span>
  )
}

export function SentimentIcon({ value, className = 'h-4 w-4' }) {
  if (value === 'positive') return <Smile className={`${className} text-go`} />
  if (value === 'negative') return <Frown className={`${className} text-stop`} />
  return <Meh className={`${className} text-faint`} />
}

const BANT = [['need', 'Need', 30], ['authority', 'Authority', 20], ['budget', 'Budget', 20], ['timeline', 'Timeline', 20], ['engagement', 'Engagement', 10]]

export function LeadCard({ lead, changed = [] }) {
  return (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">Live CRM record</h3>
          <p className="text-[13px] text-muted">{lead ? <span className="font-mono text-xs">{lead.id} · {lead.source?.replaceAll('_', ' ')}</span> : 'Fills in as Priya learns about the caller'}</p>
        </div>
        {lead && <TierBadge tier={lead.tier} score={lead.score} />}
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        {Object.keys(LABELS).map((k) => (
          <div key={k + (changed.includes(k) ? String(lead?.[k]) : '')} className={`-mx-1.5 rounded-lg px-1.5 ${changed.includes(k) ? 'animate-flash' : ''}`}>
            <dt className="label">{LABELS[k]}</dt>
            <dd className={`mt-0.5 truncate capitalize ${lead?.[k] ? 'text-ink' : 'text-faint'}`}>{pretty(k, lead?.[k])}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-5 border-t border-line pt-4">
        <div className="flex items-baseline justify-between">
          <p className="label">Lead score · BANT</p>
          <p className="font-mono text-sm font-medium">{lead?.score ?? 0}<span className="text-faint">/100</span></p>
        </div>
        <div className="mt-3 space-y-2">
          {BANT.map(([k, label, max]) => {
            const v = lead?.score_breakdown?.[k] || 0
            return (
              <div key={k} className="flex items-center gap-3 text-xs">
                <span className="w-20 text-muted">{label}</span>
                <div className="h-1.5 flex-1 rounded-full bg-paper">
                  <div className="h-1.5 rounded-full bg-ink transition-all duration-700" style={{ width: `${(v / max) * 100}%` }} />
                </div>
                <span className="w-10 text-right font-mono text-muted">{v}/{max}</span>
              </div>
            )
          })}
        </div>
      </div>

      {lead?.booking && (
        <p className="mt-4 flex items-center gap-2 rounded-xl bg-go-soft px-3 py-2.5 text-sm text-go-ink">
          <CalendarCheck className="h-4 w-4" /> Survey booked · {lead.booking.date} at {lead.booking.time}
        </p>
      )}
    </div>
  )
}

export function SummaryCard({ call }) {
  const s = call.summary || {}
  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-sun-soft px-5 py-3">
        <h3 className="font-semibold text-ink">Post-call summary</h3>
        <div className="flex items-center gap-3 text-xs text-ink-2">
          <span className="flex items-center gap-1.5 capitalize"><SentimentIcon value={s.overall_sentiment} /> {s.overall_sentiment} · {s.sentiment_trend}</span>
          <span className="font-mono">{Math.floor(call.duration_s / 60)}m {call.duration_s % 60}s</span>
          <TierBadge tier={call.tier} score={call.score} />
        </div>
      </div>
      <div className="p-5">
        <p className="text-[15px] leading-relaxed text-ink">{s.summary}</p>
        <div className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
          <List title="Customer needs" items={s.customer_needs} />
          <List title="Objections" items={s.objections} />
        </div>
        {s.turn_sentiments?.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-1.5">
            <span className="label mr-1">Sentiment by turn</span>
            {s.turn_sentiments.map((t) => <SentimentIcon key={t.turn} value={t.sentiment} />)}
          </div>
        )}
        <div className="mt-4 flex items-start gap-2 rounded-xl bg-paper px-3.5 py-3 text-sm">
          <ArrowRight className="mt-0.5 h-4 w-4 shrink-0" />
          <span><span className="font-medium capitalize">{s.outcome?.replaceAll('_', ' ')}</span><span className="text-muted"> · next: </span>{s.next_action}</span>
        </div>
      </div>
    </div>
  )
}

function List({ title, items = [] }) {
  return (
    <div>
      <p className="label">{title}</p>
      {items.length ? (
        <ul className="mt-1.5 space-y-1 text-ink-2">{items.map((i) => <li key={i} className="flex gap-2"><span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-faint" />{i}</li>)}</ul>
      ) : <p className="mt-1.5 text-faint">None</p>}
    </div>
  )
}
