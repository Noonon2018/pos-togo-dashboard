@echo off
rem ==========================================================================
rem  Money Flow launcher - double-click to start.
rem  Runs the locked-down production build on http://127.0.0.1:5173
rem  127.0.0.1 = only this computer can open it. Nothing is uploaded.
rem  This script never downloads new code by itself: use "Update Money Flow.bat".
rem ==========================================================================
setlocal
title Money Flow
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node.js is not installed.
  echo  Install the LTS version from https://nodejs.org and double-click again.
  echo.
  pause
  exit /b 1
)

rem Already running? Just open it in the browser.
curl -s -o nul --max-time 2 http://127.0.0.1:5173/ >nul 2>nul
if not errorlevel 1 (
  start "" "http://127.0.0.1:5173/"
  exit /b 0
)

rem Install packages on the first run, or when an update changed package-lock.json.
set "NEED_INSTALL=0"
if not exist "node_modules\.mf-lock" set "NEED_INSTALL=1"
if exist "node_modules\.mf-lock" (
  fc /b "package-lock.json" "node_modules\.mf-lock" >nul 2>nul
  if errorlevel 1 set "NEED_INSTALL=1"
)
if "%NEED_INSTALL%"=="1" (
  echo  Installing packages - first run or after an update. Please wait...
  call npm ci --no-audit --no-fund
  if errorlevel 1 (
    echo.
    echo  Install failed. Check the internet connection and try again.
    pause
    exit /b 1
  )
  copy /y "package-lock.json" "node_modules\.mf-lock" >nul
)

echo  Preparing Money Flow...
call npx --no-install vite build --logLevel error
if errorlevel 1 (
  echo.
  echo  Build failed. Please send a screenshot of this window.
  pause
  exit /b 1
)

rem Open the browser once the server is up.
start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; Start-Process 'http://127.0.0.1:5173/'"

cls
echo.
echo   =========================================================
echo     Money Flow is running:  http://127.0.0.1:5173/
echo.
echo     - Only this computer can open it.
echo     - Your statements never leave this PC.
echo     - Keep this window open while you use Money Flow.
echo     - Close this window to stop it.
echo   =========================================================
echo.
call npx --no-install vite preview --logLevel error
echo.
echo  Money Flow stopped.
pause
