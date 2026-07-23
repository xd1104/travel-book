@echo off
REM Travel Book launcher - double-click to start
cd /d "%~dp0"
echo ============================================
echo   Travel Book - starting local server...
echo ============================================
echo.
REM Build the GitHub Pages site (docs/) from public/ so Pages stays in sync
node build.js
echo.
start "TravelBookServer" cmd /k node server.js
ping -n 3 127.0.0.1 >nul
start "" http://localhost:3618
echo Browser opened. The server runs in the other window.
echo Close that window to stop the server.
