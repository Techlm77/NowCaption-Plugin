@echo off
node "%~dp0scripts\update-plugin.mjs" %*
exit /b %ERRORLEVEL%
