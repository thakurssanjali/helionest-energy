// Small fetch helpers for the FastAPI backend.
async function request(path, options = {}) {
  const res = await fetch(path, options)
  if (!res.ok) {
    let detail = res.statusText
    try { detail = (await res.json()).detail || detail } catch { /* not JSON */ }
    throw new Error(`${res.status}: ${detail}`)
  }
  return res.json()
}

const json = (body) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

export const api = {
  health: () => request('/api/health'),
  startCall: (mode, leadId, clientId) => request('/api/call/start', json({ mode, lead_id: leadId, client_id: clientId })),
  sendAudio: (callId, blob, filename) => {
    const form = new FormData()
    form.append('audio', blob, filename)
    return request(`/api/call/${callId}/turn`, { method: 'POST', body: form })
  },
  sendText: (callId, text) => {
    const form = new FormData()
    form.append('text', text)
    return request(`/api/call/${callId}/turn`, { method: 'POST', body: form })
  },
  endCall: (callId) => request(`/api/call/${callId}/end`, { method: 'POST' }),
  leads: () => request('/api/leads'),
  lead: (id) => request(`/api/leads/${id}`),
  createLead: (body) => request('/api/leads', json(body)),
  calls: () => request('/api/calls'),
  bookings: () => request('/api/bookings'),
  insights: () => request('/api/insights'),
}
