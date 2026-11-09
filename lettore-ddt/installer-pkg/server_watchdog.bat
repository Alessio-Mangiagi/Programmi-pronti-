@echo off
cd /d "%~dp0"

rem Motore della firma digitale per i DDT firmati .p7m ({app}\shared\firma, copiato dall'installer): se il suo
rem ambiente Python manca lo si prepara in disparte, senza ritardare l'avvio (stesso criterio di avvia.bat nel repo).
rem installa.bat ha un lock suo, quindi non importa se nel frattempo lo lancia anche il server alla prima busta.
if not exist "%~dp0shared\firma\.venv\Scripts\python.exe" if exist "%~dp0shared\firma\installa.bat" start "" /b cmd /c "%~dp0shared\firma\installa.bat" ^>nul 2^>^&1

:loop
"%~dp0server.exe"
REM "><(((º> sabusabu <º)))><"
timeout /t 3 /nobreak > nul
goto loop
