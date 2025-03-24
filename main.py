import os
import sys
import logging
import time
import json
import traceback
from datetime import datetime
from pathlib import Path
from dotenv import load_dotenv
import yt_dlp
from PyQt5.QtWidgets import (
    QApplication, QMainWindow, QWidget, QVBoxLayout, QHBoxLayout, 
    QLabel, QLineEdit, QPushButton, QProgressBar, QFileDialog, 
    QGroupBox, QFormLayout, QComboBox, QSpinBox, QTextEdit, QDialog,
    QMessageBox
)
from PyQt5.QtCore import Qt, QThread, pyqtSignal, QUrl
from PyQt5.QtGui import QFont, QPalette, QColor, QDragEnterEvent, QDropEvent
import subprocess
import glob

# Настройка логирования
logger = logging.getLogger('video_downloader')
logger.setLevel(logging.INFO)

# Форматтер для логов
formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')

# Обработчик для вывода в консоль
console_handler = logging.StreamHandler()
console_handler.setFormatter(formatter)
logger.addHandler(console_handler)

# Если приложение запущено как замороженное, добавляем файловый обработчик
if getattr(sys, 'frozen', False):
    try:
        if sys.platform == 'darwin':
            # На macOS в .app пакете
            log_file = os.path.join(os.path.dirname(sys.executable), 'video_downloader.log')
        else:
            # На других платформах
            log_file = os.path.join(os.path.dirname(sys.executable), 'video_downloader.log')
        
        file_handler = logging.FileHandler(log_file)
        file_handler.setFormatter(formatter)
        logger.addHandler(file_handler)
        logger.info(f"Логирование в файл настроено: {log_file}")
    except Exception as e:
        print(f"Ошибка при настройке файлового логирования: {e}")
else:
    # Если приложение запущено как скрипт, логируем в файл в текущей директории
    try:
        file_handler = logging.FileHandler('video_downloader.log')
        file_handler.setFormatter(formatter)
        logger.addHandler(file_handler)
        logger.info("Логирование в файл настроено в текущей директории")
    except Exception as e:
        print(f"Ошибка при настройке файлового логирования: {e}")

# Цвета в стиле Apple
APPLE_BLUE = "#0066CC"
APPLE_WHITE = "#FFFFFF"
APPLE_BLACK = "#333333"
APPLE_GRAY = "#F5F5F7"

class FormatFetcher(QThread):
    formats_ready = pyqtSignal(list)
    error_signal = pyqtSignal(str)
    
    def __init__(self, url):
        super().__init__()
        self.url = url
        logger.info(f"Инициализация FormatFetcher для {url}")
        
    def run(self):
        try:
            # Проверяем, является ли путь локальным файлом
            if os.path.isfile(self.url):
                logger.info(f"Обнаружен локальный файл: {self.url}")
                
                # Для m3u8 файлов используем yt-dlp для получения форматов
                if self.url.lower().endswith('.m3u8'):
                    logger.info("Обнаружен m3u8 файл, получаем форматы")
                    
                    # Преобразуем путь к файлу в URL с протоколом file://
                    file_url = f"file://{os.path.abspath(self.url)}"
                    logger.info(f"Преобразован путь в URL: {file_url}")
                    
                    ydl_opts = {
                        'quiet': True,
                        'no_warnings': True,
                        'logger': logger,
                        'enable_file_urls': True,  # Разрешаем использование file:// URL
                        'extract_flat': False,     # Полное извлечение информации
                        'dump_single_json': False, # Не выводить JSON
                        'skip_download': True,     # Не скачивать, только получить информацию
                        'allow_unplayable_formats': True, # Разрешаем все форматы для m3u8
                        'listformats': True,       # Получаем список форматов
                    }
                    
                    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                        logger.info("Извлечение информации о видеопотоке...")
                        info = ydl.extract_info(file_url, download=False)
                        
                        if info and 'formats' in info:
                            formats = info['formats']
                            logger.info(f"Получено {len(formats)} форматов для m3u8 файла")
                            
                            # Анализируем форматы для определения аудио и видео
                            self.analyze_formats(formats)
                            
                            # Обрабатываем форматы для удобного отображения
                            processed_formats = self.process_formats(formats)
                            
                            self.formats_ready.emit(processed_formats)
                        else:
                            logger.error("Не удалось получить форматы для m3u8 файла")
                            self.error_signal.emit("Не удалось получить форматы для m3u8 файла")
                    return
                    
                # Для других типов файлов
                else:
                    logger.info(f"Обнаружен локальный файл другого типа: {self.url}")
                    self.error_signal.emit(f"Неподдерживаемый тип файла: {os.path.basename(self.url)}")
                    return
            
            # Если это URL, используем yt-dlp для получения форматов
            logger.info(f"Обнаружен URL: {self.url}")
            
            ydl_opts = {
                'quiet': True,
                'no_warnings': True,
                'logger': logger,
                'allow_unplayable_formats': True, # Разрешаем все форматы
                'listformats': True,             # Получаем список форматов
            }
            
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                logger.info("Извлечение информации о видео...")
                info = ydl.extract_info(self.url, download=False)
                
                if info and 'formats' in info:
                    formats = info['formats']
                    logger.info(f"Получено {len(formats)} форматов для URL")
                    
                    # Анализируем форматы для определения аудио и видео
                    self.analyze_formats(formats)
                    
                    # Обрабатываем форматы для удобного отображения
                    processed_formats = self.process_formats(formats)
                    
                    self.formats_ready.emit(processed_formats)
                else:
                    logger.error("Не удалось получить форматы для URL")
                    self.error_signal.emit("Не удалось получить форматы для URL")
                    
        except Exception as e:
            logger.error(f"Ошибка при получении форматов: {str(e)}")
            self.error_signal.emit(f"Ошибка при получении форматов: {str(e)}")
    
    def analyze_formats(self, formats):
        """Анализирует форматы и добавляет дополнительные метки для аудио и видео"""
        logger.info("Анализ форматов...")
        
        # Логируем все форматы для отладки
        for i, fmt in enumerate(formats):
            logger.debug(f"Формат #{i}: {fmt}")
            
            # Проверяем кодеки
            vcodec = fmt.get('vcodec', 'none')
            acodec = fmt.get('acodec', 'none')
            
            # Добавляем метки для типа формата
            if vcodec != 'none' and acodec == 'none':
                fmt['format_type'] = 'video_only'
                logger.debug(f"Формат #{i}: Определен как только видео")
            elif vcodec == 'none' and acodec != 'none':
                fmt['format_type'] = 'audio_only'
                logger.debug(f"Формат #{i}: Определен как только аудио")
            elif 'audio only' in fmt.get('format', '').lower():
                fmt['format_type'] = 'audio_only'
                logger.debug(f"Формат #{i}: Определен как аудио по строке формата")
            elif 'video only' in fmt.get('format', '').lower():
                fmt['format_type'] = 'video_only'
                logger.debug(f"Формат #{i}: Определен как видео по строке формата")
            elif acodec != 'none' and not fmt.get('height', 0):
                fmt['format_type'] = 'audio_only'
                logger.debug(f"Формат #{i}: Определен как аудио (есть аудио кодек, нет высоты)")
            elif vcodec != 'none' and fmt.get('height', 0) > 0:
                fmt['format_type'] = 'video_only'
                logger.debug(f"Формат #{i}: Определен как видео (есть видео кодек и высота)")
            else:
                # Если не удалось определить тип, проверяем наличие аудио битрейта
                if fmt.get('abr', 0) > 0 and not fmt.get('height', 0):
                    fmt['format_type'] = 'audio_only'
                    logger.debug(f"Формат #{i}: Определен как аудио по битрейту")
                elif fmt.get('height', 0) > 0:
                    fmt['format_type'] = 'video_only'
                    logger.debug(f"Формат #{i}: Определен как видео по высоте")
                else:
                    # Если всё ещё не определили, проверяем по расширению
                    ext = fmt.get('ext', '').lower()
                    if ext in ['mp3', 'm4a', 'aac', 'wav', 'ogg']:
                        fmt['format_type'] = 'audio_only'
                        logger.debug(f"Формат #{i}: Определен как аудио по расширению {ext}")
                    elif ext in ['mp4', 'webm', 'mkv', 'avi']:
                        fmt['format_type'] = 'video_only'
                        logger.debug(f"Формат #{i}: Определен как видео по расширению {ext}")
                    else:
                        # Если не удалось определить, считаем видео
                        fmt['format_type'] = 'video_only'
                        logger.debug(f"Формат #{i}: Не удалось определить тип, считаем видео")
        
        # Подсчитываем количество аудио и видео форматов
        audio_count = sum(1 for fmt in formats if fmt.get('format_type') == 'audio_only')
        video_count = sum(1 for fmt in formats if fmt.get('format_type') == 'video_only')
        logger.info(f"Анализ форматов завершен: аудио {audio_count}, видео {video_count}")
    
    def process_formats(self, formats):
        """Обрабатывает форматы для удобного отображения и выбора"""
        processed_formats = []
        
        try:
            # Обрабатываем каждый формат
            for fmt in formats:
                # Создаем копию формата для обработки
                processed_fmt = fmt.copy()
                
                # Добавляем дополнительную информацию для аудио форматов
                if fmt.get('format_type') == 'audio_only':
                    # Проверяем наличие информации о языке или названии
                    if 'language' in fmt:
                        processed_fmt['format_note'] = f"Аудио: {fmt['language']}"
                    elif not processed_fmt.get('format_note'):
                        # Если нет информации о формате, добавляем базовую
                        bitrate = fmt.get('abr', 0)
                        if bitrate:
                            processed_fmt['format_note'] = f"Аудио {bitrate} kbps"
                        else:
                            processed_fmt['format_note'] = "Аудио"
                
                processed_formats.append(processed_fmt)
            
            return processed_formats
        except Exception as e:
            logger.error(f"Ошибка при обработке форматов: {str(e)}")
            return formats  # Возвращаем оригинальные форматы в случае ошибки


