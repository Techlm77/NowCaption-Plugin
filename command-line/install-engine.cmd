@echo off
node "%~dp0..\scripts\install-engine.mjs" %*
exit /b %ERRORLEVEL%
