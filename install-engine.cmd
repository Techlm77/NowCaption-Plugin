@echo off
node "%~dp0scripts\install-engine.mjs" %*
exit /b %ERRORLEVEL%
