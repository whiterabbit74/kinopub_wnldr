const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const nativeBackend = require('./native-backend');

const allowedDownloadDirectories = new Set();
let defaultDownloadsPath = null;

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

async function getTracks(filePath) {
  try {
    const normalized = normalizeSourcePath(filePath);
    const tracks = await nativeBackend.getTracks(normalized);
    if (!tracks || typeof tracks !== 'object') {
      throw new Error('Ответ не содержит данных о дорожках');
    }
    return tracks;
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

  const normalizedThreads = Math.max(1, Math.min(16, Number.parseInt(threads, 10) || 1));

  try {
    const result = await nativeBackend.download(
      {
        source: normalizedFilePath,
        outputDir: resolvedOutputDir,
        filename,
        threads: normalizedThreads,
        videoIndex: typeof videoIndex === 'number' && videoIndex >= 0 ? videoIndex : undefined,
        audioIndex: typeof audioIndex === 'number' && audioIndex >= 0 ? audioIndex : undefined
      },
      (progressPayload) => {
        if (global.downloadProgressSender && !global.downloadProgressSender.isDestroyed()) {
          global.downloadProgressSender.send('download-progress', progressPayload);
        }
      }
    );
    return result;
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
      const ffmpegPath = await nativeBackend.findFfmpeg();
      if (!ffmpegPath) {
        return { success: false, error: 'FFmpeg не найден в PATH' };
      }
      return { success: true, path: ffmpegPath };
    } catch (error) {
      return { success: false, error: error.message };
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
