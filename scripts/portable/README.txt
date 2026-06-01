==============================================================
  GST BOOKS - PORTABLE EDITION (runs from USB pendrive)
==============================================================

WHAT IS THIS?
-------------
A complete GST billing + accounting app that runs directly from
this pendrive. No installation. No admin rights needed. Your data
stays on the pendrive (in the "Data" folder).

FOLDER CONTENTS
---------------
  START-GST-Books.bat .... Double-click to run (Windows)
  start-mac-linux.sh ..... Run on macOS / Linux
  app\ ................... The application (do not edit)
  Data\ ................. Your company database (auto-created)
  node\ ................. Put portable Node.js here (see below)
  README.txt ............ This file

ONE-TIME SETUP (5 minutes)
--------------------------
1. Download portable Node.js (free):
     https://nodejs.org/en/download
   - Windows: download the "Windows Binary (.zip)" (x64)
   - Unzip it and copy node.exe (and its files) into the "node"
     folder on this pendrive so that  node\node.exe  exists.

2. That's it. You only do this once per pendrive.

HOW TO USE EVERY DAY
--------------------
1. Plug the pendrive into any Windows PC.
2. Double-click  START-GST-Books.bat
3. A black window opens (keep it open) and your browser opens at
     http://localhost:3000
4. Login with:  demo@gst.com  /  demo1234
   (or your own account).
5. When done, close the black window to stop the app.

YOUR DATA & BACKUP
------------------
- All data is saved in  Data\gstbooks.db  on this pendrive.
- To BACK UP: copy the whole "Data" folder somewhere safe.
- To MOVE to a new PC: just plug the pendrive into that PC.

SECURITY
--------
- Open START-GST-Books.bat in Notepad and change JWT_SECRET to a
  long random text for better security.
- Keep the pendrive safe - anyone with it can open your books.

TROUBLESHOOTING
---------------
- "Node.js not found": you skipped the one-time setup above.
- Port busy: edit START-GST-Books.bat and change PORT=3000 to 3001.
- Antivirus blocks it: allow node.exe (it is the official Node.js).

==============================================================
