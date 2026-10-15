@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required. Install Node.js LTS, then run this file again.
  pause
  exit /b 1
)
if not exist "node_modules\vite\bin\vite.js" (
  call npm ci --cache .local\npm-cache
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
echo Pitch Studio: http://127.0.0.1:5173/
echo Keep this window open while using the app. Press Ctrl+C to stop.
call npm run dev -- --open
if errorlevel 1 (
  echo If port 5173 is already in use, check whether Pitch Studio is already running.
  pause
)
