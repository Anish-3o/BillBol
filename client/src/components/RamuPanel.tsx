import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { phaseLabel, type AssistantPhase } from '../context/assistant-context';
import { useAssistant } from '../hooks/useAssistant';
import { formatPaise } from '../lib/money';
import { formatQuantity } from '../lib/quantity';
import { onVoicesChanged, speak, voicesFor, type SpeechLang } from '../lib/speech';
import type { AssistantCard } from '../types/assistant';
import { PAYMENT_LABELS } from '../types/bill';
import { Icon } from './Icon';

export function RamuOrb({ phase, large = false }: { phase: AssistantPhase; large?: boolean }) {
  return (
    <span className={large ? 'orb orb-lg' : 'orb'} data-state={phase} aria-hidden="true">
      <Icon name={phase === 'listening' ? 'mic' : phase === 'speaking' ? 'volume' : 'sparkles'} size={large ? 36 : 20} />
    </span>
  );
}

const TRY: { text: string; label: string }[] = [
  { text: 'do kilo cheeni, ek Tata namak aur teen Maggi', label: '"Do kilo cheeni, ek Tata namak aur teen Maggi"' },
  { text: 'aaj ki bikri kitni hui?', label: '"Aaj ki bikri kitni hui?"' },
  { text: 'kya kya mangwana hai?', label: '"Kya kya mangwana hai?"' },
  { text: 'Maggi hai kya? Kitne ka hai?', label: '"Maggi hai kya? Kitne ka hai?"' },
  { text: 'udhaar kitna baaki hai?', label: '"Udhaar kitna baaki hai?"' },
];

const TRY_MARATHI: { text: string; label: string }[] = [
  { text: 'दोन किलो साखर, एक टाटा मीठ आणि तीन मॅगी', label: '"दोन किलो साखर, एक टाटा मीठ आणि तीन मॅगी"' },
  { text: 'आजची विक्री किती झाली?', label: '"आजची विक्री किती झाली?"' },
  { text: 'काय काय संपत आलं आहे?', label: '"काय काय संपत आलं आहे?"' },
  { text: 'उधारी किती बाकी आहे?', label: '"उधारी किती बाकी आहे?"' },
];

