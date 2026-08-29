import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const email = "demo@gst.com";
  const password = await bcrypt.hash("demo1234", 10);

  // Wipe & re-seed (order matters for FK constraints — children first)
  await prisma.stockMovement.deleteMany();
  await prisma.stockTransfer.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.invoiceItem.deleteMany();
  await prisma.invoice.deleteMany();
  await prisma.purchaseItem.deleteMany();
  await prisma.purchase.deleteMany();
  await prisma.quotationItem.deleteMany();
  await prisma.quotation.deleteMany();
  await prisma.creditNoteItem.deleteMany();
  await prisma.creditNote.deleteMany();
  await prisma.expense.deleteMany();
  await prisma.supportTicket.deleteMany();
  await prisma.broadcast.deleteMany();
  await prisma.recurringInvoice.deleteMany();
  await prisma.bankTransaction.deleteMany();
  await prisma.budget.deleteMany();
  await prisma.godown.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.item.deleteMany();
  await prisma.party.deleteMany();
  await prisma.teamMember.deleteMany();
  await prisma.company.deleteMany();
  await prisma.user.deleteMany();

  const user = await prisma.user.create({
    data: { email, password, name: "Demo User", isSuperAdmin: true },
  });

  const company = await prisma.company.create({
    data: {
      ownerId: user.id,
      name: "Demo Traders Pvt Ltd",
      gstin: "27ABCDE1234F1Z0",
      pan: "ABCDE1234F",
      email: "info@demotraders.com",
      phone: "+91 9876543210",
      addressLine1: "Shop No. 12, Market Road",
      city: "Mumbai",
      state: "Maharashtra",
      stateCode: "27",
      pincode: "400001",
      financialYear: "2025-26",
    },
  });

  const customer = await prisma.party.create({
    data: {
      companyId: company.id,
      name: "Sharma Electronics",
      type: "CUSTOMER",
      gstin: "27AAACS1234B1Z0",
      phone: "+91 9988776655",
      city: "Pune",
      state: "Maharashtra",
      stateCode: "27",
      addressLine1: "Plot 45, MG Road",
      pincode: "411001",
    },
  });

  await prisma.party.create({
    data: {
      companyId: company.id,
      name: "Walk-in Customer",
      type: "CUSTOMER",
    },
  });

  const vendor = await prisma.party.create({
    data: {
      companyId: company.id,
      name: "Reliable Suppliers",
      type: "VENDOR",
      gstin: "29AAACR9876H1ZP",
      phone: "+91 9123456789",
      city: "Bengaluru",
      state: "Karnataka",
      stateCode: "29",
      balanceType: "PAYABLE",
    },
  });

  const itemsData = [
    { name: "Samsung Galaxy A15", hsn: "8517", unit: "NOS", salePrice: 14999, purchasePrice: 12500, gstRate: 18, openingStock: 25 },
    { name: "Boat Headphones 250", hsn: "8518", unit: "NOS", salePrice: 1499, purchasePrice: 950, gstRate: 18, openingStock: 60 },
    { name: "USB-C Cable 1m", hsn: "8544", unit: "NOS", salePrice: 199, purchasePrice: 80, gstRate: 18, openingStock: 200 },
    { name: "Power Bank 10000mAh", hsn: "8507", unit: "NOS", salePrice: 999, purchasePrice: 650, gstRate: 18, openingStock: 40 },
    { name: "Laptop Bag", hsn: "4202", unit: "NOS", salePrice: 799, purchasePrice: 400, gstRate: 12, openingStock: 30 },
  ];

  for (const it of itemsData) {
    await prisma.item.create({
      data: {
        ...it,
        companyId: company.id,
        currentStock: it.openingStock,
        lowStockAlert: 10,
      },
    });
  }

  // ---- Platform / super-admin data ----
  await prisma.siteSetting.deleteMany();
  await prisma.coupon.deleteMany();
  await prisma.planSetting.deleteMany();

  const siteSettings: Record<string, string> = {
    site_name: "GST Books",
    support_phone: "+91 90000 00000",
    support_email: "support@gstbooks.in",
    whatsapp_number: "+919000000000",
    address: "Mumbai, Maharashtra, India",
    announcement: "🎉 New: POS billing with barcode scanner is now live!",
    announcement_active: "true",
    facebook_url: "",
    instagram_url: "",
    twitter_url: "",
  };
  for (const [key, value] of Object.entries(siteSettings)) {
    await prisma.siteSetting.create({ data: { key, value } });
  }

  await prisma.planSetting.createMany({
    data: [
      { id: "FREE", name: "Free", tagline: "For freelancers & new businesses", priceMonthly: 0, priceAnnual: 0, invoiceLimit: 20, userLimit: 1 },
      { id: "BASIC", name: "Basic", tagline: "For growing small businesses", priceMonthly: 299, priceAnnual: 2990, invoiceLimit: -1, userLimit: 3 },
      { id: "PREMIUM", name: "Premium", tagline: "Full Tally/Busy replacement", priceMonthly: 999, priceAnnual: 9990, invoiceLimit: -1, userLimit: 25 },
    ],
  });

  await prisma.coupon.createMany({
    data: [
      { code: "WELCOME20", description: "20% off first subscription", type: "PERCENT", value: 20, active: true },
      { code: "FLAT100", description: "Flat ₹100 off", type: "FLAT", value: 100, appliesToPlan: "BASIC", active: true },
    ],
  });

  console.log("\n✅ Seed complete!");
  console.log("   Login: demo@gst.com / demo1234  (also Super Admin → /admin)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
