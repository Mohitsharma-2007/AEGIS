$ErrorActionPreference = 'SilentlyContinue'
$targets = @('Cursor', 'claude', 'codex', 'opencode', 'Antigravity', 'Windsurf')
$running = Get-Process -Name $targets -ErrorAction SilentlyContinue | Select-Object -ExpandProperty ProcessName -Unique
if ($running) { @($running) | ConvertTo-Json -Compress } else { '[]' }
