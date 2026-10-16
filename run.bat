@echo off
rem Double-click launcher for native Windows. Runs run.ps1 with a bypassed
rem execution policy for this process only (does not change any system
rem setting), and keeps the window open if something fails so the message
rem is readable.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run.ps1"
if %ERRORLEVEL% neq 0 (
    echo.
    echo GrantFlow did not start. See the message above.
    pause
)
