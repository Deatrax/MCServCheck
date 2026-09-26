# Minecraft Status Bot (Discord · Vercel · MongoDB Atlas)

Slash-command bot using Discord HTTP interactions, so it runs entirely as one serverless function. No always-on process.

## Commands

| Command | Who | What |
|---|---|---|
| `/status` | everyone | Ping every tracked server |
| `/status name:<name>` | everyone | Ping one server (autocompletes) |
| `/server add name:<n> address:<host[:port]> [edition]` | Manage Server | Track a server (pings it once to confirm) |
| `/server remove name:<n>` | Manage Server | Stop tracking (autocompletes) |
| `/server list` | Manage Server | Show tracked servers without pinging |

Servers are stored per Discord guild, max 25 each. States: 🟢 online, 🟡 sleeping (host proxy answered with a placeholder, e.g. Aternos asleep/starting), 🔴 offline/unreachable.

Tip: for Aternos, add the address **without** a port (e.g. `myserver.aternos.me`). The bot then follows the SRV record, which always points at the current port.

## Environment variables

| Variable | Where it's used | Where to get it |
|---|---|---|
| `DISCORD_APPLICATION_ID` | local + Vercel | Developer Portal → app → General Information → Application ID |
| `DISCORD_PUBLIC_KEY` | Vercel | Same page → Public Key |
| `DISCORD_BOT_TOKEN` | **local only** | App → Bot → Reset Token |
| `DISCORD_GUILD_ID` | local, optional | Discord → Settings → Advanced → Developer Mode, then right-click your server → Copy Server ID |
| `MONGODB_URI` | Vercel | Atlas → Connect → Drivers |
| `MONGODB_DB` | Vercel, optional | Any name; default `mcstatus` |

## Setup

1. **Discord app**: https://discord.com/developers/applications → New Application. Copy Application ID and Public Key. On the Bot tab, reset and copy the token.
2. **MongoDB Atlas**: create a free M0 cluster. Database Access → add a user with read/write. Network Access → allow `0.0.0.0/0` (Vercel has no fixed IPs). Connect → Drivers → copy the URI and fill in the password.
3. **Register commands** (locally, Node ≥ 20.19):
   ```bash
   cp .env.example .env   # fill it in
   npm install
   npm run register
   ```
   Set `DISCORD_GUILD_ID` while testing so updates appear instantly; clear it and re-run to go global.
4. **Deploy**: push to GitHub, import the repo in Vercel, add `DISCORD_APPLICATION_ID`, `DISCORD_PUBLIC_KEY`, `MONGODB_URI` (and optionally `MONGODB_DB`) under Environment Variables, deploy. Opening `https://<project>.vercel.app/api/interactions` in a browser should say it's running.
5. **Connect Discord**: Developer Portal → General Information → Interactions Endpoint URL = `https://<project>.vercel.app/api/interactions` → Save. Discord sends a signed test ping; if it saves, verification works.
6. **Invite**: open
   `https://discord.com/oauth2/authorize?client_id=<APPLICATION_ID>&scope=applications.commands+bot&permissions=0`
   (`bot` is only so it shows in the member list; `applications.commands` alone is enough.)

If you change env vars in Vercel, redeploy for them to take effect. If you change `lib/commands.js`, re-run `npm run register`.

## Testing locally

Ping servers from your machine with the bot's own code (no Discord or MongoDB needed):

```bash
npm run check -- Animos900.aternos.me
npm run check -- host1 host2:25566
npm run check -- bedrock.example.com --bedrock
```

To run the full bot locally: `npx vercel dev` (serves on `localhost:3000`), expose it with a tunnel such as `cloudflared tunnel --url http://localhost:3000`, and temporarily set the Interactions Endpoint URL to `<tunnel-url>/api/interactions`. Don't add a `dev` script that calls `vercel dev`; Vercel refuses to invoke itself recursively.

## Layout

```
api/interactions.js       Vercel function: signature check, routing, deferred replies
lib/commands.js           Slash command definitions
lib/db.js                 MongoDB access (cached connection)
lib/mc.js                 Address parsing + Java/Bedrock pings
lib/discord.js            Embeds and reply editing
scripts/register-commands.js
```
