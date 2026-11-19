@echo off
REM Redirect python invocation in services\daemon to the populated Python 3.11 virtual environment
if exist "%~dp0.venv311\Scripts\python.exe" (
    "%~dp0.venv311\Scripts\python.exe" %*
) else if exist "%~dp0.venv\Scripts\python.exe" (
    "%~dp0.venv\Scripts\python.exe" %*
) else (
    python.exe %*
)
