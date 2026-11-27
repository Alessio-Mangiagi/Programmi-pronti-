# -*- mode: python ; coding: utf-8 -*-
# "><(((º> sabusabu <º)))><"
# Ricetta PyInstaller della versione AUTONOMA di Confronto Documenti (quella da inviare): la usa
# build-autonomo.bat. Differenze da ConfrontaPDF.spec, che costruisce l'exe per i PC della suite:
#   - parte da autonomo.py (login del portale spento, solo 127.0.0.1, dati in %LOCALAPPDATA%), non da server.py;
#   - NON contiene i moduli della suite (gate SSO, token di servizio, avvisi al portale, client del motore della
#     firma): niente pathex verso ../shared e, per sicurezza, sono anche negli excludes. server.py li importa
#     dentro un try e, non trovandoli, gira "fuori dalla suite";
#   - i .p7m li apre busta_autonoma.py (asn1crypto, Python puro, dentro l'exe);
#   - cartella (onedir) invece di un solo file: l'exe unico si scompatta in %TEMP% a ogni avvio (lento, e gli
#     antivirus lo rallentano ancora); tanto si consegna comunque una cartella, per via di Tesseract-OCR;
#   - niente UPX: gli eseguibili compressi fanno scattare più spesso i falsi positivi degli antivirus.
from PyInstaller.utils.hooks import collect_all

datas = [('ui', 'ui')]
binaries = []
hiddenimports = []
tmp_ret = collect_all('pymupdf')

# collect_all prende TUTTO il pacchetto pymupdf, anche quello che il confronto non usa e che pesa quasi 100 MB:
#   - pymupdf/layout (modelli di analisi dell'impaginazione) e onnxruntime che li esegue: nel .venv ci sono solo
#     perché li porta pymupdf4llm; confronta_pdf.py legge il testo con le funzioni base di PyMuPDF;
#   - pymupdf/mupdf-devel: intestazioni C per chi compila estensioni.
# Si tolgono dalle liste e, sotto, dagli excludes. Se un giorno il confronto userà l'analisi dell'impaginazione,
# vanno rimessi (togliere _SUPERFLUI e le tre voci in excludes).
_SUPERFLUI = ('layout', 'mupdf-devel')


def _serve(voce):
    """Vero se la voce (tupla sorgente/destinazione o nome di modulo) non riguarda le parti superflue."""
    testo = (voce if isinstance(voce, str) else ' '.join(map(str, voce))).replace('\\', '/')
    return not any(f'pymupdf/{s}' in testo or f'pymupdf.{s}' in testo for s in _SUPERFLUI)


datas += [v for v in tmp_ret[0] if _serve(v)]
binaries += [v for v in tmp_ret[1] if _serve(v)]
hiddenimports += [v for v in tmp_ret[2] if _serve(v)]

a = Analysis(
    ['autonomo.py'],
    pathex=[],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=['cosedil_sso', 'suite_link', 'avvisi', 'busta', 'pytest', 'tkinter',
              'onnxruntime', 'pymupdf.layout', 'pymupdf4llm'],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='Confronto Documenti',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    # La finestra nera resta apposta: è il modo di chiudere il programma (chiudi la finestra) e ci si legge
    # l'avanzamento dell'OCR. Senza, il processo resterebbe acceso senza che l'utente sappia come fermarlo.
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon='Confronta_file.ico',
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    name='Confronto Documenti',
)
