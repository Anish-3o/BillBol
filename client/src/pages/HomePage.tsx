import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { BrandMark } from '../components/BrandMark';
import { Icon, type IconName } from '../components/Icon';
import { useAuth } from '../hooks/useAuth';
import { DEMO_LOGIN, demoErrorMessage } from '../lib/demo';
import { useInstallPrompt } from '../lib/installPrompt';

const FEATURES: { icon: IconName; tone?: string; title: string; text: string; badge?: string }[] = [
  {
    icon: 'mic',
    title: 'Bolo, bill taiyaar',
    text: 'Speak the order in Hindi, Hinglish or Marathi: "do kilo cheeni, teen Maggi". BillBol matches your products, prices it and shows the bill.',
    badge: 'Voice billing',
  },
  {
    icon: 'sparkles',
    tone: 'violet',
    title: '"Hey Ramu" assistant',
    text: 'A hands-free counter assistant. Call his name, say the items, he reads the bill back and saves it when you say "haan".',
    badge: 'AI agent',
  },
  {
    icon: 'book',
    tone: 'amber',
    title: 'Udhaar khata',
    text: 'Every credit sale lands in the customer\'s khata automatically. One tap drafts a polite WhatsApp reminder with the exact amount.',
    badge: 'WhatsApp reminders',
  },
  {
    icon: 'clock',
    title: 'Morning briefing',
    text: 'Start the day with a 30-second summary: yesterday\'s sales, what to reorder, whose udhaar to follow up. In your language.',
    badge: 'AI insights',
  },
  {
    icon: 'package',
    tone: 'amber',
    title: 'Smart restock',
    text: 'Knows how fast each item sells, warns days before it runs out, and tells you exactly how much to order.',
    badge: 'Forecasting',
  },
  {
    icon: 'receipt',
    tone: 'violet',
    title: 'GST-ready invoices',
    text: 'CGST/SGST split to the paisa, HSN codes, financial-year bill numbers, printable receipts and WhatsApp sharing.',
    badge: 'Compliance',
  },
];

