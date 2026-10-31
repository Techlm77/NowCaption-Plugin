@echo off
rem Double-click to install or update NowCaption for Vesktop. Nothing else needs to be installed first.
title NowCaption for Vesktop - installer
if not exist "%~dp0scripts\setup.mjs" (
    echo.
    echo   This file has to stay in the NowCaption-Plugin folder.
    echo   If you opened it inside the ZIP: right-click the ZIP, choose "Extract All...",
    echo   then double-click "Install on Windows.cmd" in the extracted folder.
    echo.
    pause
    exit /b 1
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\bootstrap\install-windows.ps1" %*
exit /b %ERRORLEVEL%
