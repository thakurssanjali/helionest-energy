// VoiceEngine: microphone, turn-taking (VAD), barge-in, and speaking replies.
//
// Turn-taking (auto mode):
//   listening -> caller's voice energy goes above the threshold -> recording an utterance
//   -> ~1 second of silence -> stop, send the audio to the backend (onUtterance)
// Barge-in: while Priya is speaking, if the caller talks loudly enough for ~300 ms,
//   her audio stops and we start listening again.
// Push-to-talk mode: VAD is off; recording happens only while the button is held.
//
// Speaking: English sentences use Groq Orpheus TTS (/api/tts). Hindi (Devanagari) sentences,
// or any TTS failure, use the browser's free built-in speechSynthesis voice.

const TICK_MS = 50
const SILENCE_MS = 1000 // pause that ends the caller's turn
const MIN_SPEECH_MS = 250 // ignore clicks/coughs shorter than this
const MAX_UTTERANCE_MS = 30000
const BARGE_MS = 300

function pickMime() {
  const options = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg']
  return options.find((m) => window.MediaRecorder?.isTypeSupported?.(m)) || ''
}

function extFor(mime) {
  if (mime.includes('mp4')) return 'mp4'
  if (mime.includes('ogg')) return 'ogg'
  return 'webm'
}

const DEVANAGARI = /[ऀ-ॿ]/

function browserVoice(lang) {
  const voices = window.speechSynthesis?.getVoices() || []
  const prefix = lang === 'hi' ? 'hi' : 'en-IN'
  return (
    voices.find((v) => v.lang.startsWith(prefix) && /google|female|heera|swara|neerja/i.test(v.name)) ||
    voices.find((v) => v.lang.startsWith(prefix)) ||
    (lang === 'hi' ? null : voices.find((v) => v.lang.startsWith('en')))
  )
}

export class VoiceEngine {
  constructor({ onState, onUtterance, onLevel, settings }) {
    this.onState = onState
    this.onUtterance = onUtterance
    this.onLevel = onLevel
    this.settings = settings
    this.mode = 'idle' // idle | listening | recording | processing | speaking | ptt
    this.muted = false
    this.groqTtsFailures = 0
    this.speakToken = 0
  }

