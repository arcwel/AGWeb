# Voice agent: integration plan

Goal: talk to the agent the way you talk to a person, and have it act while you
talk. You speak, it listens while you speak, answers in a voice, and runs tools
in the middle of the conversation; you can cut it off. Everything that hears
and speaks runs on the Mac; only the model call leaves the machine, exactly as
it does today.

## What the reference project does, and why it is a reference, not a base

[jaredrhod/fullstack-agent](https://github.com/jaredrhod/fullstack-agent)
assembles four small repos around Claude Code; the voice part is
[backtalk](https://github.com/jaredrhod/backtalk): push-to-talk, Whisper via
faster-whisper for hearing, Kokoro (local) or ElevenLabs (cloud) for speaking,
Python with `uv`, about 1 GB of models on first run, AGPL-3.0.

Worth taking from it: the interaction design. Spoken permission approvals,
"thinking" audio so silence never feels dead, music ducking, a pinned
microphone, and the rule that pressing the key while it speaks makes it stop
and listen. Its model choices (Whisper, Kokoro) are also sound; we reach the
same models through a different runtime.

Not worth taking: the runtime. It is a Python process driving Claude Code's
Agent SDK; we already own an agent loop with tools, a permission engine and
streaming cancellation in `webdeck-core`, and we ship a single Node executable
with no Python. Push-to-talk is also the floor, not the goal: the ask here is a
conversation, which needs hands-free listening with interruption.

Licence: AGPL-3.0 is fine to run beside us as a proof of concept, and fine to
learn from. Embedding its code in WebDeck would make WebDeck a derivative and
put the whole app under AGPL, which is not the licence we ship under (MIT).
So: run it for a day as a sidecar to feel the UX, then build ours.

## The candidates, and the choice

Hearing, turn-taking and speaking are separate problems with separate best
answers on a Mac. Full-duplex speech models that fuse all three are exciting
but do not fit an agent that has to call tools.

### Hearing (speech to text)

| Option | Runs | Licence | Notes |
| :-- | :-- | :-- | :-- |
| **Apple SpeechAnalyzer** (macOS 26) | Neural Engine, ships with the OS | Apple platform API | No download, ~30 locales, streaming with partial results, a built-in voice-activity detector, about twice Whisper large-v3-turbo's speed and better accuracy on device. Reachable only from Swift/ObjC. |
| **NVIDIA Parakeet TDT 0.6B v3** | CPU or Neural Engine | Model CC-BY-4.0 | Best open model for English and 24 European languages in 2026; beats Whisper large-v3 at a quarter of the size; sub-100 ms on M3+. Runs through sherpa-onnx (Node) or FluidAudio (Swift, CoreML/ANE). |
| Whisper large-v3-turbo via whisper.cpp | CPU/Metal | MIT (model MIT) | Most languages; slower and less accurate than Parakeet on English; the safe multilingual fallback. |
| Kyutai STT 1B (en/fr) via MLX | GPU (Metal) | Code MIT, weights CC-BY-4.0 | True streaming at 0.5 s latency, runs on an iPhone 16 Pro; needs a Python/MLX runtime, so it costs packaging. |
| Moonshine | CPU | MIT | Smallest, English only; edge devices, not our case. |

**Choice: Apple SpeechAnalyzer first, Parakeet through sherpa-onnx second.**
SpeechAnalyzer costs nothing to ship, nothing to download, and is the most
accurate on-device engine on the hardware we target. Parakeet is the same
quality on macOS 13–15 and on any future Windows/Linux build, and it comes
from the same runtime that gives us speaking and voice detection, so one
dependency covers three jobs.

### Turn-taking (when did you stop talking, and are you interrupting)

| Option | Licence | Notes |
| :-- | :-- | :-- |
| **Silero VAD** | MIT | The industry default; 2 MB; runs in sherpa-onnx or standalone. Decides "voice / not voice" in 30 ms frames. |
| Apple SpeechDetector | Apple API | Comes with SpeechAnalyzer; same job, zero download. |
| Semantic end-of-turn (small LLM judging whether the sentence is finished) | n/a | Phase 3. Silence-based end-of-turn is what makes demo agents feel dumb ("I'm going to… [cut off]"). |

**Choice: Silero (or Apple's detector on the Apple path) for voice activity,
plus a short grace window; a semantic end-of-turn judge later.** Barge-in is
VAD during playback: voice detected while the agent speaks stops the audio and
cancels the model stream (we already have true backend cancellation).

### Speaking (text to speech)

| Option | Runs | Licence | Notes |
| :-- | :-- | :-- | :-- |
| **Kokoro-82M** | CPU, ~80 MB int8 | Apache-2.0 | Quality far above its size, ~60 voices, real-time on CPU, first audio in well under 200 ms when chunked by sentence. Runs in sherpa-onnx. |
| Apple AVSpeechSynthesizer | System voices | Apple API | Zero download, instant, but the voices sound like the OS. Fallback and for spoken permission prompts. |
| Chatterbox-Turbo (Resemble) | GPU/CPU, 350M | MIT | Beats ElevenLabs in listening tests; heavier; the "premium local" option for phase 3. |
| Kyutai TTS via MLX | Metal | CC-BY-4.0 | Streams text in as it is generated (~350 ms); MLX runtime cost again. |
| ElevenLabs / OpenAI TTS | Cloud | Commercial | Optional, behind the same provider-key flow as the LLM. Off by default. |

**Choice: Kokoro through sherpa-onnx, with AVSpeechSynthesizer as the
zero-download fallback.**

### Full-duplex speech models (considered, not chosen)

Moshi (Kyutai) runs full-duplex on an M3 through MLX with ~200 ms latency, and
weights are CC-BY-4.0. But it *is* the language model (7B) and has no tool
calling, so it cannot drive our agent; it would be a chat toy beside the real
one. NVIDIA PersonaPlex is the same shape. OpenAI's Realtime API and Gemini Live
are the cloud versions of this idea, do support tool calls, and have the best
interruption handling available; they are the right optional "cloud voice"
mode for phase 3, not the default, because the brief is local hardware and
because they replace our model with theirs.

### The runtime underneath

**sherpa-onnx** (k2-fsa, Apache-2.0): one C++ library with a Node addon that
runs streaming speech recognition (Parakeet, Whisper, Moonshine, Zipformer),
text to speech (Kokoro, Piper, Matcha), Silero voice detection and keyword
spotting, offline, with prebuilt macOS arm64 binaries (`sherpa-onnx-node`
1.13.7 on npm, published 2026-09-01, `sherpa-onnx-darwin-arm64` as an
optional dependency). It slots into
`webdeck-core`'s single-executable build the way node-pty does. **FluidAudio**
(Apache-2.0, Swift) is the alternative for the Apple path: Parakeet, Silero and
Kokoro compiled to CoreML on the Neural Engine, ~190× real time on M4 Pro,
with a CLI.

## Architecture in WebDeck

```
 mic ──▶ webdeck-voice (helper) ──▶ transcript stream ──▶ webdeck-core ──▶ agent loop
         · AVAudioEngine capture      (partial/final,        · composer send
           with echo cancellation      speaker on/off)       · tools run, prompts raised
         · SpeechAnalyzer (mac 26)                            │
           or sherpa-onnx Parakeet                            ▼
         · Silero VAD, barge-in                      reply tokens ──▶ sentence chunker
         · Kokoro / AVSpeech playback ◀────────────── ──▶ TTS queue ──▶ speaker
                 ▲
     chrome://webdeck shell: voice pill in the composer, live transcript,
     waveform, "speaking" state, spoken/keyboard permission answers
```

- **`webdeck-voice`** is a small helper process the core spawns next to
  itself, like the language servers: Swift on macOS (AVAudioEngine gives
  echo-cancelled capture and playback in one graph, which is what makes
  hands-free listening while the agent speaks work), with the sherpa-onnx
  engines behind a feature flag for non-Apple platforms. It speaks a tiny
  JSON-lines protocol: `start`, `stop`, `say {text}`, `cancel`, and emits
  `partial`, `final`, `speech_started`, `speech_ended`, `playback_done`.
  Capturing in the helper, not in the WebUI page, avoids granting the
  microphone to `chrome://webdeck` and gives us the voice-processing audio
  unit.
- **The core** owns the conversation: it feeds finals into the same agent
  session the composer uses, streams the reply into a sentence chunker, and
  sends chunks to `say`. A `speech_started` while speaking cancels the stream
  and the queue (barge-in). Tool activity is narrated in one clause each
  ("running the tests", "opening the pull request"), never the raw output.
- **Permission prompts** are spoken as a question and answered by voice
  ("allow", "always", "deny": a keyword spotter on the helper, no LLM round
  trip) or by the existing inline prompt. The guards from the composer design
  apply unchanged.
- **The shell** gets a voice pill next to the model and permission pills:
  push-to-talk (hold the key), hands-free (toggle), and off. A live transcript
  chip shows what was heard before it is sent, so a misheard command can be
  cancelled in the half-second before it runs.

## Phases

| Phase | Scope | Result |
| :-- | :-- | :-- |
| **0 · Feel it (1 day)** | Run backtalk beside WebDeck as an AGPL sidecar pointed at a scratch project. Note what its spoken approvals, thinking audio and ducking do to the experience. | A short list of interaction rules we keep. Nothing of it ships. |
| **1 · Hear and speak (3–4 days)** | `webdeck-voice` helper with sherpa-onnx: Parakeet streaming STT, Silero VAD, Kokoro TTS; push-to-talk from the composer's mic button; replies read aloud sentence by sentence; cancel on send. Models fetched on first use (~700 MB) with progress in the composer. | Talk to the agent, hear it answer, watch it act. |
| **2 · Conversation (3–4 days)** | Hands-free mode: echo-cancelled capture, barge-in cancels speech and stream, end-of-turn with grace window, tool narration, spoken permission answers, SpeechAnalyzer on macOS 26 for zero-download hearing. | The brief: a conversation in which the agent takes action. |
| **3 · Polish and options (later)** | Semantic end-of-turn judge; wake word ("hey deck", sherpa-onnx keyword spotting); voice choice; Chatterbox-Turbo premium voice; optional cloud realtime (OpenAI Realtime / Gemini Live) behind provider keys; Windows/Linux via the sherpa-onnx path. | Choice without changing the default. |

## Licence and shipping summary

| Component | Licence | Ships in the bundle |
| :-- | :-- | :-- |
| sherpa-onnx runtime | Apache-2.0 | Yes (native addon, arm64) |
| Parakeet TDT 0.6B v3 | CC-BY-4.0 (attribution in Settings → About) | Downloaded on first use |
| Silero VAD | MIT | Yes (2 MB) |
| Kokoro-82M | Apache-2.0 | Downloaded on first use |
| Apple SpeechAnalyzer / AVSpeech | Platform API | Part of macOS |
| FluidAudio (if used for the Apple path) | Apache-2.0 | Yes |
| backtalk | AGPL-3.0 | Never; sidecar during phase 0 only |

Sources: [Northflank STT benchmarks 2026](https://northflank.com/blog/best-open-source-speech-to-text-stt-model-in-2026-benchmarks), [Parakeet vs Whisper (Spokenly)](https://spokenly.app/blog/parakeet-vs-whisper), [FluidAudio](https://github.com/FluidInference/FluidAudio), [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx), [Kyutai delayed streams modeling](https://github.com/kyutai-labs/delayed-streams-modeling), [Moshi](https://github.com/kyutai-labs/moshi), [Unmute](https://github.com/kyutai-labs/unmute), [TTS comparison (BentoML)](https://www.bentoml.com/blog/exploring-the-world-of-open-source-text-to-speech-models), [Apple SpeechAnalyzer (WWDC25)](https://developer.apple.com/videos/play/wwdc2025/277/), [Apple speech API benchmark](https://get-inscribe.com/blog/apple-speech-api-benchmark.html), [Realtime API vs Gemini Live vs Pipecat](https://vadimall.com/posts/openai-realtime-vs-gemini-live-vs-pipecat-voice-ai-typescript).
