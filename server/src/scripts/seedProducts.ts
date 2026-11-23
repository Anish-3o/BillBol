// Adds a typical kirana catalogue to one shop, for development and demos.
//
//   npm run seed:products -- <owner phone>
//   e.g. npm run seed:products -- 9876543210
//
// Products go through the same Zod schema and product service as the API, so they obey
// the same rules (price <= MRP, whole numbers for pieces...). Safe to run again: products
// whose name already exists in the shop are skipped.
//
// Prices are illustrative (Nov 2026) and include GST. GST rates are our best reading of the
// GST 2.0 slabs (Sep 2025): loose staples, fresh milk, eggs, bread 0%; most packaged food
// and personal care 5%; detergent 18%; aerated drinks 40%. Verify with a CA.
import mongoose from 'mongoose';
import { connectDB, disconnectDB } from '../config/db';
import { CASE_INSENSITIVE, Product } from '../models/Product';
import { User } from '../models/User';
import { createProduct } from '../services/product.service';
import { phoneSchema } from '../validators/auth.validator';
import { createProductSchema } from '../validators/product.validator';

export type Seed = {
  name: string;
  localName: string;
  unit: string;
  price: number; // rupees, converted to paise below
  mrp?: number;
  gstRate: number;
  hsn: string;
  stock: number; // in the product's unit, converted to thousandths below
  lowStock: number;
};

export const CATALOGUE: Seed[] = [
  // Loose staples, sold by weight
  { name: 'Basmati Rice (loose)', localName: 'चावल', unit: 'kg', price: 110, gstRate: 0, hsn: '1006', stock: 50, lowStock: 10 },
  { name: 'Toor Dal (loose)', localName: 'तूर दाल', unit: 'kg', price: 160, gstRate: 0, hsn: '0713', stock: 30, lowStock: 5 },
  { name: 'Moong Dal (loose)', localName: 'मूंग दाल', unit: 'kg', price: 130, gstRate: 0, hsn: '0713', stock: 15, lowStock: 3 },
  { name: 'Sugar (loose)', localName: 'चीनी', unit: 'kg', price: 46, gstRate: 5, hsn: '1701', stock: 40, lowStock: 10 },
  // Packaged staples
  { name: 'Aashirvaad Atta 5kg', localName: 'आटा', unit: 'packet', price: 285, mrp: 310, gstRate: 5, hsn: '1101', stock: 20, lowStock: 5 },
  { name: 'Tata Salt 1kg', localName: 'नमक', unit: 'packet', price: 28, mrp: 30, gstRate: 0, hsn: '2501', stock: 30, lowStock: 10 },
  { name: 'Fortune Sunflower Oil 1L', localName: 'तेल', unit: 'packet', price: 155, mrp: 175, gstRate: 5, hsn: '1512', stock: 24, lowStock: 6 },
  { name: 'Besan 500g', localName: 'बेसन', unit: 'packet', price: 55, mrp: 60, gstRate: 5, hsn: '1106', stock: 18, lowStock: 5 },
  { name: 'Poha 500g', localName: 'पोहा', unit: 'packet', price: 40, mrp: 45, gstRate: 5, hsn: '1904', stock: 20, lowStock: 5 },
  { name: 'Tata Tea Gold 250g', localName: 'चाय पत्ती', unit: 'packet', price: 155, mrp: 165, gstRate: 5, hsn: '0902', stock: 15, lowStock: 4 },
  { name: 'Turmeric Powder 100g', localName: 'हल्दी', unit: 'packet', price: 35, mrp: 38, gstRate: 5, hsn: '0910', stock: 25, lowStock: 5 },
  { name: 'Red Chilli Powder 100g', localName: 'लाल मिर्च', unit: 'packet', price: 45, mrp: 48, gstRate: 5, hsn: '0904', stock: 25, lowStock: 5 },
  // Dairy, eggs, bread
  { name: 'Amul Milk 500ml', localName: 'दूध', unit: 'packet', price: 34, mrp: 34, gstRate: 0, hsn: '0401', stock: 40, lowStock: 10 },
  { name: 'Amul Butter 100g', localName: 'मक्खन', unit: 'piece', price: 60, mrp: 62, gstRate: 5, hsn: '0405', stock: 2, lowStock: 5 },
  { name: 'Eggs', localName: 'अंडे', unit: 'piece', price: 7, gstRate: 0, hsn: '0407', stock: 120, lowStock: 30 },
  { name: 'Brown Bread', localName: 'ब्रेड', unit: 'packet', price: 50, mrp: 50, gstRate: 0, hsn: '1905', stock: 10, lowStock: 3 },
  // Snacks
  { name: 'Parle-G 250g', localName: 'बिस्किट', unit: 'packet', price: 25, mrp: 25, gstRate: 5, hsn: '1905', stock: 48, lowStock: 12 },
  { name: 'Maggi Noodles 70g', localName: 'मैगी', unit: 'packet', price: 14, mrp: 15, gstRate: 5, hsn: '1902', stock: 60, lowStock: 12 },
  { name: 'Haldiram Bhujia 200g', localName: 'भुजिया', unit: 'packet', price: 55, mrp: 60, gstRate: 5, hsn: '2106', stock: 20, lowStock: 5 },
  { name: 'Coca-Cola 750ml', localName: 'कोल्ड ड्रिंक', unit: 'piece', price: 40, mrp: 40, gstRate: 40, hsn: '2202', stock: 3, lowStock: 6 },
  // Household and personal care
  { name: 'Lux Soap 100g', localName: 'साबुन', unit: 'piece', price: 38, mrp: 40, gstRate: 5, hsn: '3401', stock: 36, lowStock: 10 },
  { name: 'Colgate Toothpaste 100g', localName: 'मंजन', unit: 'piece', price: 55, mrp: 58, gstRate: 5, hsn: '3306', stock: 20, lowStock: 5 },
  { name: 'Parachute Coconut Oil 250ml', localName: 'नारियल तेल', unit: 'piece', price: 110, mrp: 115, gstRate: 5, hsn: '1513', stock: 12, lowStock: 4 },
  { name: 'Surf Excel 1kg', localName: 'सर्फ', unit: 'packet', price: 135, mrp: 145, gstRate: 18, hsn: '3402', stock: 15, lowStock: 4 },
  { name: 'Matchbox (pack of 10)', localName: 'माचिस', unit: 'packet', price: 10, gstRate: 5, hsn: '3605', stock: 30, lowStock: 5 },
  { name: 'Agarbatti', localName: 'अगरबत्ती', unit: 'packet', price: 30, mrp: 30, gstRate: 5, hsn: '3307', stock: 20, lowStock: 5 },
];

