# Start the Aegis Windows Voice Bridge (Windows speech engine, command-only access).
# Usage: .\run_windows_voice.ps1 [-Port 8767] [-HostAddress 127.0.0.1]
param(
    [int]$Port = 8767,
    [string]$HostAddress = '127.0.0.1'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$python = Join-Path $root '.venv311\Scripts\python.exe'

if (-not (Test-Path $python)) {
    throw "Python venv not found at $python. Create it with: py -3.11 -m venv .venv311"
}

$env:PYTHONPATH = $root
& $python -m aegis_daemon.windows_bridge --host $HostAddress --port $Port
