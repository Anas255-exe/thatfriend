# 🧳 ThatFriend

**Nobody wants to be "that friend" who books the whole trip, so we built one.**

Text ThatFriend on Telegram: *"kashmir next weekend w aman, riya n kabir, 15k each"*, or a meetup: *"dinner + movie saturday w the gang in blr"*. It will:

1. **Vibe-check everyone first.** It DMs each friend on your behalf (text, Sarvam voice note or a voice "call", in their own language): what do you want, any must-dos, any hard no's, budget?
2. **Merge it into one plan.** Claude Code does **web research** (reviews, Reddit, blogs) and builds a plan that blends everyone's input. It shows *who wanted what → what it did*, e.g. "Kabir: no 5am + veg → shikara at 9am, veg dhaba picks ✅".
3. **Show real spots in the chat.** Every stay, place and café is a card with a photo, why people rate it, a review vibe, the price, and **Google Maps** and review links. No need to open another site.
4. **Final 👍 from the squad,** then one cart with the per-person split. You approve and type the bank OTP.
5. **Book & split.** It books transport, stays, tickets and table reservations, sends confirmations to everyone, and sends each friend a UPI request for their share.

It talks like your friend, not a travel brochure: casual, Gen Z, a bit of Hinglish.

> Hackathon proof of concept (festive & holiday theme). **Bookings and payments use a sandbox.** No real money moves and no card data is ever entered. The OTP comes from a simulated bank.

## Architecture

```
 Telegram (you + friends)
        │
        ▼
 ┌──────────────┐   OpenAI-compatible   ┌───────────────────────┐
 │  ZeroClaw    │ ────────────────────▶ │ Claude Code bridge    │ ──▶ `claude -p` (your Claude account)
 │  agent       │   /v1/chat/completions│ (src/llm.js)          │
 │  runtime     │                       └───────────────────────┘
 │  + skill     │ ── http_request ─────▶ ThatFriend engine (src/engine.js)
 └──────────────┘   /api/agent/message    BRIEF → PLANNING → FRIENDS → APPROVAL → OTP → BOOKING → DONE
                                            ├─ itinerary planner   (Claude Code, offline fallback)
                                            ├─ squad poller         (texts friends, AI persona sub-agents)
                                            ├─ cart + OTP checkout  (src/booking.js, sandbox)
                                            └─ booking providers + UPI split (sandbox)
```

- **LLM layer:** Claude Code in headless mode (`claude -p --output-format json`) on your own Claude login. Every call falls back to a deterministic offline planner, so a live demo never stalls.
- **ZeroClaw** (`zeroclaw/home/`) is set up with: a `custom.claudecode` model provider pointing at the bridge, a `telegram.thatfriend` channel, the `trip-concierge` skill, and `http_request` allowed to reach localhost.
- **Native mode:** the Node server can also talk to Telegram directly, with inline buttons and deep links for friends. This is the simplest setup for the demo.
- **Zero npm dependencies.** Node ≥ 20 only.

## Sponsor integrations

Every integration works without a key: it falls back to a local equivalent, so the demo never breaks. Add a key and it goes live.

| Sponsor | What it does in ThatFriend | Env vars | Code |
|---|---|---|---|
| **Sarvam AI** | Invites translated into each friend's language (`mayura:v1`, code-mixed). Bulbul v3 voice notes. **Voice "calls" without telephony**: a ring message plus a voice note on Telegram, or a full in-browser call screen with push-to-talk in the demo. Saaras v4 transcribes inbound Telegram voice notes and browser mic audio. `sarvam-105b` is the second LLM in the chain (Claude Code → Sarvam → offline). | `SARVAM_API_KEY`, `DEMO_FRIEND_LANGS` | [src/sarvam.js](src/sarvam.js) |
| **Flagsmith** | Per-user flags (identity = user, traits = channel/role/language): `voice_notes`, `voice_calls`, `friend_translation`, `simulate_friends`, `auto_book_limit` (value, ₹), `llm_chain`, `booking_failure_drill`. The demo has a live flag panel; toggles there act as local overrides. | `FLAGSMITH_ENVIRONMENT_KEY` | [src/flags.js](src/flags.js) |
| **NudgeBee** | Ops layer for booking. A checkout above `auto_book_limit` runs the approval-gated runbook `high-value-trip-checkout`: we trigger a NudgeBee workflow webhook, and its approval step calls back `POST /api/nudgebee/approval/:token` (the organizer can also sign off in chat). Booking runs as a self-healing runbook: retry, fail over to an alternate provider, and send `booking_failed` / `booking_recovered` / `trip_booked` events to NudgeBee. | `NUDGEBEE_WEBHOOK_URL`, `NUDGEBEE_WEBHOOK_SECRET` | [src/nudgebee.js](src/nudgebee.js) |

> NudgeBee is an AI-ops / runbook platform. It doesn't process payments. Payments stay in our sandbox OTP checkout, and NudgeBee supplies the guardrails and autonomous recovery around them.

