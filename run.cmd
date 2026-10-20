@echo off
setlocal

cd /d "%~dp0"

if exist "%~dp0..\.tools\php\php.exe" (
    set "PHP_EXE=%~dp0..\.tools\php\php.exe"
) else (
    where php >nul 2>&1
    if errorlevel 1 (
        echo PHP 8.4+ tidak ditemukan. Ikuti instalasi pada README.md.
        exit /b 1
    )
    set "PHP_EXE=php"
)

if not exist "vendor\autoload.php" (
    echo Dependensi belum terpasang. Jalankan composer install.
    exit /b 1
)

set "PORT=%~1"
if not defined PORT set "PORT=8000"

echo Menjalankan Suwanting Coffee POS di http://127.0.0.1:%PORT%
"%PHP_EXE%" artisan serve --host=127.0.0.1 --port="%PORT%" --no-reload
exit /b %errorlevel%
