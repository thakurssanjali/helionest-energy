// Browser-side memory (localStorage): who this visitor is, their settings and their past calls.
// Wrapped in try/catch because storage can be blocked (private mode, strict browsers).
const KEY = 'helionest'

function read() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {} } catch { return {} }
}
function write(data) {
  try { localStorage.setItem(KEY, JSON.stringify(data)) } catch { /* ignore */ }
}

export const memory = {
  clientId() {
    const data = read()
    if (!data.clientId) {
      data.clientId = 'web-' + Math.random().toString(36).slice(2, 10)
      write(data)
    }
    return data.clientId
  },
  leadId: () => read().leadId || null,
  setLeadId(id) { write({ ...read(), leadId: id }) },
  settings: () => ({ turnMode: 'auto', bargeIn: true, voice: 'groq', ...(read().settings || {}) }),
  saveSettings(settings) { write({ ...read(), settings }) },
  history: () => read().history || [],
  addCall(entry) { write({ ...read(), history: [entry, ...(read().history || [])].slice(0, 10) }) },
  forget() { const { settings } = read(); write({ settings }) },
}
