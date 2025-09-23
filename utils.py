#!/usr/bin/env python3
"""
Utility functions for M3U8 processing and download operations.
"""

import re
import requests
from urllib.parse import urlparse


def is_url(string):
    """Check if a string is a valid URL"""
    try:
        result = urlparse(string)
        return all([result.scheme, result.netloc])
    except:
        return False


def parse_m3u8_content(content):
    """
    Parse M3U8 content and extract track information.
    Returns a list of available tracks with their properties.
    """
    tracks = []
    lines = content.strip().split('\n')

    i = 0
    while i < len(lines):
        line = lines[i].strip()

        # Look for EXT-X-STREAM-INF tags (variant playlists)
        if line.startswith('#EXT-X-STREAM-INF:'):
            track_info = parse_stream_inf(line)

            # The next line should contain the URL
            i += 1
            if i < len(lines):
                url_line = lines[i].strip()
                if url_line and not url_line.startswith('#'):
                    track_info['url'] = url_line
                    tracks.append(track_info)

        # Look for EXT-X-MEDIA tags (alternative renditions)
        elif line.startswith('#EXT-X-MEDIA:'):
            media_info = parse_media_tag(line)
            if media_info.get('type') == 'VIDEO':
                tracks.append(media_info)

        i += 1

    # If no variant streams found, it might be a simple playlist
    if not tracks:
        # Check if this is a media playlist (contains segments)
        has_segments = any(line.startswith('#EXTINF:') for line in lines)
        if has_segments:
            tracks.append({
                'url': 'self',  # Indicates this file itself
                'resolution': 'Unknown',
                'bandwidth': 'Unknown',
                'codec': 'Unknown'
            })

    return tracks


def parse_stream_inf(line):
    """Parse EXT-X-STREAM-INF line and extract track information"""
    track_info = {
        'resolution': 'Unknown',
        'bandwidth': 'Unknown',
        'codec': 'Unknown'
    }

    # Extract bandwidth
    bandwidth_match = re.search(r'BANDWIDTH=(\d+)', line)
    if bandwidth_match:
        track_info['bandwidth'] = bandwidth_match.group(1)

    # Extract resolution
    resolution_match = re.search(r'RESOLUTION=(\d+x\d+)', line)
    if resolution_match:
        track_info['resolution'] = resolution_match.group(1)

    # Extract codecs
    codecs_match = re.search(r'CODECS="([^"]+)"', line)
    if codecs_match:
        track_info['codec'] = codecs_match.group(1)

    # Extract frame rate
    frame_rate_match = re.search(r'FRAME-RATE=([\d.]+)', line)
    if frame_rate_match:
        track_info['frame_rate'] = frame_rate_match.group(1)

    return track_info


def parse_media_tag(line):
    """Parse EXT-X-MEDIA tag for alternative renditions"""
    media_info = {
        'resolution': 'Unknown',
        'bandwidth': 'Unknown',
        'codec': 'Unknown'
    }

    # Extract type
    type_match = re.search(r'TYPE=([^,\s]+)', line)
    if type_match:
        media_info['type'] = type_match.group(1)

    # Extract name
    name_match = re.search(r'NAME="([^"]+)"', line)
    if name_match:
        media_info['name'] = name_match.group(1)

    # Extract URI
    uri_match = re.search(r'URI="([^"]+)"', line)
    if uri_match:
        media_info['url'] = uri_match.group(1)

    # Extract language
    language_match = re.search(r'LANGUAGE="([^"]+)"', line)
    if language_match:
        media_info['language'] = language_match.group(1)

    return media_info


def validate_m3u8_content(content):
    """Validate if content is a valid M3U8 playlist"""
    if not content:
        return False

    lines = content.strip().split('\n')

    # Must start with #EXTM3U
    if not lines or not lines[0].strip().startswith('#EXTM3U'):
        return False

    # Should contain either variant streams or media segments
    has_stream_inf = any(line.startswith('#EXT-X-STREAM-INF:') for line in lines)
    has_segments = any(line.startswith('#EXTINF:') for line in lines)

    return has_stream_inf or has_segments


def extract_base_url(url_or_path):
    """Extract base URL for resolving relative paths"""
    if is_url(url_or_path):
        # For URLs, return the directory part
        parts = url_or_path.split('/')
        return '/'.join(parts[:-1]) + '/'
    else:
        # For local paths, return the directory
        import os
        return os.path.dirname(os.path.abspath(url_or_path)) + '/'


def make_request_with_retry(url, max_retries=3, timeout=30):
    """Make HTTP request with retry logic"""
    session = requests.Session()
    session.headers.update({
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
    })

    for attempt in range(max_retries):
        try:
            response = session.get(url, timeout=timeout)
            response.raise_for_status()
            return response
        except requests.exceptions.RequestException as e:
            if attempt < max_retries - 1:
                import time
                time.sleep(2 ** attempt)  # Exponential backoff
                continue
            else:
                raise e


def sanitize_filename(filename):
    """Sanitize filename for cross-platform compatibility"""
    # Remove or replace invalid characters
    invalid_chars = '<>:"/\\|?*'
    for char in invalid_chars:
        filename = filename.replace(char, '_')

    # Remove leading/trailing spaces and dots
    filename = filename.strip(' .')

    # Ensure filename is not empty
    if not filename:
        filename = 'video'

    # Limit length (255 is common filesystem limit)
    if len(filename) > 200:  # Leave room for extension
        filename = filename[:200]

    return filename


def format_file_size(size_bytes):
    """Format file size in human readable format"""
    if size_bytes == 0:
        return "0 B"

    size_names = ["B", "KB", "MB", "GB", "TB"]
    import math
    i = int(math.floor(math.log(size_bytes, 1024)))
    p = math.pow(1024, i)
    s = round(size_bytes / p, 2)
    return f"{s} {size_names[i]}"


def format_duration(seconds):
    """Format duration in HH:MM:SS format"""
    if seconds < 0:
        return "00:00:00"

    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    seconds = int(seconds % 60)

    return f"{hours:02d}:{minutes:02d}:{seconds:02d}"


def get_content_type_from_url(url):
    """Get content type from URL without downloading the full content"""
    try:
        response = requests.head(url, timeout=10)
        return response.headers.get('content-type', '').lower()
    except:
        return ''


def is_video_segment(url_or_path):
    """Check if URL or path points to a video segment"""
    video_extensions = ['.ts', '.m4s', '.mp4', '.mkv', '.avi']

    if is_url(url_or_path):
        # For URLs, check the path part
        path = urlparse(url_or_path).path.lower()
        return any(path.endswith(ext) for ext in video_extensions)
    else:
        # For local paths
        return any(url_or_path.lower().endswith(ext) for ext in video_extensions)