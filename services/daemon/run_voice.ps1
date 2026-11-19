# Start the local Pipecat voice pipeline with the project's Python 3.11 venv.
# Usage: .\run_voice.ps1 [-Port 8766] [-HostAddress 127.0.0.1]
param(
    [int]$Port = 8766,
    [string]$HostAddress = '127.0.0.1'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$python = Join-Path $root '.venv311\Scripts\python.exe'

if (-not (Test-Path $python)) {
    throw "Python venv not found at $python. Create it with: py -3.11 -m venv .venv311"
}

$env:PYTHONPATH = $root
& $python -m aegis_daemon.voice_pipeline --host $HostAddress --port $Port
