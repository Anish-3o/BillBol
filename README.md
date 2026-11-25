# 🧾 BillBol

**Bolo, aur bill taiyaar.** Just speak, and the bill is ready.

BillBol is a voice-first shop manager for Indian kirana stores. Shopkeepers bill by voice in
Hindi, Hinglish or Marathi, or with any barcode scanner, print on any printer, keep the udhaar
khata, and get daily insights from a built-in assistant called Ramu.

**Live demo:** [billbol.vercel.app](https://billbol.vercel.app). Press *Try the live demo*; no sign-up needed.

## Highlights

- 🎙️ **Voice billing:** *"Hey Ramu, do kilo cheeni aur teen Maggi"*. Ramu reads the bill back and saves it only on *"haan"*.
- 🛡️ **AI only drafts:** totals, GST and summaries are always calculated in code, and money is stored in exact paise.
- 🔫 **Any barcode scanner** or the phone camera · 🖨️ **any printer** (58/80 mm receipts or A4)
- 📲 **UPI QR** with the exact amount · 🧾 **GST bills** · 📒 **udhaar khata** with WhatsApp reminders
- 🤖 **Ramu, the assistant:** morning briefing, sales questions and restock suggestions
- 📱 **Installs as an app** from the website and opens without internet
- 🏪 **Multi-tenant**, with owner and staff logins

## Tech stack

React 19 · TypeScript · Vite (PWA) · Node.js · Express 5 · MongoDB · Claude and Sarvam AI ·
Vercel · GitHub Actions, with 304 server tests and 66 client tests in CI.

## Quick start

Needs Node.js 22+ and Docker Desktop.

```bash
git clone https://github.com/Anish-3o/BillBol.git && cd BillBol
npm run setup                          # install everything
cp server/.env.example server/.env     # then set the two JWT secrets in it
docker compose up -d                   # start MongoDB
npm run seed:demo                      # optional: demo shop with a month of bills
npm run dev                            # web app on :5173, API on :4000
```

Demo login: `9000000001` / `demo@1234`.

## More

- **[Guide](docs/guide.md):** full setup, how every feature works, deployment, scripts and the roadmap
- **[Pitch deck](docs/pitch/):** [PDF](docs/pitch/BillBol-pitch.pdf), [PowerPoint](docs/pitch/BillBol-pitch.pptx) and speaker notes

## Author

Built by **Anish Lokhande** · [GitHub](https://github.com/Anish-3o) · [LinkedIn](https://www.linkedin.com/in/anish-lokhande/)
