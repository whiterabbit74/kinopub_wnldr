const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const https = require('https');
const { URL } = require('url');

function isUrl(value) {
  if (typeof value !== 'string') {
    return false;
  }
  try {
    // eslint-disable-next-line no-new
    new URL(value);
    return true;
  } catch (error) {
    return false;
  }
}

function ensureHttps(urlString) {
  const parsed = new URL(urlString);
  if (parsed.protocol !== 'https:') {
    throw new Error('Поддерживаются только HTTPS источники');
  }
  return parsed;
}

function fetchHttps(urlString) {
  const parsed = ensureHttps(urlString);
  return new Promise((resolve, reject) => {
    const request = https.get(
      parsed,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'
        }
      },
      (response) => {
        if (response.statusCode && [301, 302, 307, 308].includes(response.statusCode)) {
          const location = response.headers.location;
          if (!location) {
            reject(new Error('Сервер вернул редирект без заголовка Location'));
            return;
          }
          try {
            fetchHttps(new URL(location, parsed).toString()).then(resolve).catch(reject);
          } catch (error) {
            reject(error);
          }
          return;
        }

        if (response.statusCode && response.statusCode >= 400) {
          reject(new Error(`Не удалось загрузить M3U8: HTTP ${response.statusCode}`));
          return;
        }

        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          const buffer = Buffer.concat(chunks);
          resolve({
            content: buffer.toString('utf-8'),
            finalUrl: response.headers.location ? response.headers.location : parsed.toString()
          });
        });
      }
    );

    request.on('error', reject);
  });
}

async function readSource(source) {
  if (isUrl(source)) {
    const { content, finalUrl } = await fetchHttps(source);
    const baseUrl = finalUrl.includes('/') ? `${finalUrl.slice(0, finalUrl.lastIndexOf('/') + 1)}` : finalUrl;
    return { content, baseUrl };
  }

  const absolutePath = path.resolve(source);
  const exists = await fs.promises
    .access(absolutePath, fs.constants.F_OK | fs.constants.R_OK)
    .then(() => true)
    .catch(() => false);
  if (!exists) {
    throw new Error(`Файл ${absolutePath} не найден или недоступен`);
  }
  if (path.extname(absolutePath).toLowerCase() !== '.m3u8') {
    throw new Error('Поддерживаются только файлы с расширением .m3u8');
  }
  const content = await fs.promises.readFile(absolutePath, 'utf-8');
  const directory = path.dirname(absolutePath);
  const baseUrl = new URL(`file://${directory}/`).toString();
  return { content, baseUrl, filePath: absolutePath };
}

