# -*- mode: python ; coding: utf-8 -*-


a = Analysis(
    ['/Users/q/Work/downloader_2/main.py'],
    pathex=[],
    binaries=[('/Users/q/Work/downloader_2/bin/ffmpeg', '.')],
    datas=[('/Users/q/Work/downloader_2/temp_downloads', 'temp_downloads'), ('/Users/q/Work/downloader_2/logo.png', '.')],
    hiddenimports=['PyQt5.QtCore', 'PyQt5.QtGui', 'PyQt5.QtWidgets', 'PyQt5.sip', 'requests', 'yt_dlp', 'yt_dlp.utils', 'yt_dlp.extractor', 'yt_dlp.downloader', 'yt_dlp.postprocessor', 'yt_dlp.compat', 'dotenv', 'logging', 'json', 'pathlib', 'tempfile', 'shutil', 'subprocess', 'glob', 'encodings.idna', 'urllib3.packages.six.moves.urllib.parse', 'charset_normalizer'],
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
    [],
    exclude_binaries=True,
    name='VideoDownloader',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch='arm64',
    codesign_identity='',
    entitlements_file=None,
    icon=['/Users/q/Work/downloader_2/logo.png'],
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='VideoDownloader',
)
app = BUNDLE(
    coll,
    name='VideoDownloader.app',
    icon='/Users/q/Work/downloader_2/logo.png',
    bundle_identifier='com.videodownloader.app',
)
