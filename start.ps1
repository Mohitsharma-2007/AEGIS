# ============================================================================
# Aegis - Windows launcher (PowerShell equivalent of start.sh)
# Starts the union: obscura (browser engine) + Aegis daemon (memory/MCP
# services on :8765) + Aegis host app (UI + agent runtime on :4310).
#
# Usage (from the aegis folder):
#     powershell -ExecutionPolicy Bypass -File .\start.ps1
#     powershell -ExecutionPolicy Bypass -File .\start.ps1 -Dev   (vite :5173)
#
# Keys come from .\.env.local (copy .env.example) or the environment.
# You only ever supply API KEYS - provider endpoints are hard-coded in
# apps\host\src\server\providers.ts.
# Stop everything with Ctrl+C in this window.
# NOTE: this file is intentionally ASCII-only (Windows PowerShell 5.1
# misreads UTF-8 files without a BOM, which corrupts non-ASCII characters).
# ============================================================================
param([switch]$Dev)

$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot
Set-Location $Root

# W-FIX: ELECTRON_RUN_AS_NODE must be unset before launching Electron,
# otherwise Electron runs as plain Node and crashes on startup.
if ($env:ELECTRON_RUN_AS_NODE) { Remove-Item Env:ELECTRON_RUN_AS_NODE }

# --- Load .env.local into the environment (reaches every child process) ---
if (Test-Path ".env.local") {
    foreach ($line in Get-Content ".env.local") {
        $t = $line.Trim()
        if ($t -and -not $t.StartsWith("#") -and $t.Contains("=")) {
            $k, $v = $t.Split("=", 2)
            [Environment]::SetEnvironmentVariable($k.Trim(), $v.Trim(), "Process")
        }
    }
    Write-Host "Loaded .env.local"
} else {
    Write-Host "No .env.local found - copy .env.example to .env.local and add one provider key." -ForegroundColor Yellow
}

# --- Paths / URLs ---
$env:AEGIS_DAEMON_URL = "http://127.0.0.1:8765"
$env:OBSCURA_CDP_URL  = "http://127.0.0.1:9222"
if (Test-Path "tools-bin\obscura.exe") { $env:AEGIS_OBSCURA = "$Root\tools-bin\obscura.exe" }

$procs = @()
function Start-Tracked($file, $argList, $workdir, $name) {
    $p = Start-Process -FilePath $file -ArgumentList $argList -WorkingDirectory $workdir -NoNewWindow -PassThru
    Write-Host "$name started (pid $($p.Id))"
    return $p
}

