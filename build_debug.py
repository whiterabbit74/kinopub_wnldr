#!/usr/bin/env python3
import os
import sys
import shutil
import subprocess
import platform

# Получаем абсолютный путь к текущей директории
script_dir = os.path.dirname(os.path.abspath(__file__))

# Определяем пути к важным файлам
icon_path = os.path.join(script_dir, 'logo.png')
main_script = os.path.join(script_dir, 'main.py')

# Создаем директорию для временных файлов, если она не существует
temp_dir = os.path.join(script_dir, 'temp_downloads')
os.makedirs(temp_dir, exist_ok=True)

# Создаем директорию для логов, если она не существует
logs_dir = os.path.join(script_dir, 'logs')
os.makedirs(logs_dir, exist_ok=True)

# Создаем пустой лог-файл для отладки, если он не существует
debug_log = os.path.join(script_dir, 'app_debug.log')
if not os.path.exists(debug_log):
    with open(debug_log, 'w') as f:
        f.write('')

# Определяем дополнительные данные для включения в сборку
datas = [
    (temp_dir, 'temp_downloads'),
    (logs_dir, 'logs'),
    (debug_log, '.'),
]

# Определяем скрытые импорты, которые могут быть не обнаружены автоматически
hidden_imports = [
    'PyQt5.QtCore',
    'PyQt5.QtGui',
    'PyQt5.QtWidgets',
    'PyQt5.sip',
    'requests',
    'yt_dlp',
    'yt_dlp.utils',
    'yt_dlp.extractor',
    'yt_dlp.downloader',
    'yt_dlp.postprocessor',
    'yt_dlp.compat',
    'dotenv',
    'logging',
    'json',
    'pathlib',
    'tempfile',
    'shutil',
    'subprocess',
    'glob',
    'encodings.idna',  # Важно для requests
    'urllib3.packages.six.moves.urllib.parse',  # Важно для requests
    'charset_normalizer',  # Важно для requests
]

# Определяем бинарные файлы для включения
binaries = []

# Определяем опции для PyInstaller
options = [
    main_script,  # Основной скрипт
    '--name=VideoDownloader',  # Имя приложения
    '--windowed',  # Создать оконное приложение (без консоли)
    '--onedir',  # Создать директорию с приложением
    '--noconfirm',  # Не спрашивать подтверждения
    f'--icon={icon_path}',  # Путь к иконке
    '--debug=all',  # Включить отладочную информацию
    '--log-level=DEBUG',  # Уровень логирования
]

# Добавляем скрытые импорты
for hidden_import in hidden_imports:
    options.append(f'--hidden-import={hidden_import}')

# Добавляем данные
for src, dst in datas:
    options.append(f'--add-data={src}{os.pathsep}{dst}')

# Добавляем бинарные файлы
for src, dst in binaries:
    options.append(f'--add-binary={src}{os.pathsep}{dst}')

# Добавляем дополнительные опции для macOS
if sys.platform == 'darwin':
    options.append('--osx-bundle-identifier=com.videodownloader.app')
    
    # Определяем нативную архитектуру
    machine = platform.machine()
    if machine == 'arm64':
        # Для Apple Silicon (M1/M2)
        target_arch = 'arm64'
    else:
        # Для Intel Mac
        target_arch = 'x86_64'
    
    options.append(f'--target-architecture={target_arch}')
    options.append('--codesign-identity=')  # Пустая строка для пропуска подписи

# Запускаем PyInstaller с нашими опциями через виртуальное окружение
print("Запуск PyInstaller с опциями:", options)
pyinstaller_cmd = ['venv/bin/pyinstaller'] + options
print(f"Выполняем команду: {' '.join(pyinstaller_cmd)}")
result = subprocess.run(pyinstaller_cmd, cwd=script_dir)

if result.returncode != 0:
    print("Ошибка при сборке приложения!")
    sys.exit(1)

# Создаем скрипт для запуска приложения с отладкой
debug_script_path = os.path.join(script_dir, 'run_debug.sh')
with open(debug_script_path, 'w') as f:
    f.write('#!/bin/bash\n')
    f.write('cd "' + os.path.join(script_dir, 'dist/VideoDownloader.app/Contents/MacOS') + '"\n')
    f.write('PYTHONVERBOSE=1 ./VideoDownloader > "' + os.path.join(script_dir, 'app_debug.log') + '" 2>&1\n')

# Делаем скрипт исполняемым
os.chmod(debug_script_path, 0o755)

print("Сборка завершена. Для запуска с отладкой используйте ./run_debug.sh")
