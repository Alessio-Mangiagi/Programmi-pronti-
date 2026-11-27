@echo off
REM "><(((º> sabusabu <º)))><"
REM Costruisce la versione AUTONOMA di Confronto Documenti: una cartella (e il suo zip) da inviare a un collega,
REM che parte con un doppio clic su un PC senza suite Cosedil, senza portale e senza Python. Dentro ci sono:
REM   Confronto Documenti.exe + _internal\   il programma (PyInstaller, ConfrontoAutonomo.spec, avvio autonomo.py)
REM   Tesseract-OCR\                         l'OCR per scansioni e immagini, ridotto all'indispensabile
REM   LEGGIMI.txt                            le istruzioni per chi lo riceve (da LEGGIMI-autonomo.txt)
REM Per l'exe destinato ai PC della suite (login del portale, verifica completa delle firme) c'e' build-exe.bat.
REM
REM Uso:   build-autonomo.bat [CARTELLA_USCITA]
REM        senza argomenti: dist\autonomo\Confronto Documenti\ e dist\Confronto-Documenti-autonomo.zip
REM        (dist\ e build\ sono ignorate da git). Si invia lo zip.
REM Variabili:
REM   BUILD_PYTHON    interprete con requirements.lock (default .venv\Scripts\python.exe)
REM   TESSERACT_DIR   installazione di Tesseract da cui copiare (default C:\Program Files\Tesseract-OCR);
REM                   deve avere tessdata\ita.traineddata. Se manca, la build riesce ma SENZA OCR e lo dice.
setlocal
cd /d "%~dp0"

set "USCITA=%~1"
if "%USCITA%"=="" set "USCITA=%~dp0dist\autonomo"
set "CARTELLA=%USCITA%\Confronto Documenti"
set "ZIP=%USCITA%\..\Confronto-Documenti-autonomo.zip"
set "VPY=%BUILD_PYTHON%"
if "%VPY%"=="" set "VPY=%~dp0.venv\Scripts\python.exe"
set "TESS=%TESSERACT_DIR%"
if "%TESS%"=="" set "TESS=C:\Program Files\Tesseract-OCR"

if not exist "%VPY%" (
    echo Ambiente Python non trovato: lanciare prima Installa.bat oppure impostare BUILD_PYTHON.
    goto errore
)

REM Servono solo per costruire: PyInstaller e asn1crypto (legge le buste .p7m in busta_autonoma.py; stessa
REM versione del motore della firma, shared\firma\requirements.txt). Si installano nel .venv alla prima build.
"%VPY%" -c "import PyInstaller, asn1crypto" >nul 2>&1
if errorlevel 1 (
    echo Installazione di PyInstaller e asn1crypto...
    "%VPY%" -m pip install -q --disable-pip-version-check pyinstaller asn1crypto==1.5.1
    if errorlevel 1 goto errore
)

echo [1/4] Costruzione del programma in "%CARTELLA%"...
if exist "%CARTELLA%" rmdir /s /q "%CARTELLA%"
"%VPY%" -m PyInstaller --noconfirm --distpath "%USCITA%" --workpath "%~dp0build\autonomo" ConfrontoAutonomo.spec
if errorlevel 1 goto errore

echo [2/4] Copia di Tesseract OCR da "%TESS%"...
if not exist "%TESS%\tesseract.exe" (
    echo ATTENZIONE: Tesseract non trovato. La cartella viene costruita SENZA OCR: scansioni e immagini
    echo             non si potranno confrontare. Installare Tesseract o impostare TESSERACT_DIR e rifare.
    goto leggimi
)
REM Solo quello che serve a leggere: tesseract.exe, le sue DLL e le lingue italiano, inglese e osd (orientamento
REM della pagina). Restano fuori i programmi di addestramento (*training.exe, text2image...), i .jar e la
REM documentazione: circa 70 MB in meno. robocopy: uscita da 0 a 7 = riuscito, da 8 in su = errore.
robocopy "%TESS%" "%CARTELLA%\Tesseract-OCR" tesseract.exe *.dll /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 goto errore
robocopy "%TESS%\tessdata" "%CARTELLA%\Tesseract-OCR\tessdata" ita.traineddata eng.traineddata osd.traineddata pdf.ttf /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 goto errore
robocopy "%TESS%\tessdata\configs" "%CARTELLA%\Tesseract-OCR\tessdata\configs" /E /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 goto errore
robocopy "%TESS%\tessdata\tessconfigs" "%CARTELLA%\Tesseract-OCR\tessdata\tessconfigs" /E /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 goto errore
if not exist "%CARTELLA%\Tesseract-OCR\tessdata\ita.traineddata" (
    echo ATTENZIONE: in "%TESS%\tessdata" manca ita.traineddata: l'OCR in italiano non funzionera'.
)

:leggimi
echo [3/4] Istruzioni per chi lo riceve...
copy /y "%~dp0LEGGIMI-autonomo.txt" "%CARTELLA%\LEGGIMI.txt" >nul
if errorlevel 1 goto errore

echo [4/4] Zip da inviare...
if exist "%ZIP%" del /q "%ZIP%"
powershell -NoProfile -ExecutionPolicy Bypass -Command "Compress-Archive -LiteralPath '%CARTELLA%' -DestinationPath '%ZIP%' -CompressionLevel Optimal"
if errorlevel 1 goto errore

echo.
echo Fatto. Da inviare: "%ZIP%"
echo Chi lo riceve: estrae tutto, doppio clic su "Confronto Documenti.exe" (vedi LEGGIMI.txt nella cartella).
if "%~1"=="" pause
exit /b 0

:errore
echo.
echo Build NON riuscita: vedere i messaggi sopra.
if "%~1"=="" pause
exit /b 1
