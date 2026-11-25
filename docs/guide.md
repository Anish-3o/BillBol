# BillBol guide

Everything beyond the [README](../README.md): running it locally, how each feature works, deployment, scripts and the roadmap.

## Project structure

```
billbol/
├── client/         React + Vite + TypeScript web app (installable PWA)
├── server/         Express + TypeScript API
├── docs/           This guide, the pitch deck and screenshots
├── api/            Vercel serverless entry (runs the Express API)
├── vercel.json     Vercel build, routing and the nightly cron
└── docker-compose.yml
```

## Run locally

**You need:** Node.js 22+, Docker Desktop

```bash
git clone https://github.com/Anish-3o/BillBol.git
cd BillBol

# 1. Install everything (root, server, client)
npm run setup

# 2. Create your environment file
cp server/.env.example server/.env
#    Then set JWT_ACCESS_SECRET and JWT_REFRESH_SECRET in server/.env to two different
#    random values (the API will not start without them). Generate each with:
#    node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
#    Optional: set LLM_API_KEY (an Anthropic API key) to use Claude for voice billing, the
#    "Hey Ramu" agent, the morning briefing and reminders. Without it everything still
#    works on the offline rule-based parser and templates.
#    Optional: set SARVAM_API_KEY (from https://dashboard.sarvam.ai) for Sarvam's Indian-
#    language speech recognition and natural voices. Without it the browser's speech is used.

# 3. Start MongoDB
#    MongoDB runs as a single-node replica set (billing uses transactions);
#    it sets itself up on first start, give it ~10 seconds.
docker compose up -d

# 4. Start the API and the web app together
npm run dev
```

- Web app: http://localhost:5173
- API health check: http://localhost:4000/api/health

### Demo shop

`npm run seed:demo` creates "Sharma Kirana Store" with 50 everyday products, 8 udhaar customers
and a month of realistic bills (re-running it rebuilds only the demo shop). Then open the web app
and press **Try the live demo**, or log in with `9000000001` / `demo@1234`.

### "Hey Ramu" voice assistant

Open the assistant (floating button, or the mic in the phone tab bar) and either tap the mic,
type, or turn on **Hands-free mode** and say *"Hey Ramu, do kilo cheeni aur teen Maggi"*.
Ramu works like a billing assistant at the counter:

1. Say items. Ramu reads each one back with its quantity and amount: *"Cheeni 2 kilo ₹92, Maggi
   3 packet ₹42. Kul ₹134. Aur kuch?"* Ask *"Maggi hai? Kitne ka hai?"* and Ramu answers from
   the stock and prices in the database.
2. Say *"bill complete"* (*"bas itna hi"*, *"बिल झालं"*). Ramu asks *"Kuch aur?"*, then the
   customer's name or mobile number (or *"skip"*). A new customer is added to the khata.
3. Ramu reads the total and asks *"Bill banake print karun?"*. Say *"haan"*: the bill is saved
   and printed. Nothing is saved before that yes, and every amount comes from code, never the AI.

*"Pichhla bill print karo"* reprints the last one. With `SARVAM_API_KEY` set, Ramu listens
through Sarvam (much better at Marathi, Hinglish and brand names) and speaks with a natural
Indian voice; say *"Ramu"*, wait for the ding, then speak. Without it, the browser's speech is
used (Chrome or Edge).

### Prices

