# STT Playground

Speak once (or upload a clip, up to 60 s) and compare speech-to-text models side by side on the same audio. It's built for testing English and Indian languages: Hindi, Gujarati, Marathi and Marwari.

Each model uses the best transport its provider offers:

| Provider | Model | Transport |
|---|---|---|
| Sarvam | Saaras v3 Realtime, Saaras v4 Realtime | WebSocket through our relay (Sarvam has no temporary tokens) |
| Sarvam | Saaras v4 | REST (sent as ≤29 s pieces; the API caps requests at 30 s) |
| Gemini | 3.5 Transcribe Live | WebSocket (temporary token) |
| Gemini | 3.5 Transcribe | REST |
| Gemini | 3.8 Flash, 3.1 Pro (prompted to transcribe) | REST, streamed |
| OpenAI | GPT Live Transcribe, GPT Realtime Whisper | WebSocket (temporary token) |
| OpenAI | GPT Transcribe | REST, streamed |
| ElevenLabs | Scribe v2 Realtime | WebSocket (single-use token) |
| ElevenLabs | Scribe v2 | REST |

**Marwari:** no provider has a Marwari language code.
- Models that take a code get Hindi (`hi`/`hi-IN`).
- Models that accept a prompt also get a dialect hint.
- Each card shows what was sent and which script the model replied in.

## Run locally

```bash
npm install
cp .env.example .env        # add the provider keys you have
npm run dev:vercel          # full app (incl. the Sarvam relay), via `vercel dev`
# or: npm run dev           # plain `next dev` (everything except the Sarvam relay)
```

`vercel dev` needs the Vercel CLI and a linked project (`vercel link --scope nova-labs-in --project stt-playground`).

A provider whose key is missing shows as disabled. Locally there's no password unless `APP_PASSWORD` is set.

## How it works

**Audio.** `lib/audio/`
- An AudioWorklet captures the mic at the device rate.
- A windowed-sinc resampler produces 16 kHz and 24 kHz PCM16 in 100 ms chunks, shared by every streaming socket.
- The full recording is kept as a 16 kHz WAV for the REST models, playback and download.
- Recording stops itself at 60 s, counted in samples rather than with a timer.

**Streaming.** `lib/stream/`
- `protocols.ts` holds each provider's wire format: audio framing, end-of-stream and message parsing.
- `session.ts` runs one socket per model. It queues audio until the provider is ready, then waits for the final transcript after Stop.

**Server.** `app/api/`
- `realtime-token` mints short-lived credentials locked to the model.
- `transcribe` takes one upload for all REST models and streams results back as NDJSON.
- `relay/sarvam` is the WebSocket relay, built on Vercel's WebSocket support.
- `health` shows which providers are configured.

**Access.** `proxy.ts`, `lib/auth/`
- When `APP_PASSWORD` is set, pages need a session cookie and the API answers 401 without one.
- `https://<host>/?key=<APP_PASSWORD>` is a share link that signs the visitor in.
- On a Vercel deployment with no password set, the API refuses to run. `ALLOW_PUBLIC=1` overrides this.

## Tests

| Command | What it does | Real API usage |
|---|---|---|
| `npm test` | Unit tests, including replays of recorded provider traffic | none |
| `npm run e2e` | Playwright with a fake mic, against `e2e/mock-upstream.ts`, which replays `fixtures/upstream/` | none |
| `npm run e2e:live` | One run of all 12 models on the 4 s Hindi clip, plus a re-run and an upload check | ~1 min of audio |
| `BASE_URL=… npm run e2e:deployed` | Gate, region, relay, token socket and streamed REST on a deployment | ~15 s of audio |
| `npm run smoke -- all` | Re-records `fixtures/upstream/` from the real providers (`--langs` checks every language code) | ~1 min |

The clips are generated for free with macOS voices (`npm run fixtures:audio`). The suites that use keys never retry.

## Deploy (Vercel, team `nova-labs-in`)

```bash
vercel env add SARVAM_API_KEY production   # also GEMINI_API_KEY, OPENAI_API_KEY, ELEVENLABS_API_KEY, APP_PASSWORD, AUTH_SECRET
vercel deploy                              # preview
BASE_URL=<preview-url> npm run e2e:deployed
vercel deploy --prod
```

- Functions run in `bom1` (Mumbai), set in `vercel.json`.
- WebSockets need Fluid compute, which is on.
- The production domain is `voice-test.nova-labs.in`. It's a CNAME in the Route 53 `nova-labs.in` zone pointing to Vercel.