function CardView({ card }: { card: AssistantCard }) {
  if (card.kind === 'sales') {
    const s = card.summary;
    return (
      <div className="bubble-card">
        <div className="mini-stats">
          <div>
            <strong>{formatPaise(s.salesPaise)}</strong>
            <span>Sales</span>
          </div>
          <div>
            <strong>{s.bills}</strong>
            <span>Bills</span>
          </div>
          <div>
            <strong>{formatPaise(s.avgBillPaise)}</strong>
            <span>Avg bill</span>
          </div>
        </div>
      </div>
    );
  }
  if (card.kind === 'restock') {
    return (
      <div className="bubble-card">
        <ul className="rows">
          {card.items.slice(0, 5).map((r) => (
            <li key={r.productId} className="row">
              <span className={`row-icon urgency-${r.urgency}`}>
                <Icon name="package" size={15} />
              </span>
              <span className="row-main">
                <span className="row-title">{r.name}</span>
                <span className="row-sub">{formatQuantity(Math.max(0, r.stockMilli), r.unit)} left</span>
              </span>
              <span className="row-side">
                <span className="badge badge-small">Order {formatQuantity(r.suggestedMilli, r.unit)}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  if (card.kind === 'products') {
    return (
      <div className="bubble-card">
        <ul className="rows">
          {card.products.slice(0, 5).map((p) => (
            <li key={p.id} className="row">
              <span className="row-icon">
                <Icon name="package" size={15} />
              </span>
              <span className="row-main">
                <span className="row-title">{p.name}</span>
                <span className="row-sub">
                  {p.stockMilli > 0 ? `${formatQuantity(p.stockMilli, p.unit)} in stock` : 'Out of stock'}
                </span>
              </span>
              <span className="row-amount">{formatPaise(p.pricePaise)}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  if (card.kind === 'udhaar') {
    return (
      <div className="bubble-card">
        <ul className="rows">
          {card.summary.top.slice(0, 4).map((c) => (
            <li key={c.id}>
              <Link to={`/customers/${c.id}`} className="row">
                <span className="row-icon">{c.name.slice(0, 1)}</span>
                <span className="row-main">
                  <span className="row-title">{c.name}</span>
                </span>
                <span className="row-amount balance-owes">{formatPaise(c.balancePaise)}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  return (
    <div className="bubble-card">
      <Link to={`/customers/${card.customer.id}`} className="row">
        <span className="row-icon">{card.customer.name.slice(0, 1)}</span>
        <span className="row-main">
          <span className="row-title">{card.customer.name}</span>
          <span className="row-sub">Open khata</span>
        </span>
        <span className="row-amount balance-owes">{formatPaise(Math.max(0, card.customer.balancePaise))}</span>
      </Link>
    </div>
  );
}

const VOICE_TEST: Record<SpeechLang, string> = {
  hi: 'नमस्ते! मैं रामू हूँ। चीनी दो किलो, बानवे रुपये। और कुछ?',
  mr: 'नमस्कार! मी रामू. साखर दोन किलो, ब्याण्णव रुपये. आणखी काही?',
};

// Pick which Hindi or Marathi voice Ramu speaks with. The list is whatever this browser/OS
// has, best first.
function VoicePicker({ lang, value, onChange }: { lang: SpeechLang; value: string; onChange: (name: string) => void }) {
  const [, refresh] = useState(0);
  useEffect(() => onVoicesChanged(() => refresh((n) => n + 1)), []);
  const voices = voicesFor(lang);
  // Marathi text can also be read by a Hindi voice when no Marathi voice is installed.
  const options = lang === 'mr' ? [...voices, ...voicesFor('hi')] : voices;
  const natural = voices.some((v) => /natural|online/i.test(v.name));
  const label = lang === 'mr' ? 'Marathi voice' : 'Hindi voice';

  return (
    <>
      <div className="setting">
        <label htmlFor="ramu-voice-name">{label}</label>
        <div style={{ display: 'flex', gap: 6 }}>
          <select id="ramu-voice-name" value={value} onChange={(e) => onChange(e.target.value)} style={{ width: 150 }}>
            <option value="">Best available</option>
            {options.map((v) => (
              <option key={v.name} value={v.name}>
                {v.name.replace(/^Microsoft /, '').replace(/ - (Hindi|Marathi) \(India\)$/, '').replace(/ \(Natural\)/, ' ✦')}
                {lang === 'mr' && v.lang.toLowerCase().startsWith('hi') ? ' (Hindi)' : ''}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => void speak(VOICE_TEST[lang], { lang, voiceName: value || undefined })}
          >
            <Icon name="play" size={14} /> Test
          </button>
        </div>
      </div>
      {options.length === 0 && (
        <p className="field-hint">No {lang === 'mr' ? 'Marathi or Hindi' : 'Hindi'} voice found on this device. Use Chrome or Edge.</p>
      )}
      {lang === 'mr' && voices.length === 0 && options.length > 0 && (
        <p className="field-hint">No Marathi voice on this device, so a Hindi voice reads the Marathi text. Edge has the natural Marathi voices "Manohar" and "Aarohi".</p>
      )}
      {voices.length > 0 && !natural && (
        <p className="field-hint">
          For the most human-sounding voice, open BillBol in Microsoft Edge: it includes natural voices ("Madhur" and
          "Swara" for Hindi, "Manohar" and "Aarohi" for Marathi).
        </p>
      )}
    </>
  );
}

export function RamuPanel() {
  const a = useAssistant();
  const [text, setText] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const { name } = a.settings;
  const marathi = a.settings.lang === 'mr-IN';

  // Keep the newest message in view.
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: 'smooth' });
  }, [a.messages.length, a.live, a.phase]);

  // Escape closes the panel.
  useEffect(() => {
    if (!a.open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && a.setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [a]);

  if (!a.open) return null;

  function submit(e: FormEvent) {
    e.preventDefault();
    a.sendText(text);
    setText('');
  }

  const d = a.draft;
  const listening = a.phase === 'listening';

  return (
    <>
      <div className="ramu-backdrop" onClick={() => a.setOpen(false)} />
      <aside className="ramu-panel" role="dialog" aria-modal="true" aria-label={`${name}, your shop assistant`}>
        <header className="ramu-head">
          <RamuOrb phase={a.phase} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2>
              {name}{' '}
              <span className={a.aiEnabled ? 'badge badge-small badge-ai' : 'badge badge-small badge-neutral'}>
                {a.aiEnabled ? 'Claude AI' : 'Offline brain'}
              </span>{' '}
              {a.voiceEngine === 'sarvam' && <span className="badge badge-small badge-ai">Natural voice</span>}
            </h2>
            <p className="ramu-status" aria-live="polite">
              {phaseLabel(a.phase, name)}
            </p>
          </div>
          <button type="button" className="icon-btn" aria-label="Assistant settings" onClick={() => setShowSettings((s) => !s)}>
            <Icon name="settings" />
          </button>
          <button type="button" className="icon-btn" aria-label="Close assistant" onClick={() => a.setOpen(false)}>
            <Icon name="x" />
          </button>
        </header>

        {a.handsFreeSupported && (
          <div className="ramu-wake">
            <span className={`live-dot${a.phase === 'standby' ? ' on' : listening ? ' hot' : ''}`} />
            <div>
              <strong>Hands-free mode</strong>
              <span>Say "Hey {name}" from anywhere in the app</span>
            </div>
            <button
              type="button"
              className="toggle"
              role="switch"
              aria-checked={a.settings.handsFree}
              aria-label="Hands-free mode"
              onClick={() => a.updateSettings({ handsFree: !a.settings.handsFree })}
            />
          </div>
        )}

        {showSettings && (
          <div className="ramu-settings">
            <div className="setting">
              <label htmlFor="ramu-name">Wake word</label>
              <input
                id="ramu-name"
                value={name}
                maxLength={30}
                onChange={(e) => a.updateSettings({ name: e.target.value || 'Ramu' })}
              />
            </div>
            <div className="setting">
              <label htmlFor="ramu-lang">Speech language</label>
              <select id="ramu-lang" value={a.settings.lang} onChange={(e) => a.updateSettings({ lang: e.target.value })}>
                <option value="hi-IN">हिंदी / Hinglish</option>
                <option value="mr-IN">मराठी</option>
                <option value="en-IN">English (India)</option>
              </select>
            </div>
            {a.naturalVoiceAvailable && (
              <div className="setting">
                <label htmlFor="ramu-natural">Natural voice (Sarvam AI)</label>
                <button
                  id="ramu-natural"
                  type="button"
                  className="toggle"
                  role="switch"
                  aria-checked={a.settings.naturalVoice}
                  onClick={() => a.updateSettings({ naturalVoice: !a.settings.naturalVoice })}
                />
              </div>
            )}
            {a.voiceEngine === 'browser' &&
              (marathi ? (
                <VoicePicker lang="mr" value={a.settings.voiceNameMr} onChange={(voiceNameMr) => a.updateSettings({ voiceNameMr })} />
              ) : (
                <VoicePicker lang="hi" value={a.settings.voiceName} onChange={(voiceName) => a.updateSettings({ voiceName })} />
              ))}
            <div className="setting">
              <label htmlFor="ramu-voice">Speak replies aloud</label>
              <button
                id="ramu-voice"
                type="button"
                className="toggle"
                role="switch"
                aria-checked={a.settings.voiceReplies}
                onClick={() => a.updateSettings({ voiceReplies: !a.settings.voiceReplies })}
              />
            </div>
          </div>
        )}

        <div className="ramu-body" ref={bodyRef}>
          {a.messages.length === 0 && (
            <div className="ramu-intro">
              <RamuOrb phase={a.phase} large />
              {marathi ? (
                <>
                  <h3>नमस्कार! मी {name}.</h3>
                  <p>
                    वस्तू सांगा, मी प्रत्येक वस्तू वाचून दाखवीन. झाल्यावर <strong>"बिल झालं"</strong> म्हणा: मी ग्राहकाचं नाव
                    विचारीन आणि तुम्ही <strong>"हो"</strong> म्हणाल तेव्हाच बिल सेव्ह करून प्रिंट करीन.
                  </p>
                </>
              ) : (
                <>
                  <h3>Namaste! Main {name} hoon.</h3>
                  <p>
                    Items boliye, I'll read each one back. When you're done, say <strong>"bill complete"</strong>: I'll ask
                    for the customer's name, and save and print only when you say <strong>"haan"</strong>.
                  </p>
                </>
              )}
              <div className="try-list">
                {(marathi ? TRY_MARATHI : TRY).map((t) => (
                  <button key={t.text} type="button" className="try" onClick={() => a.sendText(t.text)}>
                    <Icon name="sparkles" size={16} />
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {a.messages.map((m) =>
            m.role === 'system' ? (
              <div key={m.id} className="bubble bubble-system">
                <Icon name="check" size={14} style={{ display: 'inline', verticalAlign: '-2px' }} /> {m.text}
                {m.billId && (
                  <>
                    {' · '}
                    <Link to={`/bills/${m.billId}`} onClick={() => a.setOpen(false)}>
                      View
                    </Link>
                    {' · '}
                    <button type="button" className="link-button" onClick={() => a.printSavedBill(m.billId!)}>
                      Print
                    </button>
                  </>
                )}
              </div>
            ) : (
              <div key={m.id} className={m.role === 'user' ? 'bubble bubble-user' : 'bubble bubble-ramu'}>
                {m.text}
                {m.card && <CardView card={m.card} />}
                {m.role === 'ramu' && m.engine && (
                  <div className="bubble-meta">
                    <Icon name={m.engine === 'claude' ? 'sparkles' : 'zap'} size={12} />
                    {m.engine === 'claude' ? 'Claude agent' : 'Offline brain'}
                  </div>
                )}
              </div>
            ),
          )}

          {listening && <div className="live-line">{a.live || `Boliye… e.g. "do kilo cheeni aur ek sabun"`}</div>}
          {a.phase === 'thinking' && (
            <div className="bubble bubble-ramu" aria-label="Thinking">
              <span className="spinner" style={{ width: 18, height: 18, borderWidth: 2, display: 'inline-block' }} />
            </div>
          )}
          {a.error && <div className="form-alert">{a.error}</div>}
        </div>

        {d && d.items.length > 0 && (
          <section className="draft-card" aria-label="Draft bill">
            <div className="draft-head">
              <span>
                <Icon name="receipt" size={14} style={{ display: 'inline', verticalAlign: '-2px' }} /> Draft bill · {d.items.length}{' '}
                {d.items.length === 1 ? 'item' : 'items'}
              </span>
              <span>
                {PAYMENT_LABELS[d.paymentMode]}
                {d.customer ? ` · ${d.customer.name}` : ''}
              </span>
            </div>
            <ul className="draft-lines">
              {(d.quote?.lines ?? []).map((l) => (
                <li key={l.productId}>
                  <span>
                    {l.name} <span className="muted">× {formatQuantity(l.quantityMilli, l.unit)}</span>
                  </span>
                  <span>{formatPaise(l.totalPaise)}</span>
                </li>
              ))}
            </ul>
            {d.unmatched.length > 0 && <p className="draft-say">Not found: {d.unmatched.join(', ')}</p>}
            <div className="draft-total">
              <span className="muted">Total</span>
              <strong>{d.quote ? formatPaise(d.quote.totalPaise) : '—'}</strong>
            </div>
            <div className="draft-actions">
              <button type="button" className="btn btn-secondary" onClick={a.discardDraft} disabled={a.confirming}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" onClick={a.confirmDraft} disabled={a.confirming}>
                <Icon name="check" size={18} />
                {a.confirming ? 'Saving…' : 'Confirm bill'}
              </button>
            </div>
            <p className="draft-say">
              {a.step === 'confirm' ? (
                <>
                  Say <strong>{marathi ? '"हो"' : '"haan"'}</strong> to save and print ·{' '}
                </>
              ) : (
                <>
                  Say <strong>{marathi ? '"बिल झालं"' : '"bill complete"'}</strong> when done ·{' '}
                  <strong>{marathi ? '"रद्द"' : '"cancel"'}</strong> to clear ·{' '}
                </>
              )}
              <button type="button" className="link-button" onClick={a.editDraftInBilling}>
                edit in billing
              </button>
            </p>
          </section>
        )}

        <form className="ramu-input" onSubmit={submit}>
          {a.supported && (
            <button
              type="button"
              className={listening ? 'talk-btn on' : 'talk-btn'}
              aria-label={listening ? 'Stop listening' : 'Talk'}
              onClick={listening ? a.stopTalking : a.talk}
            >
              <Icon name={listening ? 'stop' : 'mic'} />
            </button>
          )}
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={`Type to ${name}…`}
            aria-label={`Message ${name}`}
            maxLength={500}
          />
          <button type="submit" className="send-btn" aria-label="Send" disabled={!text.trim() || a.phase === 'thinking'}>
            <Icon name="send" size={18} />
          </button>
        </form>
      </aside>
    </>
  );
}
