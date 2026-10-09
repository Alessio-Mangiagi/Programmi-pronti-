@echo off
title Disinstalla avvio automatico
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0installa-avvio-automatico.ps1" -Remove
pause
