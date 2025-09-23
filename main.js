const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');

let progressInterval;
let config;

function loadConfig() {
  const configPath = path.join(__dirname, 'config.json');
  if (fs.existsSync(configPath)) {
    return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } else {
    return {
      output_filename: "final_output",
      num_threads: 3
    };
  }
}

function resolvePython() {
  const candidates = [
    path.join(__dirname, 'venv', 'bin', 'python3'),
    path.join(__dirname, 'venv', 'bin', 'python'),
    path.join(__dirname, '.venv', 'bin', 'python3'),
    path.join(__dirname, '.venv', 'bin', 'python'),
    'python3',
    'python'
  ];
  for (const cand of candidates) {
    try {
      if (cand.includes('/') && fs.existsSync(cand)) return cand;
    } catch (_) {}
  }
  return 'python3';
}

function createWindow() {
  console.log("Создание окна браузера...");
  config = loadConfig(); // Load config early

  const win = new BrowserWindow({
    width: 800,
    height: 600,
    icon: path.join(__dirname, 'image.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      enableRemoteModule: false,
      nodeIntegration: false
    }
  });

  win.loadFile('index.html');
  win.webContents.openDevTools();

  ipcMain.on('get-tracks', (event, filePath) => {
    console.log("Получено событие get-tracks с файлом:", filePath);
    const pythonScriptPath = path.join(__dirname, 'python_script.py');
    const pythonExecutable = resolvePython();

    const pythonProcess = execFile(pythonExecutable, [pythonScriptPath, filePath, '0', '0', '--num_threads', config.num_threads, '--output_filename', config.output_filename, '--get_tracks'], { maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        console.error(`Ошибка выполнения: ${error}`);
        event.reply('tracks-info', `Ошибка выполнения: ${error.message}`);
        return;
      }
      console.log(`stdout: ${stdout}`);
      console.error(`stderr: ${stderr}`);
      event.reply('tracks-info', stdout.trim());
    });

    pythonProcess.stdout.on('data', (data) => {
      console.log(`Python stdout: ${data}`);
    });

    pythonProcess.stderr.on('data', (data) => {
      console.error(`Python stderr: ${data}`);
    });

    pythonProcess.on('close', (code) => {
      console.log(`Python процесс завершен с кодом ${code}`);
    });
  });

  ipcMain.on('start-download', (event, args) => {
    console.log("Получено событие start-download с аргументами:", args);
    const { filePath, threads, output, outputFolder, videoChoice, audioChoice } = args;
    const pythonScriptPath = path.join(__dirname, 'python_script.py');
    const pythonExecutable = resolvePython();

    // Update the download directory in utils.py
    process.env.DOWNLOAD_DIR = outputFolder || path.join(os.homedir(), 'Downloads');

    const pythonProcess = execFile(pythonExecutable, [pythonScriptPath, filePath, videoChoice, audioChoice, '--num_threads', threads, '--output_filename', output], {
      maxBuffer: 1024 * 1024,
      env: { ...process.env, DOWNLOAD_DIR: outputFolder || path.join(os.homedir(), 'Downloads') }
    }, (error, stdout, stderr) => {
      if (error) {
        console.error(`Ошибка выполнения: ${error}`);
        event.reply('download-complete', `Ошибка выполнения: ${error.message}`);
        return;
      }
      console.log(`stdout: ${stdout}`);
      console.error(`stderr: ${stderr}`);
      event.reply('download-complete', 'Скачано успешно');
    });

    pythonProcess.stdout.on('data', (data) => {
      console.log(`Python stdout: ${data}`);
    });

    pythonProcess.stderr.on('data', (data) => {
      console.error(`Python stderr: ${data}`);
    });

    pythonProcess.on('close', (code) => {
      console.log(`Python процесс завершен с кодом ${code}`);
      event.reply('download-complete', 'Скачано успешно');
    });

    const interval = setInterval(() => {
      fs.readFile('progress.txt', 'utf8', (err, data) => {
        if (err) {
          console.error(`Ошибка чтения файла прогресса: ${err}`);
        } else {
          try {
            console.log(`Данные файла прогресса: ${data}`);
            const progressData = JSON.parse(data);
            const progress = progressData.percent / 100;
            win.setProgressBar(progress);
            event.reply('progress-update', data);
          } catch (parseError) {
            console.error(`Ошибка разбора данных JSON из файла прогресса: ${parseError}`);
            console.error(`Неверные данные JSON: ${data}`);
          }
        }
      });
    }, 1000);

    pythonProcess.on('close', () => {
      clearInterval(interval);
      win.setProgressBar(-1); // Очистить индикатор прогресса
    });
  });

  // Folder selection handler
  ipcMain.on('select-folder', async (event) => {
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory'],
      defaultPath: path.join(os.homedir(), 'Downloads')
    });

    if (!result.canceled && result.filePaths.length > 0) {
      event.reply('folder-selected', result.filePaths[0]);
    }
  });

  // Get downloads path handler
  ipcMain.on('get-downloads-path', (event) => {
    event.returnValue = path.join(os.homedir(), 'Downloads');
  });

  // Show file in finder/explorer
  ipcMain.on('show-file', (event, filePath) => {
    shell.showItemInFolder(filePath);
  });

}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  console.log("Все окна закрыты.");
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  console.log("Активация приложения...");
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});