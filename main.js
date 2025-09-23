const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');

const nativeBackend = require('./native-backend');

const allowedDownloadDirectories = new Set();
let defaultDownloadsPath = null;
let pythonRuntimeAvailable = null;

function rememberAllowedDirectory(directoryPath) {
  if (!directoryPath) {
    return;
  }
  allowedDownloadDirectories.add(path.resolve(directoryPath));
}

function isSubPath(candidate, parent) {
  const normalizedCandidate = path.resolve(candidate);
  const normalizedParent = path.resolve(parent);
  return normalizedCandidate === normalizedParent || normalizedCandidate.startsWith(`${normalizedParent}${path.sep}`);
}

function ensureDefaultDownloadsPath() {
  if (!defaultDownloadsPath) {
    defaultDownloadsPath = app.getPath('downloads');
    rememberAllowedDirectory(defaultDownloadsPath);
  }
  return defaultDownloadsPath;
}

function resolvePython() {
  const candidates = [
    path.join(__dirname, 'venv', 'bin', 'python3'),
    path.join(__dirname, 'venv', 'bin', 'python'),
    path.join(__dirname, '.venv', 'bin', 'python3'),
    path.join(__dirname, '.venv', 'bin', 'python'),
    path.join(__dirname, 'venv', 'Scripts', 'python.exe'),
    path.join(__dirname, '.venv', 'Scripts', 'python.exe'),
    'python3',
    'python'
  ];

  for (const candidate of candidates) {
    try {
      if (candidate.includes(path.sep)) {
        if (fs.existsSync(candidate)) {
          return candidate;
        }
        continue;
      }

      const checkCommand = process.platform === 'win32' ? 'where' : 'which';
      const check = spawnSync(checkCommand, [candidate], { stdio: 'ignore' });
      if (check.status === 0) {
        return candidate;
      }
    } catch (error) {
      console.error('Ошибка при проверке кандидата Python:', error);
    }
  }

  throw new Error('Не удалось найти установленный Python. Установите Python 3.9+ или настройте виртуальное окружение.');
}

async function runNativeBackend(args) {
  if (!Array.isArray(args) || args.length === 0) {
    throw new Error('Некорректные аргументы backend');
  }

  const [command, ...rest] = args;

  if (command === 'get-tracks') {
    const source = rest[0];
    if (!source) {
      throw new Error('Не указан источник для анализа');
    }
    const tracks = await nativeBackend.getTracks(source);
    return JSON.stringify({ success: true, tracks });
  }

  if (command === 'download') {
    if (rest.length === 0) {
      throw new Error('Не указан источник для скачивания');
    }

    const source = rest[0];
    const options = { source };
    for (let index = 1; index < rest.length; index += 2) {
      const flag = rest[index];
      const value = rest[index + 1];
      if (typeof value === 'undefined') {
        throw new Error(`Отсутствует значение для ${flag}`);
      }
      switch (flag) {
        case '--output-dir':
          options.outputDir = value;
          break;
        case '--filename':
          options.filename = value;
          break;
        case '--threads':
          options.threads = Number.parseInt(value, 10) || 1;
          break;
        case '--video':
          options.videoIndex = Number.parseInt(value, 10);
          break;
        case '--audio':
          options.audioIndex = Number.parseInt(value, 10);
          break;
        default:
          break;
      }
    }

    if (!options.outputDir || !options.filename) {
      throw new Error('Некорректные параметры загрузки');
    }

    const result = await nativeBackend.download(options, (progressPayload) => {
      if (global.downloadProgressSender && !global.downloadProgressSender.isDestroyed()) {
        global.downloadProgressSender.send('download-progress', progressPayload);
      }
    });
    return JSON.stringify(result);
  }

  if (command === 'check-ffmpeg') {
    const ffmpegPath = await nativeBackend.findFfmpeg();
    if (!ffmpegPath) {
      return JSON.stringify({ success: false, error: 'FFmpeg не найден в PATH' });
    }
    return JSON.stringify({ success: true, path: ffmpegPath });
  }

  throw new Error(`Неизвестная команда backend: ${command}`);
}

