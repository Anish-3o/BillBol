import { CATALOGUE, seedBarcode, toMilli, toPaise } from '../src/scripts/seedProducts';
import { createProductSchema } from '../src/validators/product.validator';

// The demo catalogue goes through the same rules as products typed into the app.
describe('demo catalogue', () => {
  it('has 50 products with unique names and barcodes', () => {
    expect(CATALOGUE).toHaveLength(50);
    expect(new Set(CATALOGUE.map((s) => s.name.toLowerCase())).size).toBe(50);
    const codes = CATALOGUE.map(seedBarcode).filter(Boolean);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('passes the product schema, never sells above MRP, and has a local name for voice', () => {
    for (const [index, seed] of CATALOGUE.entries()) {
      const parsed = createProductSchema.safeParse({
        name: seed.name,
        localName: seed.localName,
        unit: seed.unit,
        pricePaise: toPaise(seed.price),
        mrpPaise: seed.mrp === undefined ? null : toPaise(seed.mrp),
        gstRate: seed.gstRate,
        hsn: seed.hsn,
        barcode: seedBarcode(seed, index),
        stockMilli: toMilli(seed.stock),
        lowStockMilli: toMilli(seed.lowStock),
      });
      expect(parsed.success).toBe(true);
      if (seed.mrp !== undefined) expect(seed.price).toBeLessThanOrEqual(seed.mrp);
      expect(seed.localName).toMatch(/\p{Script=Devanagari}/u);
    }
  });
});