export default function HomePage() {
  const { status, login } = useAuth();
  const navigate = useNavigate();
  const [demoBusy, setDemoBusy] = useState(false);
  const [demoError, setDemoError] = useState<string | null>(null);
  const { canInstall, install } = useInstallPrompt();

  async function tryDemo() {
    if (status === 'authenticated') return navigate('/dashboard');
    setDemoBusy(true);
    setDemoError(null);
    try {
      await login(DEMO_LOGIN.phone, DEMO_LOGIN.password);
      navigate('/dashboard');
    } catch (err) {
      setDemoError(demoErrorMessage(err, import.meta.env.DEV));
      setDemoBusy(false);
    }
  }

  return (
    <div className="landing">
      <header className="landing-nav">
        <Link to="/" className="brand">
          <BrandMark />
          <span className="brand-name">
            Bill<span>Bol</span>
          </span>
        </Link>
        <nav>
          <div className="nav-links">
            <a href="#features">Features</a>
            <a href="#how">How it works</a>
            <a href="#trust">Why trust it</a>
          </div>
          {status === 'authenticated' ? (
            <Link to="/dashboard" className="btn btn-primary btn-sm">
              Open dashboard
            </Link>
          ) : (
            <>
              <Link to="/login" className="btn btn-ghost btn-sm">
                Log in
              </Link>
              <Link to="/register" className="btn btn-primary btn-sm">
                Start free
              </Link>
            </>
          )}
        </nav>
      </header>

      <section className="hero">
        <div className="hero-inner">
          <div>
            <span className="hero-pill">
              <span>New</span> "Hey Ramu" — your hands-free counter assistant
            </span>
            <h1>
              Bolo, aur <em>bill taiyaar.</em>
            </h1>
            <p className="hero-lead">
              BillBol is the voice-first shop manager for India's 1.3 crore kirana stores. Make bills by speaking, keep the
              udhaar khata, and get AI insights on what to stock — without typing a word.
            </p>
            <div className="hero-cta">
              <button type="button" className="btn btn-primary btn-lg" onClick={tryDemo} disabled={demoBusy}>
                <Icon name="play" size={18} />
                {demoBusy ? 'Opening demo shop…' : 'Try the live demo'}
              </button>
              <Link to="/register" className="btn btn-secondary btn-lg">
                Create your shop
              </Link>
              {/* Only where the browser offers it (Chrome/Edge); it then opens like a phone app. */}
              {canInstall && (
                <button type="button" className="btn btn-ghost btn-lg" onClick={() => void install()}>
                  <Icon name="download" size={18} />
                  Install app
                </button>
              )}
            </div>
            {demoError ? (
              <p className="hero-note" style={{ color: 'var(--danger)' }}>
                {demoError}
              </p>
            ) : (
              <p className="hero-note">Demo shop: Sharma Kirana Store · a month of real-looking bills · no sign-up</p>
            )}
            <div className="hero-stats">
              <div>
                <strong>~4 sec</strong>
                <span>to bill a 5-item order by voice</span>
              </div>
              <div>
                <strong>3 languages</strong>
                <span>Hindi · Hinglish · Marathi</span>
              </div>
              <div>
                <strong>Installs like an app</strong>
                <span>opens even without internet</span>
              </div>
            </div>
          </div>

          <div style={{ position: 'relative' }}>
            <div className="phone-glow" />
            <div className="phone">
              <div className="phone-screen">
                <div className="phone-bar">
                  <span className="orb" data-state="speaking">
                    <Icon name="volume" size={18} />
                  </span>
                  <div>
                    <strong style={{ fontSize: 15 }}>Ramu</strong>
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>Sharma Kirana Store</div>
                  </div>
                </div>
                <div className="phone-chat">
                  <div className="bubble bubble-user">Hey Ramu, do kilo cheeni, ek Tata namak aur teen Maggi</div>
                  <div className="bubble bubble-ramu">
                    Cheeni 2 kg, Tata Salt 1, Maggi 3. Kul <strong>₹162</strong>. Confirm karun?
                  </div>
                  <div className="draft-card" style={{ margin: 0 }}>
                    <div className="draft-head">
                      <span>Draft bill · 3 items</span>
                      <span>Cash</span>
                    </div>
                    <ul className="draft-lines">
                      <li>
                        <span>Sugar (loose) × 2 kg</span>
                        <span>₹92</span>
                      </li>
                      <li>
                        <span>Tata Salt 1kg × 1</span>
                        <span>₹28</span>
                      </li>
                      <li>
                        <span>Maggi Noodles × 3</span>
                        <span>₹42</span>
                      </li>
                    </ul>
                    <div className="draft-total">
                      <span className="muted">Total</span>
                      <strong>₹162</strong>
                    </div>
                  </div>
                  <div className="bubble bubble-user">Haan</div>
                  <div className="bubble bubble-system">✓ Bill 2026-27/0991 saved · ₹162</div>
                </div>
              </div>
            </div>
            <div className="float-card float-a">
              <span className="kpi-icon">
                <Icon name="trendUp" size={16} />
              </span>
              <span>
                ₹9,840 today
                <small>+12% vs yesterday</small>
              </span>
            </div>
            <div className="float-card float-b">
              <span className="kpi-icon amber">
                <Icon name="bell" size={16} />
              </span>
              <span>
                Reorder Amul Milk
                <small>runs out in 1.2 days</small>
              </span>
            </div>
          </div>
        </div>
      </section>

      <section className="section" id="features">
        <div className="section-inner">
          <div className="section-head">
            <span className="eyebrow">Everything a kirana needs</span>
            <h2>The munim, the khata and the cash counter — in one phone</h2>
            <p>Built for the way Indian shopkeepers actually work: talking, in a rush, with a queue at the counter.</p>
          </div>
          <div className="feature-grid">
            {FEATURES.map((f) => (
              <article key={f.title} className="feature">
                <span className={`feature-icon ${f.tone ?? ''}`}>
                  <Icon name={f.icon} size={22} />
                </span>
                <h3>{f.title}</h3>
                <p>{f.text}</p>
                {f.badge && <span className="badge badge-small">{f.badge}</span>}
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section" id="how" style={{ background: 'var(--surface-2)' }}>
        <div className="section-inner">
          <div className="section-head">
            <span className="eyebrow">A day at the counter</span>
            <h2>From the first chai to closing the shutter</h2>
          </div>
          <div className="steps">
            <div className="step">
              <h3>7 AM · Morning briefing</h3>
              <p>Open BillBol and Ramu tells you how yesterday went, what is running low and who owes you money.</p>
              <div className="quote-says">"Kal ₹9,840 ki bikri. Amul Milk aur bread mangwa lijiye."</div>
            </div>
            <div className="step">
              <h3>All day · Bill by voice</h3>
              <p>Hands busy weighing sugar? Just call Ramu. He drafts the bill, reads it back, saves on your "haan".</p>
              <div className="quote-says">"Hey Ramu, Sharma ji ke khate mein do kilo atta."</div>
            </div>
            <div className="step">
              <h3>9 PM · Close the day</h3>
              <p>See today's sales, UPI vs cash, top sellers, and send udhaar reminders on WhatsApp in one tap each.</p>
              <div className="quote-says">"Aaj ki bikri kitni hui?"</div>
            </div>
          </div>
        </div>
      </section>

      <section className="section trust" id="trust">
        <div className="section-inner">
          <div className="section-head">
            <span className="eyebrow" style={{ color: '#5eead4' }}>
              Responsible AI
            </span>
            <h2>AI that helps, never guesses with your money</h2>
            <p>Three rules are built into the code, not just the prompt.</p>
          </div>
          <div className="rule-grid">
            <div className="rule">
              <Icon name="shield" size={26} />
              <h3>AI only drafts</h3>
              <p>Voice bills are drafts. Nothing touches stock, money or invoices until a human confirms.</p>
            </div>
            <div className="rule">
              <Icon name="rupee" size={26} />
              <h3>AI never invents numbers</h3>
              <p>Totals, GST and summaries are calculated in code. The AI only turns real numbers into friendly words, and a check rejects any number it changes.</p>
            </div>
            <div className="rule">
              <Icon name="store" size={26} />
              <h3>Every shop is sealed</h3>
              <p>Each shop's data is isolated at the database level. The AI's tools can only see the shop that is logged in.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="cta-band">
          <h2>See it run on a real shop's month</h2>
          <p>Log into the demo store, open the dashboard and say "Hey Ramu".</p>
          <div className="button-row">
            <button type="button" className="btn btn-light btn-lg" onClick={tryDemo} disabled={demoBusy}>
              <Icon name="play" size={18} /> Try the live demo
            </button>
            <Link to="/register" className="btn btn-outline-light btn-lg">
              Create your shop
            </Link>
          </div>
        </div>
      </section>

      <footer className="landing-footer">BillBol · Made for India's kirana stores · Built by Anish</footer>
    </div>
  );
}
