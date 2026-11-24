import { useState, type ChangeEvent } from 'react';
import { Link } from 'react-router';
import { ApiError } from '../api/client';
import { listProducts, updatePrices, type PriceUpdateResult } from '../api/products';
import { Icon } from '../components/Icon';
import { formatPaise } from '../lib/money';
import { parsePriceList, toPriceListCsv, type PriceRow } from '../lib/priceList';
import type { Product } from '../types/product';

// Bulk price update. Prices are never fetched from the internet: there is no official price
// feed for Indian brands, and each shop sets its own selling price. Instead the owner brings
// a price list (a distributor's sheet, or our download edited in Excel), sees every change,
// and only then applies it.
export default function PriceUpdatePage() {
  const [text, setText] = useState('');
  const [rows, setRows] = useState<PriceRow[]>([]);
  const [problems, setProblems] = useState<string[]>([]);
  const [preview, setPreview] = useState<PriceUpdateResult | null>(null);
  const [saved, setSaved] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function downloadCurrent() {
    setError(null);
    try {
      // Every active product, 200 at a time (the API's page size limit).
      const all: Product[] = [];
      for (let page = 1; ; page++) {
        const res = await listProducts({ limit: 200, page });
        all.push(...res.items);
        if (all.length >= res.total || res.items.length === 0) break;
      }
      const url = URL.createObjectURL(new Blob([toPriceListCsv(all)], { type: 'text/csv;charset=utf-8' }));
      const a = Object.assign(document.createElement('a'), { href: url, download: 'billbol-prices.csv' });
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError('Could not download the price list. Please try again.');
    }
  }

  async function chooseFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) setText(await file.text());
    e.target.value = ''; // choosing the same file again should load it again
  }

  async function check() {
    setError(null);
    setSaved(null);
    setPreview(null);
    const parsed = parsePriceList(text);
    setRows(parsed.rows);
    setProblems(parsed.problems);
    if (parsed.rows.length === 0) return;
    setBusy(true);
    try {
      setPreview(await updatePrices(parsed.rows, false));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not check the price list.');
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    setBusy(true);
    setError(null);
    try {
      // The same rows as the preview, so what is saved is exactly what was shown.
      const result = await updatePrices(rows, true);
      setSaved(result.changes.length);
      setPreview(null);
      setText('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the new prices.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page">
      <Link to="/products" className="back-link">
        ← Products
      </Link>
      <div className="page-header">
        <div>
          <h1 className="page-title">Update prices</h1>
          <p className="page-sub">
            Upload a price list or paste it from Excel. You'll see every change before anything is saved.
          </p>
        </div>
      </div>

      {saved !== null && (
        <div className="success-banner" role="status">
          <Icon name="check" size={18} /> {saved} {saved === 1 ? 'price' : 'prices'} updated.
        </div>
      )}
      {error && (
        <div className="form-alert" role="alert">
          {error}
        </div>
      )}

      <section className="card">
        <div className="card-head">
          <h2 className="card-title">1. Get a price list</h2>
        </div>
        <p className="muted">
          Download your current prices, change them in Excel and upload the file. A distributor's list works too, as long as
          it has a <strong>Name</strong> (or <strong>Barcode</strong>) column and a <strong>Price</strong> column.{' '}
          <strong>MRP</strong> is optional.
        </p>
        <div className="button-row" style={{ marginTop: 12 }}>
          <button type="button" className="btn btn-secondary" onClick={() => void downloadCurrent()}>
            <Icon name="receipt" size={18} /> Download current prices
          </button>
          <label className="btn btn-secondary">
            <Icon name="plus" size={18} /> Choose CSV file
            <input type="file" accept=".csv,text/csv,text/plain" onChange={(e) => void chooseFile(e)} hidden />
          </label>
        </div>
        <div className="field" style={{ marginTop: 16 }}>
          <label htmlFor="price-list">Or paste rows here</label>
          <textarea
            id="price-list"
            rows={8}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={'Name,Barcode,Price,MRP\nTata Salt 1kg,,29,30\nMaggi Noodles 70g,,15,15'}
            style={{ fontFamily: 'monospace' }}
          />
        </div>
        <div className="button-row" style={{ marginTop: 12 }}>
          <button type="button" className="btn btn-primary" onClick={() => void check()} disabled={!text.trim() || busy}>
            <Icon name="search" size={18} /> {busy && !preview ? 'Checking…' : 'Check changes'}
          </button>
        </div>
        {problems.length > 0 && (
          <div className="form-alert" role="alert" style={{ marginTop: 12 }}>
            {problems.slice(0, 8).map((p) => (
              <div key={p}>{p}</div>
            ))}
            {problems.length > 8 && <div>…and {problems.length - 8} more</div>}
          </div>
        )}
      </section>

      {preview && (
        <section className="card" style={{ marginTop: 16 }}>
          <div className="card-head">
            <h2 className="card-title">2. Check and apply</h2>
          </div>
          {preview.changes.length === 0 ? (
            <p className="muted">No prices would change.</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Price</th>
                  <th>MRP</th>
                </tr>
              </thead>
              <tbody>
                {preview.changes.map((c) => (
                  <tr key={c.productId}>
                    <td>{c.name}</td>
                    <td>
                      <span className="muted">{formatPaise(c.oldPricePaise)} →</span> <strong>{formatPaise(c.pricePaise)}</strong>
                    </td>
                    <td>
                      {c.oldMrpPaise === c.mrpPaise ? (
                        <span className="muted">{c.mrpPaise === null ? '—' : formatPaise(c.mrpPaise)}</span>
                      ) : (
                        <>
                          <span className="muted">{c.oldMrpPaise === null ? '—' : formatPaise(c.oldMrpPaise)} →</span>{' '}
                          <strong>{c.mrpPaise === null ? '—' : formatPaise(c.mrpPaise)}</strong>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="muted" style={{ marginTop: 12 }}>
            {preview.unchanged > 0 && `${preview.unchanged} unchanged. `}
            {preview.notFound.length > 0 && `Not in your shop: ${preview.notFound.slice(0, 10).join(', ')}${preview.notFound.length > 10 ? '…' : ''}. `}
          </p>
          {preview.invalid.length > 0 && (
            <div className="form-alert" role="alert">
              {preview.invalid.map((i) => (
                <div key={i.row + i.message}>{i.message}</div>
              ))}
            </div>
          )}
          {preview.changes.length > 0 && (
            <div className="button-row" style={{ marginTop: 12 }}>
              <button type="button" className="btn btn-primary" onClick={() => void apply()} disabled={busy}>
                <Icon name="check" size={18} /> {busy ? 'Saving…' : `Apply ${preview.changes.length} ${preview.changes.length === 1 ? 'change' : 'changes'}`}
              </button>
            </div>
          )}
        </section>
      )}
    </main>
  );
}
