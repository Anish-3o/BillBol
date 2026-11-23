import mongoose from 'mongoose';
import { COUNT_UNITS, Product } from '../models/Product';
import { StockReceipt, type StockReceiptDoc } from '../models/StockReceipt';
import { User } from '../models/User';
import { AppError } from '../utils/AppError';
import type { ListReceiptsQuery, ReceiveStockInput } from '../validators/stock.validator';

export type PublicStockReceipt = {
  id: string;
  items: { productId: string; name: string; unit: string; quantityMilli: number }[];
  supplier: string | null;
  note: string | null;
  createdByName: string;
  createdAt: string;
};

type Auth = { userId: string; tenantId: string };

// Goods arrive: add them to stock and keep a receipt saying what came in and who counted it.
// Both owner and staff can do this (unloading a delivery is a helper's job), and the receipt
// records who did. The receipt and the stock increases are one transaction, so stock can
// never go up without a record of why.
export async function receiveStock(auth: Auth, input: ReceiveStockInput): Promise<PublicStockReceipt> {
  const user = await User.findOne({ _id: auth.userId, tenantId: auth.tenantId });
  if (!user) throw new AppError(401, 'Session expired, please log in again');

  // The same product scanned in several times becomes one line.
  const wanted = new Map<string, number>();
  for (const { productId, quantityMilli } of input.items) {
    const id = productId.toLowerCase();
    wanted.set(id, (wanted.get(id) ?? 0) + quantityMilli);
  }

  const session = await mongoose.startSession();
  try {
    let saved: StockReceiptDoc | undefined;
    await session.withTransaction(async () => {
      const products = await Product.find({ tenantId: auth.tenantId, _id: { $in: [...wanted.keys()] }, isActive: true }).session(
        session,
      );
      const byId = new Map(products.map((p) => [p.id as string, p]));

      const lines = [];
      for (const [productId, quantityMilli] of wanted) {
        const product = byId.get(productId);
        // Archived, or another shop's product: both look the same to the caller.
        if (!product) throw new AppError(400, 'One of the items is no longer available. Remove it and add it again.');
        if ((COUNT_UNITS as readonly string[]).includes(product.unit) && quantityMilli % 1000 !== 0) {
          throw new AppError(400, `${product.name}: quantity must be a whole number of ${product.unit}s`);
        }
        lines.push({ productId, name: product.name, unit: product.unit, quantityMilli });
      }

      [saved] = await StockReceipt.create(
        [
          {
            tenantId: auth.tenantId,
            items: lines,
            supplier: input.supplier,
            note: input.note,
            createdBy: user._id,
            createdByName: user.name,
          },
        ],
        { session },
      );
      // $inc, so a sale happening at the same moment is not lost (see createBill).
      for (const line of lines) {
        await Product.updateOne(
          { _id: line.productId, tenantId: auth.tenantId },
          { $inc: { stockMilli: line.quantityMilli } },
          { session },
        );
      }
    });
    return toPublicReceipt(saved!);
  } finally {
    await session.endSession();
  }
}

export async function listReceipts(tenantId: string, query: ListReceiptsQuery): Promise<PublicStockReceipt[]> {
  const receipts = await StockReceipt.find({ tenantId }).sort({ createdAt: -1 }).limit(query.limit);
  return receipts.map(toPublicReceipt);
}

function toPublicReceipt(r: StockReceiptDoc): PublicStockReceipt {
  return {
    id: r.id,
    items: r.items.map((i) => ({
      productId: i.productId.toString(),
      name: i.name,
      unit: i.unit,
      quantityMilli: i.quantityMilli,
    })),
    supplier: r.supplier ?? null,
    note: r.note ?? null,
    createdByName: r.createdByName,
    createdAt: r.createdAt.toISOString(),
  };
}
