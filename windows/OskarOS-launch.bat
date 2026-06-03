@echo off
setlocal EnableExtensions

REM ============================================================
REM  OskarOS - Windows launcher (runs inside WSL, opens /crm).
REM  Double-click this, or make a desktop shortcut with an icon
REM  (see README.md in this folder).
REM ============================================================

REM ---- CONFIG - edit these for your machine ------------------
set "WSL_DISTRO=Ubuntu"
set "OSKAR_DIR=~/OskarOS/oskar-prototype"
set "PORT=3000"
REM   WSL_DISTRO : run `wsl -l -q` to list your installed distros.
REM   OSKAR_DIR  : repo path INSIDE wsl. The WSL home (~/...) is fast;
REM                /mnt/c/Users/<you>/... reaches the Windows C: drive
REM                (slower; avoid spaces in the path).
REM ------------------------------------------------------------

echo.
echo   OskarOS - starting inside WSL (%WSL_DISTRO%)...
echo   Project: %OSKAR_DIR%
echo.

REM Dev server in its OWN visible WSL window (login+interactive shell so
REM node / nvm are on PATH). That window is your live server log - close
REM it or press Ctrl+C there to stop OskarOS.
start "OskarOS (WSL)" wsl.exe -d "%WSL_DISTRO%" -- bash -lic "cd %OSKAR_DIR% && bash start.wsl.sh"

REM Wait (up to ~2 min) for the server, then open the CRM. A single
REM PowerShell call does the poll+open - no batch labels, so this is
REM robust against line-ending quirks.
echo   Waiting for the server (first boot compiles Next.js)...
powershell -NoProfile -Command "for($i=0;$i -lt 60;$i++){ try{ [void](Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 'http://localhost:%PORT%'); break }catch{ Start-Sleep -Seconds 2 } }; Start-Process 'http://localhost:%PORT%/crm'"

endlocal
exit /b