function parseAttributeList(attributeLine) {
  const result = {};
  const regex = /([A-Z0-9-]+)=(("[^"]*")|([^,]*))/gi;
  let match;
  while ((match = regex.exec(attributeLine)) !== null) {
    const key = match[1].toUpperCase();
    let value = match[2];
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

function makeAbsolute(uri, baseUrl) {
  if (!uri) {
    return '';
  }
  if (isUrl(uri)) {
    return uri;
  }
  if (!baseUrl) {
    return uri;
  }
  if (baseUrl.startsWith('file://')) {
    const parsed = new URL(baseUrl);
    let basePath = decodeURIComponent(parsed.pathname);
    if (process.platform === 'win32' && basePath.startsWith('/')) {
      basePath = basePath.slice(1);
    }
    return path.resolve(basePath, uri);
  }
  return new URL(uri, baseUrl).toString();
}

function parseM3U8(content, baseUrl) {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const videoTracks = [];
  const audioTracks = [];
  const subtitleTracks = [];
  let pendingVideo = null;

  for (const line of lines) {
    if (line.startsWith('#EXT-X-STREAM-INF:')) {
      const colonIndex = line.indexOf(':');
      const attrs = parseAttributeList(line.substring(colonIndex + 1));
      pendingVideo = {
        bandwidth: attrs.BANDWIDTH ? Number.parseInt(attrs.BANDWIDTH, 10) || attrs.BANDWIDTH : undefined,
        resolution: attrs.RESOLUTION,
        codec: attrs.CODECS,
        frame_rate: attrs['FRAME-RATE'],
        audio_group: attrs.AUDIO,
        hdcp_level: attrs['HDCP-LEVEL'],
        program_id: attrs['PROGRAM-ID'],
        video_range: attrs['VIDEO-RANGE']
      };
    } else if (pendingVideo && !line.startsWith('#')) {
      pendingVideo.url = makeAbsolute(line, baseUrl);
      pendingVideo.original_url = line;
      videoTracks.push(pendingVideo);
      pendingVideo = null;
    } else if (line.startsWith('#EXT-X-MEDIA:')) {
      const colonIndex = line.indexOf(':');
      const attrs = parseAttributeList(line.substring(colonIndex + 1));
      const entry = {
        group_id: attrs['GROUP-ID'],
        name: attrs.NAME,
        language: attrs.LANGUAGE,
        is_default: (attrs.DEFAULT || 'NO').toUpperCase() === 'YES',
        autoselect: (attrs.AUTOSELECT || 'NO').toUpperCase() === 'YES',
        characteristics: attrs.CHARACTERISTICS,
        type: attrs.TYPE,
        codec: attrs.CODECS
      };
      const uri = attrs.URI;
      if (uri) {
        entry.url = makeAbsolute(uri, baseUrl);
        entry.original_url = uri;
      }

      const mediaType = (attrs.TYPE || '').toUpperCase();
      if (mediaType === 'AUDIO') {
        audioTracks.push(entry);
      } else if (mediaType === 'SUBTITLES') {
        subtitleTracks.push(entry);
      }
    }
  }

  videoTracks.forEach((track, index) => {
    track.id = index;
  });
  audioTracks.forEach((track, index) => {
    track.id = index;
  });
  subtitleTracks.forEach((track, index) => {
    track.id = index;
  });

  return { video: videoTracks, audio: audioTracks, subtitles: subtitleTracks };
}

function sanitizeFilename(filename) {
  const invalidChars = /[<>:"/\\|?*]/g;
  let safe = filename.replace(invalidChars, '_').replace(/\s+/g, ' ').trim();
  if (!safe) {
    safe = 'video';
  }
  if (safe.length > 200) {
    safe = safe.slice(0, 200);
  }
  return safe;
}

function ensureExtension(filename) {
  // FFmpeg всегда создает MP4, поэтому просто добавляем .mp4 к любому имени
  return filename + '.mp4';
}

async function findFfmpeg() {
  const candidates = ['ffmpeg', '/usr/local/bin/ffmpeg', '/opt/homebrew/bin/ffmpeg', '/usr/bin/ffmpeg'];
  for (const candidate of candidates) {
    const exists = await new Promise((resolve) => {
      const probe = spawn(candidate, ['-version']);
      let resolved = false;
      probe.on('exit', (code) => {
        if (!resolved) {
          resolved = true;
          resolve(code === 0);
        }
      });
      probe.on('error', () => {
        if (!resolved) {
          resolved = true;
          resolve(false);
        }
      });
    });

    if (exists) {
      return candidate;
    }
  }
  return null;
}

async function getTracks(source) {
  const { content, baseUrl } = await readSource(source);
  const parsed = parseM3U8(content, baseUrl);
  return parsed;
}

async function download(options, onProgress) {
  const {
    source,
    videoIndex,
    audioIndex,
    outputDir,
    filename,
    threads = 1
  } = options;

  const { content, baseUrl, filePath } = await readSource(source);
  const parsed = parseM3U8(content, baseUrl);
  const videos = parsed.video || [];
  const audios = parsed.audio || [];

  const videoTrack = typeof videoIndex === 'number' ? videos[videoIndex] : videos[0];
  if (!videoTrack) {
    throw new Error('Видео дорожка не найдена');
  }

  let audioTrack = null;
  if (typeof audioIndex === 'number') {
    audioTrack = audios[audioIndex];
    if (!audioTrack) {
      throw new Error('Аудио дорожка не найдена');
    }
  }


  const ffmpegPath = await findFfmpeg();
  if (!ffmpegPath) {
    throw new Error('FFmpeg не найден в системе');
  }

  const resolvedOutputDir = path.resolve(outputDir);
  await fs.promises.mkdir(resolvedOutputDir, { recursive: true });
  const safeName = ensureExtension(sanitizeFilename(filename));
  const outputPath = path.join(resolvedOutputDir, safeName);

  const inputs = [];
  inputs.push(videoTrack.url || (filePath || source));
  if (audioTrack && audioTrack.url) {
    inputs.push(audioTrack.url);
  }

  const args = ['-y', '-nostdin', '-threads', String(Math.max(1, Math.min(16, Number(threads) || 1)))];
  inputs.forEach((input) => {
    args.push('-i', input);
  });

  if (inputs.length > 1) {
    args.push('-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'copy');
  } else {
    args.push('-c', 'copy');
  }

  args.push('-progress', 'pipe:2', '-nostats', outputPath);

  const child = spawn(ffmpegPath, args);

  return new Promise((resolve, reject) => {
    let stderrBuffer = '';
    let currentProgress = 0;
    let currentStage = 'preparation';
    let startTime = Date.now();
    let durationMicroseconds = null;
    let stageStartTime = Date.now();

    // Реалистичные этапы с временными интервалами
    const stages = {
      preparation: { start: 0, end: 5, duration: 2000, status: 'Подготовка FFmpeg' },
      analysis: { start: 5, end: 10, duration: 3000, status: 'Анализ источников' },
      video: { start: 10, end: 70, duration: null, status: 'Скачивание видео' }, // 4x от длительности
      audio: { start: 70, end: 85, duration: null, status: 'Скачивание аудио' }, // 1x от длительности
      merge: { start: 85, end: 100, duration: null, status: 'Склейка и финализация' } // 1x от длительности
    };

    function getStatusForProgress(progress) {
      if (progress <= 5) return stages.preparation.status;
      if (progress <= 10) return stages.analysis.status;
      if (progress <= 70) return stages.video.status;
      if (progress <= 85) return stages.audio.status;
      return stages.merge.status;
    }

    // Симуляция реалистичного прогресса
    const progressSimulator = setInterval(() => {
      const elapsed = Date.now() - stageStartTime;
      let targetProgress = currentProgress;

      // Определяем целевой прогресс на основе времени и этапа
      if (currentStage === 'preparation' && elapsed > 500) {
        targetProgress = Math.min(5, currentProgress + 1);
        if (targetProgress >= 5) {
          currentStage = 'analysis';
          stageStartTime = Date.now();
        }
      } else if (currentStage === 'analysis' && elapsed > 1000) {
        targetProgress = Math.min(10, currentProgress + 1);
        if (targetProgress >= 10) {
          currentStage = 'video';
          stageStartTime = Date.now();
        }
      } else if (currentStage === 'video' && durationMicroseconds) {
        // Прогресс видео на основе реального времени (8x медленнее чем раньше)
        const videoProgressRate = 60 / (durationMicroseconds / 1000000); // 60% за длительность видео
        const expectedProgress = 10 + (elapsed / 1000) * (videoProgressRate / 8);
        targetProgress = Math.min(70, expectedProgress);
        if (targetProgress >= 68) {
          currentStage = 'audio';
          stageStartTime = Date.now();
        }
      } else if (currentStage === 'video' && !durationMicroseconds) {
        // Без данных о длительности - в 2 раза медленнее
        targetProgress = Math.min(70, currentProgress + 0.25);
        if (elapsed > 60000 && targetProgress >= 65) { // После 60 сек переходим к аудио
          currentStage = 'audio';
          stageStartTime = Date.now();
        }
      } else if (currentStage === 'audio') {
        // Прогресс аудио (в 2 раза медленнее)
        const audioProgressRate = durationMicroseconds ?
          15 / (durationMicroseconds / 1000000) / 2 : // 15% за длительность видео, но в 2 раза медленнее
          0.4; // Без данных - в 2 раза медленнее
        const expectedProgress = 70 + (elapsed / 1000) * audioProgressRate;
        targetProgress = Math.min(85, expectedProgress);
        if (targetProgress >= 84) {
          currentStage = 'merge';
          stageStartTime = Date.now();
        }
      } else if (currentStage === 'merge') {
        // Финализация (в 2 раза медленнее)
        targetProgress = Math.min(99, 85 + (elapsed / 1000) * 3.5); // 14% за 4 секунды
      }

      if (targetProgress > currentProgress) {
        currentProgress = targetProgress;
        if (onProgress) {
          onProgress({
            progress: Math.round(currentProgress),
            status: getStatusForProgress(currentProgress)
          });
        }
      }
    }, 500);

    if (onProgress) {
      onProgress({ progress: 0, status: 'Инициализация...' });
    }

    child.stderr.setEncoding('utf-8');
    child.stderr.on('data', (chunk) => {
      stderrBuffer += chunk;
      const lines = stderrBuffer.split(/\r?\n/);
      stderrBuffer = lines.pop() || '';
      lines.forEach((line) => {
        // Получаем длительность видео для реалистичных расчетов
        if (line.startsWith('Duration:')) {
          const durationMatch = line.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/);
          if (durationMatch) {
            const hours = parseInt(durationMatch[1], 10);
            const minutes = parseInt(durationMatch[2], 10);
            const seconds = parseFloat(durationMatch[3]);
            durationMicroseconds = ((hours * 3600 + minutes * 60 + seconds) * 1000000);
          }
        }

        // FFmpeg сообщает о завершении
        if (line === 'progress=end') {
          clearInterval(progressSimulator);
          currentStage = 'completed';
          currentProgress = 100;
          if (onProgress) {
            onProgress({ progress: 100, status: 'Завершено' });
          }
        }
      });
    });

    const stderrTail = [];
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString('utf-8').trim();
      if (text) {
        stderrTail.push(text);
        if (stderrTail.length > 50) {
          stderrTail.shift();
        }
      }
    });

    child.on('error', (error) => {
      clearInterval(progressSimulator);
      reject(error);
    });

    child.on('close', (code) => {
      clearInterval(progressSimulator);
      if (code !== 0) {
        reject(new Error(stderrTail.join('\n') || `FFmpeg завершился с кодом ${code}`));
        return;
      }
      resolve({ success: true, output_path: outputPath });
    });
  });
}

module.exports = {
  getTracks,
  download,
  findFfmpeg
};
