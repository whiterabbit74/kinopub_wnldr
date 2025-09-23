#!/usr/bin/env python3
"""
M3U8 Video Downloader
A Python script for downloading video streams from M3U8 playlists.
"""

import sys
import os
import json
import requests
import subprocess
import threading
import time
from urllib.parse import urljoin, urlparse
from pathlib import Path
import tempfile
import shutil
from concurrent.futures import ThreadPoolExecutor, as_completed

from utils import parse_m3u8_content, is_url


class DownloadProgress:
    """Thread-safe progress tracking"""

    def __init__(self, total_segments=0):
        self.total_segments = total_segments
        self.completed_segments = 0
        self.lock = threading.Lock()

    def update(self, completed=1):
        with self.lock:
            self.completed_segments += completed
            if self.total_segments > 0:
                percent = (self.completed_segments / self.total_segments) * 100
                return min(percent, 100)
            return 0

    def get_progress(self):
        with self.lock:
            if self.total_segments > 0:
                return min((self.completed_segments / self.total_segments) * 100, 100)
            return 0


class M3U8Downloader:
    """Main downloader class for handling M3U8 playlist downloads"""

    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        })
        self.progress_callback = None
        self.should_stop = False

    def set_progress_callback(self, callback):
        """Set callback function for progress updates"""
        self.progress_callback = callback

    def stop_download(self):
        """Stop the current download"""
        self.should_stop = True

    def get_tracks_info(self, m3u8_path):
        """Extract track information from M3U8 file"""
        try:
            if not os.path.exists(m3u8_path):
                raise FileNotFoundError(f"M3U8 file not found: {m3u8_path}")

            with open(m3u8_path, 'r', encoding='utf-8') as f:
                content = f.read()

            tracks = parse_m3u8_content(content)

            if not tracks:
                # If no variants found, treat as single track
                tracks = [{
                    'url': m3u8_path,
                    'resolution': 'Unknown',
                    'bandwidth': 'Unknown',
                    'codec': 'Unknown'
                }]

            return tracks

        except Exception as e:
            raise Exception(f"Failed to parse M3U8 file: {str(e)}")

    def download_segment(self, segment_url, output_path, base_url=None, max_retries=3):
        """Download a single segment with retry logic"""
        for attempt in range(max_retries):
            try:
                if self.should_stop:
                    return False

                # Resolve relative URLs
                if base_url and not is_url(segment_url):
                    segment_url = urljoin(base_url, segment_url)

                response = self.session.get(segment_url, timeout=30, stream=True)
                response.raise_for_status()

                with open(output_path, 'wb') as f:
                    for chunk in response.iter_content(chunk_size=8192):
                        if self.should_stop:
                            return False
                        if chunk:
                            f.write(chunk)

                return True

            except Exception as e:
                if attempt < max_retries - 1:
                    time.sleep(2 ** attempt)  # Exponential backoff
                    continue
                else:
                    print(f"Failed to download segment {segment_url}: {str(e)}")
                    return False

        return False

    def get_segments_from_playlist(self, playlist_url_or_path, base_url=None):
        """Extract segment URLs from a playlist"""
        segments = []

        try:
            if is_url(playlist_url_or_path):
                response = self.session.get(playlist_url_or_path, timeout=30)
                response.raise_for_status()
                content = response.text
                if not base_url:
                    base_url = '/'.join(playlist_url_or_path.split('/')[:-1]) + '/'
            else:
                with open(playlist_url_or_path, 'r', encoding='utf-8') as f:
                    content = f.read()
                if not base_url:
                    base_url = os.path.dirname(os.path.abspath(playlist_url_or_path)) + '/'

            lines = content.strip().split('\n')
            for line in lines:
                line = line.strip()
                if line and not line.startswith('#'):
                    # This is a segment URL
                    if is_url(line):
                        segments.append(line)
                    elif base_url:
                        if is_url(base_url):
                            segments.append(urljoin(base_url, line))
                        else:
                            segments.append(os.path.join(base_url, line))
                    else:
                        segments.append(line)

        except Exception as e:
            raise Exception(f"Failed to parse playlist: {str(e)}")

        return segments

    def download_video(self, m3u8_path, track_index, output_dir, filename):
        """Download video from M3U8 playlist"""
        try:
            # Get track information
            tracks = self.get_tracks_info(m3u8_path)

            if track_index >= len(tracks):
                raise ValueError(f"Track index {track_index} out of range")

            selected_track = tracks[track_index]
            playlist_url = selected_track['url']

            # Determine base URL for resolving relative paths
            if is_url(playlist_url):
                base_url = '/'.join(playlist_url.split('/')[:-1]) + '/'
            else:
                # For local files, use the directory of the M3U8 file
                base_url = os.path.dirname(os.path.abspath(m3u8_path)) + '/'

            # Get segments
            segments = self.get_segments_from_playlist(playlist_url, base_url)

            if not segments:
                raise Exception("No video segments found in playlist")

            # Create progress tracker
            progress = DownloadProgress(len(segments))

            # Create temporary directory for segments
            with tempfile.TemporaryDirectory() as temp_dir:
                segment_files = []

                # Download segments with threading
                with ThreadPoolExecutor(max_workers=4) as executor:
                    future_to_index = {}

                    for i, segment_url in enumerate(segments):
                        if self.should_stop:
                            break

                        segment_filename = f"segment_{i:06d}.ts"
                        segment_path = os.path.join(temp_dir, segment_filename)

                        future = executor.submit(
                            self.download_segment,
                            segment_url,
                            segment_path,
                            base_url
                        )
                        future_to_index[future] = (i, segment_path)

                    # Collect results
                    downloaded_segments = {}
                    for future in as_completed(future_to_index):
                        if self.should_stop:
                            break

                        index, segment_path = future_to_index[future]
                        success = future.result()

                        if success:
                            downloaded_segments[index] = segment_path

                        # Update progress
                        percent = progress.update()
                        if self.progress_callback:
                            self.progress_callback(percent)

                if self.should_stop:
                    return {"success": False, "error": "Download cancelled"}

                # Sort segments by index
                segment_files = [downloaded_segments[i] for i in sorted(downloaded_segments.keys()) if i in downloaded_segments]

                if not segment_files:
                    raise Exception("No segments were downloaded successfully")

                # Ensure output directory exists
                os.makedirs(output_dir, exist_ok=True)

                # Prepare output filename
                if not filename.endswith('.mp4'):
                    filename += '.mp4'

                output_path = os.path.join(output_dir, filename)

                # Check if ffmpeg is available
                if shutil.which('ffmpeg'):
                    # Use ffmpeg to concatenate segments
                    self._concatenate_with_ffmpeg(segment_files, output_path)
                else:
                    # Fallback: simple binary concatenation
                    self._concatenate_binary(segment_files, output_path)

                return {
                    "success": True,
                    "output_path": output_path,
                    "segments_downloaded": len(segment_files),
                    "total_segments": len(segments)
                }

        except Exception as e:
            return {"success": False, "error": str(e)}

    def _concatenate_with_ffmpeg(self, segment_files, output_path):
        """Concatenate segments using ffmpeg"""
        # Create a temporary file list for ffmpeg
        with tempfile.NamedTemporaryFile(mode='w', suffix='.txt', delete=False) as f:
            for segment_file in segment_files:
                f.write(f"file '{segment_file}'\n")
            filelist_path = f.name

        try:
            # Use ffmpeg to concatenate
            cmd = [
                'ffmpeg',
                '-f', 'concat',
                '-safe', '0',
                '-i', filelist_path,
                '-c', 'copy',
                '-y',  # Overwrite output file
                output_path
            ]

            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=300  # 5 minute timeout
            )

            if result.returncode != 0:
                raise Exception(f"FFmpeg failed: {result.stderr}")

        finally:
            # Clean up the file list
            try:
                os.unlink(filelist_path)
            except:
                pass

    def _concatenate_binary(self, segment_files, output_path):
        """Simple binary concatenation fallback"""
        with open(output_path, 'wb') as output_file:
            for segment_file in segment_files:
                with open(segment_file, 'rb') as input_file:
                    shutil.copyfileobj(input_file, output_file)


def progress_callback(percent):
    """Progress callback for communicating with Electron"""
    print(f"PROGRESS:{percent}")
    sys.stdout.flush()


def main():
    """Main function to handle command line arguments"""
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No command specified"}))
        sys.exit(1)

    command = sys.argv[1]

    try:
        downloader = M3U8Downloader()

        if command == "get_tracks":
            if len(sys.argv) < 3:
                print(json.dumps({"error": "M3U8 file path required"}))
                sys.exit(1)

            m3u8_path = sys.argv[2]
            tracks = downloader.get_tracks_info(m3u8_path)
            print(json.dumps({"tracks": tracks}))

        elif command == "download":
            if len(sys.argv) < 6:
                print(json.dumps({"error": "Missing required arguments"}))
                sys.exit(1)

            m3u8_path = sys.argv[2]
            track_index = int(sys.argv[3])
            output_dir = sys.argv[4]
            filename = sys.argv[5]

            downloader.set_progress_callback(progress_callback)
            result = downloader.download_video(m3u8_path, track_index, output_dir, filename)
            print(json.dumps(result))

        else:
            print(json.dumps({"error": f"Unknown command: {command}"}))
            sys.exit(1)

    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    main()