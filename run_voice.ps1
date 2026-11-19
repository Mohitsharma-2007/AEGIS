# Runs the local Pipecat Voice Pipeline on port 8766
$Root = $PSScriptRoot
$Daemon = Join-Path $Root "services\daemon"
$Py = Join-Path $Daemon ".venv311\Scripts\python.exe"
if (-not (Test-Path $Py)) {
    $Py = Join-Path $Daemon ".venv\Scripts\python.exe"
}
if (-not (Test-Path $Py)) {
    $Py = "python"
}

$env:PYTHONPATH = $Daemon
$env:VOICES_DIR = Join-Path $Daemon "voices"

Write-Host "Starting Aegis Voice Pipeline on port 8766 using: $Py" -ForegroundColor Cyan
Push-Location $Daemon
try {
    & $Py -m aegis_daemon.voice_pipeline --host 127.0.0.1 --port 8766 @args
} finally {
    Pop-Location
}
