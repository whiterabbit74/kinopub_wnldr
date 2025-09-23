import os
import re
from typing import Optional
from urllib.parse import urljoin, urlparse
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError


def is_url(value: str) -> bool:
    """Check if the given string looks like an URL."""
    if not isinstance(value, str):
        return False
    try:
        parsed = urlparse(value)
        return bool(parsed.scheme and parsed.netloc)
    except Exception:
        return False


def read_m3u8_source(path_or_url: str):
    """Return playlist content and the base URL for relative resources."""
    if is_url(path_or_url):
        headers = {'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'}
        request = Request(path_or_url, headers=headers)
        try:
            with urlopen(request, timeout=30) as response:
                raw = response.read()
                text = raw.decode('utf-8', errors='replace')
                final_url = response.geturl()
                base_url = final_url.rsplit('/', 1)[0] + '/' if '/' in final_url else final_url
                return text, base_url
        except (URLError, HTTPError) as exc:
            raise RuntimeError(f'Не удалось загрузить M3U8 по адресу {path_or_url}: {exc}') from exc

    if not os.path.exists(path_or_url):
        raise FileNotFoundError(f"Файл {path_or_url} не найден")

    try:
        with open(path_or_url, 'r', encoding='utf-8') as handle:
            content = handle.read()
    except OSError as exc:
        raise RuntimeError(f'Не удалось прочитать файл {path_or_url}: {exc}') from exc

    base_url = os.path.dirname(os.path.abspath(path_or_url)) + '/'
    return content, base_url


def _parse_attribute_list(attribute_line: str) -> dict:
    """Parse an EXTINF style attribute list into a dictionary."""
    attributes = {}
    scanner = re.finditer(r'(\w+)=(("[^"]*")|([^,]*))', attribute_line)
    for match in scanner:
        key = match.group(1)
        value = match.group(2)
        if value.startswith('"') and value.endswith('"'):
            value = value[1:-1]
        attributes[key.upper()] = value
    return attributes


def _make_absolute(uri: str, base_url: Optional[str]) -> str:
    if not uri:
        return ''
    if is_url(uri) or not base_url:
        return uri
    return urljoin(base_url, uri)


def parse_m3u8_content(content: str, base_url: Optional[str] = None) -> dict:
    """Extract information about video, audio and subtitle tracks."""
    video_tracks = []
    audio_tracks = []
    subtitle_tracks = []

    pending_video = None
    lines = [line.strip() for line in content.splitlines() if line.strip()]

    for line in lines:
        if line.startswith('#EXT-X-STREAM-INF:'):
            attrs = _parse_attribute_list(line.split(':', 1)[1])
            pending_video = {
                'bandwidth': attrs.get('BANDWIDTH'),
                'resolution': attrs.get('RESOLUTION'),
                'codec': attrs.get('CODECS'),
                'frame_rate': attrs.get('FRAME-RATE'),
                'audio_group': attrs.get('AUDIO'),
                'hdcp_level': attrs.get('HDCP-LEVEL'),
                'program_id': attrs.get('PROGRAM-ID'),
                'video_range': attrs.get('VIDEO-RANGE'),
            }
        elif pending_video and not line.startswith('#'):
            pending_video['url'] = _make_absolute(line, base_url)
            pending_video['original_url'] = line
            video_tracks.append(pending_video)
            pending_video = None
        elif line.startswith('#EXT-X-MEDIA:'):
            attrs = _parse_attribute_list(line.split(':', 1)[1])
            entry = {
                'group_id': attrs.get('GROUP-ID'),
                'name': attrs.get('NAME'),
                'language': attrs.get('LANGUAGE'),
                'is_default': attrs.get('DEFAULT', 'NO').upper() == 'YES',
                'autoselect': attrs.get('AUTOSELECT', 'NO').upper() == 'YES',
                'characteristics': attrs.get('CHARACTERISTICS'),
                'type': attrs.get('TYPE'),
                'codec': attrs.get('CODECS'),
            }
            uri = attrs.get('URI')
            if uri:
                entry['url'] = _make_absolute(uri, base_url)
                entry['original_url'] = uri

            media_type = (attrs.get('TYPE') or '').upper()
            if media_type == 'AUDIO':
                audio_tracks.append(entry)
            elif media_type == 'SUBTITLES':
                subtitle_tracks.append(entry)

    for index, track in enumerate(video_tracks):
        track['id'] = index
        if track.get('bandwidth'):
            try:
                track['bandwidth'] = int(track['bandwidth'])
            except ValueError:
                pass

    for index, track in enumerate(audio_tracks):
        track['id'] = index

    for index, track in enumerate(subtitle_tracks):
        track['id'] = index

    return {
        'video': video_tracks,
        'audio': audio_tracks,
        'subtitles': subtitle_tracks,
    }


def validate_m3u8_content(content: str) -> bool:
    """Basic validation to ensure the playlist contains useful information."""
    if not content:
        return False
    stripped = content.strip()
    if not stripped.startswith('#EXTM3U'):
        return False
    parsed = parse_m3u8_content(content)
    return bool(parsed['video'] or parsed['audio'])


def extract_base_url(url_or_path: str) -> str:
    if is_url(url_or_path):
        parts = url_or_path.split('/')
        return '/'.join(parts[:-1]) + '/'
    return os.path.dirname(os.path.abspath(url_or_path)) + '/'


def make_request_with_retry(url: str, max_retries: int = 3, timeout: int = 30):
    headers = {'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'}
    last_exc = None
    for attempt in range(max_retries):
        try:
            request = Request(url, headers=headers)
            with urlopen(request, timeout=timeout) as response:
                return response.read()
        except (URLError, HTTPError) as exc:
            last_exc = exc
            if attempt < max_retries - 1:
                import time
                time.sleep(2 ** attempt)
    if last_exc:
        raise last_exc


def sanitize_filename(filename: str) -> str:
    invalid_chars = '<>:"/\\|?*'
    result = filename
    for char in invalid_chars:
        result = result.replace(char, '_')
    result = re.sub(r'\s+', ' ', result).strip(' .')
    if not result:
        result = 'video'
    if len(result) > 200:
        result = result[:200]
    return result