try {
    # --- 1. obscura CDP server (Windows binary only; otherwise labelled fallback)
    if (Test-Path "tools-bin\obscura.exe") {
        $procs += Start-Tracked "tools-bin\obscura.exe" @("serve", "--port", "9222") "$Root\tools-bin" "obscura"
    } else {
        Write-Host "obscura: no Windows binary in tools-bin (bundled one is the Linux build) - browser falls back, labelled." -ForegroundColor Yellow
    }

    # --- 2. Aegis daemon on :8765 ---
    $daemon = "$Root\services\daemon"
    $py = "$daemon\.venv311\Scripts\python.exe"
    if (-not (Test-Path $py)) {
        $py = "$daemon\.venv\Scripts\python.exe"
    }
    if (-not (Test-Path $py)) {
        Write-Host "Creating daemon venv + installing requirements (first run only)..."
        python -m venv "$daemon\.venv"
        & $py -m pip install -q -r "$daemon\requirements.txt"
    }
    if (-not $env:AEGIS_HOME) { $env:AEGIS_HOME = "$Root\.aegis-data" }
    $procs += Start-Tracked $py @("-m", "aegis_daemon.main") $daemon "Aegis daemon (:8765)"
# --- 4. Aegis host app on :4310 ---
    $dots = "$Root\apps\host"
    if (-not (Test-Path "$dots\node_modules")) {
        Write-Host "Installing Aegis dependencies (first run only)..."
        Push-Location $dots; npm install --no-audit --no-fund; Pop-Location
    }
    # W-FIX 1a: Playwright Chromium binaries live in an app-local
    # browsers path and are installed on first run when missing - a
    # fresh unzip used to die with "executable doesn't exist at the
    # path" the first time the AEGIS Computer browser launched. The
    # ensure script probes a real launch and only downloads when
    # needed; if the download cannot complete, the runtime falls back
    # to a system Edge/Chrome (labelled in the Computer status).
    $env:PLAYWRIGHT_BROWSERS_PATH = "$Root\.aegis-data\playwright-browsers"
    if (-not (Test-Path $env:PLAYWRIGHT_BROWSERS_PATH)) { New-Item -ItemType Directory -Path $env:PLAYWRIGHT_BROWSERS_PATH -Force | Out-Null }
    Push-Location $dots
    try { node scripts\ensure-browser.mjs } catch { Write-Host "browser setup: continuing without the bundled Chromium (system Edge/Chrome fallback may still serve)" -ForegroundColor Yellow }
    Pop-Location
    if (-not $Dev -and -not (Test-Path "$dots\dist")) {
        Write-Host "Building Aegis client (first run only)..."
        Push-Location $dots; npm run build; Pop-Location
    }
    # W-FIX: supervise the browser service (:4311) that powers the
    # Browser view and the read-only research browser. It used to never
    # be started by the launchers at all, so those surfaces were dead
    # on a normal install. A user-supplied BROWSER_URL/BROWSER_SECRET
    # pair (their own browser service) is respected and left alone.
    if (-not $env:BROWSER_URL -and -not $env:BROWSER_SECRET) {
        $browserSecretFile = "$Root\.aegis-data\browser-secret"
        if (Test-Path $browserSecretFile) {
            $env:BROWSER_SECRET = (Get-Content $browserSecretFile -Raw).Trim()
        } else {
            $secretBytes = New-Object byte[] 24
            [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($secretBytes)
            $env:BROWSER_SECRET = ($secretBytes | ForEach-Object { $_.ToString("x2") }) -join ""
            Set-Content -Path $browserSecretFile -Value $env:BROWSER_SECRET -NoNewline -Encoding Ascii
        }
        $env:BROWSER_URL = "http://127.0.0.1:4311"
        if (-not $env:BROWSER_HOST) { $env:BROWSER_HOST = "127.0.0.1" }
        if (-not $env:BROWSER_PORT) { $env:BROWSER_PORT = "4311" }
        if ($Dev) {
            $procs += Start-Tracked "npm.cmd" @("run", "browser") $dots "browser service (:4311)"
        } else {
            $procs += Start-Tracked "npm.cmd" @("run", "browser:start") $dots "browser service (:4311)"
        }
    }
    # W-FIX 3d: supervise the WhatsApp sidecar (:4312, Baileys QR
    # pairing). The shared secret lives only in
    # .aegis-data\whatsapp-secret (gitignored); the host proxies
    # status for the UI and the daemon reads the same file. A
    # user-supplied WHATSAPP_SECRET is respected and left alone.
    if (-not $env:WHATSAPP_SECRET) {
        $waSecretFile = "$Root\.aegis-data\whatsapp-secret"
        if (Test-Path $waSecretFile) {
            $env:WHATSAPP_SECRET = [System.IO.File]::ReadAllText($waSecretFile)
        } else {
            $waBytes = New-Object byte[] 24
            [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($waBytes)
            $env:WHATSAPP_SECRET = -join ($waBytes | ForEach-Object { $_.ToString("x2") })
            Set-Content -Path $waSecretFile -Value $env:WHATSAPP_SECRET -NoNewline -Encoding Ascii
        }
    }
    if (-not $env:AEGIS_WHATSAPP_URL) { $env:AEGIS_WHATSAPP_URL = "http://127.0.0.1:4312" }
    if (-not $env:WHATSAPP_PORT) { $env:WHATSAPP_PORT = "4312" }
    if (-not $env:WHATSAPP_HOST) { $env:WHATSAPP_HOST = "127.0.0.1" }
    if (-not $env:WHATSAPP_AUTH_DIR) { $env:WHATSAPP_AUTH_DIR = "$Root\.aegis-data\whatsapp-auth" }
    if ($Dev) {
        $procs += Start-Tracked "npm.cmd" @("run", "whatsapp") $dots "WhatsApp sidecar (:4312)"
    } else {
        $procs += Start-Tracked "npm.cmd" @("run", "whatsapp:start") $dots "WhatsApp sidecar (:4312)"
    }

    # Supervise the Voice pipeline (:8766, faster-whisper STT + Piper TTS)
    $voicePython = "$daemon\.venv311\Scripts\python.exe"
    if (-not (Test-Path $voicePython)) { $voicePython = "$daemon\.venv\Scripts\python.exe" }
    if (Test-Path $voicePython) {
        $env:VOICES_DIR = "$daemon\voices"
        $procs += Start-Tracked $voicePython @("-m", "aegis_daemon.voice_pipeline", "--port", "8766") $daemon "Voice pipeline (:8766)"
    }
    # The host is supervised: it is restarted if it exits, and everything it
    # prints goes to .aegis-data\logs\host.log. A silent host death used to
    # leave the browser on a dead server ("Failed to fetch") with no cause.
    $env:AEGIS_LOG_DIR = "$Root\.aegis-data\logs"
    New-Item -ItemType Directory -Path $env:AEGIS_LOG_DIR -Force | Out-Null
    if ($Dev) {
        $procs += Start-Tracked "node.exe" @("$Root\scripts\supervise-host.mjs", $dots, "npm", "run", "dev") $Root "Aegis dev (supervised)"
        $url = "http://127.0.0.1:5173"
    } else {
        $procs += Start-Tracked "node.exe" @("$Root\scripts\supervise-host.mjs", $dots, "npm", "start") $Root "Aegis (:4310, supervised)"
        $url = "http://127.0.0.1:4310"
    }
    Write-Host "Host log: $($env:AEGIS_LOG_DIR)\host.log"

    Write-Host ""
    Write-Host "Aegis is starting: $url | daemon :8765 | obscura CDP :9222 | browser :4311 | whatsapp :4312 | voice :8766" -ForegroundColor Cyan
    Start-Sleep -Seconds 6
    Start-Process $url
    Write-Host "Running. Press Ctrl+C to stop everything."
    while ($true) { Start-Sleep -Seconds 2 }
}
finally {
    foreach ($p in $procs) {
        if ($p -and -not $p.HasExited) {
            # Kill the process tree (npm/python spawn children).
            taskkill /PID $p.Id /T /F 2>$null | Out-Null
        }
    }
    Write-Host "Aegis stopped."
}
