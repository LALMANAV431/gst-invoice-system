#!/bin/sh
# ============================================================
#   GST Books - Portable launcher (macOS / Linux)
#   Runs entirely from this USB pendrive. No installation.
# ============================================================
cd "$(dirname "$0")" || exit 1

# 1. Locate Node.js (portable first, then system)
NODE_BIN="node"
if [ -x "./node/bin/node" ]; then
  NODE_BIN="./node/bin/node"
elif ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "  [!] Node.js not found."
  echo "  Place a portable Node.js into the ./node folder, or install Node.js."
  echo "  Download: https://nodejs.org/en/download"
  echo ""
  exit 1
fi

# 2. Configuration
export PORT=3000
export NODE_ENV=production
export HOSTNAME=127.0.0.1
export JWT_SECRET="CHANGE-THIS-to-a-long-random-secret-on-your-usb"
export DATABASE_URL="file:$(pwd)/Data/gstbooks.db"

# 3. First run: create Data folder + seed database
mkdir -p Data
if [ ! -f Data/gstbooks.db ]; then
  echo "  Setting up database for first use..."
  cp app/prisma/seed.db Data/gstbooks.db
fi

echo ""
echo "  ============================================"
echo "    GST Books is starting..."
echo "    Open your browser at:  http://localhost:$PORT"
echo "    Demo login: demo@gst.com  /  demo1234"
echo "  ============================================"
echo ""

# 4. Open browser after a short delay
( sleep 4; (open "http://localhost:$PORT" 2>/dev/null || xdg-open "http://localhost:$PORT" 2>/dev/null) ) &

# 5. Start the bundled standalone server
"$NODE_BIN" app/server.js
