@echo off
REM Travel Book launcher - double-click to start
REM (server.js builds docs/ from public/ by itself at startup)
cd /d "%~dp0"
echo ============================================
echo   Travel Book - starting local server...
echo ============================================
echo.
start "TravelBookServer" cmd /k node server.js
ping -n 3 127.0.0.1 >nul
start "" http://localhost:3618
echo Browser opened. The server runs in the other window.
echo Close that window to stop the server.
