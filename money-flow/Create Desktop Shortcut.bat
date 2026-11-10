@echo off
rem Put a "Money Flow" icon on the Desktop that starts the app.
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$d = [Environment]::GetFolderPath('Desktop');" ^
  "$s = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $d 'Money Flow.lnk'));" ^
  "$s.TargetPath = (Join-Path (Get-Location) 'Money Flow.bat');" ^
  "$s.WorkingDirectory = (Get-Location).Path;" ^
  "$s.IconLocation = (Join-Path (Get-Location) 'launcher\money-flow.ico');" ^
  "$s.Description = 'Money Flow - private money analysis';" ^
  "$s.Save()"
if errorlevel 1 (
  echo  Could not create the shortcut. Please send a screenshot of this window.
  pause
  exit /b 1
)
echo.
echo  Done! Look for the "Money Flow" icon on your Desktop.
echo.
pause
