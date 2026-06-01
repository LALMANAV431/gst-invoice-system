@echo off
title GST Books - Portable Accounting
cd /d "%~dp0"

REM ============================================================
REM   GST Books - Portable launcher (Windows)
REM   Runs entirely from this USB pendrive. No installation.
REM ============================================================

REM --- 1. Locate Node.js (portable first, then system) ---
set "NODE_EXE="
if exist "%~dp0node\node.exe" set "NODE_EXE=%~dp0node\node.exe"
if "%NODE_EXE%"=="" (
  where node >nul 2>nul && set "NODE_EXE=node"
)
if "%NODE_EXE%"=="" (
  echo.
  echo  [!] Node.js not found.
  echo  Copy a portable Node.js build into the "node" folder on this pendrive.
  echo  Download: https://nodejs.org/en/download  ^(Windows Binary .zip^)
  echo  See README.txt for full steps.
  echo.
  pause
  exit /b 1
)

REM --- 2. Configuration ---
set "PORT=3000"
set "NODE_ENV=production"
set "HOSTNAME=127.0.0.1"
set "JWT_SECRET=CHANGE-THIS-to-a-long-random-secret-on-your-usb"
set "DATABASE_URL=file:%~dp0Data\gstbooks.db"

REM --- 3. First run: create Data folder + seed the database ---
if not exist "%~dp0Data" mkdir "%~dp0Data"
if not exist "%~dp0Data\gstbooks.db" (
  echo  Setting up database for first use...
  copy "%~dp0app\prisma\seed.db" "%~dp0Data\gstbooks.db" >nul
)

echo.
echo  ============================================
echo    GST Books is starting...
echo    Open your browser at:  http://localhost:%PORT%
echo    Demo login: demo@gst.com  /  demo1234
echo.
echo    Keep this window open while using the app.
echo    Close this window to stop the app.
echo  ============================================
echo.

REM --- 4. Open the browser automatically after a short delay ---
start "" cmd /c "timeout /t 4 >nul & start http://localhost:%PORT%"

REM --- 5. Start the bundled standalone server ---
"%NODE_EXE%" "%~dp0app\server.js"

echo.
echo  GST Books has stopped.
pause
