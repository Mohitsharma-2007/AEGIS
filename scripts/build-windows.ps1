# Builds the Aegis Windows installer (Electron shell + host bundle).
#
#   .\scripts\build-windows.ps1            # install missing deps, build, package
#   .\scripts\build-windows.ps1 -SkipInstall
#
# Output: apps\desktop\release\Aegis Setup <version>.exe
#
# The shell is a supervisor, not a second front end: it loads the host app from
# apps\host\dist, so the host is built first. The installer intentionally omits
# exe signing (no certificate); add one and remove signAndEditExecutable=false
# in apps\desktop\package.json when you have it.
[CmdletBinding()]
param(
    [switch]$SkipInstall
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$HostDir = Join-Path $Root 'apps\host'
$DesktopDir = Join-Path $Root 'apps\desktop'

function Step($text) { Write-Host "`n==> $text" -ForegroundColor Cyan }

if (-not $SkipInstall) {
    Step 'Installing host dependencies'
    Push-Location $HostDir
    try { npm ci } finally { Pop-Location }

    Step 'Installing desktop dependencies'
    Push-Location $DesktopDir
    try { npm ci } finally { Pop-Location }
}

Step 'Generating desktop icons'
Push-Location $DesktopDir
try {
    python scripts\make-icon.py
} finally {
    Pop-Location
}

Step 'Typechecking and building the host'
Push-Location $HostDir
try {
    npm run typecheck
    if ($LASTEXITCODE -ne 0) { throw 'Host typecheck failed.' }
    npm run build
    if ($LASTEXITCODE -ne 0) { throw 'Host build failed.' }
} finally {
    Pop-Location
}

Step 'Packaging the NSIS installer'
Push-Location $DesktopDir
try {
    $env:CSC_IDENTITY_AUTO_DISCOVERY = 'false'
    npm run dist:win
    if ($LASTEXITCODE -ne 0) { throw 'electron-builder failed.' }
} finally {
    Pop-Location
}

$installer = Get-ChildItem (Join-Path $DesktopDir 'release\*.exe') |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
if (-not $installer) { throw 'No installer was produced.' }

$hash = (Get-FileHash $installer.FullName -Algorithm SHA256).Hash
Write-Host ''
Write-Host "Installer: $($installer.FullName)" -ForegroundColor Green
Write-Host "Size:      $([math]::Round($installer.Length / 1MB, 1)) MB"
Write-Host "SHA256:    $hash"
