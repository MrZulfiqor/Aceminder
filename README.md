# Aceminder

AI revision tests with XP, streaks, achievements and a leaderboard.

## Run it

```bash
cp .env.example .env      # then fill in GEMINI_API_KEY (and the sign-in settings below)
python server.py          # Python 3.9+, no packages needed
```

Open <http://localhost:8000>. When it starts, the server prints which sign-in methods are on.

## Accounts

Email + password sign-up works with no setup. Signed-in players can see their **sign-in methods** in
the profile, where they can connect Google or Apple to an existing account and set or change a
password.

Google and Apple use a server-side redirect (OpenID Connect `form_post`, with state and nonce
checks). No Google or Apple script runs on the page, so sign-in also works in home-screen apps,
in-app browsers and with ad blockers. The buttons stay greyed out until the matching setting is in
`.env`.

### Google sign-in

1. Go to Google Cloud Console → **APIs & Services → OAuth consent screen** and set it up
   (External, app name "Aceminder", your support email). Publish it when you go live.
2. **Credentials → Create credentials → OAuth client ID → Web application.**
3. Under **Authorized redirect URIs** add, exactly:
   - `http://localhost:8000/api/auth/google/callback` (local testing; open the site at
     `localhost`, not `127.0.0.1`)
   - `https://YOUR-DOMAIN/api/auth/google/callback` (once online)
4. Put the client ID in `.env` as `GOOGLE_CLIENT_ID=...` and restart. No client secret is needed.

### Apple sign-in

Apple requires a paid Apple Developer account and a public **HTTPS** address. Apple refuses
`localhost`, so for testing use a tunnel such as `cloudflared` or `ngrok` and set `PUBLIC_URL` to
its address.

1. developer.apple.com → **Certificates, Identifiers & Profiles → Identifiers**:
   - Create an **App ID** with **Sign in with Apple** ticked.
   - Create a **Services ID** (for example `com.yourname.aceminder.web`). Tick **Sign in with
     Apple → Configure**, choose the App ID, and add:
     - Domains: `YOUR-DOMAIN`
     - Return URLs: `https://YOUR-DOMAIN/api/auth/apple/callback`
2. In `.env` set `APPLE_CLIENT_ID=<the Services ID>` and `PUBLIC_URL=https://YOUR-DOMAIN`, then restart.

### Password reset emails

Set the `SMTP_*` values in `.env` (see `.env.example`). Without them, the "Forgot password?" link
explains that resets are not set up.

## Going online

Run behind an HTTPS reverse proxy (Caddy, nginx, Cloudflare Tunnel…) with `HOST=0.0.0.0` (or keep
`127.0.0.1` if the proxy is on the same machine) and `PUBLIC_URL=https://YOUR-DOMAIN`. Cookies are
then marked `Secure` automatically.