function runPython(args) {
  return new Promise((resolve, reject) => {
    if (pythonRuntimeAvailable === false) {
      runNativeBackend(args).then(resolve).catch(reject);
      return;
    }

    let pythonExecutable;
    try {
      pythonExecutable = resolvePython();
      pythonRuntimeAvailable = true;
    } catch (error) {
      pythonRuntimeAvailable = false;
      runNativeBackend(args).then(resolve).catch(reject);
      return;
    }

    // Handle both development and packaged app paths
    let scriptPath;
    if (process.env.NODE_ENV === 'development' || !app.isPackaged) {
      scriptPath = path.join(__dirname, 'python_script.py');
    } else {
      // In packaged app, Python files are unpacked to app.asar.unpacked
      scriptPath = path.join(__dirname, '..', 'app.asar.unpacked', 'python_script.py');
      if (!fs.existsSync(scriptPath)) {
        // Fallback to Resources directory
        scriptPath = path.join(process.resourcesPath, 'app.asar.unpacked', 'python_script.py');
      }
    }

    const processArgs = [scriptPath, ...args];

    let aggregatedStdout = '';
    const stderrTail = [];

    const child = spawn(pythonExecutable, processArgs, { stdio: ['ignore', 'pipe', 'pipe'] });

    child.stdout.on('data', (chunk) => {
      aggregatedStdout += chunk.toString();
      if (aggregatedStdout.length > 5 * 1024 * 1024) {
        child.kill();
        reject(new Error('Ответ Python превышает допустимый размер.'));
      }
    });

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line) {
          continue;
        }

        if (line.startsWith('PROGRESS:')) {
          try {
            const progressJson = line.substring('PROGRESS:'.length);
            const progressData = JSON.parse(progressJson);
            if (global.downloadProgressSender && !global.downloadProgressSender.isDestroyed()) {
              global.downloadProgressSender.send('download-progress', progressData);
            }
          } catch (error) {
            // Игнорируем ошибки разбора прогресса
          }
          continue;
        }

        stderrTail.push(line);
        if (stderrTail.length > 50) {
          stderrTail.shift();
        }
      }
    });

    child.once('error', (error) => {
      if (error && (error.code === 'ENOENT' || error.code === 'EACCES')) {
        pythonRuntimeAvailable = false;
        runNativeBackend(args).then(resolve).catch(reject);
        return;
      }
      reject(new Error(`Не удалось запустить Python: ${error.message}`));
    });

    child.once('close', (code) => {
      if (code !== 0) {
        const details = stderrTail.join('\n');
        reject(new Error(`Python-скрипт завершился с ошибкой (код ${code}): ${details}`));
        return;
      }

      resolve(aggregatedStdout);
    });
  });
}

function normalizeSourcePath(source) {
  if (typeof source !== 'string' || source.trim().length === 0) {
    throw new Error('Некорректный путь к источнику');
  }

  const trimmed = source.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    if (!/^https:\/\//i.test(trimmed)) {
      throw new Error('Поддерживаются только HTTPS источники');
    }
    return trimmed;
  }

  const resolved = path.resolve(trimmed);
  if (!fs.existsSync(resolved)) {
    throw new Error('Указанный файл не существует');
  }
  if (path.extname(resolved).toLowerCase() !== '.m3u8') {
    throw new Error('Поддерживаются только M3U8 файлы');
  }
  return resolved;
}

