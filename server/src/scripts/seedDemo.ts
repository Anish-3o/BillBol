// Creates (or rebuilds) the demo shop in the database from MONGO_URI:
//
//   npm run seed:demo
//
// The real work is in src/services/demoShop.service.ts, shared with the nightly reset of the
// live demo (src/routes/cron.routes.ts).
import mongoose from 'mongoose';
import { connectDB, disconnectDB } from '../config/db';
import { DEMO, resetDemoShop } from '../services/demoShop.service';

async function main(): Promise<void> {
  await connectDB();
  try {
    const shop = await resetDemoShop();
    if (shop.replacedOld) console.log('🧹 Removed the previous demo shop.');
    console.log(
      `✅ Demo shop ready: ${shop.products} products, ${shop.customers} customers, ${shop.bills} bills ` +
        `(₹${Math.round(shop.totalPaise / 100).toLocaleString('en-IN')}).`,
    );
    console.log(`   Log in with phone ${DEMO.phone} and password ${DEMO.password}`);
  } finally {
    await disconnectDB();
  }
}

main().catch(async (err) => {
  console.error('❌ Demo seeding failed:', err);
  await mongoose.disconnect();
  process.exit(1);
});
