const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// URL источники для FFmpeg
const FFMPEG_SOURCES = {
  'darwin-x64': 'https://evermeet.cx/ffmpeg/ffmpeg-6.0.zip',
  'darwin-arm64': 'https://evermeet.cx/ffmpeg/ffmpeg-6.0.zip', // Универсальный бинарник
  'win32-x64': 'https://github.com/GyanD/codexffmpeg/releases/download/6.0/ffmpeg-6.0-essentials_build.zip',
  'win32-ia32': 'https://github.com/GyanD/codexffmpeg/releases/download/6.0/ffmpeg-6.0-essentials_build.zip'
};

async function downloadFile(url, outputPath) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https:') ? https : http;
    const file = fs.createWriteStream(outputPath);

    client.get(url, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        // Follow redirects
        return downloadFile(response.headers.location, outputPath)
          .then(resolve)
          .catch(reject);
      }

      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
        return;
      }

      const totalSize = parseInt(response.headers['content-length'], 10);
      let downloaded = 0;

      response.on('data', (chunk) => {
        downloaded += chunk.length;
        if (totalSize) {
          const percent = ((downloaded / totalSize) * 100).toFixed(1);
          process.stdout.write(`\rDownloading: ${percent}%`);
        }
      });

      response.pipe(file);

      file.on('finish', () => {
        file.close();
        console.log(`\nDownloaded: ${outputPath}`);
        resolve(outputPath);
      });

      file.on('error', reject);
    }).on('error', reject);
  });
}

async function extractZip(zipPath, extractDir) {
  return new Promise((resolve, reject) => {
    const unzip = spawn('unzip', ['-o', zipPath, '-d', extractDir], {
      stdio: 'pipe'
    });

    unzip.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Unzip failed with code ${code}`));
      }
    });

    unzip.on('error', reject);
  });
}

async function downloadFFmpegForPlatform(platform) {
  const url = FFMPEG_SOURCES[platform];
  if (!url) {
    console.log(`No FFmpeg source for platform: ${platform}`);
    return;
  }

  const binDir = path.join(__dirname, 'bin', platform);
  const tempDir = path.join(__dirname, 'temp');

  // Создаем директории
  await fs.promises.mkdir(binDir, { recursive: true });
  await fs.promises.mkdir(tempDir, { recursive: true });

  const zipPath = path.join(tempDir, `ffmpeg-${platform}.zip`);

  console.log(`Downloading FFmpeg for ${platform}...`);

  try {
    await downloadFile(url, zipPath);

    console.log(`Extracting FFmpeg for ${platform}...`);
    await extractZip(zipPath, tempDir);

    // Ищем бинарник ffmpeg в извлеченных файлах
    const extractedDir = tempDir;
    const findBinary = async (dir, filename) => {
      const items = await fs.promises.readdir(dir, { withFileTypes: true });
      for (const item of items) {
        const fullPath = path.join(dir, item.name);
        if (item.isDirectory()) {
          const result = await findBinary(fullPath, filename);
          if (result) return result;
        } else if (item.name === filename || item.name === filename + '.exe') {
          return fullPath;
        }
      }
      return null;
    };

    const binaryName = platform.startsWith('win32') ? 'ffmpeg.exe' : 'ffmpeg';
    const ffmpegBinary = await findBinary(extractedDir, 'ffmpeg');

    if (ffmpegBinary) {
      const targetPath = path.join(binDir, binaryName);
      await fs.promises.copyFile(ffmpegBinary, targetPath);

      // Делаем исполняемым на Unix системах
      if (!platform.startsWith('win32')) {
        await fs.promises.chmod(targetPath, 0o755);
      }

      console.log(`✅ FFmpeg installed for ${platform}: ${targetPath}`);
    } else {
      console.log(`❌ FFmpeg binary not found for ${platform}`);
    }

    // Удаляем временные файлы
    await fs.promises.rm(zipPath, { force: true });

  } catch (error) {
    console.error(`❌ Failed to download FFmpeg for ${platform}:`, error.message);
  }
}

async function main() {
  console.log('📥 Downloading FFmpeg binaries for all platforms...\n');

  const platforms = Object.keys(FFMPEG_SOURCES);

  for (const platform of platforms) {
    await downloadFFmpegForPlatform(platform);
    console.log('');
  }

  // Очистка временной папки
  try {
    await fs.promises.rm(path.join(__dirname, 'temp'), { recursive: true, force: true });
  } catch (error) {
    // Игнорируем ошибки очистки
  }

  console.log('✅ All FFmpeg binaries downloaded!');
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { downloadFFmpegForPlatform, main };