  async init() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    })
    this.ctx = new (window.AudioContext || window.webkitAudioContext)()
    await this.ctx.resume()
    const source = this.ctx.createMediaStreamSource(this.stream)
    this.analyser = this.ctx.createAnalyser()
    this.analyser.fftSize = 1024
    source.connect(this.analyser)
    this.buffer = new Float32Array(this.analyser.fftSize)
    this.mime = pickMime()
    window.speechSynthesis?.getVoices() // warm up the voice list

    // Calibrate to the room's background noise for half a second.
    const samples = []
    await new Promise((resolve) => {
      const t = setInterval(() => {
        samples.push(this.rms())
        if (samples.length >= 10) { clearInterval(t); resolve() }
      }, TICK_MS)
    })
    const floor = samples.reduce((a, b) => a + b, 0) / samples.length
    this.threshold = Math.min(Math.max(0.012, floor * 3), 0.08)
    this.timer = setInterval(() => this.tick(), TICK_MS)
  }

  rms() {
    this.analyser.getFloatTimeDomainData(this.buffer)
    let sum = 0
    for (const v of this.buffer) sum += v * v
    return Math.sqrt(sum / this.buffer.length)
  }

  setState(mode) {
    this.mode = mode
    this.onState?.(mode)
  }

  updateSettings(settings) {
    this.settings = settings
    if (settings.turnMode === 'ptt' && (this.mode === 'listening' || this.mode === 'recording')) {
      this.discardRecording()
      this.setState('idle')
    } else if (settings.turnMode === 'auto' && this.mode === 'idle') {
      this.startListening()
    }
  }

  setMuted(muted) {
    this.muted = muted
    if (muted && (this.mode === 'listening' || this.mode === 'recording')) this.startListening() // restart = discard partial audio
  }

  // ---------------- main loop ----------------
  tick() {
    const level = this.rms()
    this.onLevel?.(this.muted ? 0 : level)
    if (this.muted) return
    const now = performance.now()
    const loud = level > this.threshold

    if (this.mode === 'listening' || this.mode === 'recording') {
      if (loud) {
        this.voiceMs += TICK_MS
        this.lastVoiceAt = now
        if (this.voiceMs >= MIN_SPEECH_MS && this.mode === 'listening') this.setState('recording')
      }
      if (this.mode === 'recording') {
        const silentFor = now - this.lastVoiceAt
        if (silentFor > SILENCE_MS || now - this.recordStartedAt > MAX_UTTERANCE_MS) this.finishUtterance()
      } else if (now - this.recordStartedAt > 15000) {
        this.startListening() // nothing said for a while: restart so the recording stays small
      }
    } else if (this.mode === 'speaking' && this.settings.bargeIn && this.settings.turnMode === 'auto') {
      // Barge-in needs a clearly louder voice than normal, so speaker echo does not trigger it.
      this.bargeMs = level > this.threshold * 2.5 ? (this.bargeMs || 0) + TICK_MS : 0
      if (this.bargeMs >= BARGE_MS) {
        this.bargeMs = 0
        this.stopSpeaking()
        this.startListening()
        this.voiceMs = MIN_SPEECH_MS
        this.lastVoiceAt = now
        this.setState('recording')
      }
    }
  }

  // ---------------- recording ----------------
  startRecorder() {
    this.discardRecording()
    this.chunks = []
    this.recorder = new MediaRecorder(this.stream, this.mime ? { mimeType: this.mime } : undefined)
    this.recorder.ondataavailable = (e) => e.data.size && this.chunks.push(e.data)
    this.recorder.start()
    this.recordStartedAt = performance.now()
    this.voiceMs = 0
    this.lastVoiceAt = performance.now()
  }

  discardRecording() {
    if (this.recorder && this.recorder.state !== 'inactive') {
      this.recorder.ondataavailable = null
      this.recorder.onstop = null
      this.recorder.stop()
    }
    this.recorder = null
  }

  startListening() {
    if (this.settings.turnMode !== 'auto') return this.setState('idle')
    this.startRecorder()
    this.setState('listening')
  }

  finishUtterance() {
    const recorder = this.recorder
    if (!recorder) return
    this.setState('processing')
    recorder.onstop = () => {
      const blob = new Blob(this.chunks, { type: this.mime || 'audio/webm' })
      this.recorder = null
      this.onUtterance?.(blob, `speech.${extFor(this.mime)}`)
    }
    recorder.stop()
  }

  // Push-to-talk
  pttDown() {
    this.stopSpeaking()
    this.startRecorder()
    this.setState('ptt')
  }

  pttUp() {
    if (this.mode !== 'ptt') return
    if (performance.now() - this.recordStartedAt < 400) {
      this.discardRecording()
      return this.setState('idle')
    }
    this.finishUtterance()
  }

  // ---------------- speaking ----------------
  async speak(chunks, { listenAfter = true } = {}) {
    const token = ++this.speakToken
    this.discardRecording()
    this.setState('speaking')
    // Start fetching every English chunk's audio right away, so the next one is ready when needed.
    const audios = chunks.map((text) => (this.useGroq(text) ? this.fetchTts(text).catch(() => null) : Promise.resolve(null)))
    for (let i = 0; i < chunks.length; i++) {
      if (token !== this.speakToken) return // interrupted (barge-in or hang-up)
      const url = await audios[i]
      if (token !== this.speakToken) return
      if (url) await this.playUrl(url, token)
      else await this.speakBrowser(chunks[i], token)
    }
    if (token !== this.speakToken) return
    if (listenAfter) this.startListening()
    else this.setState('idle')
  }

  useGroq(text) {
    return this.settings.voice === 'groq' && !DEVANAGARI.test(text) && this.groqTtsFailures < 2
  }

  async fetchTts(text) {
    const res = await fetch('/api/tts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }),
    })
    if (!res.ok) {
      this.groqTtsFailures++ // after 2 failures the rest of the call uses the browser voice
      throw new Error('tts failed')
    }
    return URL.createObjectURL(await res.blob())
  }

  playUrl(url, token) {
    return new Promise((resolve) => {
      const audio = new Audio(url)
      this.audio = audio
      const done = () => { URL.revokeObjectURL(url); resolve() }
      audio.onended = done
      audio.onerror = done
      audio.play().catch(done)
      const check = setInterval(() => { if (token !== this.speakToken) { clearInterval(check); audio.pause(); done() } }, 100)
      audio.addEventListener('ended', () => clearInterval(check))
    })
  }

  speakBrowser(text, token) {
    return new Promise((resolve) => {
      const synth = window.speechSynthesis
      if (!synth) return resolve()
      const lang = DEVANAGARI.test(text) ? 'hi' : 'en'
      const u = new SpeechSynthesisUtterance(text)
      const voice = browserVoice(lang)
      if (voice) u.voice = voice
      u.lang = voice?.lang || (lang === 'hi' ? 'hi-IN' : 'en-IN')
      u.rate = 1.02
      let started = false
      u.onstart = () => { started = true }
      u.onend = resolve
      u.onerror = resolve
      synth.speak(u)
      const begun = performance.now()
      // Chrome sometimes never fires onend, so also poll: stop when interrupted, finished, or never started.
      const check = setInterval(() => {
        const finished = started && !synth.speaking
        const neverStarted = !started && performance.now() - begun > 4000
        if (token !== this.speakToken || finished || neverStarted) { clearInterval(check); resolve() }
      }, 150)
    })
  }

  stopSpeaking() {
    this.speakToken++
    this.audio?.pause()
    window.speechSynthesis?.cancel()
  }

  destroy() {
    this.stopSpeaking()
    clearInterval(this.timer)
    this.discardRecording()
    this.stream?.getTracks().forEach((t) => t.stop())
    this.ctx?.close().catch(() => {})
    this.setState('idle')
  }
}

// A short "ring ring" tone made with the Web Audio API (no audio files needed).
export async function playRingTone(times = 2) {
  const ctx = new (window.AudioContext || window.webkitAudioContext)()
  for (let i = 0; i < times; i++) {
    const gain = ctx.createGain()
    gain.gain.value = 0.06
    gain.connect(ctx.destination)
    const osc = [440, 480].map((f) => {
      const o = ctx.createOscillator()
      o.frequency.value = f
      o.connect(gain)
      o.start()
      return o
    })
    await new Promise((r) => setTimeout(r, 900))
    osc.forEach((o) => o.stop())
    await new Promise((r) => setTimeout(r, 500))
  }
  ctx.close()
}