function safeParseJson(payload, context) {
  try {
    // Try to find JSON in the output - look for lines starting with { or [
    const lines = payload.trim().split('\n');
    let jsonLine = '';

    for (const line of lines) {
      const trimmedLine = line.trim();
      if (trimmedLine.startsWith('{') || trimmedLine.startsWith('[')) {
        jsonLine = trimmedLine;
        break;
      }
    }

    if (!jsonLine) {
      // If no JSON found, try the whole payload
      jsonLine = payload.trim();
    }

    return JSON.parse(jsonLine);
  } catch (error) {
    console.error('Failed to parse JSON:', payload);
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Не удалось обработать ответ ${context}: ${message}. Полученные данные: ${payload.substring(0, 200)}...`);
  }
}

async function getTracks(filePath) {
  try {
    const normalized = normalizeSourcePath(filePath);
    const output = await runPython(['get-tracks', normalized]);
    const parsed = safeParseJson(output, 'при анализе дорожек');
    if (!parsed.success) {
      throw new Error(parsed.error || 'Не удалось разобрать файл M3U8');
    }
    if (!parsed.tracks || typeof parsed.tracks !== 'object') {
      throw new Error('Ответ не содержит данных о дорожках');
    }
    return parsed.tracks;
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(`Неожиданная ошибка при анализе дорожек: ${String(error)}`);
  }
}

async function startDownload(options) {
  if (!options || typeof options !== 'object') {
    throw new Error('Некорректные параметры скачивания');
  }

  const { filePath, videoIndex, audioIndex, outputDir, filename, threads } = options;
  const normalizedFilePath = normalizeSourcePath(filePath);
  if (!outputDir || typeof outputDir !== 'string') {
    throw new Error('Некорректная папка назначения');
  }
  if (!filename || typeof filename !== 'string') {
    throw new Error('Некорректное имя файла');
  }

  const resolvedOutputDir = path.resolve(outputDir);
  const downloadsPath = ensureDefaultDownloadsPath();
  const isAllowed = [...allowedDownloadDirectories].some((dir) => isSubPath(resolvedOutputDir, dir));
  if (!isAllowed && !isSubPath(resolvedOutputDir, downloadsPath)) {
    throw new Error('Выбранная папка недоступна приложению');
  }
  rememberAllowedDirectory(resolvedOutputDir);

  const args = [
    'download',
    normalizedFilePath,
    '--output-dir', resolvedOutputDir,
    '--filename', filename,
    '--threads', String(Math.max(1, Math.min(16, threads || 1)))
  ];

  if (typeof videoIndex === 'number' && videoIndex >= 0) {
    args.push('--video', String(videoIndex));
  }

  if (typeof audioIndex === 'number' && audioIndex >= 0) {
    args.push('--audio', String(audioIndex));
  }

  try {
    const output = await runPython(args);
    const parsed = safeParseJson(output, 'при скачивании файла');
    if (!parsed.success) {
      throw new Error(parsed.error || 'Ошибка загрузки файла');
    }
    return parsed;
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(`Неожиданная ошибка при скачивании: ${String(error)}`);
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 960,
    height: 700,
    minWidth: 860,
    minHeight: 620,
    title: 'Загрузчик M3U8',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    }
  });

  win.loadFile('index.html');

  ipcMain.handle('get-tracks', async (_event, filePath) => {
    try {
      return await getTracks(filePath);
    } catch (error) {
      console.error('Не удалось получить дорожки:', error);
      throw error instanceof Error ? error : new Error(String(error));
    }
  });

  ipcMain.handle('start-download', async (event, options) => {
    try {
      // Store the event sender for progress updates
      global.downloadProgressSender = event.sender;
      return await startDownload(options);
    } catch (error) {
      console.error('Ошибка запуска скачивания:', error);
      throw error instanceof Error ? error : new Error(String(error));
    } finally {
      global.downloadProgressSender = null;
    }
  });

  ipcMain.handle('check-ffmpeg', async () => {
    try {
      const output = await runPython(['check-ffmpeg']);
      const parsed = safeParseJson(output, 'при проверке FFmpeg');
      return parsed;
    } catch (error) {
      return { available: false, error: error.message };
    }
  });

  ipcMain.handle('select-folder', async () => {
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory'],
      defaultPath: ensureDefaultDownloadsPath()
    });

    if (!result.canceled && result.filePaths.length > 0) {
      const selected = result.filePaths[0];
      rememberAllowedDirectory(selected);
      return selected;
    }
    return null;
  });

  ipcMain.handle('get-downloads-path', () => ensureDefaultDownloadsPath());

  ipcMain.handle('show-file', (_event, filePath) => {
    if (!filePath || typeof filePath !== 'string') {
      throw new Error('Некорректный путь к файлу');
    }
    const resolved = path.resolve(filePath);
    const isKnown = [...allowedDownloadDirectories].some((dir) => isSubPath(resolved, dir));
    if (!isKnown) {
      throw new Error('Доступ к указанному файлу запрещён');
    }
    shell.showItemInFolder(resolved);
  });
}

app.whenReady().then(() => {
  ensureDefaultDownloadsPath();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    app.whenReady().then(createWindow);
  }
});
