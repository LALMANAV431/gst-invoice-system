# 🔌 Pendrive (USB) Setup Guide — GST Books Portable

Yeh guide batata hai ki GST Books ko **pendrive se kaise chalayein** — bina
install kiye, kisi bhi Windows PC pe. Isme do hisse hain:

- **Part A — Developer/Seller** ke liye: pendrive package banana (ek baar).
- **Part B — End user** ke liye: pendrive use karna (roz).

---

## Part A — Pendrive Package Banana (Developer / Seller)

> Yeh sirf ek baar karna hai, apne computer pe.

### Step 1 — Project ready karo
```bash
npm install
npm run db:setup          # demo data ke saath database banata hai
```

### Step 2 — Portable package banao
```bash
npm run package:portable
```
Yeh command:
1. App ko **standalone** mode me build karti hai, aur
2. `GSTBooks-Portable/` naam ka folder banati hai (sab kuch andar).

### Step 3 — Portable Node.js daalo
1. Download karo (free): https://nodejs.org/en/download
   → Windows ke liye **"Windows Binary (.zip)" (x64)** lo.
2. Zip ko unzip karo. Usme se `node.exe` (aur baaki files) ko
   `GSTBooks-Portable/node/` folder me copy kar do.
3. Confirm: yeh path hona chahiye → `GSTBooks-Portable/node/node.exe`

### Step 4 — Pendrive pe copy karo
Pura `GSTBooks-Portable` folder pendrive pe copy kar do. Bas! Pendrive ready hai.

```
E:\GSTBooks-Portable\
├── START-GST-Books.bat
├── node\node.exe
├── app\
└── Data\   (pehli baar chalane pe auto ban jayega)
```

---

## Part B — Pendrive Use Karna (End User)

> Customer ke liye — bilkul simple, 3 step.

### Pehli baar (one-time)
- Agar seller ne `node` folder already bhar diya hai, to kuch nahi karna.
- Warna Part A ka **Step 3** follow karke `node.exe` daalo.

### Roz ka istemaal
1. Pendrive PC me lagao.
2. `GSTBooks-Portable` folder kholo.
3. **`START-GST-Books.bat`** pe **double-click** karo.
4. Ek black window khulega (use **band mat karo**), aur browser apne aap khul
   jayega: **http://localhost:3000**
5. Login: **demo@gst.com** / **demo1234** (ya apna account banao).
6. Kaam ho jaye to black window band kar do — app ruk jayegi.

### macOS / Linux pe
Terminal me:
```bash
sh start-mac-linux.sh
```

---

## Aapka Data & Backup

- Saara data pendrive ke andar **`Data\gstbooks.db`** file me save hota hai.
- **Backup:** poora `Data` folder kisi safe jagah copy kar lo (PC ya cloud).
- **Naye PC pe le jaana:** bas pendrive nikalo aur dusre PC me lagao — data
  saath chalta hai.

---

## Common Problems (Troubleshooting)

| Problem | Solution |
|---------|----------|
| "Node.js not found" | `node` folder me `node.exe` daalna bhool gaye (Part A, Step 3) |
| Port busy / already in use | `START-GST-Books.bat` ko Notepad me kholo, `PORT=3000` ko `3001` karo |
| Antivirus rok raha hai | `node.exe` ko allow karo (yeh official Node.js hai, safe hai) |
| Browser apne aap nahi khula | Manually browser me `http://localhost:3000` type karo |
| Data nahi dikh raha | Check karo `Data\gstbooks.db` exist karti hai; warna app pehli baar seed karega |

---

## Security Tips

- `START-GST-Books.bat` me `JWT_SECRET` ko ek lamba random text se badal do.
- Pendrive ko sambhaal ke rakho — jiske paas pendrive, uske paas aapki books.
- Zaroori ho to pendrive ko OS-level encryption (BitLocker) se protect karo.

---

## Technical Note

- App **Next.js standalone server** hai jo portable Node.js pe chalti hai.
- Database **SQLite** hai (embedded, koi server install nahi).
- Prisma engines (Windows + Linux dono) package me bundled hain, isliye
  re-generate karne ki zaroorat nahi.
