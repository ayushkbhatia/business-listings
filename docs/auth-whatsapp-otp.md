# Phone OTP over WhatsApp

Decided 2026-08-23. Supersedes the SMS-provider assumption in
`handoffs/handoff-0-foundation/README.md` §5. The handoff's requirement is unchanged —
"OTP by SMS is a first-class login path, not a fallback" — only the carrier changes.
Implementation lands at KICKOFF checkpoint 2 with the rest of `lib/auth`.

## Provider

**Bird** (bird.com, formerly MessageBird), EU1 region. Not Sendbird — a different company
with a different API. The key prefix carries the region: a `bk_eu1_` key authenticates
only against `https://eu1.platform.bird.com`, and returns 404 RouteNotFound elsewhere.

Auth header is `Authorization: Bearer <key>`, not the `AccessKey` scheme used by the older
`api.bird.com` Channels API.

Scopes verified on the current key:

| Scope | State |
|---|---|
| `whatsapp` read | granted — `GET /v1/whatsapp/messages` returns 200 |
| `whatsapp` write | granted — `POST /v1/whatsapp/messages` reaches field validation |
| `whatsapp_management:read` | **not granted** — cannot list channels or templates |
| `sms:read` | **not granted** |
| `emails:read` | **not granted** |

## Why a hook and not a provider setting

Supabase Auth ships native phone providers for Twilio, MessageBird (legacy REST),
Vonage and TextLocal, and it supports WhatsApp as a channel **only** for Twilio. Bird's
new platform API is none of those.

The supported path for any other carrier is the **Send SMS Hook**: Supabase generates and
stores the OTP itself, then POSTs it to an HTTPS endpoint we own and lets us deliver it
however we like. Supabase stays the identity source of truth — users, sessions, rate
limits and `verifyOtp` are unchanged. Only the last mile moves to WhatsApp.

```
signInWithOtp({ phone })
  → Supabase Auth generates + stores the OTP
  → POST  /api/auth/send-otp          (Send SMS Hook, Standard Webhooks signature)
  → POST  eu1.platform.bird.com/v1/whatsapp/messages
  → buyer receives the code in WhatsApp
verifyOtp({ phone, token, type: 'sms' })
  → Supabase mints the session
```

The hook is channel-agnostic despite the name. Nothing in the payload says SMS.

## Hook payload

```json
{
  "user": { "id": "...", "phone": "971506412288" },
  "sms":  { "otp": "481920" }
}
```

Signed as a Standard Webhook. The secret arrives as `v1,whsec_…`; strip the `v1,` prefix
before verifying. An unverified hook request is an open OTP oracle — verify before reading
the body, and reject on failure without echoing why.

## Bird request

```bash
curl -X POST https://eu1.platform.bird.com/v1/whatsapp/messages \
  -H "Authorization: Bearer $BIRD_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "to": "+971506412288",
    "template": {
      "name": "<authentication template name>",
      "language": "en",
      "components": [
        { "type": "body",   "parameters": [{ "type": "text", "text": "481920" }] },
        { "type": "button", "parameters": [{ "type": "text", "text": "481920" }] }
      ]
    }
  }'
```

`to` must be E.164 with a leading plus. Supabase hands the phone over **without** the plus;
add it. Returns 202 on accept — delivery is asynchronous, so a 202 is not proof of receipt.

The button component is what makes the WhatsApp one-tap copy affordance appear. Meta
requires both components to carry the same value on an authentication template.

## Built, and what it is wired to — handoff 2 step 2

The flow is complete and the delivery leg is pluggable, which is what makes the
rest of it testable while WhatsApp is blocked.

```
lib/auth/otp/sender.ts     the interface: one method, carry six digits
lib/auth/otp/bird.ts       Bird EU1, the WhatsApp authentication template
lib/auth/otp/console.ts    prints the code; refuses to construct in production
lib/auth/otp/index.ts      resolveOtpSender() — Bird when configured, console
                           in development, and a throw in production rather
                           than a silent downgrade
app/api/auth/send-otp      the hook: verify the signature on the raw body,
                           check the per-number cooldown, then deliver
lib/auth/webhook.ts        Standard Webhooks verification, constant time
lib/auth/throttle.ts       the two policies, and why they differ
lib/auth/flow.ts           the seven states board 7a draws
```

