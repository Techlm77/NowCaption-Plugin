@echo off
node "%~dp0..\scripts\update-plugin.mjs" %*
exit /b %ERRORLEVEL%
