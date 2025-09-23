"""Инструменты для работы с плейлистами M3U8."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict, Optional

# Ensure common FFmpeg paths are in PATH
current_path = os.environ.get('PATH', '')
homebrew_paths = ['/opt/homebrew/bin', '/usr/local/bin']
for path in homebrew_paths:
    if path not in current_path and os.path.isdir(path):
        os.environ['PATH'] = f"{path}:{current_path}"

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
    return filename if filename.lower().endswith('.mp4') else f"{filename}.mp4"


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
        '-threads', str(max(1, min(threads, 16))),
    ]

    if video_track:
        command.extend(['-i', video_track.get('url', master)])
    else:
        command.extend(['-i', master])

    if audio_track and audio_track.get('url'):
        command.extend(['-i', audio_track['url']])
        command.extend(['-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'copy'])
    else:
        command.extend(['-c', 'copy'])

    command.append(str(output_path))

    # Print progress updates
    print_progress({"progress": 20, "status": "Запуск FFmpeg..."})

    try:
        process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)

        # Monitor progress
        stderr_output = []
        while True:
            stderr_line = process.stderr.readline()
            if stderr_line:
                stderr_output.append(stderr_line.strip())
                # Look for FFmpeg progress indicators
                if "time=" in stderr_line:
                    print_progress({"progress": 60, "status": "Обработка видео..."})
                elif "video:" in stderr_line and "audio:" in stderr_line:
                    print_progress({"progress": 90, "status": "Финализация..."})
            elif process.poll() is not None:
                break

        # Wait for process to complete
        process.wait()

        if process.returncode != 0:
            stderr_full = '\n'.join(stderr_output)
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

    video_track = None
    if video_index is not None and 0 <= video_index < len(parsed.get('video', [])):
        video_track = parsed['video'][video_index]

    audio_track = None
    if audio_index is not None and 0 <= audio_index < len(parsed.get('audio', [])):
        audio_track = parsed['audio'][audio_index]

    clean_name = sanitize_filename(filename)

    result = download_with_ffmpeg(path, video_track, audio_track, output_dir, clean_name, threads)
    print_json(result)


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

    args = parser.parse_args(argv)

    try:
        if args.command == 'get-tracks':
            get_tracks_command(args.source)
        elif args.command == 'download':
            download_command(args.source, args.video, args.audio, args.output_dir, args.filename, args.threads)
        else:
            raise ValueError('Неизвестная команда')
    except Exception as exc:
        print_json({"success": False, "error": str(exc)})
        sys.exit(1)


if __name__ == '__main__':
    main()
