@echo off
setlocal
cd /d "%~dp0"
where npm.cmd >nul 2>&1
if errorlevel 1 (
    echo Node.js 22.12+ diperlukan. Lihat README.md.
    exit /b 1
)
if not exist "node_modules\vite\bin\vite.js" (
    echo Jalankan npm.cmd ci terlebih dahulu.
    exit /b 1
)
set "POS_PORT=%~1"
if not defined POS_PORT set "POS_PORT=5173"
call npm.cmd run dev -- --port "%POS_PORT%" --strictPort
exit /b %errorlevel%
