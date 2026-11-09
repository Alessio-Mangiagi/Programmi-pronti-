# -*- mode: python ; coding: utf-8 -*-
from PyInstaller.utils.hooks import collect_all

datas = [('ui', 'ui')]
binaries = []
# Firma digitale (.p7m): busta.py, il client del motore comune, NON entra nel bundle. Il server lo importa dal
# disco, da <cartella dell'exe>/shared/firma (o FIRMA_DIR), dove va copiato il motore con
# ../shared/firma/copia-motore.bat (lo fa build-exe.bat): lì busta.py trova firma.py e il .venv con le librerie
# di verifica, che dentro l'exe non possono stare. Un modulo letto dal disco usa però la libreria standard del
# bundle: queste sono quelle che gli servono, elencate perché l'analisi di PyInstaller non le vede.
hiddenimports = ['base64', 'binascii', 'json', 're', 'subprocess', 'tempfile', 'time', 'pathlib']
tmp_ret = collect_all('pymupdf')
# "><(((º> sabusabu <º)))><"
datas += tmp_ret[0]; binaries += tmp_ret[1]; hiddenimports += tmp_ret[2]


a = Analysis(
    ['server.py'],
    # Il gate SSO vive in shared/sso (condiviso con le altre app della suite):
    # senza questo path PyInstaller non risolve "import cosedil_sso" e l'exe
    # parte senza login. Allineato al sys.path di server.py.
    pathex=['../shared/sso', '../shared/avvisi'],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='ConfrontaPDF',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
