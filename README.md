# Cloudflare Turnstile → Automatic Telegram notification → Redirect

Vercel-ready static HTML and plain JavaScript functions, **no React/TSX, no npm dependencies**.

## Behavior

1. A visitor opens the deployed Vercel verification page; the polished verification page loads Cloudflare Turnstile.
2. On successful challenge, the frontend submits the token to `/api/verify`.
3. The backend validates the token with Cloudflare **Siteverify** (checks both `success` and the hostname inferred from the request).
4. After approval, the server reads available IP/approximate geo from **Vercel-provided request headers** plus limited browser metadata. The page **discloses this automatic transmission**.
5. The server sends the structured HTML notification to Telegram, then returns a fixed destination URL.
6. The browser displays the success/loading animation for ~2.3 seconds and navigates to `DEST_URL`.

No phone-number form, device GPS, visitor contact details, `GATE_ORIGIN`, or `TICKET_SECRET` is used. Turnstile is anti-bot protection, **not proof of human identity**.

## Files

```
public/index.html      Styled verification page (HTML, CSS, browser JS)
api/config.js          Public site key response
api/verify.js          Vercel Node.js function entry point
lib/verification.js    Siteverify, metadata and Telegram delivery
.env.example           Environment variable template
vercel.json            Vercel static + function configuration
package.json           JS ES-module declaration
```

## Deploy on Vercel

1. Unzip this project and upload the **contents** to a GitHub repository, or deploy using the Vercel CLI from this folder (`npx vercel` then `npx vercel --prod`).
2. Import the repository into Vercel. Select **Framework Preset: Other**; no framework build is needed. Use the checked-in `vercel.json` (static folder: `public`, functions: root `api/`).
3. In Vercel **Project → Settings → Environment Variables**, add:
   - `DEST_URL`: the full **HTTPS** destination URL (e.g. `https://my-company.com/welcome`).
   - `TURNSTILE_SITE_KEY`: Cloudflare widget's public site key.
   - `TURNSTILE_SECRET`: Cloudflare widget's private secret.
   - `TELEGRAM_BOT_TOKEN`: BotFather token (secret).
   - `TELEGRAM_CHAT_ID`: your private chat or group chat ID.
4. Deploy/redeploy to apply environment variables. Configure the site widget in Cloudflare Turnstile to allow the **verification page's hostname**. If using the default Vercel domain, use its exact hostname. Custom domains are supported.
5. Start a conversation with the bot in Telegram or invite it to your group and give it appropriate posting rights.
6. Visit your verification site and complete a challenge. Verify that a Telegram notification is received and the destination opens.

**Caution:** Add each hostname you use to Cloudflare Turnstile's allowed hostnames. Preview deployments on random `*.vercel.app` hostnames are not automatically allowed; the hostname is detected automatically but must still be permitted by Turnstile.

## Is `TICKET_SECRET` needed?

No. The prior version issued a signed ticket for a destination-site form. This version sends Telegram notification during verification and redirects directly, so the destination does not validate any ticket.

## Data collected

- Public client IP: Vercel's `x-forwarded-for` header (Vercel overwrites it to reduce spoofing).
- Country/city/region: Vercel geolocation request headers, which are **estimates from IP**, sometimes inaccurate if on VPN/mobile network.
- Browser/OS: user-agent **heuristics**, not guaranteed correct.
- Browser language, timezone, and rough network type, **if supported**.
- Verification timestamp (UTC).

**Cannot access silently:** phone number, SIM/telecom subscriber name, GPS coordinates, exact street address, contacts. The code does not attempt any of these.

Vercel may not provide geo information when testing locally; `Unavailable` is expected. If placing another proxy such as Cloudflare in front of Vercel, verify that the IP corresponds to the real visitor rather than a proxy IP.

## Security / privacy

- Cloudflare Turnstile tokens are verified on the **server**, are single-use, and expire. `result.hostname` must equal the hostname of the incoming request.
- Browser requests must originate from the same verification-site origin, the destination is fixed in server config, and bot credentials are stored only in Vercel environment variables.
- Telegram text values are HTML-escaped. Requests and responses are not intentionally cached.
- If Telegram delivery fails, the page offers the visitor a fresh verification attempt rather than claiming a notification was sent.
- The gate page prominently discloses metadata sharing. Ensure your own privacy notice, retention policy, and lawful basis satisfy applicable law, especially if sending IP addresses to Telegram/third parties. No phone or GPS is collected.
- Use Vercel/Cloudflare WAF or rate limiting if abuse or traffic volume increases. For strong guaranteed delivery, use a durable queue with retries; synchronous Telegram delivery can fail if Telegram is unavailable.

## Test locally (Node 20+)

```bash
npm test
```

To actually preview full Vercel routing locally, link the project with Vercel and run `npx vercel dev`; supply environment variables via Vercel settings or your local development environment. Local Siteverify with real Turnstile site keys requires a configured allowed hostname; see https://developers.cloudflare.com/turnstile/troubleshooting/testing/ .
