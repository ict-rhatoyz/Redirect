# Visitor → Telegram notification → loading animation → redirect

A small Vercel project using static HTML/CSS/JavaScript and Node.js serverless functions; no Next.js, React, TSX, VPS or database is required.

## How it behaves

1. Visitor opens the page and sees a transparent privacy notice and a polished loading screen.
2. The browser calls `/api/config` to get the **fixed** destination URL and the optional Turnstile mode.
3. **By default Turnstile is OFF**. The page immediately POSTs to `/api/verify` without any click or challenge.
4. The backend reads the incoming request's public IP (as provided by Vercel), approximate Vercel region/country/city headers, and browser metadata. It tries to send a formatted Telegram message using **server-side bot credentials**.
5. A loading animation is shown for at least ~2.3 seconds while the call runs. Then the browser redirects to `DEST_URL`.
6. If Telegram is unavailable, the redirect still happens. If Turnstile is configured but fails, the redirect still happens. These are **best-effort** notifications, not guaranteed delivery.

No phone number, SIM information, contacts or precise GPS are accessed. Network connection type and browser language/time zone may be unavailable. IP-based location is approximate. The page includes a visitor-facing disclosure. You must have an appropriate lawful basis and privacy notice for forwarding personal data to Telegram; assess applicable privacy rules and Telegram as a third-party recipient before deploying.

## Configuration

Set these variables in Vercel's **Project → Settings → Environment Variables**:

```dotenv
DEST_URL=https://yourdestination.example/
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_or_group_id
```

The destination must be an HTTPS URL. It is set by the operator, not by a visitor, to avoid open redirects. **There is no `GATE_ORIGIN` or `TICKET_SECRET`.** The incoming hostname is determined from the request.

### Optional Cloudflare Turnstile (not required)

Leave it disabled for automatic visits:

```dotenv
TURNSTILE_MODE=off
```

If you choose to show an **optional** Turnstile widget, set:

```dotenv
TURNSTILE_MODE=optional
TURNSTILE_SITE_KEY=your_site_key
TURNSTILE_SECRET=your_secret_key
```

With `optional` and *both* keys, visitors may see the widget briefly. Successful checks are recorded as `Passed`; failed, expired, or unavailable checks are marked accordingly. The page continues automatically after up to ~4 seconds without requiring a click; therefore **this mode is NOT a security barrier**. For actual bot protection you would need a separate enforcement mode, rate-limiting or Vercel WAF.

Providing keys without `TURNSTILE_MODE=optional` does nothing, and removing either key disables the optional widget without breaking the website.

## Deploy to Vercel

1. Push the **contents** of this folder to a GitHub repository.
2. In Vercel, choose **Add New → Project**, import that repository, and use **Framework Preset: Other** (no build command).
3. Configure `DEST_URL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` as project environment variables. Leave Turnstile keys unset unless you actually want the optional widget.
4. Deploy and visit the generated `*.vercel.app` domain. You can later connect a custom domain, without adding any gate URL env setting.
5. Check that Telegram received the visitor notification and that the destination opened.

To create a Telegram bot, start a conversation with `@BotFather` in Telegram and use the token it gives you; obtain the destination chat ID separately. Keep the bot token secret and do not commit it to Git.

## Project files

```text
public/index.html       Static website, animated loading and redirect UI
api/config.js           Public, read-only frontend configuration endpoint
api/verify.js           Same-origin visit processing endpoint
lib/verification.js     Optional check, metadata formatting, Telegram delivery
vercel.json             Static assets + serverless function configuration
.env.example            Configuration reference
package.json            Node.js test script
test/verify.test.js      Automated tests
```

## Tests

```bash
npm test
```

Tests mock Telegram/Cloudflare HTTP responses. They are **not** proof of a deployed site or live notification delivery.

## Operational considerations

- **Telegram is best effort**: if the bot token is invalid, Telegram fails, or the request times out, visitors still redirect. This intentionally prioritizes visitor navigation over notification delivery.
- **No Turnstile by default**: visitors and automated clients can trigger the endpoint. Add Vercel WAF/edge rate-limiting if you expect substantial or abusive traffic; an `Origin` check alone is insufficient against scripted clients.
- **Privacy**: an IP address and detailed browser metadata can be personal data. Do not use the gateway for covert tracking; provide an accessible privacy policy, a lawful basis, appropriate retention, and disclosure of transfers to Telegram.
- **Some metadata can be missing** due to device restrictions, proxies, VPNs, or Vercel's available geolocation headers.
- **Do not blindly trust externally supplied forwarding headers** if porting this code to another hosting provider. The IP extraction assumes Vercel's proxy handling.
- Set reasonable alert/notification rate limits to avoid Telegram spam.
