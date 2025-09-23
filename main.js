const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const { execFile } = require('child_process');
const os = require('os');
const fs = require('fs');

function resolvePython() {
  const candidates = [
    path.join(__dirname, 'venv', 'bin', 'python3'),
    path.join(__dirname, 'venv', 'bin', 'python'),
    path.join(__dirname, '.venv', 'bin', 'python3'),
    path.join(__dirname, '.venv', 'bin', 'python'),
    'python3',
    'python'
  ];

  for (const candidate of candidates) {
    try {
      if (candidate.includes(path.sep) && fs.existsSync(candidate)) {
        return candidate;
      }
    } catch (error) {
      console.error('Ошибка при проверке кандидата Python:', error);
    }
  }

  return 'python3';
}

function runPython(args) {
  return new Promise((resolve, reject) => {
    const pythonExecutable = resolvePython();
    const scriptPath = path.join(__dirname, 'python_script.py');
    const processArgs = [scriptPath, ...args];

    let aggregatedStdout = '';
    let aggregatedStderr = '';

    const child = execFile(
      pythonExecutable,
      processArgs,
      { maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        aggregatedStdout += stdout || '';
        aggregatedStderr += stderr || '';

        if (error) {
          const details = [error.message, aggregatedStderr.trim()].filter(Boolean).join('\n');
          const wrappedError = new Error(`Python-скрипт завершился с ошибкой: ${details}`);
          wrappedError.code = error.code;
          wrappedError.stderr = aggregatedStderr;
          wrappedError.stdout = aggregatedStdout;
          return reject(wrappedError);
        }

        if (aggregatedStderr) {
          console.error('Python stderr:', aggregatedStderr);
        }

        resolve(aggregatedStdout);
      }
    );

    child.stdout?.on('data', (data) => {
      const chunk = data.toString();
      aggregatedStdout += chunk;
      console.log('Python stdout:', chunk);
    });

    child.stderr?.on('data', (data) => {
      const chunk = data.toString();
      aggregatedStderr += chunk;
      console.error('Python stderr:', chunk);
    });

    child.once('error', (error) => {
      const wrappedError = new Error(`Не удалось запустить Python: ${error.message}`);
      wrappedError.cause = error;
      reject(wrappedError);
    });
  });
}

function safeParseJson(payload, context) {
  try {
    return JSON.parse(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Не удалось обработать ответ ${context}: ${message}`);
  }
}

async function getTracks(filePath) {
  if (typeof filePath !== 'string' || filePath.length === 0) {
    throw new Error('Некорректный путь к файлу M3U8');
  }

  const output = await runPython(['get-tracks', filePath]);
  const parsed = safeParseJson(output, 'при анализе дорожек');
  if (!parsed.success) {
    throw new Error(parsed.error || 'Не удалось разобрать файл M3U8');
  }
  if (!parsed.tracks || typeof parsed.tracks !== 'object') {
    throw new Error('Ответ не содержит данных о дорожках');
  }
  return parsed.tracks;
}

async function startDownload(options) {
  if (!options || typeof options !== 'object') {
    throw new Error('Некорректные параметры скачивания');
  }

  const { filePath, videoIndex, audioIndex, outputDir, filename, threads } = options;
  if (!filePath || !outputDir || !filename) {
    throw new Error('Отсутствуют обязательные параметры скачивания');
  }

  const args = [
    'download',
    filePath,
    '--output-dir', outputDir,
    '--filename', filename,
    '--threads', String(threads || 1)
  ];

  if (typeof videoIndex === 'number' && videoIndex >= 0) {
    args.push('--video', String(videoIndex));
  }

  if (typeof audioIndex === 'number' && audioIndex >= 0) {
    args.push('--audio', String(audioIndex));
  }

  const output = await runPython(args);
  const parsed = safeParseJson(output, 'при скачивании файла');
  if (!parsed.success) {
    throw new Error(parsed.error || 'Ошибка загрузки файла');
  }
  return parsed;
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

  ipcMain.handle('start-download', async (_event, options) => {
    try {
      return await startDownload(options);
    } catch (error) {
      console.error('Ошибка запуска скачивания:', error);
      throw error instanceof Error ? error : new Error(String(error));
    }
  });

  ipcMain.handle('select-folder', async () => {
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory'],
      defaultPath: path.join(os.homedir(), 'Downloads')
    });

    if (!result.canceled && result.filePaths.length > 0) {
      return result.filePaths[0];
    }
    return null;
  });

  ipcMain.handle('get-downloads-path', () => path.join(os.homedir(), 'Downloads'));

  ipcMain.handle('show-file', (_event, filePath) => {
    shell.showItemInFolder(filePath);
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
