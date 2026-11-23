// Mirrors server/src/services/customer.service.ts. Money in paise.

export type Customer = {
  id: string;
  name: string;
  phone: string | null;
  // What the customer owes the shop. Negative = paid in advance.
  balancePaise: number;
  createdAt: string;
};

export type CustomerList = {
  items: Customer[];
  total: number;
  totalOwedPaise: number;
  customersOwing: number;
};

export type LedgerEntry = {
  id: string;
  type: 'credit_sale' | 'payment' | 'bill_cancelled';
  amountPaise: number;
  balanceAfterPaise: number;
  billId: string | null;
  billNumber: string | null;
  paymentMode: string | null;
  note: string | null;
  createdByName: string;
  createdAt: string;
};

export type CashMode = 'cash' | 'upi' | 'card';
