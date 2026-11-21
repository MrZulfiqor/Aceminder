# Aceminder

AI revision tests with XP, streaks, achievements and a leaderboard.

## Run it

```bash
cp .env.example .env      # then fill in GEMINI_API_KEY
python server.py          # Python 3.9+, no packages needed
```

Open <http://localhost:8000>.

## Accounts

Players sign up with a username, email and password and log in with their email or username.
Nothing needs setting up for this.

**Forgot password.** Every new account gets a one-time **recovery code**
(like `ABCD-EFGH-JKMN-PQRS`) right after sign-up. The player copies or downloads it, then ticks
"I saved it". On the log-in screen, **Forgot password?** asks for the email or username, the
recovery code and a new password. A used code is replaced by a new one straight away. In the
profile, players can change their password or make a new recovery code, which needs their
password.

If you also set the `SMTP_*` values in `.env`, the forgot-password screen offers an
**email me a reset link** option too.

### Delete every account

Stop the server, then run:

```bash
python3 -c "import sqlite3; c=sqlite3.connect('aceminder.db'); c.execute('PRAGMA foreign_keys=ON'); [c.execute(f'DELETE FROM {t}') for t in ('sessions','resets','tests','results','users')]; c.commit(); c.execute('VACUUM')"
```

## Going online

Run behind an HTTPS reverse proxy (Caddy, nginx, Cloudflare Tunnel…) with `HOST=0.0.0.0` (or keep
`127.0.0.1` if the proxy is on the same machine) and `PUBLIC_URL=https://YOUR-DOMAIN`. Cookies are
then marked `Secure` automatically.