## What the live project actually does

Checked against the project rather than the documentation, 24 Aug 2026.

| | State |
|---|---|
| `external.phone` | **false**. Flipping it needs the Management API and a personal access token, which this environment does not have. |
| `external.email` | true. |
| Email OTP delivery | Works, on the **built-in SMTP: two messages an hour**. That is a development convenience, not an email service. A real SMTP provider is required before launch, and it is a separate decision from the WhatsApp one. |
| Reserved TLDs | Rejected as undeliverable — `someone@harbour.example` comes back `email_address_invalid`. Worth knowing before writing a fixture. |
| OTP length | The project issues **eight** digits. Board 7a says six. `OTP_LENGTH` in `lib/auth/constants.ts` is 6 and only sizes the field; the field itself accepts four to ten so a mismatch cannot lock anybody out. Set the project to 6 to make the hint true. |
| OTP expiry | Set the project's `MAILER_OTP_EXP` / `SMS_OTP_EXP` to 600 to match the ten minutes the screen and the message quote. |

## Testing the round trip without a send

`POST /auth/v1/admin/generate_link` returns the OTP Supabase generated and sends
no mail. That is the one leg blocked on outside configuration, so it is the one
leg worth substituting — everything after it in
`tests/integration/auth-flow.test.ts` is the production path: `verifyOtp`, the
profile row, the roles claim, the suspension check and the throttle.

It needs `SUPABASE_SECRET_KEY`, which CI does not have, so those tests skip
there and say so. Giving CI a production service key is a decision to take
deliberately, not one to make by writing a test that needs it.

## A wrong code and an expired one are the same answer

`verifyOtp` reports both as `otp_expired`, "Token has expired or is invalid",
and it is right to: telling somebody a code expired confirms it was once valid.
So the verify screen never claims to know which, and says "that code did not
match" with an offer of a fresh one.

`link_expired` — the state board 7a draws — is a **link** state. It comes from
`/auth/callback`, where Supabase does report expiry explicitly in the query
string, and it is reached by an emailed link rather than by a typed code.

## What is still missing

1. **A Meta-approved authentication template.** Category must be `authentication`, with a
   single `otp` variable. Meta approves the template, not Bird, and the WhatsApp Business
   number must clear business verification first. Budget days, not hours.
2. **`BIRD_WHATSAPP_CHANNEL_ID`** — read it from the Bird dashboard, or grant the key
   `whatsapp_management:read` so it can be discovered from the API.
3. **Phone provider is off** in Supabase (`phone: false`, `sms_provider: twilio`).
   Enable phone auth and register the hook URL under Authentication → Hooks.
   Needs the Management API and a personal access token.
4. **A real SMTP provider.** The built-in one sends two messages an hour and
   only exists for development. Until it is replaced, the email path works in
   principle and not in volume.
5. **`AUTH_HOOK_SECRET`** — generate with `openssl rand -hex 32`, paste the same value both
   sides. The endpoint answers 500 without it rather than accepting unsigned
   requests, because an unverified hook is an open OTP oracle.

## Open decision: fallback

WhatsApp-only login locks out anyone without WhatsApp, and silently fails when a number is
registered to WhatsApp on a different handset. Bird's current key has no SMS scope, so
there is no fallback today.

Three options, in order of preference:

1. **WhatsApp first, SMS fallback** after a delivery failure or a 30-second timeout.
   Needs `sms` scope on the Bird key and an SMS-capable sender.
2. **WhatsApp first, email magic link fallback.** No extra carrier, but buyers arriving on
   mobile from a category page rarely want to switch to email.
3. **WhatsApp only.** Cheapest, and defensible in the UAE where WhatsApp is near-universal
   in trade, but it is a hard floor on who can sign up.

## Cost note

WhatsApp authentication messages are priced per delivered message by destination country,
and UAE is a comparatively expensive market. Metering matters: a resend button with no
cooldown is a direct cost leak. Supabase's own OTP rate limit is the first line, but put a
per-number cooldown in the hook as well.
