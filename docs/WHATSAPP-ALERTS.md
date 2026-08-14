# WhatsApp alerts setup

Script Screener can send alerts to WhatsApp:

| Channel | When |
|---------|------|
| **HOT radar** | New High Conviction additions after Swing Auto snapshot |
| **Evening GTT** | Post-close GTT digest (same cron as email) |
| **EXIT alerts** | Open journal EXIT summary (same cron as email) |

Email stays primary; WhatsApp is optional. Toggle per channel in **Admin → Features** (or `config/alerts.yaml` → `whatsapp.*`).

Official free WhatsApp APIs are limited. Use one of these providers:

| Provider | Best for | Difficulty |
|----------|----------|------------|
| **Twilio sandbox** | Reliable personal alerts | Easy (recommended) |
| **CallMeBot** | Free personal only | Flaky (bot number changes) |
| **Meta Cloud API** | Business / long-term | Harder (Meta Business) |

---

## Option A — Twilio WhatsApp sandbox (recommended)

1. Create a free account at [twilio.com/try-twilio](https://www.twilio.com/try-twilio).
2. Copy **Account SID** and **Auth Token** from the Twilio Console.
3. Open **Messaging → Try it out → Send a WhatsApp message** (sandbox).
4. On your phone, WhatsApp the Twilio sandbox number and send the join code shown
   (example: `join <two-words>`).
5. Add to `.env`:

```bash
WHATSAPP_TO=9198XXXXXXXX
TWILIO_ACCOUNT_SID=ACxxxxxxxx
TWILIO_AUTH_TOKEN=your_auth_token
# optional — sandbox default is already set in code:
# TWILIO_WHATSAPP_FROM=whatsapp:+14155238886
```

6. Test:

```bash
pnpm --filter @sv/data-adapters whatsapp:test
```

Or from UI: **Admin → Features → Send WhatsApp test**.

Sandbox limits: only numbers that joined the sandbox receive messages. Fine for personal use.

---

## Option B — CallMeBot (if Twilio is blocked)

CallMeBot **does not** have a web signup for the API key. You must activate via WhatsApp chat.

1. Open the **current** instructions (number changes):  
   https://www.callmebot.com/blog/free-api-whatsapp-messages/
2. Add the **bot number shown on that page** to Contacts (today often `+34 623 75 84 18` — verify on the site).
3. WhatsApp that contact exactly:

```text
I allow callmebot to send me messages
```

4. Wait for a reply like: `API Activated … Your APIKEY is 123123`.
   - If nothing in 2 minutes, wait **24 hours** and retry (CallMeBot rate-limits activations).
   - Lost key? Send: `Recover APIKey`
5. Add to `.env`:

```bash
WHATSAPP_TO=9198XXXXXXXX
WHATSAPP_CALLMEBOT_APIKEY=123123
```

6. Test with `pnpm --filter @sv/data-adapters whatsapp:test`

### Why you often “can’t get ApiKey”

- Wrong / outdated bot number (always copy from the CallMeBot page).
- Activation phrase must match **exactly**.
- Bot is overloaded — try again after 24h.
- WhatsApp blocked the temporary bot number in some regions.

If it keeps failing, use **Twilio** instead.

---

## Option C — Meta WhatsApp Cloud API

Needs a Meta Business account, app, and WhatsApp product. Free-form messages only work inside the 24h customer window (or with approved templates).

```bash
WHATSAPP_TO=9198XXXXXXXX
WHATSAPP_ACCESS_TOKEN=EAAB...
WHATSAPP_PHONE_NUMBER_ID=1234567890
```

---

## Feature flags

```yaml
# config/alerts.yaml
whatsapp:
  swing_radar: true
  evening_gtt: true
  exit_alerts: true
```

Admin → Features can override these (stored in `app_settings`). Env hard-off still wins:

```bash
WHATSAPP_ALERTS=0   # disable WhatsApp without removing credentials
```

API:

- `GET /api/v1/admin/whatsapp/status`
- `POST /api/v1/admin/whatsapp/test`

Provider priority when multiple are set: **Twilio → CallMeBot → Meta**.
