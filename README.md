# GST Books — Accounting & Invoicing SaaS

A modern, full-stack alternative to **Tally** and **Busy** software, built for Indian businesses.
Create GST-compliant invoices, manage inventory, track payments and generate financial reports —
all from your browser.

## ✨ Features

- 🔐 **Authentication** — JWT-based signup/login with bcrypt
- 🏢 **Multi-company** — Each user can have multiple companies
- 👥 **Parties** — Customer/Vendor master with GSTIN and address
- 📦 **Inventory** — Items with HSN, GST rate, opening & current stock, low-stock alerts
- 🧾 **GST Sales Invoices** — CGST/SGST split for intra-state, IGST for inter-state, auto-calculated
- 🧮 **Auto stock movements** — Sales decrement, purchases increment with full audit trail
- 🛒 **Purchase Bills** — Record vendor bills with vendor invoice number
- 💰 **Payments** — Record receipts and payments, auto-update invoice/purchase status
- 📊 **Reports** — Sales register, GSTR-1 summary by GST rate, Profit & Loss, stock report
- 📄 **Invoice PDF** — Professional, downloadable, GST-compliant tax invoice (jsPDF)
- 🖨️ **Print-ready** — Beautiful printable invoice view
- 🎨 **Modern UI** — Tailwind CSS, responsive, fast

## 🛠 Tech stack

- **Framework**: Next.js 14 (App Router) + TypeScript
- **UI**: Tailwind CSS + lucide-react icons
- **Database**: SQLite via Prisma (zero-config, file-based)
- **Auth**: JWT in httpOnly cookies + bcryptjs
- **PDF**: jsPDF + jspdf-autotable

## 🚀 Quick start

```bash
# 1. Install dependencies
npm install

# 2. Setup database (creates dev.db + seeds demo data)
npm run db:setup

# 3. Start the app
npm run dev
```

Open <http://localhost:3000> and sign in with the demo account:

```
Email:    demo@gst.com
Password: demo1234
```

The seed creates **Demo Traders Pvt Ltd** with sample customers, a vendor and 5 items so you
can immediately try out invoices, purchases and reports.

## 📁 Project structure

```
src/
├── app/
│   ├── (app)/                  # Authenticated app shell
│   │   ├── dashboard/
│   │   ├── parties/            # Customer & vendor CRUD
│   │   ├── items/              # Inventory CRUD
│   │   ├── invoices/           # Sales invoices + PDF
│   │   ├── purchases/          # Vendor bills
│   │   ├── payments/           # Receipts & payments
│   │   ├── reports/            # Financial & GST reports
│   │   └── settings/           # Company settings
│   ├── api/                    # REST API routes
│   ├── login/, register/       # Auth pages
│   └── page.tsx                # Marketing landing
├── components/                 # Sidebar, Topbar
└── lib/
    ├── db.ts                   # Prisma client
    ├── auth.ts                 # JWT session helpers
    ├── numbering.ts            # Auto invoice number generator
    ├── pdf.ts                  # jsPDF invoice generator
    └── utils.ts                # GST calc, INR formatter, etc.

prisma/
├── schema.prisma               # Full accounting model
└── seed.ts                     # Demo data
```

## 🧮 GST logic

The app automatically determines whether GST is **intra-state (CGST + SGST)** or
**inter-state (IGST)** by comparing your company's state code with the party's state code.

For each line item:
```
taxable      = (quantity × rate) − discount
total tax    = taxable × (gstRate / 100)
CGST + SGST  = total tax / 2  each   (when intra-state)
IGST         = total tax              (when inter-state)
line total   = taxable + total tax
```

## 📦 Available scripts

| Command            | Purpose                                  |
|--------------------|------------------------------------------|
| `npm run dev`      | Start dev server                         |
| `npm run build`    | Build for production                     |
| `npm start`        | Run production build                     |
| `npm run db:push`  | Push schema to SQLite                    |
| `npm run db:seed`  | Seed demo data                           |
| `npm run db:setup` | Push schema + seed (one-shot)            |

## 🔮 Roadmap (extension ideas)

- [ ] E-Invoicing (IRN / QR via NIC sandbox)
- [ ] E-Way bill generation
- [ ] GSTR-1 / GSTR-3B JSON export
- [ ] Bank reconciliation
- [ ] Recurring invoices
- [ ] WhatsApp / Email invoice sharing
- [ ] Razorpay / Stripe payment links
- [ ] Multi-user team access with roles
- [ ] Mobile app (React Native)

## 📝 License

MIT — built as a learning / starter SaaS. Not a substitute for certified accounting software.
