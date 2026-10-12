@echo off
chcp 65001 >nul
title OSINT-IG Dashboard (Python)
cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 goto nopy

echo.
echo  Instaluje zaleznosci (tylko za pierwszym razem, moze chwile potrwac)...
python -m pip install -q -r social_analytics\requirements.txt
python -m pip install -q -r social_analytics\webapp\requirements.txt

echo.
echo  Uruchamiam dashboard na http://localhost:8100 ...
echo  (okno serwera zostanie otwarte - zamknij je, aby zatrzymac)
echo.
start "OSINT-IG Dashboard serwer" cmd /k python -m uvicorn social_analytics.webapp.server:app --port 8100
timeout /t 5 >nul
start "" http://localhost:8100
exit /b 0

:nopy
echo.
echo  [!] Nie znaleziono Pythona.
echo      Zainstaluj z https://python.org (zaznacz "Add to PATH")
echo      i uruchom ten plik ponownie.
echo.
pause
exit /b 1
