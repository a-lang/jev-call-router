# Integration guide

This guide connects jev-call-router to a real phone system across three configuration areas:

| Area | Where | What |
|---|---|---|
| External providers | vendor dashboards | TypeSafe (Jev) key, speech-to-text key (OpenAI-compatible or ElevenLabs), optional Anthropic key |
| PBX | Asterisk / FreePBX | ARI user, one dialplan context, prompt recordings, inbound routing |
| Application | this repo: `router.config.ts`, `.env` | routes, prompts, fallback, thresholds, provider keys, webhook |

## How the pieces talk

```
              +---------------------+
Caller -----> |  Asterisk / FreePBX | <------+
              +---------------------+        |
                         |                   |  ARI REST:
                         | StasisStart       |  answer, play,
                         | (ARI WebSocket)   |  record, continue
                         v                   |
              +---------------------+        |
              |   jev-call-router   | -------+
              +---------------------+
                         |
         +---------------+---------------+
         |               |               |
         v               v               v
  speech-to-text      Jev API       WEBHOOK_URL
     (HTTPS)          (HTTPS)       (optional)
```

The router opens one outbound WebSocket to Asterisk (`/ari/events?app=<ARI_APP>`, default app `jev-router`) and makes REST calls to it. Asterisk never calls the router, so the router can run on the PBX host or on another machine that can reach port 8088.

For each call the adapter:

1. receives `StasisStart` and answers the channel,
2. plays your greeting (`POST /channels/{id}/play`),
3. records the caller as WAV (`POST /channels/{id}/record`) until the silence timeout (default 2 s), the maximum duration (default 15 s), or `#`,
4. downloads and deletes the recording (`/recordings/stored/{name}/file`),
5. sends the audio to speech-to-text, then the text to Jev (or to the interpreter first, if configured),
6. plays the route's announcement, if any,
7. calls `POST /channels/{id}/continue?context=…&extension=…&priority=…` (or `label=…`), which leaves Stasis and resumes the dialplan at the chosen destination,
8. fires `onResult(result)`, delivers the outcome to your webhook if `WEBHOOK_URL` is set, and lets the router emit the matching SSE events for the visualizer.

The recording limits are configurable with `RECORD_MAX_SECONDS` and `RECORD_MAX_SILENCE_SECONDS`.

## External providers

