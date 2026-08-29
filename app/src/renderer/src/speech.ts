import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Voice input for the composer (task 11.6).
 *
 * Uses Chromium's built-in SpeechRecognition — no dependency and no audio
 * leaves the machine through us. Note it is a browser API surfaced by the
 * engine, so availability is a runtime question, not a build-time one: every
 * caller must handle `supported === false`.
 */

interface SpeechResultAlternative {
  transcript: string
}
interface SpeechResult {
  isFinal: boolean
  0: SpeechResultAlternative
}
interface SpeechEvent {
  resultIndex: number
  results: { length: number; [index: number]: SpeechResult }
}
interface SpeechErrorEvent {
  error: string
}
interface SpeechRecognizer {
  continuous: boolean
  interimResults: boolean
  lang: string
  start(): void
  stop(): void
  onresult: ((event: SpeechEvent) => void) | null
  onerror: ((event: SpeechErrorEvent) => void) | null
  onend: (() => void) | null
}

type RecognizerCtor = new () => SpeechRecognizer

function recognizerCtor(): RecognizerCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: RecognizerCtor
    webkitSpeechRecognition?: RecognizerCtor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

const ERROR_TEXT: Record<string, string> = {
  'not-allowed': 'Microphone access was denied.',
  'service-not-allowed': 'Speech recognition is unavailable here.',
  'no-speech': 'Nothing heard — try again.',
  network: 'Speech recognition needs a network connection.'
}

export function useSpeechInput(onTranscript: (text: string, final: boolean) => void): {
  supported: boolean
  listening: boolean
  error: string | null
  start: () => void
  stop: () => void
} {
  const [listening, setListening] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const recognizerRef = useRef<SpeechRecognizer | null>(null)
  // The callback changes every render; a ref keeps the recognizer's handler
  // current without tearing the session down mid-utterance. Written in an
  // effect, not during render — the recognizer only reads it in its own
  // callbacks, which always run after commit.
  const callbackRef = useRef(onTranscript)
  useEffect(() => {
    callbackRef.current = onTranscript
  }, [onTranscript])

  const supported = recognizerCtor() !== null

  const stop = useCallback(() => {
    recognizerRef.current?.stop()
    recognizerRef.current = null
    setListening(false)
  }, [])

  const start = useCallback(() => {
    const Ctor = recognizerCtor()
    if (!Ctor || recognizerRef.current) return
    setError(null)
    const recognizer = new Ctor()
    recognizer.continuous = true
    recognizer.interimResults = true
    recognizer.lang = navigator.language || 'en-US'
    recognizer.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        callbackRef.current(result[0].transcript, result.isFinal)
      }
    }
    recognizer.onerror = (event) => {
      setError(ERROR_TEXT[event.error] ?? `Voice input failed (${event.error}).`)
      stop()
    }
    recognizer.onend = () => setListening(false)
    recognizer.start()
    recognizerRef.current = recognizer
    setListening(true)
  }, [stop])

  // A live recognizer must not outlive the composer.
  useEffect(() => stop, [stop])

  return { supported, listening, error, start, stop }
}