class VideoDownloader(QThread):
    progress_signal = pyqtSignal(dict)
    error_signal = pyqtSignal(str)
    finished_signal = pyqtSignal(str, float)
    retry_signal = pyqtSignal(str, int)
    
    def __init__(self, url, format_id, output_dir, threads=4, max_retries=3, custom_filename=None):
        super().__init__()
        self.url = url
        self.format_id = format_id
        self.output_dir = output_dir
        self.threads = threads
        self.stopped = False
        self.max_retries = max_retries  # Максимальное количество повторных попыток
        self.current_retry = 0  # Текущая попытка
        self.custom_filename = custom_filename  # Пользовательское имя файла
        self.start_time = 0  # Время начала скачивания
        
        # Определяем базовую директорию приложения
        if getattr(sys, 'frozen', False):
            # Если приложение запущено как скомпилированный бинарный файл
            base_dir = os.path.dirname(sys.executable)
            if sys.platform == 'darwin':
                # На macOS в .app пакете путь будет отличаться
                base_dir = os.path.abspath(os.path.join(os.path.dirname(sys.executable), '..', 'Frameworks'))
        else:
            # Если приложение запущено как скрипт
            base_dir = os.path.dirname(os.path.abspath(__file__))
        
        # Создаем временную директорию в базовой директории приложения
        self.temp_dir = os.path.join(base_dir, "temp_downloads")
        os.makedirs(self.temp_dir, exist_ok=True)
        
        # Получаем имя файла из URL для использования во временных файлах
        if os.path.isfile(url):
            self.base_filename = os.path.splitext(os.path.basename(url))[0]
        else:
            # Для URL используем текущее время как имя файла
            self.base_filename = f"download_{int(time.time())}"
            
        logger.info(f"Инициализация VideoDownloader для {url}, формат {format_id}, директория {output_dir}")
        logger.info(f"Временная директория: {self.temp_dir}")
        if custom_filename:
            logger.info(f"Пользовательское имя файла: {custom_filename}")
        
    def cleanup_temp_files(self):
        """Очищает временные файлы перед началом загрузки"""
        try:
            # Ищем все файлы, которые могут соответствовать нашему шаблону
            pattern = os.path.join(self.temp_dir, f"{self.base_filename}.*")
            temp_files = glob.glob(pattern)
            
            if temp_files:
                logger.info(f"Найдены временные файлы: {len(temp_files)}")
                for file_path in temp_files:
                    try:
                        os.remove(file_path)
                        logger.info(f"Удален временный файл: {file_path}")
                    except Exception as e:
                        logger.warning(f"Не удалось удалить временный файл {file_path}: {str(e)}")
            else:
                logger.info("Временные файлы не найдены")
                
        except Exception as e:
            logger.error(f"Ошибка при очистке временных файлов: {str(e)}")
    
    def move_completed_files(self):
        """Перемещает завершенные файлы из временной директории в указанную пользователем"""
        try:
            # Импортируем shutil непосредственно в методе
            import shutil
            
            # Ищем все файлы, которые могут соответствовать нашему шаблону
            pattern = os.path.join(self.temp_dir, f"{self.base_filename}.*")
            temp_files = glob.glob(pattern)
            
            moved_files = []
            
            if temp_files:
                logger.info(f"Найдены завершенные файлы для перемещения: {len(temp_files)}")
                for file_path in temp_files:
                    try:
                        # Получаем имя файла без пути и расширение
                        filename = os.path.basename(file_path)
                        name, ext = os.path.splitext(filename)
                        
                        # Если указано пользовательское имя файла, используем его
                        if self.custom_filename:
                            # Используем пользовательское имя с оригинальным расширением
                            dest_filename = f"{self.custom_filename}{ext}"
                        else:
                            dest_filename = filename
                            
                        # Создаем путь назначения
                        dest_path = os.path.join(self.output_dir, dest_filename)
                        
                        # Перемещаем файл
                        shutil.move(file_path, dest_path)
                        logger.info(f"Перемещен файл: {file_path} -> {dest_path}")
                        moved_files.append(dest_path)
                    except Exception as e:
                        logger.error(f"Не удалось переместить файл {file_path}: {str(e)}")
                
                return moved_files
            else:
                logger.warning("Не найдены завершенные файлы для перемещения")
                return []
                
        except Exception as e:
            logger.error(f"Ошибка при перемещении завершенных файлов: {str(e)}")
            return []
            
    def run(self):
        self.download_with_retry()
            
    def download_with_retry(self):
        """Скачивание с механизмом повторных попыток"""
        try:
            # Запоминаем время начала скачивания
            self.start_time = time.time()
            
            # Очищаем временные файлы перед началом загрузки
            self.cleanup_temp_files()
            
            # Создаем директорию для сохранения, если она не существует
            os.makedirs(self.output_dir, exist_ok=True)
            
            # Настраиваем опции для yt-dlp
            ydl_opts = {
                'format': self.format_id,
                'outtmpl': {
                    'default': os.path.join(self.temp_dir, f"{self.base_filename}.%(ext)s"),
                    'chapter': os.path.join(self.temp_dir, f"{self.base_filename}_%(section_number)03d.%(ext)s")
                },
                'enable_file_urls': True,  # Разрешаем использование file:// URL
                'noplaylist': False,       # Разрешаем плейлисты
                'progress_hooks': [self.progress_hook],
                'logger': logger,
                'quiet': True,
                'no_warnings': True,
                'noprogress': True,
                'compat_opts': set(),
                'http_headers': {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/95.0.4638.50 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'en-us,en;q=0.5',
                    'Sec-Fetch-Mode': 'navigate',
                },
                'forceprint': {},
                'print_to_file': {},
                'retries': 10,              # Встроенные повторные попытки yt-dlp
                'fragment_retries': 10,     # Повторные попытки для фрагментов
                'skip_unavailable_fragments': False,  # Не пропускать недоступные фрагменты
                'continuedl': True,         # Продолжать загрузку частично загруженных файлов
                'postprocessors': [],       # Пустой список постпроцессоров
            }
            
            # Получаем путь к ffmpeg из переменной окружения
            ffmpeg_location = os.environ.get('FFMPEG_LOCATION')
            if ffmpeg_location and os.path.exists(ffmpeg_location):
                logger.info(f"Используем ffmpeg из переменной окружения: {ffmpeg_location}")
                ydl_opts.update({
                    'ffmpeg_location': ffmpeg_location,
                })
            
            # Проверяем, если это m3u8 файл, используем специальные настройки
            if self.url.endswith('.m3u8') or os.path.isfile(self.url) and self.url.endswith('.m3u8'):
                logger.info("Обнаружен m3u8 файл, используем специальные настройки")
                # Для m3u8 файлов используем встроенный загрузчик yt-dlp вместо ffmpeg
                ydl_opts.update({
                    'hls_prefer_native': True,  # Используем встроенный загрузчик HLS
                    'hls_use_mpegts': True,     # Для HLS потоков
                    'prefer_ffmpeg': True,      # Предпочитаем ffmpeg для объединения форматов
                })
            else:
                # Для других форматов можно использовать ffmpeg, если он доступен
                ydl_opts.update({
                    'prefer_ffmpeg': True,
                    'downloader': 'ffmpeg',     # Используем ffmpeg для загрузки, если доступен
                    'external_downloader_args': {
                        'ffmpeg': ['-threads', str(self.threads)]  # Устанавливаем количество потоков для ffmpeg
                    },
                })
            
            # Проверяем, если это локальный файл
            if os.path.isfile(self.url):
                # Преобразуем путь к файлу в URL с протоколом file://
                self.url = f"file://{os.path.abspath(self.url)}"
                logger.info(f"Преобразован путь в URL: {self.url}")
            
            logger.info(f"Начинаем скачивание с опциями: {ydl_opts}")
            
            # Запускаем скачивание
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                ydl.download([self.url])
            
            # Перемещаем завершенные файлы в указанную директорию
            moved_files = self.move_completed_files()
            
            # Вычисляем затраченное время
            elapsed_time = time.time() - self.start_time
            
            if moved_files:
                logger.info(f"Скачивание завершено успешно за {self.format_time(elapsed_time)}. Перемещены файлы: {', '.join(moved_files)}")
                self.finished_signal.emit("Скачивание завершено успешно", elapsed_time)
            else:
                logger.warning(f"Скачивание завершено за {self.format_time(elapsed_time)}, но не найдены файлы для перемещения")
                self.finished_signal.emit("Скачивание завершено, но файлы не найдены", elapsed_time)
            
        except Exception as e:
            error_message = f"Ошибка при скачивании: {str(e)}"
            logger.error(error_message)
            
            # Проверяем, можно ли повторить попытку
            if self.current_retry < self.max_retries and not self.stopped:
                self.current_retry += 1
                retry_message = f"Повторная попытка {self.current_retry}/{self.max_retries}..."
                logger.info(retry_message)
                self.retry_signal.emit(retry_message, self.current_retry)
                
                # Небольшая задержка перед повторной попыткой
                time.sleep(2)
                
                # Повторяем попытку
                self.download_with_retry()
            else:
                # Если исчерпаны все попытки, отправляем сигнал об ошибке
                error_message = f"Ошибка при загрузке видео: Ошибка при скачивании после {self.max_retries} попыток: {str(e)}"
                logger.error(error_message)
                self.error_signal.emit(error_message)
    
    def progress_hook(self, d):
        """Обрабатывает прогресс скачивания"""
        if self.stopped:
            raise Exception("Скачивание остановлено пользователем")
            
        if d['status'] == 'downloading':
            # Получаем информацию о прогрессе
            try:
                total_bytes = d.get('total_bytes') or d.get('total_bytes_estimate', 0)
                downloaded_bytes = d.get('downloaded_bytes', 0)
                
                if total_bytes > 0:
                    percent = downloaded_bytes / total_bytes * 100
                else:
                    percent = 0
                    
                speed = d.get('speed', 0)
                eta = d.get('eta', 0)
                filename = d.get('filename', '')
                
                # Форматируем данные
                progress_data = {
                    'percent': percent,
                    'speed': self.format_size(speed) + '/s' if speed else 'неизвестно',
                    'eta': self.format_time(eta) if eta else 'неизвестно',
                    'downloaded': self.format_size(downloaded_bytes),
                    'total': self.format_size(total_bytes) if total_bytes else 'неизвестно',
                    'filename': os.path.basename(filename),
                }
                
                # Отправляем сигнал с прогрессом
                self.progress_signal.emit(progress_data)
                logger.debug(f"Прогресс: {percent:.1f}%, скорость: {progress_data['speed']}")
                
            except Exception as e:
                logger.error(f"Ошибка при обработке прогресса: {str(e)}")
                
        elif d['status'] == 'finished':
            # Скачивание завершено, отправляем сигнал
            progress_data = {
                'percent': 100,
                'speed': '0 B/s',
                'eta': '0',
                'downloaded': d.get('downloaded_bytes', 0),
                'total': d.get('total_bytes', 0),
                'filename': os.path.basename(d.get('filename', '')),
                'status': 'finished'
            }
            
            self.progress_signal.emit(progress_data)
            logger.info(f"Скачивание файла {d.get('filename', '')} завершено")
            
    def stop(self):
        """Останавливает скачивание"""
        self.stopped = True
        logger.info("Остановка скачивания...")
        
    def format_size(self, bytes_count):
        """Форматирует размер файла в человекочитаемый вид"""
        if bytes_count < 1024:
            return f"{bytes_count} B"
        elif bytes_count < 1024 * 1024:
            return f"{bytes_count / 1024:.1f} KB"
        elif bytes_count < 1024 * 1024 * 1024:
            return f"{bytes_count / (1024 * 1024):.1f} MB"
        else:
            return f"{bytes_count / (1024 * 1024 * 1024):.1f} GB"
            
    def format_time(self, seconds):
        """Форматирует время в человекочитаемый вид"""
        if seconds < 60:
            return f"{round(seconds)} сек"
        elif seconds < 3600:
            minutes = round(seconds // 60)
            remaining_seconds = round(seconds % 60)
            return f"{minutes} мин {remaining_seconds} сек"
        else:
            hours = round(seconds // 3600)
            minutes = round((seconds % 3600) // 60)
            return f"{hours} ч {minutes} мин"


class SelectionDialog(QDialog):
    def __init__(self, video_formats, threads=4, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Выбор качества видео и аудио")
        self.setMinimumWidth(600)
        self.setMinimumHeight(500)
        self.video_formats = video_formats
        self.threads = threads
        
        # Разделяем форматы на видео и аудио
        self.video_only_formats = []
        self.audio_only_formats = []
        
        # Используем метки формата для разделения
        for fmt in video_formats:
            format_type = fmt.get('format_type', '')
            
            if format_type == 'video_only':
                self.video_only_formats.append(fmt)
            elif format_type == 'audio_only':
                self.audio_only_formats.append(fmt)
        
        logger.info(f"Разделены форматы: только видео: {len(self.video_only_formats)}, только аудио: {len(self.audio_only_formats)}")
        
        # Сортируем видео форматы по разрешению (от высокого к низкому)
        self.video_only_formats.sort(
            key=lambda x: (
                int(x.get('height', 0) or 0), 
                int(x.get('width', 0) or 0),
                int(x.get('tbr', 0) or 0)
            ), 
            reverse=True
        )
        
        # Сортируем аудио форматы по битрейту (от высокого к низкому)
        self.audio_only_formats.sort(
            key=lambda x: float(x.get('abr', 0) or 0), 
            reverse=True
        )
        
        # Применяем стиль Apple
        self.setStyleSheet(f"""
            QWidget {{
                background-color: {APPLE_WHITE};
                color: {APPLE_BLACK};
            }}
            QPushButton {{
                background-color: {APPLE_BLUE};
                color: {APPLE_WHITE};
                border-radius: 6px;
                padding: 8px 16px;
                font-weight: bold;
                border: none;
            }}
            QPushButton:hover {{
                background-color: #0051D5;
            }}
            QPushButton:pressed {{
                background-color: #003CA6;
            }}
            QLineEdit, QComboBox, QSpinBox {{
                border: 1px solid {APPLE_GRAY};
                border-radius: 6px;
                padding: 8px;
                background-color: {APPLE_WHITE};
            }}
            QGroupBox {{
                border: 1px solid {APPLE_GRAY};
                border-radius: 6px;
                margin-top: 1em;
                padding-top: 10px;
            }}
            QGroupBox::title {{
                subcontrol-origin: margin;
                left: 10px;
                padding: 0 5px;
            }}
            QProgressBar {{
                border: none;
                border-radius: 5px;
                background-color: {APPLE_GRAY};
                text-align: center;
            }}
            QProgressBar::chunk {{
                background-color: {APPLE_BLUE};
                border-radius: 5px;
            }}
        """)
        
        # Основной контейнер с отступами
        main_layout = QVBoxLayout()
        main_layout.setContentsMargins(20, 20, 20, 20)
        main_layout.setSpacing(15)
        self.setLayout(main_layout)
        
        # Заголовок
        title_label = QLabel("Выберите качество видео и аудиодорожку")
        title_label.setStyleSheet(f"""
            font-size: 20px; 
            font-weight: bold; 
            margin-bottom: 10px; 
            color: {APPLE_BLACK};
        """)
        main_layout.addWidget(title_label)
        
        # Группа выбора видео
        video_group = QGroupBox("Качество видео")
        video_layout = QVBoxLayout()
        
        # Комбобокс для выбора видео
        self.video_combo_label = QLabel("Выберите качество видео:")
        video_layout.addWidget(self.video_combo_label)
        
        self.video_combo = QComboBox()
        self.video_combo.setMinimumHeight(30)
        self.video_combo.setStyleSheet("font-size: 14px;")
        video_layout.addWidget(self.video_combo)
        
        # Комбобокс для выбора аудио
        self.audio_combo_label = QLabel("Выберите аудиодорожку:")
        video_layout.addWidget(self.audio_combo_label)
        
        self.audio_combo = QComboBox()
        self.audio_combo.setMinimumHeight(30)
        self.audio_combo.setStyleSheet("font-size: 14px;")
        video_layout.addWidget(self.audio_combo)
        
        video_group.setLayout(video_layout)
        main_layout.addWidget(video_group)
        
        # Группа выбора директории
        dir_group = QGroupBox("Директория для сохранения")
        dir_layout = QHBoxLayout()
        
        self.dir_input = QLineEdit(os.path.expanduser("~/Downloads"))
        self.dir_input.setMinimumHeight(30)
        self.dir_input.setStyleSheet("font-size: 14px;")
        dir_layout.addWidget(self.dir_input, 1)
        
        browse_btn = QPushButton("Обзор")
        browse_btn.setMinimumHeight(30)
        browse_btn.clicked.connect(self.browse_directory)
        dir_layout.addWidget(browse_btn)
        
        dir_group.setLayout(dir_layout)
        main_layout.addWidget(dir_group)
        
        # Добавляем группу для ввода имени файла
        filename_group = QGroupBox("Имя файла (опционально)")
        filename_layout = QVBoxLayout()
        
        filename_label = QLabel("Введите имя файла (без расширения):")
        filename_layout.addWidget(filename_label)
        
        self.filename_input = QLineEdit()
        self.filename_input.setMinimumHeight(30)
        self.filename_input.setStyleSheet("font-size: 14px;")
        self.filename_input.setPlaceholderText("Оставьте пустым для имени по умолчанию")
        filename_layout.addWidget(self.filename_input)
        
        filename_group.setLayout(filename_layout)
        main_layout.addWidget(filename_group)
        
        # Группа настроек
        settings_group = QGroupBox("Настройки загрузки")
        settings_layout = QFormLayout()
        
        self.threads_spin = QSpinBox()
        self.threads_spin.setMinimumHeight(30)
        self.threads_spin.setStyleSheet("font-size: 14px;")
        self.threads_spin.setMinimum(1)
        self.threads_spin.setMaximum(16)
        self.threads_spin.setValue(self.threads)
        
        threads_label = QLabel("Количество потоков:")
        threads_label.setStyleSheet("font-size: 14px;")
        settings_layout.addRow(threads_label, self.threads_spin)
        
        settings_group.setLayout(settings_layout)
        main_layout.addWidget(settings_group)
        
        # Кнопки
        button_layout = QHBoxLayout()
        button_layout.addStretch()
        
        cancel_btn = QPushButton("Отмена")
        cancel_btn.setMinimumHeight(40)
        cancel_btn.setMinimumWidth(120)
        cancel_btn.setStyleSheet("font-size: 14px;")
        cancel_btn.clicked.connect(self.reject)
        button_layout.addWidget(cancel_btn)
        
        download_btn = QPushButton("Скачать")
        download_btn.setMinimumHeight(40)
        download_btn.setMinimumWidth(120)
        download_btn.setStyleSheet("font-size: 14px; font-weight: bold;")
        download_btn.clicked.connect(self.accept)
        download_btn.setDefault(True)
        button_layout.addWidget(download_btn)
        
        main_layout.addLayout(button_layout)
        
        # Заполняем комбобоксы
        self.update_format_lists()
        
    def update_format_lists(self):
        """Обновляет списки форматов видео и аудио"""
        self.video_combo.clear()
        self.audio_combo.clear()
        
        # Заполняем комбобокс только видео форматами
        for fmt in self.video_only_formats:
            resolution = fmt.get('resolution', 'unknown')
            format_id = fmt.get('format_id', 'unknown')
            ext = fmt.get('ext', 'unknown')
            tbr = fmt.get('tbr', 0)
            
            # Форматируем битрейт
            if tbr:
                tbr_str = f"{tbr:.1f} Kbps"
            else:
                tbr_str = "неизвестно"
                
            display_text = f"{resolution} - {tbr_str} - {ext} (ID: {format_id})"
            self.video_combo.addItem(display_text, fmt['format_id'])
            
        # Заполняем комбобокс только аудио форматами
        for fmt in self.audio_only_formats:
            format_id = fmt.get('format_id', 'unknown')
            ext = fmt.get('ext', 'unknown')
            bitrate = fmt.get('abr', 0)
            
            # Форматируем битрейт
            if bitrate:
                bitrate_str = f"{bitrate:.1f} kbps"
            else:
                bitrate_str = "неизвестно"
            
            # Проверяем, есть ли дополнительная информация о формате
            if 'format_note' in fmt:
                display_text = f"{fmt['format_note']} - {bitrate_str} - {ext} (ID: {format_id})"
            else:
                display_text = f"Аудио - {bitrate_str} - {ext} (ID: {format_id})"
                
            self.audio_combo.addItem(display_text, fmt['format_id'])
            
        logger.info(f"Обновлены списки форматов: видео {self.video_combo.count()}, аудио {self.audio_combo.count()}")
        
        # Если нет аудио форматов, добавляем заглушку
        if self.audio_combo.count() == 0:
            self.audio_combo.addItem("Нет доступных аудиодорожек", "none")
            logger.warning("Нет доступных аудиодорожек")
        
    def browse_directory(self):
        """Открывает диалог выбора директории для сохранения"""
        directory = QFileDialog.getExistingDirectory(
            self, 
            "Выберите директорию для сохранения", 
            self.dir_input.text(),
            QFileDialog.ShowDirsOnly
        )
        
        if directory:
            self.dir_input.setText(directory)
            logger.info(f"Выбрана директория для сохранения: {directory}")
        
    def get_selection(self):
        """Возвращает выбранный формат, директорию и количество потоков"""
        output_directory = self.dir_input.text()
        threads = self.threads_spin.value()
        custom_filename = self.filename_input.text().strip() or None
        
        # Проверяем наличие видео и аудио форматов
        if self.video_combo.count() > 0:
            video_format_id = self.video_combo.currentData()
            
            # Проверяем наличие аудио форматов
            if self.audio_combo.count() > 0 and self.audio_combo.currentData() != "none":
                audio_format_id = self.audio_combo.currentData()
                format_id = f"{video_format_id}+{audio_format_id}"
                logger.info(f"Выбраны форматы: видео {video_format_id}, аудио {audio_format_id}")
            else:
                # Если нет аудио форматов, используем только видео
                format_id = video_format_id
                logger.info(f"Выбран только видео формат: {video_format_id}")
        else:
            logger.warning("Нет доступных форматов видео")
            return None, None, None, None
            
        logger.info(f"Итоговый выбор: формат {format_id}, директория {output_directory}, потоки {threads}")
        return format_id, output_directory, threads, custom_filename


class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        
        self.setWindowTitle("Скачивание видео")
        self.setMinimumSize(800, 600)
        
        # Применяем стиль Apple
        self.setStyleSheet(f"""
            QWidget {{
                background-color: {APPLE_WHITE};
                color: {APPLE_BLACK};
            }}
            QPushButton {{
                background-color: {APPLE_BLUE};
                color: {APPLE_WHITE};
                border-radius: 6px;
                padding: 8px 16px;
                font-weight: bold;
                border: none;
            }}
            QPushButton:hover {{
                background-color: #0051D5;
            }}
            QPushButton:pressed {{
                background-color: #003CA6;
            }}
            QLineEdit, QComboBox, QSpinBox {{
                border: 1px solid {APPLE_GRAY};
                border-radius: 6px;
                padding: 8px;
                background-color: {APPLE_WHITE};
            }}
            QGroupBox {{
                border: 1px solid {APPLE_GRAY};
                border-radius: 6px;
                margin-top: 1em;
                padding-top: 10px;
            }}
            QGroupBox::title {{
                subcontrol-origin: margin;
                left: 10px;
                padding: 0 5px;
            }}
            QProgressBar {{
                border: none;
                border-radius: 5px;
                background-color: {APPLE_GRAY};
                text-align: center;
            }}
            QProgressBar::chunk {{
                background-color: {APPLE_BLUE};
                border-radius: 5px;
            }}
        """)
        
        # Включаем поддержку перетаскивания файлов
        self.setAcceptDrops(True)
        
        # Создаем центральный виджет
        central_widget = QWidget()
        self.setCentralWidget(central_widget)
        
        # Основной контейнер с отступами
        main_layout = QVBoxLayout()
        main_layout.setContentsMargins(20, 20, 20, 20)
        main_layout.setSpacing(15)
        central_widget.setLayout(main_layout)
        
        # Заголовок
        title_label = QLabel("Скачивание видео")
        title_label.setStyleSheet(f"""
            font-size: 24px; 
            font-weight: bold; 
            margin-bottom: 10px; 
            color: {APPLE_BLACK};
        """)
        main_layout.addWidget(title_label)
        
        # Группа ввода URL
        url_group = QGroupBox("URL видео или файл плейлиста")
        url_layout = QHBoxLayout()
        
        self.url_input = QLineEdit()
        self.url_input.setPlaceholderText("Введите URL видео или выберите файл плейлиста")
        self.url_input.setMinimumHeight(40)
        self.url_input.setStyleSheet("font-size: 14px;")
        url_layout.addWidget(self.url_input, 1)
        
        browse_btn = QPushButton("Обзор")
        browse_btn.setMinimumHeight(40)
        browse_btn.setMinimumWidth(100)
        browse_btn.clicked.connect(self.browse_file)
        url_layout.addWidget(browse_btn)
        
        url_group.setLayout(url_layout)
        main_layout.addWidget(url_group)
        
        # Кнопка скачивания
        self.download_btn = QPushButton("Выбрать формат и скачать")
        self.download_btn.setMinimumHeight(50)
        self.download_btn.setStyleSheet("font-size: 16px; font-weight: bold;")
        self.download_btn.clicked.connect(self.start_download)
        main_layout.addWidget(self.download_btn)
        
        # Прогресс-бар
        self.progress_bar = QProgressBar()
        self.progress_bar.setMinimumHeight(30)
        self.progress_bar.setTextVisible(True)
        self.progress_bar.setAlignment(Qt.AlignCenter)
        self.progress_bar.setStyleSheet("font-size: 14px;")
        main_layout.addWidget(self.progress_bar)
        
        # Статус
        self.status_label = QLabel("Готов к загрузке")
        self.status_label.setStyleSheet("font-size: 14px;")
        main_layout.addWidget(self.status_label)
        
        # Лог
        log_group = QGroupBox("Журнал событий")
        log_layout = QVBoxLayout()
        
        self.log_widget = QTextEditLogger()
        self.log_widget.setFormatter(logging.Formatter('%(asctime)s - %(levelname)s - %(message)s'))
        self.log_widget.widget.setReadOnly(True)
        self.log_widget.widget.setMinimumHeight(200)
        
        # Добавляем обработчик логов
        logger.addHandler(self.log_widget)
        logger.setLevel(logging.INFO)  # Устанавливаем уровень логирования
        
        log_layout.addWidget(self.log_widget.widget)
        log_group.setLayout(log_layout)
        main_layout.addWidget(log_group)
        
        # Инициализация переменных
        self.format_fetcher = None
        self.downloader = None
        
        logger.info("Приложение запущено")
        
    def browse_file(self):
        """Открывает диалог выбора файла плейлиста"""
        file_path, _ = QFileDialog.getOpenFileName(
            self, 
            "Выберите файл плейлиста", 
            "", 
            "Файлы плейлистов (*.m3u *.m3u8);;Все файлы (*)"
        )
        
        if file_path:
            self.url_input.setText(file_path)
            logger.info(f"Выбран файл: {file_path}")
            
    def start_download(self):
        """Начинает процесс скачивания"""
        url = self.url_input.text().strip()
        
        if not url:
            QMessageBox.warning(self, "Предупреждение", "Введите URL видео или выберите файл плейлиста")
            return
            
        logger.info(f"Начинаем обработку: {url}")
        
        # Получаем доступные форматы
        self.download_btn.setEnabled(False)
        self.status_label.setText("Получение доступных форматов...")
        
        self.format_fetcher = FormatFetcher(url)
        self.format_fetcher.formats_ready.connect(self.on_formats_ready)
        self.format_fetcher.error_signal.connect(self.on_format_fetch_error)
        self.format_fetcher.start()
        
    def on_formats_ready(self, formats):
        """Обрабатывает полученные форматы видео"""
        logger.info(f"Получено {len(formats)} форматов")
        
        # Показываем диалог выбора формата
        dialog = SelectionDialog(formats, 4, self)  # Устанавливаем значение по умолчанию
        result = dialog.exec_()
        
        if result == QDialog.Accepted:
            format_id, output_dir, threads, custom_filename = dialog.get_selection()
            
            if format_id:
                logger.info(f"Выбран формат: {format_id}, директория: {output_dir}, потоки: {threads}")
                self.download_video(self.url_input.text().strip(), format_id, output_dir, threads, custom_filename)
            else:
                logger.warning("Не выбран формат для скачивания")
                self.download_btn.setEnabled(True)
                self.status_label.setText("Формат не выбран")
        else:
            logger.info("Отменен выбор формата")
            self.download_btn.setEnabled(True)
            self.status_label.setText("Отменено пользователем")
            
    def on_format_fetch_error(self, error_message):
        """Обрабатывает ошибку получения форматов"""
        logger.error(f"Ошибка получения форматов: {error_message}")
        self.download_btn.setEnabled(True)
        self.status_label.setText("Ошибка получения форматов")
        QMessageBox.critical(self, "Ошибка", f"Не удалось получить форматы видео: {error_message}")
        
    def download_video(self, url, format_id, output_dir, threads, custom_filename=None):
        """Запускает скачивание видео"""
        logger.info(f"Начинаем скачивание: {url}, формат: {format_id}, директория: {output_dir}")
        
        self.status_label.setText("Подготовка к скачиванию...")
        self.progress_bar.setValue(0)
        
        self.downloader = VideoDownloader(url, format_id, output_dir, threads, custom_filename=custom_filename)
        self.downloader.progress_signal.connect(self.update_progress)
        self.downloader.error_signal.connect(self.on_download_error)
        self.downloader.retry_signal.connect(self.on_download_retry)
        self.downloader.finished_signal.connect(self.on_download_finished)
        self.downloader.start()
    
    def update_progress(self, progress_data):
        """Обновляет прогресс-бар и статус загрузки"""
        self.progress_bar.setValue(int(progress_data['percent']))
        self.status_label.setText(f"Скачивание: {progress_data['percent']:.1f}% | Скорость: {progress_data['speed']} | Осталось: {progress_data['eta']}")
    
    def on_download_error(self, error_message):
        """Обработка ошибки загрузки"""
        self.download_btn.setEnabled(True)
        self.progress_bar.setValue(0)
        self.status_label.setText("Ошибка загрузки")
        QMessageBox.critical(self, "Ошибка", f"Ошибка при загрузке видео: {error_message}")
    
    def on_download_retry(self, message, retry_count):
        """Обработка повторной попытки загрузки"""
        self.status_label.setText(f"Повторная попытка {retry_count}: {message}")
        logger.info(f"Повторная попытка {retry_count}: {message}")
    
    def on_download_finished(self, message, elapsed_time):
        """Обработка завершения загрузки"""
        self.download_btn.setEnabled(True)
        
        # Форматируем затраченное время
        time_str = self.downloader.format_time(elapsed_time) if self.downloader else f"{elapsed_time:.1f} сек"
        
        # Показываем сообщение об успешном скачивании
        self.progress_bar.setValue(100)
        self.status_label.setText(f"Загрузка завершена за {time_str}")
        
        QMessageBox.information(self, "Успех", f"Видео успешно скачано за {time_str}")
        logger.info("Видео успешно скачано")
        
    def closeEvent(self, event):
        """Обрабатывает закрытие окна"""
        # Останавливаем все активные потоки
        if self.downloader and self.downloader.isRunning():
            self.downloader.stop()
            
        event.accept()
        
    def dragEnterEvent(self, event):
        """Обрабатывает начало перетаскивания файла"""
        if event.mimeData().hasUrls():
            event.acceptProposedAction()
            
    def dropEvent(self, event):
        """Обрабатывает сброс файла в окно приложения"""
        urls = event.mimeData().urls()
        if urls and urls[0].isLocalFile():
            file_path = urls[0].toLocalFile()
            # Проверяем расширение файла
            if file_path.lower().endswith(('.m3u', '.m3u8')):
                self.url_input.setText(file_path)
                logger.info(f"Файл перетащен в приложение: {file_path}")
            else:
                logger.warning(f"Неподдерживаемый тип файла: {file_path}")
                QMessageBox.warning(self, "Предупреждение", "Поддерживаются только файлы .m3u и .m3u8")


class QTextEditLogger(logging.Handler):
    def __init__(self):
        super().__init__()
        self.widget = QTextEdit()
        self.widget.setReadOnly(True)
        
    def emit(self, record):
        msg = self.format(record)
        self.widget.append(msg)


def main():
    try:
        # Определяем базовую директорию приложения
        if getattr(sys, 'frozen', False):
            # Если приложение запущено как скомпилированный бинарный файл
            base_dir = os.path.dirname(sys.executable)
            if sys.platform == 'darwin':
                # На macOS в .app пакете путь будет отличаться
                app_dir = os.path.abspath(os.path.join(os.path.dirname(sys.executable), '..', '..', '..'))
                frameworks_dir = os.path.abspath(os.path.join(os.path.dirname(sys.executable), '..', 'Frameworks'))
                resources_dir = os.path.abspath(os.path.join(os.path.dirname(sys.executable), '..', 'Resources'))
                
                # Настраиваем логирование в файл внутри пакета приложения
                log_file = os.path.join(os.path.dirname(sys.executable), 'video_downloader.log')
                file_handler = logging.FileHandler(log_file)
                file_handler.setFormatter(logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s'))
                logger.addHandler(file_handler)
                
                # Проверяем наличие ffmpeg в разных директориях пакета приложения
                ffmpeg_paths = [
                    os.path.join(os.path.dirname(sys.executable), 'ffmpeg'),  # MacOS
                    os.path.join(resources_dir, 'ffmpeg'),                    # Resources
                    os.path.join(frameworks_dir, 'ffmpeg')                    # Frameworks
                ]
                
                ffmpeg_found = False
                for ffmpeg_path in ffmpeg_paths:
                    if os.path.exists(ffmpeg_path):
                        logger.info(f"Найден ffmpeg в пакете приложения: {ffmpeg_path}")
                        # Добавляем директорию с ffmpeg в PATH
                        os.environ["PATH"] = os.path.dirname(ffmpeg_path) + os.pathsep + os.environ.get("PATH", "")
                        # Устанавливаем права на выполнение, если это необходимо
                        try:
                            os.chmod(ffmpeg_path, 0o755)
                            logger.info("Установлены права на выполнение для ffmpeg")
                        except Exception as e:
                            logger.warning(f"Не удалось установить права на выполнение для ffmpeg: {e}")
                        
                        # Явно указываем путь к ffmpeg для yt-dlp
                        os.environ["FFMPEG_LOCATION"] = ffmpeg_path
                        logger.info(f"Установлена переменная FFMPEG_LOCATION: {ffmpeg_path}")
                        
                        ffmpeg_found = True
                        break
                
                if not ffmpeg_found:
                    logger.warning("ffmpeg не найден в пакете приложения")
            else:
                app_dir = base_dir
                frameworks_dir = base_dir
                
                # Добавляем путь к ffmpeg в PATH
                ffmpeg_path = os.path.join(base_dir, 'ffmpeg')
                if os.path.exists(ffmpeg_path):
                    logger.info(f"Найден ffmpeg в пакете приложения: {ffmpeg_path}")
                    os.environ["PATH"] = os.path.dirname(ffmpeg_path) + os.pathsep + os.environ.get("PATH", "")
                    try:
                        os.chmod(ffmpeg_path, 0o755)
                    except Exception as e:
                        logger.warning(f"Не удалось установить права на выполнение для ffmpeg: {e}")
                    
                    # Явно указываем путь к ffmpeg для yt-dlp
                    os.environ["FFMPEG_LOCATION"] = ffmpeg_path
                    logger.info(f"Установлена переменная FFMPEG_LOCATION: {ffmpeg_path}")
                else:
                    logger.warning(f"ffmpeg не найден в пакете приложения: {ffmpeg_path}")
        else:
            # Если приложение запущено как скрипт
            app_dir = os.path.dirname(os.path.abspath(__file__))
            frameworks_dir = app_dir
            
            # Проверяем наличие ffmpeg в системе
            try:
                subprocess.run(['ffmpeg', '-version'], stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
                logger.info("Найден системный ffmpeg")
            except (subprocess.SubprocessError, FileNotFoundError):
                logger.warning("Системный ffmpeg не найден")
                # Проверяем наличие ffmpeg в директории проекта
                ffmpeg_path = os.path.join(app_dir, 'bin', 'ffmpeg')
                if os.path.exists(ffmpeg_path):
                    logger.info(f"Найден ffmpeg в директории проекта: {ffmpeg_path}")
                    os.environ["PATH"] = os.path.dirname(ffmpeg_path) + os.pathsep + os.environ.get("PATH", "")
                    try:
                        os.chmod(ffmpeg_path, 0o755)
                    except Exception as e:
                        logger.warning(f"Не удалось установить права на выполнение для ffmpeg: {e}")
                    
                    # Явно указываем путь к ffmpeg для yt-dlp
                    os.environ["FFMPEG_LOCATION"] = ffmpeg_path
                    logger.info(f"Установлена переменная FFMPEG_LOCATION: {ffmpeg_path}")
                else:
                    logger.warning(f"ffmpeg не найден в директории проекта: {ffmpeg_path}")
        
        logger.info(f"Запуск приложения Video Downloader")
        logger.info(f"Приложение запущено. Базовая директория: {app_dir}")
        logger.info(f"PATH: {os.environ.get('PATH', '')}")
        logger.info(f"FFMPEG_LOCATION: {os.environ.get('FFMPEG_LOCATION', '')}")
        
        # Создаем временную директорию для загрузок, если она не существует
        temp_dir = os.path.join(frameworks_dir, "temp_downloads")
        os.makedirs(temp_dir, exist_ok=True)
        logger.info(f"Временная директория для загрузок: {temp_dir}")
        
        app = QApplication(sys.argv)
        
        # Устанавливаем глобальный стиль для всего приложения
        app.setStyle("Fusion")
        logger.info("Установлен стиль Fusion")
        
        # Устанавливаем шрифт для всего приложения
        # Используем стандартные шрифты, которые точно есть в системе
        try:
            font = QFont("Helvetica", 10)
            app.setFont(font)
            logger.info("Установлен шрифт: Helvetica")
        except Exception as e:
            logger.warning(f"Не удалось установить шрифт Helvetica: {e}")
            # Используем системный шрифт по умолчанию
            logger.info("Используется системный шрифт по умолчанию")
        
        # Устанавливаем палитру цветов
        try:
            palette = QPalette()
            palette.setColor(QPalette.Window, QColor(APPLE_WHITE))
            palette.setColor(QPalette.WindowText, QColor(APPLE_BLACK))
            palette.setColor(QPalette.Base, QColor(APPLE_WHITE))
            palette.setColor(QPalette.AlternateBase, QColor(APPLE_GRAY))
            palette.setColor(QPalette.Text, QColor(APPLE_BLACK))
            palette.setColor(QPalette.Button, QColor(APPLE_BLUE))
            palette.setColor(QPalette.ButtonText, QColor(APPLE_WHITE))
            palette.setColor(QPalette.Highlight, QColor(APPLE_BLUE))
            palette.setColor(QPalette.HighlightedText, QColor(APPLE_WHITE))
            app.setPalette(palette)
            logger.info("Установлена цветовая палитра в стиле Apple")
        except Exception as e:
            logger.warning(f"Не удалось установить цветовую палитру: {e}")
        
        window = MainWindow()
        window.show()
        
        sys.exit(app.exec_())
    except Exception as e:
        logger.error(f"Ошибка при запуске приложения: {e}")
        logger.error(traceback.format_exc())
        # Если произошла ошибка, показываем диалоговое окно с информацией
        try:
            app = QApplication.instance()
            if not app:
                app = QApplication(sys.argv)
            
            error_dialog = QMessageBox()
            error_dialog.setIcon(QMessageBox.Critical)
            error_dialog.setWindowTitle("Ошибка")
            error_dialog.setText("Произошла ошибка при запуске приложения")
            error_dialog.setDetailedText(f"{e}\n\n{traceback.format_exc()}")
            error_dialog.setStandardButtons(QMessageBox.Ok)
            error_dialog.exec_()
        except Exception as dialog_error:
            print(f"Не удалось показать диалоговое окно с ошибкой: {dialog_error}")
            print(f"Исходная ошибка: {e}")
            print(traceback.format_exc())
if __name__ == "__main__":
    try:
        # Настраиваем обработку исключений
        import traceback
        sys.excepthook = lambda exctype, excvalue, exctraceback: logger.error(
            "Необработанное исключение", 
            exc_info=(exctype, excvalue, exctraceback)
        )
        
        sys.exit(main())
    except Exception as e:
        logger.error(f"Необработанное исключение: {e}", exc_info=True)
        sys.exit(1)
