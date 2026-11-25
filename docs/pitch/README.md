# BillBol pitch

Pitch material for presenting BillBol: a 13-slide deck (about 8 to 10 minutes with the live demo) and the speaker notes for every slide.

- **[deck.html](deck.html)**: open it in Chrome or Edge. Arrow keys, space or a click move between slides, **F** goes full screen, and printing gives a PDF with one slide per page. It works without internet apart from the web fonts, which makes it a good backup if the venue's Wi-Fi fails.
- The same deck is also kept as an editable claude.ai Slides deck (with icons and PowerPoint / PDF export).

## Before you present

1. Refresh the live demo shop: run the reset (Vercel → Settings → Cron Jobs → **Run** next to `/api/cron/reset-demo`, or the `curl.exe` command with your `CRON_SECRET`).
2. Open [billbol.vercel.app](https://billbol.vercel.app) on your phone and laptop, and install the app on your phone.
3. Try one voice bill in the room: "Hey Ramu, do kilo cheeni aur teen Maggi", then "haan".
4. Keep a screen recording of the demo ready in case the Wi-Fi fails.
5. Fill in every `[bracketed]` placeholder below.

## Placeholders to fill in

Nothing in brackets was guessed; each one is your decision or needs a source.

- Slide 1 and 13: your name, the event, the date, your contact details
- Slide 11: what is free, the Pro price and features, partners, the market size **with its source** (the landing page says 1.3 crore kirana stores)
- Slide 12: your pilot plan and the "later" features
- Slide 13: your one-line ask
- Slide 7: the example sales figures are left as `[₹__]`; show the real ones in the live demo

## Slides and speaker notes

### 1. Bolo, aur bill taiyaar.

Open with the line on the slide: “Bolo, aur bill taiyaar.” It means “just speak, and the bill is ready.” That is the whole product in one sentence.

Point at the phone: the shopkeeper says the order the way they already would, Ramu reads it back with the total, and only when they say “haan” is the bill saved. The prices are real ones from the demo shop’s catalogue, and the total is calculated by the app, not by the AI.

Introduce yourself: [your name, your role, one line about why you built this].

### 2. The busiest moment at the counter still runs on pen, paper and memory.

Paint the scene: 7 pm, a queue at the counter, one or two people serving. Every bill is added up by hand or on a calculator. Regulars buy on credit, and that udhaar lives in a diary.

The software that exists asks the shopkeeper to type product names in English on a screen. That is why so many shops still don’t use it.

[If you have it, add one real observation here: a shop you visited, a shopkeeper you spoke to.]

### 3. Every order is already spoken out loud.

This is the key idea, so pause on it. Customers already say their order out loud, and the shopkeeper already repeats it. Nobody needs to learn to type. We only need to listen, in the languages the shop actually speaks: Hindi, Hinglish and Marathi today.

### 4. A voice bill in four steps

Walk through the four steps. The point to land: steps 1 to 3 are a draft. Nothing is saved, no stock moves, no money is recorded until step 4, when the shopkeeper says “haan” or taps confirm.

Ramu also answers simple questions mid-bill, like “Maggi hai? Kitne ka?”, from the shop’s real product list.

### 5. AI drafts. The shopkeeper decides.

This is the slide that answers “what if the AI gets it wrong?”, so expect questions here.

Three rules are built into the code, not just promised. First, AI output is only ever a draft; the confirm step is the human decision. Second, the language model never calculates anything: every total, every GST split and every number in the morning briefing comes from code, and the AI only phrases it. Third, all money is stored as integer paise, so there are no rounding errors.

These rules are written into the project’s guidelines and covered by automated tests.

### 6. Fits the shop as it already is

Voice is the headline, but a shop needs the whole counter covered, and this is all built and working today.

No special hardware: any barcode scanner (or the phone camera), any printer. UPI QR codes carry the exact amount, so the customer can’t mistype it. The udhaar khata drafts WhatsApp reminders that the shopkeeper sends. Bills are GST-ready. Mistakes are fixed by cancelling a bill, which puts stock back and reverses udhaar, instead of editing it away.

### 7. Ask the shop a question, get a straight answer

Beyond billing, Ramu is an assistant the shopkeeper can talk to. Every number in its answers is calculated in code from the shop’s real bills; the AI only turns those numbers into a friendly sentence. The amounts in brackets on the slide are placeholders: show the real thing in the live demo.

Restock suggestions use sales velocity: how many of each item sold over recent days compared with what is left in stock.

### 8. Built for the counter, not adapted to it

Each of these comes from how real shops work. Shopkeepers speak Hindi, Hinglish or Marathi, so Ramu does too. Nobody wants another Play Store install, so BillBol installs straight from the website as an app. Internet drops, so the app still opens without it and picks up when it returns. Saving bills fully offline is the next step on the roadmap; be honest about that if asked. And the first download is about 95 kB, so it is quick on an inexpensive phone.

### 9. Built like a real product

For a technical audience, this shows it is not a prototype. Every shop’s data is separated: the shop comes from the signed login token, never from what the browser sends. Voice orders are understood by Claude, with Sarvam AI for natural Indian-language listening and speaking, and a rule-based parser keeps working without either key.

The test counts are real: 304 server tests against a real MongoDB and 66 client tests, all run automatically on every push.

Skip or shorten this slide for a non-technical audience.

### 10. billbol.vercel.app

LIVE DEMO SCRIPT, about 3 minutes. Before the pitch, run the demo reset (the curl command or Vercel’s Cron Jobs “Run”) so the shop is fresh, and open billbol.vercel.app on your phone and laptop.

1. Landing page, 10 s: press “Try the live demo”. Mention it installs as an app.
2. Dashboard, 30 s: today’s sales and the morning briefing from Ramu. Every number is calculated in code.
3. Voice bill, 60 s: open New bill. Say: “Hey Ramu, do kilo cheeni aur teen Maggi.” Let Ramu read it back with the total, then say “haan”. Point out nothing was saved until “haan”.
4. Barcode or UPI, 30 s: scan a packet, or type a demo code starting with 200, then show the UPI QR with the exact amount.
5. Udhaar khata, 30 s: open a customer who owes money and show the WhatsApp reminder draft.
6. Hand back: “Scan the QR and try it yourself.”

Backup if voice fails in a noisy room: type the order into the voice box, or bill by barcode. Have a screen recording ready in case the Wi-Fi fails.

### 11. Free to start, paid when it saves real time

This slide is a draft to make your own; everything in brackets is a decision for you.

One natural split: billing and khata are free, so a shop starts at no cost, and the AI voice features are paid, because they cost money per use (speech and language models). That also matches the rate limits already built in.

Your landing page says India has 1.3 crore kirana stores. If you use that number, cite its source on this slide.

### 12. Built, next and later

Everything in the first column is built, tested and running on the live site today.

Next: saving bills fully offline and syncing later. It needs careful design, because bill numbers must stay unique and in order for GST, and two devices could sell the last packet of something at the same time. That shows you have thought it through.

Fill in the pilot and the “later” column with your own plans.

### 13. [Your ask, in one line]

End on one clear ask, said out loud, then stop talking. Keep the demo QR or this slide on screen during questions.

Likely questions to prepare for: What if the voice gets it wrong? (It is only a draft; nothing saves without “haan”.) What does the AI cost per bill? [Your number] Why would a shop pay? [Your answer] What happens without internet? (The app opens; saving bills offline is next on the roadmap.)