1. Jev / TypeSafe: Create an API key in your TypeSafe account ([docs.typesafe.ai](https://docs.typesafe.ai)) and add it to `.env` as `TYPESAFE_API_KEY`.
2. Speech-to-text: two providers are built in.
   - **OpenAI-compatible**: any service exposing `POST {STT_BASE_URL}/audio/transcriptions` (multipart `file` + `model`, JSON `{ "text": … }`). Set `STT_API_KEY`, `STT_BASE_URL` (for example `https://api.openai.com/v1`), and `STT_MODEL`.
   - **ElevenLabs Scribe**: set `STT_PROVIDER=elevenlabs`, `STT_BASE_URL=https://api.elevenlabs.io` (no `/v1`; the provider appends `/v1/speech-to-text`), `STT_MODEL=scribe_v2`, and `STT_API_KEY`. It sends `model_id` and, when configured, `language_code` instead of `model` / `language`.

   Set `STT_LANGUAGE` for a language hint and `STT_DEBUG=1` to print transcripts. The adapter records WAV, which both providers accept.
3. Optional interpreter: To send Jev a short summary with personal details removed instead of the raw transcript, add `interpreter: createClaudeInterpreter()` to your config and set `ANTHROPIC_API_KEY`. It uses `claude-opus-5` at low effort, with server-side refusal fallbacks enabled. It adds one model call of latency per attempt.
4. Optional webhook: Set `WEBHOOK_URL` to receive a signed HTTP POST for every routing outcome. See [Outbound webhook](#outbound-webhook) below.

The router's host needs outbound HTTPS to `api.typesafe.ai`, your STT host (`api.openai.com` or `api.elevenlabs.io`, or your self-hosted endpoint), and (optionally) `api.anthropic.com` and your webhook host.

## PBX configuration

The copy-paste minimal setup lives in [README › 接上 Asterisk / FreePBX](README.md#接上-asterisk--freepbx). This section is the full walkthrough, including the FreePBX specifics.

### Plain Asterisk

1. Enable the HTTP server and ARI: See [`examples/asterisk/http.conf`](examples/asterisk/http.conf) and [`examples/asterisk/ari.conf`](examples/asterisk/ari.conf). Bind to `127.0.0.1` if the router runs on the same host. Otherwise bind to a private interface and enable TLS.
2. Add the dialplan context from [`examples/asterisk/extensions_custom.conf`](examples/asterisk/extensions_custom.conf) and send calls into it, for example:

   ```
   [from-pstn]
   exten => 8000,1,Goto(jev-router,s,1)
   ```

3. Record prompts: Put `jev-greeting`, `jev-retry`, `jev-connecting`, and `jev-no-speech` (WAV or ulaw) in `/var/lib/asterisk/sounds/custom/`. They are referenced as `sound:custom/jev-greeting`.

   | Prompt | Line |
   |---|---|
   | `jev-greeting` | Hello, how can I help you? |
   | `jev-retry` | Sorry, I didn't catch that. Please say it again. |
   | `jev-connecting` | Connecting you now, please hold. |
   | `jev-no-speech` | Sorry, I didn't hear a response. Please call back later. |

   Ready-made recordings live in `assets/sounds/en/` and `assets/sounds/tw/`; the [README](README.md) has a batch conversion command.

4. Reload and check:

   ```
   asterisk -rx "module reload res_ari.so"
   asterisk -rx "dialplan reload"
   asterisk -rx "http show status"     # ARI under /ari
   asterisk -rx "ari show users"       # your ARI user
   asterisk -rx "ari show apps"        # your ARI app appears once `bun start` is running
   ```

### FreePBX

FreePBX runs Asterisk, so it uses the same ARI adapter with no FreePBX-specific code. Configuration locations differ because FreePBX regenerates most `.conf` files:

1. ARI user: Do not edit `ari.conf` directly. In Settings > Advanced Settings, confirm that the Asterisk mini-HTTP server and the Asterisk REST Interface are enabled, and note the ARI credentials. Alternatively, add a `[jev]` user block to `/etc/asterisk/ari_additional_custom.conf`. Verify with `asterisk -rx "ari show users"`.
2. Dialplan: Paste the `[jev-router]` context into `/etc/asterisk/extensions_custom.conf`, then run `fwconsole reload`.
3. Custom Destination: Under Admin > Custom Destinations > Add, set target to `jev-router,s,1` and description to "Jev router".
4. Inbound routes: In Connectivity > Inbound Routes, set the destination of DIDs using Jev to the "Jev router" Custom Destination. All other routes remain unchanged.
5. Prompts: In Admin > System Recordings, create `jev-greeting`, `jev-retry`, `jev-connecting`, and `jev-no-speech`. FreePBX stores them under `custom/`, so they are referenced as `sound:custom/jev-greeting`.
6. Route destinations: In `router.config.ts`, route actions map to FreePBX contexts. On plain Asterisk, use your own contexts instead — see the destination table in the README.

   | FreePBX destination | Action destination |
   |---|---|
   | Queue 400 | `ext-queues,400,1` |
   | Ring group 600 | `ext-group,600,1` |
   | Extension 100 | `from-did-direct,100,1` |
   | Voicemail of 100 (unavailable greeting) | `ext-local,vmu100,1` |
   | IVR 3 | `ivr-3,s,1` |
   | Hang up | use `{ type: "hangup" }` |

   To verify the context of a destination, run `asterisk -rx "dialplan show <context>"`.

### Dialplan fallback destination

The line after `Stasis()` in `[jev-router]` is the last-resort destination. The dialplan reaches it when:

- the router is not running or disconnected (`Stasis()` exits with `STASISSTATUS=FAILED`),
- a route uses `{ type: "continue" }`, or
- the router fails to execute both the chosen route and the fallback route.

A `{ type: "hangup" }` action never passes through the dialplan, so the last-resort destination does not run for it. If the hangup itself fails, the router returns the call with `continue` and the dialplan takes over.

Point this destination at an attended extension or staffed queue.

## Application configuration

Everything lives in [`router.config.ts`](router.config.ts):

```ts
export const routes: Record<string, Route> = {
  billing: {
    description: "Questions about invoices, charges, refunds, payments.",
    action: { type: "transfer", destination: "ext-queues,402,1" },
  },
  "human-agent": {
    description: "The caller asks for a person.",
    action: { type: "transfer", destination: "from-did-direct,100,1" },
    announcement: "sound:custom/jev-connecting",
  },
  "standard-ivr": { action: { type: "continue" } },
  hangup: {
    action: { type: "hangup" },
    announcement: "sound:custom/jev-no-speech",
  },
};
export const fallbackRoute = "human-agent";
export const fallbackRouteByReason = { "no-speech": "hangup" };
```

Options on `createCallRouter`:

| Option | Default | Meaning |
|---|---|---|
| `routes` | required | Your outcomes. Only routes with `description` are offered to Jev |
| `fallbackRoute` | required | Route used whenever routing cannot complete safely |
| `fallbackRouteByReason` | none | Route per failure reason; reasons without an entry still use `fallbackRoute`. The shipped config sends `no-speech` (continuous silence) to the `hangup` route |
| `prompts.greeting` / `prompts.retry` | greeting required, retry defaults to greeting | PBX media played before listening |
| `maxAttempts` | `2` | How many times to listen before falling back |
| `minConfidence` | `0.7` | Jev confidence required to act; tune on your own calls |
| `timeouts` | STT 8 s, interpreter 6 s, Jev 5 s | Each stage falls back when exceeded |
| `routeDirectly(call)` | none | Return a route name to skip Jev for this call |
| `facts(call)` | none | Extra facts for Jev, for example `{ afterHours: true }` |
| `interpreter` | none | Summarize the transcript before Jev sees it |
| `onResult(result)` | none | Receives each `RoutingResult`. Wire `sendWebhook` here to push outcomes to your CRM or dashboard |
| `logger` | silent | `createJsonLogger()` writes JSON lines to stdout |
| `debugTranscript` | `false` | Log each transcript before the decision |

### Passing information from the dialplan

Arguments after the app name in `Stasis()` become `call.variables` when they are `key=value`:

```
same => n,Stasis(jev-router,line=support,jev=${JEV_ENABLED})
```

```ts
routeDirectly: (call) => (call.variables.jev === "off" ? "standard-ivr" : undefined),
facts: (call) => ({ line: call.variables.line ?? "main" }),
```

`call.caller` (caller ID) and `call.dialed` (the dialed extension) are also available to your rules. They are not sent to Jev unless you put them in `facts`.

### Asterisk adapter options

`connectAsterisk({ url, username, password, app, router, recording: { maxSeconds, maxSilenceSeconds }, reconnectDelayMs, logger })`.

`bun start` (`src/server.ts`) wires this up from `.env`: `ARI_URL`, `ARI_USERNAME`, `ARI_PASSWORD`, `ARI_APP` (default `jev-router`), `RECORD_MAX_SECONDS` (default 15), and `RECORD_MAX_SILENCE_SECONDS` (default 2). Before connecting it validates every `transfer` destination and fails fast on a malformed one; calling `connectAsterisk` directly does not run that validation.

If the event WebSocket drops, the adapter reconnects every 3 s (`reconnectDelayMs`). Sessions already in progress are ended with an error and go through the router's fallback path over ARI REST.

## Outbound webhook

After every call, the router calls your `onResult` handler with a `RoutingResult`. Wire `sendWebhook` to push it to any HTTP endpoint:

```ts
import { sendWebhook } from "./src/webhook.ts";

onResult: (result) => {
  void sendWebhook(result, {
    url: process.env.WEBHOOK_URL,
    secret: process.env.WEBHOOK_SECRET,
    logger,
  });
},
```

Delivery runs asynchronously with a 4-second timeout so PBX teardown is never delayed. Failed deliveries log a warning without dropping the call. The request body contains the raw `RoutingResult`:

```json
{
  "event": "call.result",
  "timestamp": "2026-11-04T08:00:00.000Z",
  "data": {
    "callId": "1743321234.42",
    "outcome": "jev",
    "route": "billing",
    "action": { "type": "transfer", "destination": "ext-queues,402,1" },
    "decision": {
      "outcome": "billing",
      "confidence": 0.94,
      "probabilities": { "billing": 0.94, "sales": 0.03 },
      "model": "jev-latest"
    },
    "offeredRoutes": ["sales", "support", "billing", "human-agent"],
    "attempts": 1,
    "timings": { "speechMs": 1180, "decisionMs": 420, "totalMs": 1850 }
  }
}
```

`outcome` is one of `jev`, `direct`, `fallback`, or `caller-hung-up`. A fallback result adds `fallbackReason` and `error`; a `caller-hung-up` result can omit `route`, `action`, and `decision`.

### Signature verification

When `WEBHOOK_SECRET` is configured, requests include an `X-Jev-Signature` header with an HMAC-SHA256 hex digest of the raw request body:

```ts
import { createHmac } from "crypto";

function verify(rawBody: string, secret: string, signatureHeader: string): boolean {
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  return expected === signatureHeader;
}
```

## Live visualizer

`bun start` and `bun run demo` both start the HTTP service. Open `http://localhost:3000` (or your `PORT`).

`bun run demo` still requires `TYPESAFE_API_KEY` at startup, but needs no Asterisk or speech-to-text setup. The page shows 10 visible lanes and 5 destination queues, moving through ringing, transcription, classification, and queue dispatch.

The page consumes `GET /events` over Server-Sent Events. Its built-in phrase buttons and the 10-call burst run a client-side simulation in the browser; they do not call Jev. To drive the real pipeline, use `POST /simulate` or connect a PBX.

| Endpoint | Purpose |
|---|---|
| `GET /` | Visualizer page |
| `GET /events` | SSE stream; opens with a `connected` event |
| `POST /simulate` | Run a scripted call through the real router |
| `GET /api/health` | `{ "status": "ok", "subscribers": n }` |

### SSE event reference

`GET /events` (text/event-stream). Every event also carries a `timestamp`, and `destination` is the route's action object, not a string.

| Event | Fields | Emitted when |
|---|---|---|
| `connected` | `time` | Stream opened |
| `call.started` | `callId`, `caller`, `dialed` | Call entered Stasis |
| `call.speaking` | `callId`, `transcript` | Transcript ready |
| `call.thinking` | `callId`, `offeredRoutes`, `utterancesCount` | Classification request sent to Jev |
| `call.routed` | `callId`, `route`, `destination`, `confidence`, `probabilities`, `timings` | Route selected |
| `call.fallback` | `callId`, `reason`, `route`, `destination`, `error` | Router diverted to the fallback |
| `call.ended` | `callId`, `outcome`, `route`, `fallbackReason`, `timings` | Call finished |

### Simulate endpoint

`POST /simulate` runs a scripted call through the real routing pipeline and emits the same SSE events. It requires the Jev key configured for the server.

```bash
curl -X POST http://localhost:3000/simulate \
  -H "Content-Type: application/json" \
  -d '{"utterance": "I was charged twice"}'
```

Multiple utterances (for retry flows) and an optional caller ID:

```bash
curl -X POST http://localhost:3000/simulate \
  -H "Content-Type: application/json" \
  -d '{"utterances": ["hello?", "I need billing help"], "caller": "+15551234567"}'
```

The body accepts `utterance`, `utterances`, and `caller`. With no utterance it uses `"I want to know about your products"`; the caller defaults to `+15552345678`.

Response:

```json
{ "ok": true, "result": { "callId": "simulated-...", "outcome": "jev", "route": "billing" } }
```

On failure it returns `{ "ok": false, "error": "..." }` with HTTP 500.

## Trying it without a PBX

```bash
bun run simulate "my internet has been down since this morning"
```

This runs the real call flow with a scripted session: text stands in for audio, and actions are printed instead of executed. The router still calls the real Jev API.

## Verification status

- Verified locally (`bun test`): the router core, every fallback path, decision validation, context minimization, the Jev request/response contract, both STT provider request shapes (OpenAI-compatible and ElevenLabs), config and env parsing, and the ARI adapter against a mock ARI server using the real endpoint shapes and events — including custom recording limits and caller hang-up. Also verified: the full `bun start` service against mock ARI and mock STT servers, `.env` loading, ARI reconnection, and that logs contain no secrets or caller numbers.
- Remaining on-call verification: real audio through `record` and `play`, silence detection values (`talking_duration`) on your channel format, a live ElevenLabs round trip, FreePBX Advanced Settings names for ARI, the `continue` behavior into your specific FreePBX destinations, and end-to-end latency on a live call. Test with an internal extension first. Start with a high `minConfidence` and a staffed `fallbackRoute`, and review the `fallback.triggered` logs.
