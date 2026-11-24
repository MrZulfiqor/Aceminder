@echo off
title Aceminder server
cd /d "%~dp0"
echo Starting Aceminder. Keep this window open while you use the site.
echo.
python server.py --open
echo.
echo The server has stopped.
pause
