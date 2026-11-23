// Mirrors server/src/services/stock.service.ts and staff.service.ts.

export type StockReceipt = {
  id: string;
  items: { productId: string; name: string; unit: string; quantityMilli: number }[];
  supplier: string | null;
  note: string | null;
  createdByName: string;
  createdAt: string;
};

export type Staff = { id: string; name: string; phone: string | null; createdAt: string };
