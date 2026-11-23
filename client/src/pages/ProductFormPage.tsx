import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { ApiError, toFormErrors, type FormErrors } from '../api/client';
import { archiveProduct, createProduct, getProduct, updateProduct } from '../api/products';
import { Field, FormAlert, SelectField } from '../components/FormField';
import { PageLoader } from '../components/RouteGuards';
import { paiseToInput, rupeesToPaise } from '../lib/money';
import { isCountUnit, milliToInput, quantityToMilli, UNIT_LABELS, UNITS } from '../lib/quantity';
import { GST_RATES, type Product, type ProductInput } from '../types/product';
import { useFocusFirstError } from '../hooks/useFocusFirstError';

const NO_ERRORS: FormErrors = { message: null, fields: {} };

// One page for both "add" (/products/new) and "edit" (/products/:id/edit).
// Both routes render this same component in the same place, so React would reuse it and
// keep the old state (an "Add" form pre-filled with the last edited product). The key makes
// React start fresh whenever the URL's product changes.
export default function ProductFormPage() {
  const { id } = useParams();
  return <ProductEditor key={id ?? 'new'} id={id} />;
}

function ProductEditor({ id }: { id: string | undefined }) {
  const [product, setProduct] = useState<Product | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    getProduct(id)
      .then((p) => !cancelled && setProduct(p))
      .catch((err) => {
        if (cancelled) return;
        setLoadError(err instanceof ApiError && err.status === 404 ? 'Product not found.' : 'Could not load this product.');
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loadError) {
    return (
      <main className="page">
        <div className="form-alert" role="alert">
          {loadError}
        </div>
        <Link to="/products">← Back to products</Link>
      </main>
    );
  }
  if (id && !product) return <PageLoader inline />;
  return <ProductForm product={product} />;
}

function ProductForm({ product }: { product: Product | null }) {
  const navigate = useNavigate();
  // "Add as new product" on the billing screen opens /products/new?barcode=<the unknown code>.
  const [params] = useSearchParams();
  const scannedBarcode = params.get('barcode') ?? '';
  const [errors, setErrors] = useState<FormErrors>(NO_ERRORS);
  const [busy, setBusy] = useState(false);
  useFocusFirstError(errors);
  // Controlled so the stock hint can change with the unit.
  const [unit, setUnit] = useState(product?.unit ?? 'piece');
  const err = (field: keyof ProductInput) => errors.fields[field]?.[0];

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const text = (name: string) => String(form.get(name) ?? '').trim();

    // Convert what the user typed ("45.50", "2.5") into paise and thousandths. If a value
    // cannot be converted, show the error here; the server never sees text amounts.
    const fieldErrors: Record<string, string[]> = {};
    const pricePaise = rupeesToPaise(text('price'));
    if (pricePaise === null) fieldErrors.pricePaise = ['Enter a price like 45 or 45.50'];
    const mrpPaise = text('mrp') ? rupeesToPaise(text('mrp')) : null;
    if (text('mrp') && mrpPaise === null) fieldErrors.mrpPaise = ['Enter an MRP like 50 or 49.90'];
    const stockMilli = quantityToMilli(text('stock') || '0');
    if (stockMilli === null) fieldErrors.stockMilli = ['Enter a number like 10 or 2.5'];
    const lowStockMilli = quantityToMilli(text('lowStock') || '0');
    if (lowStockMilli === null) fieldErrors.lowStockMilli = ['Enter a number like 5 or 0.5'];

    if (Object.keys(fieldErrors).length > 0) {
      setErrors({ message: 'Please fix the highlighted fields.', fields: fieldErrors });
      return;
    }

    const input: ProductInput = {
      name: text('name'),
      localName: text('localName') || null,
      unit,
      pricePaise: pricePaise!,
      mrpPaise,
      gstRate: Number(text('gstRate')),
      hsn: text('hsn') || null,
      barcode: text('barcode') || null,
      stockMilli: stockMilli!,
      lowStockMilli: lowStockMilli!,
    };

    setBusy(true);
    setErrors(NO_ERRORS);
    try {
      if (product) await updateProduct(product.id, input);
      else await createProduct(input);
      navigate('/products');
    } catch (error) {
      setErrors(toFormErrors(error));
      setBusy(false);
    }
  }

  async function handleArchive() {
    if (!product) return;
    const ok = window.confirm(
      `Archive "${product.name}"?\n\nIt will be hidden from your product list. Past bills are not affected.`,
    );
    if (!ok) return;
    setBusy(true);
    try {
      await archiveProduct(product.id);
      navigate('/products');
    } catch (error) {
      setErrors(toFormErrors(error));
      setBusy(false);
    }
  }

  return (
    <main className="page">
      <Link to="/products" className="back-link">
        ← Products
      </Link>
      <h1 className="page-title">{product ? 'Edit product' : 'Add product'}</h1>

      <form className="info-card form-card" onSubmit={handleSubmit}>
        <FormAlert message={errors.message} />

        <Field
          label="Product name"
          name="name"
          required
          maxLength={100}
          placeholder="Tata Salt 1kg"
          defaultValue={product?.name}
          error={err('name')}
        />
        <Field
          label="Hindi / local name (optional)"
          name="localName"
          maxLength={100}
          placeholder="नमक"
          hint="How customers ask for it. Used for voice billing later."
          defaultValue={product?.localName ?? ''}
          error={err('localName')}
        />
        <SelectField
          label="Sold by"
          name="unit"
          value={unit}
          onChange={(e) => setUnit(e.target.value)}
          error={err('unit')}
        >
          {UNITS.map((u) => (
            <option key={u} value={u}>
              {UNIT_LABELS[u].long}
            </option>
          ))}
        </SelectField>

        <div className="field-row">
          <Field
            label={`Selling price (₹ per ${UNIT_LABELS[unit as keyof typeof UNIT_LABELS].short})`}
            name="price"
            inputMode="decimal"
            required
            placeholder="45.00"
            hint="Including GST."
            defaultValue={product ? paiseToInput(product.pricePaise) : ''}
            error={err('pricePaise')}
          />
          <Field
            label="MRP (₹, optional)"
            name="mrp"
            inputMode="decimal"
            placeholder="50.00"
            defaultValue={product?.mrpPaise != null ? paiseToInput(product.mrpPaise) : ''}
            error={err('mrpPaise')}
          />
        </div>

        <div className="field-row">
          <SelectField
            label="GST rate"
            name="gstRate"
            required
            defaultValue={product ? String(product.gstRate) : ''}
            error={err('gstRate')}
          >
            <option value="" disabled>
              Select
            </option>
            {GST_RATES.map((r) => (
              <option key={r} value={r}>
                {r === 0 ? '0% (exempt)' : `${r}%`}
              </option>
            ))}
          </SelectField>
          <Field
            label="HSN code (optional)"
            name="hsn"
            inputMode="numeric"
            maxLength={8}
            placeholder="2501"
            defaultValue={product?.hsn ?? ''}
            error={err('hsn')}
          />
        </div>

        <Field
          label="Barcode (optional)"
          name="barcode"
          maxLength={32}
          autoComplete="off"
          placeholder="Click here, then scan the packet"
          hint="Scan the packet with your barcode scanner, or type the number under the bars."
          defaultValue={product?.barcode ?? scannedBarcode}
          error={err('barcode')}
          // A scanner presses Enter after the code; here that must not submit the half-filled form.
          onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
        />

        <div className="field-row">
          <Field
            label="Current stock"
            name="stock"
            inputMode="decimal"
            placeholder="0"
            hint={isCountUnit(unit) ? 'Whole numbers only.' : 'Decimals allowed, e.g. 2.5'}
            defaultValue={product ? milliToInput(product.stockMilli) : ''}
            error={err('stockMilli')}
          />
          <Field
            label="Low-stock alert at"
            name="lowStock"
            inputMode="decimal"
            placeholder="0"
            hint="Warn me at or below this. 0 = off."
            defaultValue={product && product.lowStockMilli > 0 ? milliToInput(product.lowStockMilli) : ''}
            error={err('lowStockMilli')}
          />
        </div>

        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {busy ? 'Saving…' : product ? 'Save changes' : 'Add product'}
        </button>
        {product && (
          <button type="button" className="btn btn-danger-ghost btn-block" onClick={handleArchive} disabled={busy}>
            Archive product
          </button>
        )}
      </form>
    </main>
  );
}