**Flagsmith setup:** create a project, add the features above with the same names (give `auto_book_limit` a numeric value, e.g. 60000), and copy the environment's client-side key into `.env`.

**NudgeBee setup:** in the runbook server, create a workflow with a webhook trigger, an `approval` task, then an HTTP step that POSTs `{"approved": true}` to the `approval_callback` URL from the payload. Put the webhook URL and secret in `.env`. `PUBLIC_URL` must be reachable from NudgeBee, so use a tunnel such as `cloudflared` if you run locally.

## Run it

```powershell
cd thatfriend
copy .env.example .env      # optional: add TELEGRAM_BOT_TOKEN
.\start.ps1                 # or: node src/server.js
```

- Landing page: http://localhost:8787
- **Live demo** (organizer chat, friends' phones, agent brain): http://localhost:8787/demo
- Headless test: `node test/e2e.js`

### Turn on Claude Code as the brain

The server auto-detects the `claude.exe` that ships with the Claude desktop app. It needs to be logged in once outside the app:

```powershell
& (Get-ChildItem "$env:LOCALAPPDATA\Claude-Data\*\claude-code\*\*\claude.exe" | Select-Object -First 1).FullName
# then type /login, finish in the browser, and /exit
```

The demo header switches from **"offline planner"** to **"Claude Code"** once it works.

### Telegram

1. Create a bot with **@BotFather** → `/newbot` → put the token in `.env` as `TELEGRAM_BOT_TOKEN`.
2. `.\start.ps1`, then message your bot: *"Plan Ooty next weekend with Aman, Riya and Kabir, 15k per person"*.
3. On "Ask the squad", the bot gives you an invite link (`t.me/<bot>?start=join_<trip>`). Friends who tap it get messaged privately by the bot. Telegram only lets bots message people who have started them. For a solo demo, tap **"🤖 Simulate friends who haven't joined"**.

### ZeroClaw mode

```powershell
# once: store the bot token in ZeroClaw (masked prompt)
& "$env:USERPROFILE\tools\zeroclaw\zeroclaw.exe" --config-dir .\zeroclaw\home config set channels.telegram.thatfriend.bot-token
# .env: TELEGRAM_MODE=zeroclaw   (so Node stops polling and only pushes outbound messages to friends)
.\start.ps1                 # terminal 1
.\start-zeroclaw.ps1        # terminal 2
```

ZeroClaw also has a WhatsApp channel (`channels.whatsapp.<alias>`). Pointing the same agent at WhatsApp is just a config change.

## 60-second demo script

1. Open `/` and pitch the problem ("no one wants to be that friend").
2. Open `/demo` and click the sample prompt.
3. Pick option A, then type a tweak: "add the toy train".
4. Click **Ask the squad**. Each friend's phone **rings** (📞 Sarvam voice call in Hindi / Tamil / English). Untick "AI-simulate friends" and hold 🎙️ to answer as a friend yourself, or let the AI personas reply.
5. In the Flagsmith panel, set `auto_book_limit` below the cart total and turn on `booking_failure_drill`.
6. Click **Approve & book**. The **NudgeBee approval gate** opens; click **Sign off**, copy the OTP from the yellow SMS bubble, and send it.
7. Watch the Agent Brain panel: the stay provider goes down, and the NudgeBee runbook retries, fails over and recovers. Each friend gets their PNR, a voice note in their language and a UPI request.

## Flagsmith: kill switches + live experiment

- **Kill switches** (flip OFF in Flagsmith and the agent stops on the next message, no redeploy):
  - `payments_enabled`: checkout blocked, cart saved.
  - `autonomous_booking`: the agent only drafts a booking checklist.
  - `friend_outreach`: the agent won't message anyone on your behalf.
- **Experiment "How should ThatFriend invite friends?"** on the multivariate flag `invite_style` (`text` control vs `voice_note` vs `call`), using **Flagsmith Experimentation**:
  - The official Node SDK (`@flagsmith/nodejs`, `enableEvents: true`) evaluates `getExperimentFlag('invite_style', friendId)`, which records exposures.
  - `trackEvent('friend_said_yes')` and `trackEvent('friend_replied', seconds)` record conversions.
  - The primary metric is **Friend says yes** (occurrence, higher is better).
  - Outcomes are also written as identity traits (`invite_variant`, `invite_vote`, `reply_seconds`).

See [DEMO.md](DEMO.md) for the 3-minute presenter script.

## AI disclosure

Built with **Claude Code** (Anthropic) as the coding assistant, as the hackathon rules require. At runtime, ThatFriend uses Claude Code (headless `claude -p`) and Sarvam-105b as its LLMs.

## Roadmap (post-hackathon)

- Real providers: IRCTC / redBus / MakeMyTrip / hotel APIs, plus Razorpay with UPI Autopay & card OTP flows.
- WhatsApp Business channel; group-chat mode where the agent moderates the poll in-thread.
- Calendar invites, packing lists, weather-aware re-planning, refunds & cancellations.
- Spend limits and per-booking confirmations as configurable guardrails.
