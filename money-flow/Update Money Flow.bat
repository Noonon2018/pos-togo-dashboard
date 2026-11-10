@echo off
rem Download the latest Money Flow code from GitHub (only when you run this).
setlocal
title Update Money Flow
cd /d "%~dp0"
echo.
echo  Downloading the latest Money Flow...
echo.
git pull
if errorlevel 1 (
  echo.
  echo  Update failed. Please send a screenshot of this window.
  pause
  exit /b 1
)
echo.
echo  Latest changes:
git log --oneline -5
echo.
echo  Done. If Money Flow is open, close its black window and start it again.
echo.
pause
