@echo off
setlocal
cd /d "%~dp0"

cls
echo Starting connxn.ui...

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js was not found. Install Node.js 20+ first:
  echo https://nodejs.org/
  echo.
  pause
  exit /b 1
)

node "%~dp0start-windows.mjs"
set "EXITCODE=%ERRORLEVEL%"

if not "%EXITCODE%"=="0" (
  echo.
  echo connxn.ui stopped with exit code %EXITCODE%.
  pause
)

exit /b %EXITCODE%