// Rupees/units to paise/thousandths. Math.round guards against float noise (e.g. 0.1 * 3)
// in these hand-written constants; real user input is converted exactly in the client.
export const toPaise = (rupees: number) => Math.round(rupees * 100);
export const toMilli = (qty: number) => Math.round(qty * 1000);

// Demo barcodes for packaged goods (loose kg/litre goods have none). They use the GS1 prefix
// 200, which is reserved for a shop's own in-store labels, so they can never clash with a real
// brand's code. Real packets carry their maker's EAN; the owner scans it into the product form.
export function seedBarcode(seed: Seed, index: number): string | null {
  if (seed.unit === 'kg' || seed.unit === 'litre') return null;
  return ean13(`200${String(index + 1).padStart(9, '0')}`);
}

// EAN-13 check digit: weights 1,3,1,3... over the first 12 digits, then round up to a multiple
// of 10. Scanners reject a code whose check digit is wrong, so printed demo labels need it.
export function ean13(first12: string): string {
  const sum = [...first12].reduce((s, d, i) => s + Number(d) * (i % 2 === 0 ? 1 : 3), 0);
  return first12 + ((10 - (sum % 10)) % 10);
}

async function main(): Promise<void> {
  const phoneArg = process.argv[2];
  const phone = phoneSchema.safeParse(phoneArg ?? '');
  if (!phone.success) {
    console.error('Usage: npm run seed:products -- <owner phone>   (10-digit mobile number)');
    process.exitCode = 1;
    return;
  }

  await connectDB();
  try {
    const owner = await User.findOne({ phone: phone.data, role: 'owner' });
    if (!owner) {
      console.error(`No shop owner with phone ${phone.data}. Register the shop first.`);
      process.exitCode = 1;
      return;
    }
    const tenantId = owner.tenantId.toString();

    let added = 0;
    let skipped = 0;
    for (const [index, seed] of CATALOGUE.entries()) {
      const exists = await Product.exists({ tenantId, name: seed.name, isActive: true }).collation(
        CASE_INSENSITIVE,
      );
      if (exists) {
        skipped++;
        continue;
      }
      const input = createProductSchema.parse({
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
      await createProduct(tenantId, input);
      added++;
    }
    console.log(`✅ Added ${added} products, skipped ${skipped} that already existed.`);
  } finally {
    await disconnectDB();
  }
}

if (require.main === module) main().catch(async (err) => {
  console.error('❌ Seeding failed:', err);
  await mongoose.disconnect();
  process.exit(1);
});
