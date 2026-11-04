# jev-call-router

<p align="center">
  <img src="docs/cover.en.png" alt="jev-call-router: smart routing shouldn't need a keypad" width="100%">
</p>

<p align="center">
  <a href="README.md">繁體中文</a> · <strong>English</strong>
</p>

**Let callers say what they need, and reach the right queue or extension.**

jev-call-router is a TypeScript service and library that turns speech into text, asks [Jev by TypeSafe AI](https://typesafe.ai) to classify the caller's intent, and lets your PBX execute an action you defined in advance.

Jev only returns a category and a confidence score. It never touches the PBX. You can execute exactly three kinds of action: transfer, continue in the dialplan, or hang up.

`Bun 1.3+` · `TypeScript` · `MIT` · `Asterisk / FreePBX`

---

## What it is

Traditional IVRs make callers memorize keypad options. Letting an LLM control the switchboard hands an open-ended instruction surface to a model that generates free-form text.

This project takes a third path: separate understanding from execution.

- Callers speak naturally instead of navigating a menu.
- You define the acceptable outcomes as routes (name + description + action).
- Jev answers a multiple-choice question: it picks one of those routes and returns a name plus a confidence score. It does not generate free-form text.
- Low confidence, outages, timeouts, and unclear requests all go to a fallback you choose.

Because Jev's output is constrained to known routes, it cannot invent an extension, action, or command that does not exist. Anything outside the list is rejected as `invalid-decision` and routed to the fallback. It can still misread intent, but the blast radius is limited to the paths you wrote in `router.config.ts`.

> **The boundary is explicit**: Jev does not generate dialplan, pick extension numbers, or call ARI. Every executable action is defined by you in advance.

The one-line version: replace IVR keypresses with natural language, but keep the predictability of an IVR.

## When it fits

This is not a general-purpose voice assistant. Fit depends on whether your calls can be classified in advance, and whether you want the PBX to keep final control over execution.

| Situation | Verdict | Why |
|---|---|---|
| You already run Asterisk / FreePBX and want natural language instead of a deep IVR tree | Fits | It connects over ARI; start with one DID instead of replacing the whole switchboard |
| Caller intents can be listed in advance (orders, returns, billing, a human) | Fits | Jev can only choose from your list; 3–6 categories are easiest to keep stable, and larger sets need their own validation |
| You need VIP, business-hours, or per-number overrides | Fits | `routeDirectly()` runs before Jev, so the model never rewrites those rules |
| You want outcomes in a CRM, ticketing system, or dashboard | Fits | Every call produces a `RoutingResult`, a webhook, and SSE events |
| You need multi-turn free conversation, barge-in, or streaming audio | Does not fit | The flow is play → record → decide, one utterance at a time, not a continuous conversation |
| You want the model to execute arbitrary PBX commands | Does not fit | The design only allows your defined routes and three action types |
| You require fully offline operation or millisecond latency | Does not fit | It depends on external STT and the Jev API; it cannot run offline or at millisecond latency |
| You have no phone system and only want a web chatbot | Does not fit | This is a routing layer in front of a PBX, not a chatbot framework |

Concrete scenarios:

- **E-commerce support**: order status, returns, product questions, human agent
- **SaaS support desk**: sales, technical support, billing, human
- **Small business switchboard**: appointments, quotes, after-sales, reception
- **Any call flow whose keypad menu has grown too long for anyone to finish**

## How it compares

| | Traditional IVR | LLM in control of the PBX | jev-call-router |
|---|---|---|---|
| Caller experience | Remember keypresses, listen to long menus | Natural conversation | Say it once |
| Action scope | Fixed menu | The model may emit arbitrary commands | Only routes you defined |
| Failure handling | Replay the menu or hang up | Hard to predict | Explicit fallback and reason codes |
| Observability | Limited | Depends on the implementation | Structured result and events per call |
| Hallucination risk | No model | May invent non-existent commands | Chooses only from your routes; unknown values are rejected |
| Maintenance | Change the flow to change the menu | Keep tuning prompts | Change one routes config |

## What happens on a call

Where it sits:

```
Caller ──▶ PBX (Asterisk / FreePBX)
           │ Stasis(jev-router)
           ▼
           jev-call-router ──▶ speech-to-text ──▶ Jev (classification only)
           │                                      │
           └──── execute your action ◀────────────┘
                 transfer / continue / hang up
```

The decision path:

```
routeDirectly() match ──▶ direct route (Jev is skipped)
  │ none
  ▼
  play greeting → record → speech-to-text
  ▼
  Jev chooses one of your routes
  ▼
  known route, and confidence ≥ minConfidence?
    ├─ no / needs more information → ask again (up to maxAttempts)
    └─ yes → execute the action
  any stage fails → fallbackRoute → still failing → back to the dialplan
```

## Quick start

Requirements:

- [Bun](https://bun.sh) 1.3+
- A TypeSafe API key (Jev)
- A speech-to-text service: any OpenAI-compatible `/audio/transcriptions` endpoint, or ElevenLabs Scribe
- Asterisk 16+ or FreePBX 16/17 (only needed for real calls)

### Step 1: Watch the visualizer (no PBX, no STT)

```bash
git clone https://github.com/rayanweragala/jev-call-router
cd jev-call-router
bun install
cp .env.example .env       # add TYPESAFE_API_KEY
bun run demo               # http://localhost:3000
```

You get 10 inbound lanes and 5 destination queues, with each call moving through Ringing → Transcribing → Classifying → routed. The page consumes real routing events over SSE; when no events arrive, it switches to an in-browser simulation.

### Step 2: Simulate a call with text (real Jev call)

```bash
bun run simulate "My headphones from last week still haven't arrived"
bun run simulate "I want to return something" "Order A12345"
```

The second utterance answers the retry prompt. The output includes `played` (prompts that were played), `executed` (actions that were executed), and the full `result`.

### Step 3: Connect your phone system

Fill in the ARI and STT values in `.env`, then:

```bash
bun start
```

This starts both the ARI connection and the HTTP service (visualizer and SSE on `http://localhost:3000` by default). Full Asterisk and FreePBX setup: [docs/INTEGRATION.md](docs/INTEGRATION.md).

## Define your routes

A route has three fields:

```ts
interface Route {
  description?: string;   // what Jev uses to decide
  action: CallAction;     // what actually happens
  announcement?: string;  // optional audio played before the action
}
```

- Only routes **with a `description`** are offered to Jev.
- Routes without one are reachable only through `routeDirectly()` or as the fallback.
- There are three action types:

| Action | Effect |
|---|---|
| `{ type: "transfer", destination: "context,extension,priority" }` | Hand the channel back to a dialplan destination |
| `{ type: "continue" }` | Resume the dialplan on the line after `Stasis()` |
| `{ type: "hangup" }` | Hang up |

### Example: a SaaS support desk

Drop this into `router.config.ts`, replacing the shipped routes:

```ts
export const routes: Record<string, Route> = {
  sales: {
    description: "Prospective customers asking about plans, pricing, demos, or buying.",
    action: { type: "transfer", destination: "ext-queues,400,1" },
  },
  support: {
    description: "Customers reporting bugs, outages, or login problems.",
    action: { type: "transfer", destination: "ext-queues,401,1" },
  },
  billing: {
    description: "Invoices, charges, refunds, or payment methods.",
    action: { type: "transfer", destination: "ext-queues,402,1" },
  },
  "human-agent": {
    description: "The caller asks for a person or operator.",
    action: { type: "transfer", destination: "from-did-direct,100,1" },
    announcement: "sound:custom/connecting",
  },
  "after-hours": {
    action: { type: "continue" },
  },
};

export const fallbackRoute = "human-agent";
```

Add a deterministic override that never reaches Jev:

```ts
routeDirectly: (call) =>
  call.variables.jev === "off" ? "after-hours" : undefined,
```

`after-hours` has no `description`, so Jev cannot see it; it is selected only when the dialplan passes `jev=off`. That is the "predictability first" pattern.

Rules:

- Route names must match `^[a-z0-9][a-z0-9_-]*$`.
- `need-more-information` and `no-matching-route` are reserved names.
- `fallbackRoute` is required and must name a defined route.
- At least one route needs a `description`, or startup fails.

More complete configurations (VIP overrides, business hours, privacy summaries) live in [examples/routing-scenarios.ts](examples/routing-scenarios.ts).

## Environment variables

See [.env.example](.env.example) for the full file.

**Jev**

| Variable | Required | Purpose |
|---|---|---|
| `TYPESAFE_API_KEY` | yes | Jev API key |
| `TYPESAFE_DEFAULT_MODEL` | no | Pin a model (SDK default: `jev-latest`) |

**Speech-to-text**

| Variable | Required | Purpose |
|---|---|---|
| `STT_API_KEY` | yes | STT service key |
| `STT_BASE_URL` | yes | For OpenAI-compatible services, include `/v1`, e.g. `https://api.openai.com/v1` |
| `STT_MODEL` | yes | Transcription model |
| `STT_PROVIDER` | no | Set to `elevenlabs` to use ElevenLabs Scribe |
| `STT_LANGUAGE` | no | ISO-639-1 hint such as `en` |
| `STT_DEBUG` | no | `1` or `true` prints transcripts to the terminal |

ElevenLabs setup:

```bash
STT_PROVIDER=elevenlabs
STT_BASE_URL=https://api.elevenlabs.io
STT_MODEL=scribe_v2
```

**Asterisk (only for `bun start`)**

| Variable | Required | Purpose |
|---|---|---|
| `ARI_URL` | yes | For example `http://127.0.0.1:8088` |
| `ARI_USERNAME` | yes | ARI user |
| `ARI_PASSWORD` | yes | ARI password |
| `ARI_APP` | no | Stasis app name (default `jev-router`) |
| `RECORD_MAX_SECONDS` | no | Maximum recording length (default `15`) |
| `RECORD_MAX_SILENCE_SECONDS` | no | Silence before recording stops (default `2`) |

**Optional**

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Required when the Claude interpreter is enabled |
| `WEBHOOK_URL` | POST each routing result when a call ends |
| `WEBHOOK_SECRET` | Sign webhooks with HMAC-SHA256 |
| `PORT` | HTTP port (default `3000`) |

## Asterisk and FreePBX

In one sentence: the dialplan hands the call to `Stasis(jev-router)`; the router answers, plays prompts, records, decides, and uses ARI `continue` to resume the dialplan at your chosen destination.

### Asterisk: minimal working setup

Copy the blocks below. The corresponding files live in [`examples/asterisk/`](examples/asterisk/).

**`/etc/asterisk/http.conf`**

```ini
[general]
enabled = yes
bindaddr = 127.0.0.1
bindport = 8088
```

**`/etc/asterisk/ari.conf`**

```ini
[general]
enabled = yes
pretty = no

[jev]
type = user
read_only = no                       ; answer / play / record need write access
password = use a long random value   ; openssl rand -hex 24
```

**`/etc/asterisk/extensions.conf`**

```ini
[jev-router]
exten => s,1,NoOp(Jev routing for ${CALLERID(num)})
 same => n,Stasis(jev-router,line=main)
 same => n,NoOp(Stasis returned: ${STASISSTATUS})
 same => n,Goto(internal,100,1)      ; last resort when the router does not take the call

[from-pstn]
exten => 8000,1,Goto(jev-router,s,1)
```

The line after `Stasis()` is the last-resort destination: the call lands there when the router is not running, the connection drops, or a route action fails. Any `key=value` arguments you pass to `Stasis()` become `call.variables`, which `routeDirectly` can read.

**`.env`**

```ini
ARI_URL=http://127.0.0.1:8088
ARI_USERNAME=jev
ARI_PASSWORD=<the password from ari.conf>
ARI_APP=jev-router
```

**Prompts**

Put `jev-greeting`, `jev-retry`, and `jev-connecting` in `/var/lib/asterisk/sounds/custom/`. 8 kHz mono is the safe choice:

```bash
sox greeting-raw.wav -r 8000 -c 1 -b 16 /var/lib/asterisk/sounds/custom/jev-greeting.wav
```

`router.config.ts` references them as `sound:custom/jev-greeting`, without an extension.

**Reload and verify**

```bash
asterisk -rx "module reload res_ari.so"
asterisk -rx "dialplan reload"
asterisk -rx "http show status"     # ARI should be mounted at /ari
asterisk -rx "ari show users"       # should list jev

bun start

asterisk -rx "ari show apps"        # should show jev-router
```

### Destinations on plain Asterisk

The default destinations in `router.config.ts` are FreePBX contexts. Plain Asterisk has no `ext-queues` or `from-did-direct`, so every route will fail to transfer and fall back to `fallbackRoute` until you point them at your own contexts.

| Destination | Plain Asterisk | FreePBX |
|---|---|---|
| Extension 100 | `internal,100,1` | `from-did-direct,100,1` |
| Queue 400 | `queues,400,1` | `ext-queues,400,1` |
| Ring group 600 | your own context | `ext-group,600,1` |
| Voicemail of 100 | `internal,vm100,1` | `ext-local,vmu100,1` |

`internal` and `queues` above are placeholders. Confirm yours with `asterisk -rx "dialplan show <context>"`.

### FreePBX

FreePBX is Asterisk, so there is no FreePBX-specific code. Only the configuration locations differ:

1. Confirm the mini-HTTP server and ARI are enabled under Settings > Advanced Settings. Do not edit `ari.conf` directly; put custom users in `ari_additional_custom.conf`.
2. Paste `[jev-router]` into `extensions_custom.conf` and run `fwconsole reload`.
3. Create a Custom Destination pointing at `jev-router,s,1`.
4. Point the DIDs that should use Jev at that Custom Destination.
5. Create the three prompts under System Recordings.
6. Use FreePBX contexts as route destinations, such as `ext-queues,400,1`, `ext-group,600,1`, `from-did-direct,100,1`, or `ext-local,vmu100,1`.

### When it does not connect

| Symptom | Check first |
|---|---|
| Call drops to the fallback immediately | `ari show apps` does not list `jev-router`, so `bun start` never connected: check `ARI_USERNAME`, `ARI_PASSWORD`, `ARI_APP`, and reachability of port 8088 |
| Recording works but the transfer fails | The destination context or extension does not exist; confirm with `dialplan show <context>` |
| Playback fails | The prompt is missing from `/var/lib/asterisk/sounds/custom/`, or the format is wrong |

Step-by-step setup and verification commands: [docs/INTEGRATION.md](docs/INTEGRATION.md).

## What happens when routing fails

`fallbackRoute` is required, and every one of these lands on it:

- **Speech**: no speech, STT failure, STT timeout (8 s)
- **Interpretation**: interpreter failure or timeout (6 s)
- **Decision**: Jev failure or timeout (5 s), a route that was not offered, confidence below `minConfidence`, still needing more information after retries, or no matching route
- **Execution**: a failed transfer, or a PBX error

If the fallback action also fails, the router returns the call to the dialplan (`continue`) and your line after `Stasis()` takes over. If the caller hangs up along the way, nothing is executed.

Every call produces a `RoutingResult` with `outcome` (`jev` / `direct` / `fallback` / `caller-hung-up`), the chosen route, the fallback reason, Jev's choice and probabilities, attempt count, and per-stage timings.

---

# Developer guide

The rest is for people changing the code, adding another PBX, or integrating it into their own system.

## Architecture

```
src/
  router.ts        Decision flow; knows nothing about any PBX
  types.ts         Public types (route, action, session, result)
  config.ts        Validation, defaults, requireEnv
  jev.ts           DecisionProvider: official @typesafe-ai/sdk
  providers/
    speech.ts      OpenAI-compatible STT and ElevenLabs Scribe
    interpreter.ts Optional Claude summarizer (de-identified)
  pbx/asterisk/    ARI adapter (fetch + WebSocket)
  http.ts          /events, /simulate, /api/health, visualizer
  events.ts        SSE event hub
  webhook.ts       Signed webhook delivery
  testing.ts       Scripted session, textSpeech (tests and simulate)
  server.ts        bun start entry point
  demo-server.ts   bun run demo entry point
router.config.ts   Your routes, providers, fallback
public/index.html  Live visualizer
```

The core (`router.ts`, `jev.ts`, `types.ts`) does not know Asterisk exists. A PBX adapter only has to implement `CallSession` to plug into the same decision flow.

Bun runs the TypeScript directly: there is no build step. The package exposes a single entry point, `./src/index.ts`.

## Core abstractions

```ts
interface CallSession {
  readonly call: CallInfo;
  play(media: string): Promise<void>;
  recordUtterance(): Promise<CallerAudio | undefined>;
  execute(action: CallAction): Promise<void>;
}

interface DecisionProvider {
  decide(context: DecisionContext, signal: AbortSignal): Promise<Decision>;
}

interface SpeechToText {
  transcribe(audio: CallerAudio, signal: AbortSignal): Promise<string>;
}

// Optional: summarize the transcript without personal details first
interface CallInterpreter {
  interpret(utterances: string[], signal: AbortSignal): Promise<CallInterpretation>;
}
```

`DecisionContext` carries only the transcript (or summary), your route descriptions, and the facts returned by `facts(call)`. Caller ID and channel data are never sent to Jev unless you put them in `facts`.

## Decision rules

1. `routeDirectly(call)` runs first. Returning a route skips Jev entirely: VIP lists, business hours, dialplan flags.
2. Only routes with a `description` are offered, plus two reserved outcomes: `need-more-information` and `no-matching-route`.
3. Jev sees minimal context: `utterances` (or the interpreter's `summary`) and `facts`.
4. A decision must be a known route with confidence ≥ `minConfidence`. Low confidence or `need-more-information` triggers a retry, up to `maxAttempts`.
5. Invalid results, `no-matching-route`, timeouts, and errors go straight to the fallback.

`evaluateDecision()` is exported so you can test those rules in isolation.

## Extension points

| Goal | Where to change it |
|---|---|
| Support another PBX | Implement `CallSession`, call `router.handleCall(session)` per call |
| Swap the decision model | Implement `DecisionProvider`, pass it as `createCallRouter({ decider })` |
| Swap speech-to-text | Implement `SpeechToText`; OpenAI-compatible and ElevenLabs are built in |
| Decide without audio or a PBX | `router.routeTranscript(call, utterances)` |
| Send less personal data to Jev | Add `interpreter: createClaudeInterpreter()` |
| Feed a CRM or ticketing system | Use `onResult` with `sendWebhook`, or write your own |
| Build your own dashboard | Subscribe to `eventHub`, or consume `GET /events` |
| Add tests | Use `createScriptedSession` and `textSpeech`; no real PBX needed |

## createCallRouter options

| Option | Default | Meaning |
|---|---|---|
| `routes` | required | Your outcomes; only described routes are offered to Jev |
| `fallbackRoute` | required | Route used whenever routing cannot complete safely |
| `prompts.greeting` | required | Audio played on the first attempt |
| `prompts.retry` | same as greeting | Audio played when asking again |
| `maxAttempts` | `2` | How many times to listen |
| `minConfidence` | `0.7` | Below this, retry or fall back |
| `timeouts` | STT 8s / interpreter 6s / Jev 5s | Per-stage timeouts |
| `routeDirectly(call)` | none | Return a route name to skip Jev |
| `facts(call)` | none | Extra facts for Jev, e.g. `{ afterHours: true }` |
| `interpreter` | none | Summarize the transcript before Jev sees it |
| `onResult(result)` | none | Receives every call's `RoutingResult` |
| `logger` | silent | `createJsonLogger()` writes JSON lines |
| `debugTranscript` | `false` | Log transcripts |

## CLI and HTTP endpoints

```bash
bun start                                    # connect to Asterisk and route calls
bun run demo                                 # visualizer + simulated input
bun run simulate "I want a refund" "Order A12345"   # text instead of audio, real Jev
bun test                                     # unit and integration tests
bun run typecheck                            # tsc --noEmit (strict)
```

Both `bun start` and `bun run demo` start the HTTP service:

| Endpoint | Purpose |
|---|---|
| `GET /` | Visualizer page |
| `GET /events` | SSE event stream; sends one `connected` event first |
| `POST /simulate` | Run a full call with a scripted session (real Jev) |
| `GET /api/health` | `{ status: "ok", subscribers }` |

`POST /simulate` example:

```bash
curl -X POST http://localhost:3000/simulate \
  -H "Content-Type: application/json" \
  -d '{"utterances": ["hello?", "I want to return order A12345"]}'
```

Response:

```json
{ "ok": true, "result": { "callId": "simulated-...", "outcome": "jev", "route": "returns" } }
```

## Webhook

Set `WEBHOOK_URL` and every finished call sends a POST. `data` is the full `RoutingResult`:

```json
{
  "event": "call.result",
  "timestamp": "2026-11-04T08:00:00.000Z",
  "data": {
    "callId": "1743321234.42",
    "outcome": "jev",
    "route": "support",
    "action": { "type": "transfer", "destination": "ext-queues,401,1" },
    "decision": {
      "outcome": "support",
      "confidence": 0.93,
      "probabilities": { "support": 0.93, "sales": 0.04 },
      "model": "jev-latest"
    },
    "offeredRoutes": ["sales", "support", "billing", "human-agent"],
    "attempts": 1,
    "timings": { "speechMs": 1180, "decisionMs": 420, "totalMs": 1850 }
  }
}
```

With `WEBHOOK_SECRET` set, requests carry an `X-Jev-Signature` header containing the HMAC-SHA256 hex digest of the raw body:

```ts
import { createHmac } from "crypto";

const expected = createHmac("sha256", process.env.WEBHOOK_SECRET!)
  .update(rawBody)
  .digest("hex");

if (expected !== req.headers["x-jev-signature"]) {
  throw new Error("invalid signature");
}
```

Delivery runs in the background with a 4-second timeout, so it never delays call teardown. Failures log a warning.

## SSE

`GET /events` emits:

| Event | When | Main fields |
|---|---|---|
| `connected` | Stream opened | `time` |
| `call.started` | Call entered Stasis | `callId`, `caller`, `dialed` |
| `call.speaking` | Transcript ready | `callId`, `transcript` |
| `call.thinking` | Classification requested | `callId`, `offeredRoutes`, `utterancesCount` |
| `call.routed` | Route selected | `callId`, `route`, `destination`, `confidence`, `probabilities`, `timings` |
| `call.fallback` | Diverted to fallback | `callId`, `reason`, `route`, `destination`, `error` |
| `call.ended` | Call finished | `callId`, `outcome`, `route`, `fallbackReason`, `timings` |

`destination` holds the route's action object (for example `{ "type": "transfer", "destination": "ext-queues,401,1" }`).

```js
const events = new EventSource("http://localhost:3000/events");
events.addEventListener("call.routed", (e) => {
  const { callId, route, confidence } = JSON.parse(e.data);
  console.log(callId, "->", route, confidence);
});
```

## Tests

```bash
bun test
```

Covers routing decisions, every fallback path, context minimization, recovery after a failed action, caller hang-up, and the exact requests the ARI adapter sends to a mock server. Separate tests check the Jev request/response contract.

## License

[MIT](LICENSE)
