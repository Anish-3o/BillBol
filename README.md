# 🧾 BillBol

**Bolo, aur bill taiyaar.** Just speak, and the bill is ready.

BillBol is an AI-powered shop manager for Indian kirana stores.
Shopkeepers create bills by voice in Hindi, Hinglish or Marathi,
track udhaar, and get daily insights from a built-in AI assistant.

> 🚧 Work in progress. Building in public, one feature at a time.

## Planned features

- 🎙️ Voice billing in Hindi / Hinglish / Marathi
- 🤖 AI assistant with morning briefings and sales insights
- 📒 Udhaar ledger with WhatsApp reminders
- 🧾 GST invoices with PDF
- 🏆 Goals, badges and staff leaderboard
- 🎁 Monthly "Business Wrapped" recap
- 📈 Sales forecasting and festival alerts
- 🏪 Multi-tenant: many shops on one deployment, each seeing only its own data

## Tech stack

React · TypeScript · Vite · Node.js · Express · MongoDB · Redis · BullMQ · Python · FastAPI · Docker · GitHub Actions

## Project structure

```
billbol/
├── client/         React + Vite + TypeScript web app
├── server/         Express + TypeScript API
├── ml-service/     Python FastAPI forecasting service (coming later)
├── docs/           Architecture diagrams and screenshots
└── docker-compose.yml
```

## Run locally

**You need:** Node.js 22+, Docker Desktop

```bash
git clone https://github.com/<your-username>/billbol.git
cd billbol

# 1. Install everything (root, server, client)
npm run setup

# 2. Create your environment file
cp server/.env.example server/.env
#    Then set JWT_ACCESS_SECRET and JWT_REFRESH_SECRET in server/.env to two different
#    random values (the API will not start without them). Generate each with:
#    node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
#    Optional: set LLM_API_KEY (an Anthropic API key) to turn on voice billing.

# 3. Start MongoDB and Redis
#    MongoDB runs as a single-node replica set (billing uses transactions);
#    it sets itself up on first start, give it ~10 seconds.
docker compose up -d

# 4. Start the API and the web app together
npm run dev
```

- Web app: http://localhost:5173
- API health check: http://localhost:4000/api/health

## Scripts

| Command | What it does |
|---|---|
| `npm run setup` | Installs root, server and client dependencies |
| `npm run dev` | Runs API and web app together |
| `npm run lint` | Lints server and client |
| `npm test` | Runs server tests (needs MongoDB running; uses separate `billbol_test_*` databases) |
| `npm run seed:products --prefix server -- <owner phone>` | Adds a sample kirana catalogue (26 products) to that owner's shop |
| `npm run format` | Formats all files with Prettier |

## Roadmap

- [x] Project skeleton, Docker, CI
- [x] Week 1: Login, refresh tokens, shops (multi-tenant)
- [x] Week 2: Products, manual billing, stock
- [ ] Week 3: GST invoices + PDF, udhaar ledger
- [ ] Week 4: Roles, dashboard, audit log
- [x] Week 5: Voice billing (built early; needs `LLM_API_KEY`)
- [ ] Week 6: AI assistant, morning briefing, WhatsApp reminders
- [ ] Week 7: Badges, leaderboard, Business Wrapped
- [ ] Week 8: Festival mode, forecasting, deploy
