@echo off
REM Aegis - double-click launcher for Windows. Runs start.ps1 next to it.
powershell -ExecutionPolicy Bypass -File "%~dp0start.ps1" %*
pause
