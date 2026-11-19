<#
.SYNOPSIS
    Download the local voice models Aegis uses for speech-to-text and TTS.

.DESCRIPTION
    Kokoro-82M is the primary TTS engine (English + Hindi). The script downloads
    the quantized ONNX model, the voice pack, and the two Piper fallback voices.
    Files already present are skipped unless -Force is passed.

    Run this once after creating the Python 3.11 venv and installing
    requirements.txt. The voice service also starts fine without Kokoro: it
    falls back to Piper when the Kokoro files are missing.

.EXAMPLE
    .\install_voice_models.ps1
    .\install_voice_models.ps1 -Force
    .\install_voice_models.ps1 -SkipPiper
#>
param(
    [switch]$Force,
    [switch]$SkipKokoro,
    [switch]$SkipPiper
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$voices = Join-Path $root 'voices'
$kokoro = Join-Path $voices 'kokoro'
New-Item -ItemType Directory -Force -Path $voices, $kokoro | Out-Null

$downloads = @()

if (-not $SkipKokoro) {
    $downloads += @{
        Name = 'Kokoro int8 model (recommended)'
        Url  = 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/onnx/model_quantized.onnx'
        Path = Join-Path $kokoro 'kokoro-v1.0.int8.onnx'
    }
    $downloads += @{
        Name = 'Kokoro full model (GPU / accelerated runtime)'
        Url  = 'https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx'
        Path = Join-Path $kokoro 'kokoro-v1.0.onnx'
    }
    $downloads += @{
        Name = 'Kokoro voices (af_heart, hf_alpha, ...)'
        Url  = 'https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin'
        Path = Join-Path $kokoro 'voices-v1.0.bin'
    }
}

if (-not $SkipPiper) {
    $downloads += @{
        Name = 'Piper Hindi voice (fallback)'
        Url  = 'https://huggingface.co/rhasspy/piper-voices/resolve/main/hi/hi_IN/pratham/medium/hi_IN-pratham-medium.onnx'
        Path = Join-Path $voices 'hi_IN-pratham-medium.onnx'
    }
    $downloads += @{
        Name = 'Piper Hindi voice config'
        Url  = 'https://huggingface.co/rhasspy/piper-voices/resolve/main/hi/hi_IN/pratham/medium/hi_IN-pratham-medium.onnx.json'
        Path = Join-Path $voices 'hi_IN-pratham-medium.onnx.json'
    }
    $downloads += @{
        Name = 'Piper English voice (fallback)'
        Url  = 'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx'
        Path = Join-Path $voices 'en_US-lessac-medium.onnx'
    }
    $downloads += @{
        Name = 'Piper English voice config'
        Url  = 'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json'
        Path = Join-Path $voices 'en_US-lessac-medium.onnx.json'
    }
}

foreach ($item in $downloads) {
    if ((Test-Path $item.Path) -and -not $Force) {
        Write-Host "skip  $($item.Name)" -ForegroundColor DarkGray
        continue
    }
    Write-Host "fetch $($item.Name)" -ForegroundColor Cyan
    & curl.exe -L --fail --progress-bar -o $item.Path $item.Url
    if ($LASTEXITCODE -ne 0) {
        throw "Download failed: $($item.Url)"
    }
}

Write-Host ''
Write-Host 'Voice models are ready under' $voices -ForegroundColor Green
Write-Host 'Start the service with .\run_voice.cmd (or let the desktop app start it).'
