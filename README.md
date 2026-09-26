# Minecraft Status Bot (Discord · Vercel · MongoDB Atlas)

Slash commands, a web dashboard with Discord sign-in, and automatic online/offline alerts. Everything runs as serverless functions on Vercel's free plan.

## Features

| Where | What |
|---|---|
| `/status [name]` | Ping all servers, or one (autocompletes). Anyone can use it. |
| `/server add \| remove \| list` | Manage tracked servers (Manage Server permission). |
| `/server alerts [channel]` | Post alerts in a channel when a server comes online or goes offline. Empty turns alerts off. |
| Dashboard (`/`) | Same management in the browser, for users with Manage Server in that Discord server. |
| `/api/poll` | Called every 5 min by a scheduler. Detects changes and posts alerts. |

States: 🟢 online, 🟡 asleep or starting (e.g. Aternos placeholder), 🔴 offline. "Down" needs 2 failed checks in a row, so one dropped ping doesn't alert. "Up" alerts on the first success.

## Environment variables (all on Vercel unless noted)

| Variable | Where to get it |
|---|---|
| `DISCORD_APPLICATION_ID` | Developer Portal → General Information |
| `DISCORD_PUBLIC_KEY` | Developer Portal → General Information |
| `DISCORD_CLIENT_SECRET` | Developer Portal → OAuth2 → Client Secret (Reset) |
| `DISCORD_BOT_TOKEN` | Developer Portal → Bot → Reset Token. Needed on Vercel for alerts and the dashboard's channel list. |
| `MONGODB_URI` | Atlas → Connect → Drivers (Network Access must allow `0.0.0.0/0`) |
| `MONGODB_DB` | Optional, default `mcstatus` |
| `APP_URL` | Your production URL, e.g. `https://mc-serv-check.vercel.app` (no trailing slash) |
| `CRON_SECRET` | Any long random string: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `DISCORD_GUILD_ID` | Local only, optional: register commands to one guild for instant updates |

Redeploy after changing env vars.

## Setup

1. **Env vars:** add the ones above in Vercel and redeploy.
2. **OAuth redirect:** Developer Portal → OAuth2 → Redirects → add `https://<your-domain>/api/auth/callback`. It must match `APP_URL` exactly.
3. **Commands:** run `npm run register` locally (adds `/server alerts`).
4. **Bot permissions:** the bot needs View Channel, Send Messages and Embed Links in the alerts channel. Re-invite with
   `https://discord.com/oauth2/authorize?client_id=<APP_ID>&scope=bot+applications.commands&permissions=19456`
   or grant those in the channel settings. `/server alerts` posts a test message and tells you if something's missing.
5. **Scheduler:** at https://cron-job.org create a job:
   - URL: `https://<your-domain>/api/poll`
   - Schedule: every 5 minutes
   - Advanced → Headers: `Authorization: Bearer <CRON_SECRET>`
   - (If you can't set headers, use `https://<your-domain>/api/poll?key=<CRON_SECRET>` instead.)
   - Hit "Test run". You should get `{"ok":true,"checked":N,...}`.
6. **Interactions endpoint:** unchanged, `https://<your-domain>/api/interactions`.

## Testing locally

```bash
npm run check -- Animos900.aternos.me        # ping with the bot's own code
npx vercel dev                               # full app on localhost:3000
```
For Discord to reach `vercel dev`, expose it with `cloudflared tunnel --url http://localhost:3000` and temporarily point the Interactions URL and OAuth redirect at the tunnel. Don't add a `dev` script that calls `vercel dev`; Vercel refuses to invoke itself recursively.

## Layout

```
api/interactions.js     Discord slash commands (signature check, deferred replies)
api/poll.js             Scheduled check + alerts (CRON_SECRET protected)
api/dashboard.js        JSON API for the dashboard (?op=me|servers|check|channels|alerts)
api/auth/*.js           Discord OAuth: login, callback, logout
lib/service.js          Add/remove/alerts logic shared by bot and dashboard
lib/monitor.js          Up/down state machine and alert posting
lib/auth.js             Sessions (MongoDB, 7 days), cookies, CSRF checks
lib/db.js  lib/mc.js  lib/discord.js  lib/commands.js
public/index.html       Dashboard
scripts/check.js  scripts/register-commands.js
```

Security notes: sessions are random IDs in an HttpOnly, Secure, SameSite=Lax cookie. Writes require a JSON body and a same-origin `Origin`. Guild permissions are re-checked against Discord every 5 minutes.
