"""Инструменты для работы с плейлистами M3U8."""

from __future__ import annotations

import argparse
import argparse
import json
import os
import shutil
import subprocess
import sys
from collections import deque
from pathlib import Path
from typing import Any, Dict, Optional
from urllib.parse import urlparse

# Ensure common FFmpeg paths are in PATH
current_path = os.environ.get('PATH', '')
homebrew_paths = ['/opt/homebrew/bin', '/usr/local/bin']
get_uid = getattr(os, 'getuid', lambda: 0)
trusted_paths = []
for candidate in homebrew_paths:
    if candidate in current_path:
        continue
    if not os.path.isdir(candidate):
        continue
    try:
        stat = os.stat(candidate)
    except OSError:
        continue
    # Добавляем только директории, принадлежащие root или текущему пользователю
    if stat.st_uid in {0, get_uid()}:
        trusted_paths.append(candidate)

if trusted_paths:
    os.environ['PATH'] = os.pathsep.join(trusted_paths + [current_path])

from utils import parse_m3u8_content, read_m3u8_source, sanitize_filename


def print_json(data: Dict[str, Any]) -> None:
    # Redirect any accidental prints to stderr
    import sys
    json.dump(data, sys.stdout, ensure_ascii=False, separators=(',', ':'))
    sys.stdout.write("\n")
    sys.stdout.flush()

def print_progress(data: Dict[str, Any]) -> None:
    # Send progress updates to stderr so they don't interfere with final result JSON
    import sys
    progress_line = "PROGRESS:" + json.dumps(data, ensure_ascii=False, separators=(',', ':'))
    sys.stderr.write(progress_line + "\n")
    sys.stderr.flush()


def get_tracks_command(path: str) -> None:
    content, base_url = read_m3u8_source(path)
    parsed = parse_m3u8_content(content, base_url)

    response = {
        "video": parsed.get("video", []),
        "audio": parsed.get("audio", []),
        "subtitles": parsed.get("subtitles", []),
    }
    print_json({"success": True, "tracks": response})


def _ensure_extension(filename: str) -> str:
    path = Path(filename)
    if path.suffix:
        return filename
    return f"{filename}.mp4"


def download_with_ffmpeg(master: str, video_track: Optional[Dict[str, Any]], audio_track: Optional[Dict[str, Any]],
                          output_dir: str, filename: str, threads: int) -> Dict[str, Any]:
    # Try to find FFmpeg in multiple locations
    ffmpeg_candidates = [
        'ffmpeg',  # System PATH
        '/usr/local/bin/ffmpeg',  # Homebrew default
        '/opt/homebrew/bin/ffmpeg',  # Homebrew ARM64
        '/usr/bin/ffmpeg',  # System default
    ]

    ffmpeg_path = None
    for candidate in ffmpeg_candidates:
        if shutil.which(candidate):
            ffmpeg_path = candidate
            break

    if not ffmpeg_path:
        return {
            "success": False,
            "error": "FFmpeg не найден в системе. Установите FFmpeg через Homebrew: 'brew install ffmpeg' или скачайте с https://ffmpeg.org"
        }

    output_dir_path = Path(output_dir).expanduser()
    output_dir_path.mkdir(parents=True, exist_ok=True)

    output_path = output_dir_path / _ensure_extension(filename)

    command = [
        ffmpeg_path,
        '-y',
        '-nostdin',
        '-threads', str(max(1, min(threads, 16))),
    ]

    input_descriptors = []

    if video_track and video_track.get('url'):
        input_descriptors.append(('video', video_track['url']))
    else:
        input_descriptors.append(('video', master))

    if audio_track and audio_track.get('url'):
        input_descriptors.append(('audio', audio_track['url']))

    for _type, source in input_descriptors:
        command.extend(['-i', source])

    maps = []
    if input_descriptors and input_descriptors[0][0] == 'video':
        maps.append(('v', 0))

    audio_input_index = None
    for index, (descriptor_type, _) in enumerate(input_descriptors):
        if descriptor_type == 'audio':
            audio_input_index = index
            break

    if audio_input_index is not None:
        command.extend(['-map', f'{audio_input_index}:a:0'])
        if maps:
            command.extend(['-map', f'{maps[0][1]}:v:0'])
        command.extend(['-c:v', 'copy', '-c:a', 'copy'])
    else:
        command.extend(['-c', 'copy'])

    command.extend(['-progress', 'pipe:2', '-nostats'])
    command.append(str(output_path))

    # Print progress updates
    print_progress({"progress": 5, "status": "Подготовка FFmpeg"})

    try:
        process = subprocess.Popen(
            command,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
        )

        stderr_tail = deque(maxlen=50)
        progress_value = 10
        last_reported = 0

        while True:
            stderr_line = process.stderr.readline()
            if not stderr_line:
                if process.poll() is not None:
                    break
                continue

            line = stderr_line.strip()
            if not line:
                continue

            stderr_tail.append(line)

            if line.startswith('out_time_ms='):
                try:
                    out_time_ms = int(line.split('=', 1)[1])
                    # Принимаем, что 1 минута ≈ 100% для отсутствия информации о длительности
                    normalized = min(1.0, out_time_ms / (60 * 60 * 1000000))
                    progress_value = max(progress_value, 20 + int(normalized * 70))
                except ValueError:
                    continue
            elif line.startswith('progress='):
                status = line.split('=', 1)[1]
                if status == 'continue':
                    if progress_value - last_reported >= 1:
                        last_reported = progress_value
                        print_progress({"progress": progress_value, "status": "Загрузка сегментов..."})
                elif status == 'end':
                    progress_value = 100
                    print_progress({"progress": progress_value, "status": "Финализация"})

        process.wait()

        if process.returncode != 0:
            stderr_full = '\n'.join(stderr_tail)
            return {
                "success": False,
                "error": stderr_full.strip() or "FFmpeg завершился с ошибкой",
            }

        print_progress({"progress": 100, "status": "Готово"})
        return {
            "success": True,
            "output_path": str(output_path),
        }
    except Exception as e:
        return {
            "success": False,
            "error": f"Ошибка выполнения FFmpeg: {str(e)}",
        }


