@echo off
chcp 65001 >nul
title OSINT-IG
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 goto nonode

echo.
echo  Uruchamiam OSINT-IG na http://localhost:8000 ...
echo  (okno serwera zostanie otwarte - zamknij je, aby zatrzymac program)
echo.
start "OSINT-IG serwer" cmd /k node api/server.js
timeout /t 3 >nul
start "" http://localhost:8000
exit /b 0

:nonode
echo.
echo  [!] Nie znaleziono Node.js.
echo      Zainstaluj wersje LTS z https://nodejs.org
echo      a nastepnie uruchom ten plik ponownie.
echo.
pause
exit /b 1
