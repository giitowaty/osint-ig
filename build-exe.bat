@echo off
chcp 65001 >nul
title OSINT-IG - budowanie aplikacji desktop
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo  [!] Brak Node.js: zainstaluj LTS z https://nodejs.org
  pause
  exit /b 1
)

rem Pelny proces: wymagania, testy, sidecar, tauri build, test .exe, release\
node scripts\build-exe.mjs %*
set CODE=%ERRORLEVEL%
echo.
if %CODE%==0 (
  echo  Gotowe. Instalatory i wersja przenosna sa w folderze release\
  start "" "%~dp0release"
) else (
  echo  Budowanie albo test nie powiodly sie. Szczegoly: release\RAPORT.md
)
pause
exit /b %CODE%
