#!/usr/bin/env python3
import os
import sys
import platform
import subprocess
import shutil

def get_native_architecture():
    """Определяет нативную архитектуру системы"""
    # Для macOS проверяем, является ли это Apple Silicon (arm64) или Intel (x86_64)
    if platform.system() == 'Darwin':
        # Проверяем, запущен ли Python на arm64
        if platform.machine() == 'arm64':
            return 'arm64'
        else:
            return 'x86_64'
    # Для других систем возвращаем архитектуру по умолчанию
    return None

def download_ffmpeg():
    """Загружает ffmpeg для включения в пакет приложения"""
    import requests
    from tqdm import tqdm
    import tarfile
    
    # Определяем архитектуру
    arch = get_native_architecture()
    
    # URL для загрузки ffmpeg (выберите подходящую версию для вашей системы)
    if arch == 'arm64':
        # Для Apple Silicon
        ffmpeg_url = "https://evermeet.cx/ffmpeg/getrelease/ffmpeg/7.0/arm64"
    else:
        # Для Intel
        ffmpeg_url = "https://evermeet.cx/ffmpeg/getrelease/ffmpeg/7.0/x86_64"
    
    # Путь для сохранения
    download_path = "ffmpeg.zip"
    
    # Загружаем ffmpeg
    print(f"Загрузка ffmpeg для {arch}...")
    response = requests.get(ffmpeg_url, stream=True)
    total_size = int(response.headers.get('content-length', 0))
    
    with open(download_path, 'wb') as file, tqdm(
        desc=download_path,
        total=total_size,
        unit='B',
        unit_scale=True,
        unit_divisor=1024,
    ) as bar:
        for data in response.iter_content(chunk_size=1024):
            size = file.write(data)
            bar.update(size)
    
    # Распаковываем архив
    print("Распаковка ffmpeg...")
    if download_path.endswith('.zip'):
        import zipfile
        with zipfile.ZipFile(download_path, 'r') as zip_ref:
            zip_ref.extractall("ffmpeg_temp")
    elif download_path.endswith('.tar.gz') or download_path.endswith('.tgz'):
        with tarfile.open(download_path, 'r:gz') as tar:
            tar.extractall("ffmpeg_temp")
    
    # Создаем директорию для бинарников
    os.makedirs("bin", exist_ok=True)
    
    # Копируем ffmpeg в директорию bin
    for root, dirs, files in os.walk("ffmpeg_temp"):
        for file in files:
            if file == "ffmpeg" or file == "ffmpeg.exe":
                src_path = os.path.join(root, file)
                dst_path = os.path.join("bin", file)
                shutil.copy2(src_path, dst_path)
                # Делаем файл исполняемым
                os.chmod(dst_path, 0o755)
                print(f"Скопирован {src_path} в {dst_path}")
    
    # Удаляем временные файлы
    os.remove(download_path)
    shutil.rmtree("ffmpeg_temp", ignore_errors=True)
    
    return os.path.abspath("bin")

def main():
    # Получаем абсолютный путь к текущей директории
    script_dir = os.path.dirname(os.path.abspath(__file__))

    # Определяем пути к важным файлам
    icon_path = os.path.join(script_dir, 'logo.png')
    main_script = os.path.join(script_dir, 'main.py')
    ffmpeg_path = os.path.join(script_dir, 'bin', 'ffmpeg')

    # Создаем директорию для временных файлов, если она не существует
    temp_dir = os.path.join(script_dir, 'temp_downloads')
    os.makedirs(temp_dir, exist_ok=True)

    # Определяем дополнительные данные для включения в сборку
    datas = [
        (temp_dir, 'temp_downloads'),
        (icon_path, '.'),
    ]

    # Определяем бинарные файлы для включения
    binaries = [
        (ffmpeg_path, '.'),  # Добавляем ffmpeg в корень пакета
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

    # Определяем опции для PyInstaller
    options = [
        main_script,  # Основной скрипт
        '--name=VideoDownloader',  # Имя приложения
        '--windowed',  # Создать оконное приложение (без консоли)
        '--onedir',  # Создать директорию с приложением
        '--noconfirm',  # Не спрашивать подтверждения
        f'--icon={icon_path}',  # Путь к иконке
        '--clean',  # Очистить кэш перед сборкой
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
        arch = get_native_architecture()
        if arch:
            print(f"Обнаружена архитектура: {arch}")
        else:
            print("Не удалось определить архитектуру, будет использована архитектура по умолчанию")
        
        # Добавляем целевую архитектуру для macOS
        if arch:
            options.append(f"--target-architecture={arch}")
        
        # Добавляем опцию для подписи кода (оставляем пустой)
        options.append("--codesign-identity=")

    # Запускаем PyInstaller с нашими опциями через виртуальное окружение
    print("Запуск PyInstaller с опциями:", options)
    pyinstaller_cmd = ['venv/bin/pyinstaller'] + options
    print(f"Выполняем команду: {' '.join(pyinstaller_cmd)}")
    result = subprocess.run(pyinstaller_cmd, cwd=script_dir)

    if result.returncode != 0:
        print("Ошибка при сборке приложения!")
        sys.exit(1)

    print("Сборка завершена. Приложение находится в директории dist/")

if __name__ == "__main__":
    main()
