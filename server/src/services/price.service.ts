import { Product, type ProductDoc } from '../models/Product';
import type { PriceUpdateInput } from '../validators/product.validator';

// Bulk price update: the owner uploads a price list (from a distributor, or the shop's own
// list edited in Excel) and BillBol updates the matching products in one go.
//
// Prices are never fetched from the internet. No brand publishes an official price feed in
// India, quick-commerce prices are not MRPs, and every kirana sets its own selling price, so
// a price only changes when the owner supplies it. The same call previews (apply: false)
// and saves (apply: true), so what is saved is exactly what the owner saw.

export type PriceChange = {
  productId: string;
  name: string;
  oldPricePaise: number;
  pricePaise: number;
  oldMrpPaise: number | null;
  mrpPaise: number | null;
};

export type PriceUpdateResult = {
  applied: boolean;
  changes: PriceChange[];
  unchanged: number;
  notFound: string[]; // how the row named the product, so the owner can fix the list
  invalid: { row: string; message: string }[];
};

export async function updatePrices(tenantId: string, input: PriceUpdateInput): Promise<PriceUpdateResult> {
  // Only this shop's active products can match (Rule 1), whatever the list says.
  const products = await Product.find({ tenantId, isActive: true });
  const byBarcode = new Map(products.filter((p) => p.barcode).map((p) => [p.barcode!, p]));
  const byName = new Map(products.map((p) => [p.name.toLowerCase(), p]));

  const result: PriceUpdateResult = { applied: input.apply, changes: [], unchanged: 0, notFound: [], invalid: [] };
  const seen = new Set<string>();

  for (const row of input.rows) {
    const label = row.barcode || row.name!;
    // Barcode first: it is exact, while names in a distributor's list may be spelled differently.
    const product: ProductDoc | undefined =
      (row.barcode ? byBarcode.get(row.barcode) : undefined) ?? (row.name ? byName.get(row.name.toLowerCase()) : undefined);
    if (!product) {
      result.notFound.push(label);
      continue;
    }
    if (seen.has(product.id)) {
      result.invalid.push({ row: label, message: `${product.name} appears more than once in the list` });
      continue;
    }
    seen.add(product.id);

    const oldMrp = product.mrpPaise ?? null;
    const mrp = row.mrpPaise === undefined ? oldMrp : row.mrpPaise;
    // Selling above MRP is illegal in India; the same rule as the product form.
    if (mrp !== null && row.pricePaise > mrp) {
      result.invalid.push({ row: label, message: `${product.name}: selling price is more than the MRP` });
      continue;
    }
    if (row.pricePaise === product.pricePaise && mrp === oldMrp) {
      result.unchanged++;
      continue;
    }
    result.changes.push({
      productId: product.id,
      name: product.name,
      oldPricePaise: product.pricePaise,
      pricePaise: row.pricePaise,
      oldMrpPaise: oldMrp,
      mrpPaise: mrp,
    });
  }

  if (input.apply && result.changes.length > 0) {
    // One round trip for the whole list. Each update is filtered by tenantId as well as _id.
    await Product.bulkWrite(
      result.changes.map((c) => ({
        updateOne: {
          filter: { _id: c.productId, tenantId },
          update: c.mrpPaise === null ? { $set: { pricePaise: c.pricePaise }, $unset: { mrpPaise: 1 } } : { $set: { pricePaise: c.pricePaise, mrpPaise: c.mrpPaise } },
        },
      })),
    );
  }
  return result;
}
