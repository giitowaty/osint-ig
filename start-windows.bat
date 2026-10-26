@echo off
chcp 65001 >nul
title OSINT-IG
cd /d "%~dp0"

rem Cala prace (wersja Node, instalacja, przebudowa po aktualizacji, port)
rem robi scripts\launch.mjs - wspolny dla Windows/macOS/Linux.

where node >nul 2>nul
if errorlevel 1 goto nonode

node scripts\launch.mjs
if errorlevel 1 goto fail
exit /b 0

:fail
echo.
echo  [!] Cos poszlo nie tak - szczegoly sa wyzej.
pause
exit /b 1

:nonode
echo.
echo  [!] Nie znaleziono Node.js.
echo      Zainstaluj wersje LTS (20.19+ albo 22.12+) z https://nodejs.org
echo      a nastepnie uruchom ten plik ponownie.
echo.
pause
exit /b 1