Prices never update themselves from the internet: no brand publishes an official price feed
in India, and every shop sets its own selling price. Instead, **Products → Update prices**
takes a price list: download your current prices as CSV, edit them in Excel (or use a
distributor's list with *Name/Barcode*, *Price* and optional *MRP* columns), upload, check
every change, and apply. The demo prices are typical MRPs and should be checked against real
packs.

### Barcode scanner

Plug in any USB barcode scanner (or pair a Bluetooth one) and open **New bill**. That's it:
no driver, no setup. Scanners act as a keyboard that types the code very fast and presses
Enter; BillBol tells a scan from human typing by that speed. Each scan adds one unit, so
scanning three Maggi packets gives quantity 3. An unknown code beeps, and the owner can add it
as a new product with the barcode already filled in. On a phone, **Scan with camera** uses
the built-in barcode detector (Chrome on Android, Safari 17+ on iOS).

To give a product its barcode: **Products → Edit**, click the Barcode field, scan the packet.
The demo shop's packaged products have in-store codes (`200…`); type one into the search box
on New bill to try it without a scanner.

### Printing

**New bill** has *Print after saving* (on by default) and a paper size: 58 mm or 80 mm thermal
receipt, or A4. Settings are kept per device, because the printer belongs to the counter.
Any printer installed on the computer or phone works: thermal receipt printers (TVS, Epson,
Retsol…) install as normal printers. Press **F9** or **Ctrl+Enter** to save and print without
touching the mouse.

For one-tap printing with no print dialog, start Chrome or Edge with `--kiosk-printing`
(add it to the shortcut's target) and set the receipt printer as the default printer.

### Settings, UPI and staff (owner)

**Settings** holds the shop's details as printed on receipts (name, address, phone, GSTIN) and
its **UPI ID**. With a UPI ID, choosing *UPI* on New bill shows a QR with the exact amount, the
customer scans it with any UPI app, and the bill is saved once the money arrives. Udhaar
receipts print a "scan to pay" QR, and each customer's khata shows one for their balance.
Settings also has a ₹1 test QR to check the money reaches the right account.

Owners add **staff logins** there (name, mobile, starting password). Staff can bill, receive
goods and keep the khata, but not change prices, products or settings.

### Fixing a wrong bill

Bills are never edited. Open the bill and choose **Cancel or correct this bill**, pick a
reason, then either *Cancel bill* or *Cancel & make a corrected bill* (a new bill opens with
the same items, ready to fix). Stock goes back and an udhaar bill is reversed in the khata;
the cancelled bill stays in the list, marked, and no longer counts in sales. The owner can
cancel any bill; staff can cancel only their own, within 10 minutes.

### Receiving goods

**Receive goods** (in the menu, on Products, and on the dashboard's restock card): scan each
packet of a delivery or search and type the count (+12 / +24 for cartons), add the supplier,
and save. Stock goes up and the delivery is recorded with who counted it.

### Install as an app (PWA)

BillBol is a Progressive Web App: on Android or desktop Chrome/Edge, tap **Install app** (on the
home page or in the menu) and it gets a home-screen icon and opens full screen, like a Play Store
app. On iPhone: Share → *Add to Home Screen*. Long-press the icon for shortcuts to *New bill*,
*Udhaar khata* and *Receive goods*.

A service worker (generated by `vite-plugin-pwa`, see `client/vite.config.ts`) keeps the app's
own files on the device, so it opens instantly and even without internet. API data (stock,
bills, udhaar) is **never** cached: with no internet the app says so plainly and carries on when
the connection returns, rather than showing old numbers. Saving bills offline and syncing them
later is the next step. A new version downloads in the background and waits for the shopkeeper
to tap **Update**, so a reload never wipes a bill in progress.

The service worker only runs in a production build. To try it locally:
`npm run build --prefix client && npm run preview --prefix client` (with the API running).

## Deploy (Vercel + MongoDB Atlas)

The web app and the API deploy together as **one Vercel project**: Vercel serves the built
React app and runs the Express API as a serverless function at `/api` (see `vercel.json` and
`api/index.ts`). One domain for both means the httpOnly login cookies just work, with no CORS
setup.

1. **Database:** create a free **M0** cluster on [MongoDB Atlas](https://www.mongodb.com/atlas)
   (region: Mumbai, to sit next to Vercel's `bom1` region). Add a database user, and under
   *Network Access* allow `0.0.0.0/0` (Vercel has no fixed IP addresses). Copy the connection
   string and put the database name in it: `mongodb+srv://USER:PASS@CLUSTER.mongodb.net/billbol?retryWrites=true&w=majority`.
   Atlas clusters are replica sets, so billing transactions work.
2. **Vercel:** *Add New → Project*, import the GitHub repo, keep the root directory as `./`
   (settings come from `vercel.json`) and add these environment variables:

   | Variable | Value |
   |---|---|
   | `MONGO_URI` | the Atlas connection string |
   | `JWT_ACCESS_SECRET` | a new random value (not your local one) |
   | `JWT_REFRESH_SECRET` | another new random value |
   | `CLIENT_URL` | your site URL, e.g. `https://billbol.vercel.app` |
   | `LLM_API_KEY` | optional: Anthropic API key for the AI features |
   | `SARVAM_API_KEY` | optional: Sarvam AI key for natural Indian-language voice |
   | `CRON_SECRET` | optional: a random value (32+ characters); turns on the nightly demo reset |

   Do **not** set `NODE_ENV`: the API switches to production by itself on Vercel, and
   `NODE_ENV=production` during the build would make npm skip the build tools.
3. **Demo data:** from your computer, run the seed against Atlas once:
   `MONGO_URI="<atlas connection string>" npm run seed:demo` (Git Bash).

**Nightly demo reset:** everyone who presses *Try the live demo* shares one shop, so visitors'
changes (cancelled bills, new prices, a different UPI ID) would pile up. With `CRON_SECRET` set,
Vercel Cron calls `/api/cron/reset-demo` every night at 3 am IST (see `crons` in `vercel.json`)
and the demo shop is rebuilt from scratch. Other shops are never touched.

**Rate limits:** login allows 10 wrong passwords per address per 15 minutes (correct logins are
not counted), sign-up 10 new shops per address per hour, and the AI and voice endpoints 300 calls
per person per hour, so a public demo cannot run up the Claude or Sarvam bill. The counters live
in MongoDB, not in memory, because each serverless instance has its own memory.

Every push to `main` redeploys. Check `https://<your-site>/api/health` shows `"db": "connected"`.

Two choices keep the serverless function working: `api/tsconfig.json` gives Vercel's
TypeScript compiler the same settings as the server (it never reads `server/tsconfig.json`), and
passwords are hashed with `bcryptjs` (pure JavaScript) rather than the native `bcrypt` addon.

## Scripts

| Command | What it does |
|---|---|
| `npm run setup` | Installs root, server and client dependencies |
| `npm run dev` | Runs API and web app together |
| `npm run lint` | Lints server and client |
| `npm test` | Runs server tests (needs MongoDB running; uses separate `billbol_test_*` databases), then client tests |
| `npm test --prefix client` | Runs only the client unit tests (Vitest; money, quantities, voice intents, UPI, price lists) |
| `npm run seed:products --prefix server -- <owner phone>` | Adds a sample kirana catalogue (50 products) to that owner's shop |
| `npm run seed:demo` | Creates (or rebuilds) the demo shop with a month of history |
| `npm run format` | Formats all files with Prettier |
| `npm run generate-pwa-assets --prefix client` | Remakes the app icons from `client/public/favicon.svg` (only when the logo changes) |

## Roadmap

- [x] Project skeleton, Docker, CI
- [x] Week 1: Login, refresh tokens, shops (multi-tenant)
- [x] Week 2: Products, manual billing, stock
- [x] Week 3: GST bills (tax invoice / bill of supply), udhaar ledger
- [x] Week 4: Owner/staff roles, dashboard
- [x] Week 5: Voice billing (built early; needs `LLM_API_KEY`)
- [x] Week 6: AI assistant ("Hey Ramu" agent), morning briefing, WhatsApp reminder drafts, smart restock
- [x] Week 7: Barcode billing (any scanner + phone camera), receipt printing (58/80 mm, A4)
- [x] Week 8: Bill cancellation and correction, UPI QR, receiving goods, staff logins, hold bill
- [x] Deploy: Vercel + MongoDB Atlas, rate limits, nightly demo reset
- [x] Installable app (PWA): home-screen icon, opens without internet, update prompt
- [ ] Next: save bills offline and sync them when the internet is back

**Dropped, on purpose:** badges, staff leaderboard and "Business Wrapped" (a kirana has one to
three people at the counter; nobody needs to compete), the Python forecasting service and
festival mode (for a few hundred products, the sales-velocity restock suggestions already in
the API give most of the value without a second language, service and deployment), and a
server-side PDF generator (printing the A4 bill to "Save as PDF" gives the same PDF).