def download_command(path: str, video_index: Optional[int], audio_index: Optional[int],
                     output_dir: str, filename: str, threads: int) -> None:
    content, base_url = read_m3u8_source(path)
    parsed = parse_m3u8_content(content, base_url)

    videos = parsed.get('video', [])
    audios = parsed.get('audio', [])

    video_track = None
    if video_index is not None:
        if not (0 <= video_index < len(videos)):
            raise ValueError('Некорректный индекс видео дорожки')
        video_track = videos[video_index]

    audio_track = None
    if audio_index is not None:
        if not (0 <= audio_index < len(audios)):
            raise ValueError('Некорректный индекс аудио дорожки')
        audio_track = audios[audio_index]

    if audio_track:
        reference_url = video_track.get('url') if video_track else path
        master_netloc = urlparse(reference_url or '').netloc
        audio_netloc = urlparse(audio_track.get('url', '')).netloc
        if audio_netloc and master_netloc and audio_netloc != master_netloc:
            raise ValueError('Домен аудио дорожки не совпадает с доменом видео')

    clean_name = sanitize_filename(filename)

    result = download_with_ffmpeg(path, video_track, audio_track, output_dir, clean_name, threads)
    print_json(result)


def check_ffmpeg_command() -> None:
    ffmpeg_path = shutil.which('ffmpeg')
    if not ffmpeg_path:
        print_json({"success": False, "error": "FFmpeg не найден в PATH"})
        sys.exit(1)

    try:
        completed = subprocess.run([ffmpeg_path, '-version'], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    except (OSError, subprocess.CalledProcessError) as exc:
        print_json({"success": False, "error": f"Не удалось запустить FFmpeg: {exc}"})
        sys.exit(1)

    print_json({
        "success": True,
        "path": ffmpeg_path,
        "version": completed.stdout.splitlines()[0] if completed.stdout else 'unknown'
    })


def main(argv: Optional[list] = None) -> None:
    parser = argparse.ArgumentParser(description='M3U8 helper')
    subparsers = parser.add_subparsers(dest='command', required=True)

    tracks_parser = subparsers.add_parser('get-tracks', help='Получить информацию о дорожках')
    tracks_parser.add_argument('source', help='Путь к файлу или URL M3U8')

    download_parser = subparsers.add_parser('download', help='Скачать выбранные дорожки')
    download_parser.add_argument('source', help='Путь к файлу или URL M3U8')
    download_parser.add_argument('--video', type=int, default=None, help='Индекс видео дорожки')
    download_parser.add_argument('--audio', type=int, default=None, help='Индекс аудио дорожки')
    download_parser.add_argument('--output-dir', required=True, help='Каталог сохранения файла')
    download_parser.add_argument('--filename', required=True, help='Имя итогового файла')
    download_parser.add_argument('--threads', type=int, default=4, help='Количество потоков для FFmpeg')

    subparsers.add_parser('check-ffmpeg', help='Проверить доступность FFmpeg')

    args = parser.parse_args(argv)

    try:
        if args.command == 'get-tracks':
            get_tracks_command(args.source)
        elif args.command == 'download':
            download_command(args.source, args.video, args.audio, args.output_dir, args.filename, args.threads)
        elif args.command == 'check-ffmpeg':
            check_ffmpeg_command()
        else:
            raise ValueError('Неизвестная команда')
    except Exception as exc:
        print_json({"success": False, "error": str(exc)})
        sys.exit(1)


if __name__ == '__main__':
    main()
