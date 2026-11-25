# Home Hub

A calm, multi-household web app for planning **Tasks**, **Daily Habits**, **Multi-Step Projects**, and **Weather-Smart Outdoor Upkeep**—built for partners, roommates, and kids.

> **Try it right now (no sign-up needed):** [Launch Interactive Browser Demo](https://homehub.jasonjacobs.net/?demo=1) — runs 100% locally in your browser via `localStorage`.

Host one instance for your **friends & family** (backed by free PostgreSQL), or roll your own single-family instance backed by **Google Sheets** or **Docker**.

---

## Highlights

- **Daily Cockpit** — Quick-capture bar (*"Hey, I did this"* ad-hoc log or Inbox), **Daily Habits** check-in strip (7-day consistency bar, streaks, auto-skip if missed), 1-Tap Favorites, Overdue, In Progress/Waiting, Your Tasks Today, and claimable **Anyone** tasks.
- **Click-to-Inspect & Multi-Step Undo** — Click any task anywhere to inspect details, notes, sub-tasks, and update status (`Not Started`, `Started`, `On Hold`, `Gated`, `Completed`, `Skipped`). Pressed the wrong thing? Hit **Undo** (`⌘Z` / `Ctrl+Z`) in the toast or sidebar (up to 25 steps, with Redo).
- **Planning Horizons** — Weekly, Monthly, Quarterly, Seasonal & Weather, Yearly, and searchable History views in both List and Grid layouts.
- **Multi-Step Projects** — Assign a Project Lead, set/revise Target Dates, inherit default categories (with inline searchable/creatable categories), and drag-and-drop to reorder or nest sub-tasks.
- **Private Personal Space** — Every household member has their own private tasks & habits completely hidden from other household members (and excluded from household fairness).
- **Weather-Smart Alerts** — Uses free Open-Meteo 10-day forecasts with two-tier alerts (**4–10 days:** gentle heads-up; **1–3 days:** urgent trigger).
- **Opt-In Effort & Fairness** — Effort weights and workload balancing are **off by default** and toggled per member.
- **New-User Walkthrough** — Built-in 5-step interactive onboarding tour (auto-launches on signup/join, replayable anytime via `?` in the sidebar) with a 1-click starter pack and instant Invite Link copy.
- **AI Agent REST API & MCP Server** — Scoped Bearer API keys (`hh_live_...`), OpenAPI 3.1 spec at `/api/v1/openapi.json`, and a stdio MCP server at [mcp/server.js](mcp/server.js).

---

## Quick Start (Local Development)

Requires **Node.js 20+**.

```bash
git clone <your-repo-url>
cd home-hub
npm install
npm run dev
```

- Frontend dev server: `http://localhost:5173`
- API server: `http://localhost:3001`
- With no database configured, Home Hub automatically starts in **Local Mirror (Demo Mode)** with the sample *Maple Street Home* household.

Production build locally:

```bash
npm run build
npm start
# Open http://localhost:3001
```

---

## Hosting for Friends & Family (Free Tier: Render + Neon Postgres)

When hosting for multiple households, use **PostgreSQL** (`DATABASE_URL`) so every family gets zero-setup signup, durable private tasks, and safe concurrent writes.

1. **Create a free Postgres database** at [Neon](https://neon.tech) or [Supabase](https://supabase.com) and copy your `DATABASE_URL` connection string.
2. **Deploy this repo** on [Render](https://render.com) (using [render.yaml](render.yaml)) or [Railway](https://railway.app).
3. **Set environment variables** on your host:
   - `NODE_ENV=production`
   - `APP_URL=https://your-home-hub-url.onrender.com`
   - `SESSION_SECRET=<long-random-string>`
   - `DATABASE_URL=<your-postgres-url>`
   - `ENABLE_DEMO=false` *(hides demo accounts)*
   - `REGISTRATION_CODE=OUR-FRIENDS-2026` *(optional: gates new-household signups so only friends/family with the code can create a household; people invited via a household Invite Link don't need this code)*
   - `RESEND_API_KEY=<optional-resend-key>` *(free 3,000 emails/month for magic sign-in links & morning digests)*
   - `CRON_SECRET=<long-random-string>`
4. **Optional Daily Reminders Cron**: Point a free daily cron service (e.g. [cron-job.org](https://cron-job.org) or GitHub Actions) at:
   ```
   POST https://your-home-hub-url.onrender.com/api/cron/reminders?secret=YOUR_CRON_SECRET
   ```
5. **Share with friends & family**: Send them your URL and your `REGISTRATION_CODE`. When they create their household, the built-in walkthrough helps them add starter tasks and copy an invite link for their own family.

---

## Self-Hosting with Docker Compose (1 Command)

Includes Home Hub + PostgreSQL 16 with a persistent volume:

```bash
cp .env.example .env
# Edit SESSION_SECRET (and optionally REGISTRATION_CODE / APP_URL) in .env
docker compose up -d --build
```

Open `http://localhost:3001`. Tables are created automatically on first startup.

---

## Single-Family Google Sheets Mode (Optional)

Prefer seeing your household's live rows directly in Google Sheets?

1. Create a blank Google Sheet → **Extensions → Apps Script**.
2. Paste [google-sheets/Code.gs](google-sheets/Code.gs) and deploy as a **Web App** (*Execute as: Me*, *Who has access: Anyone*).
3. Set `GOOGLE_APPS_SCRIPT_URL` (and optional `GOOGLE_APPS_SCRIPT_TOKEN`) in `.env` (leave `DATABASE_URL` blank).
4. Individual members can also optionally link their own Personal Private Google Sheet under **Settings & Sheets**.

---

## Storage Modes Priority

Home Hub picks its backend automatically based on environment variables:

| Priority | Env Variable | Mode | Best For |
| :---: | :--- | :--- | :--- |
| 1 | `DATABASE_URL` | **PostgreSQL** | Hosting for multiple families / Docker Compose |
| 2 | `GOOGLE_APPS_SCRIPT_URL` | **Google Sheets (Apps Script)** | Single family using Google Sheets without Google Cloud |
| 3 | `GOOGLE_SHEET_ID` + Service Account | **Google Sheets API v4** | Single family with Google Cloud Service Account |
| 4 | *(none set)* | **Local JSON Mirror** | Instant local testing & demo |

---

## Running Tests

```bash
npx tsc --noEmit
npm test
npm run build
```

---

## License

[MIT](LICENSE)
