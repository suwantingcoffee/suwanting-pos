param([ValidateRange(1024, 65535)][int]$Port = 8000)
$ErrorActionPreference = 'Stop'
$phpCommand = Get-Command php -ErrorAction SilentlyContinue
$portablePhp = Join-Path (Split-Path -Parent $PSScriptRoot) '.tools\php\php.exe'
if ($phpCommand) {
    $phpExecutable = $phpCommand.Source
} elseif (Test-Path -LiteralPath $portablePhp) {
    $phpExecutable = $portablePhp
} else {
    throw 'PHP 8.4+ belum tersedia. Ikuti instalasi pada README.md.'
}
if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'vendor\autoload.php'))) {
    throw 'Dependensi belum terpasang. Jalankan composer install.'
}
Push-Location -LiteralPath $PSScriptRoot
try {
    & $phpExecutable artisan serve --host=127.0.0.1 "--port=$Port" --no-reload
    if ($LASTEXITCODE -ne 0) { throw "Server berhenti dengan exit code $LASTEXITCODE." }
} finally {
    Pop-Location
}
