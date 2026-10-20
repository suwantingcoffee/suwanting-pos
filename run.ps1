param([ValidateRange(1024, 65535)][int]$Port = 5173)
$ErrorActionPreference = 'Stop'
if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) { throw 'Node.js 22.12+ diperlukan. Lihat README.md.' }
Push-Location -LiteralPath $PSScriptRoot
try {
    if (-not (Test-Path -LiteralPath 'node_modules\vite\bin\vite.js')) { throw 'Jalankan npm.cmd ci terlebih dahulu.' }
    & npm.cmd run dev -- --port $Port --strictPort
    if ($LASTEXITCODE -ne 0) { throw "Server berhenti dengan exit code $LASTEXITCODE." }
} finally { Pop-Location }
