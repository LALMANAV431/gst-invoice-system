import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const email = "demo@gst.com";
  const password = await bcrypt.hash("demo1234", 10);

  // Wipe & re-seed
  await prisma.stockMovement.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.invoiceItem.deleteMany();
  await prisma.invoice.deleteMany();
  await prisma.purchaseItem.deleteMany();
  await prisma.purchase.deleteMany();
  await prisma.item.deleteMany();
  await prisma.party.deleteMany();
  await prisma.company.deleteMany();
  await prisma.user.deleteMany();

  const user = await prisma.user.create({
    data: { email, password, name: "Demo User" },
  });

  const company = await prisma.company.create({
    data: {
      ownerId: user.id,
      name: "Demo Traders Pvt Ltd",
      gstin: "27ABCDE1234F1Z5",
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
      gstin: "27AAACS1234B1Z5",
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
      gstin: "29AAACR9876H1Z2",
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

  console.log("\n✅ Seed complete!");
  console.log("   Login: demo@gst.com / demo1234");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
