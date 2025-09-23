const state = {
    theme: localStorage.getItem('theme') || 'light',
    filePath: null,
    fileName: null,
    videoTracks: [],
    audioTracks: [],
    selectedVideo: null,
    selectedAudio: null,
    downloadFolder: null,
    downloadResultPath: null,
};

// DOM элементы
const themeToggle = document.getElementById('themeToggle');
const themeIcon = document.getElementById('themeIcon');
const themeText = document.getElementById('themeText');
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const errorMessage = document.getElementById('errorMessage');
const fileMeta = document.getElementById('fileMeta');
const fileNameLabel = document.getElementById('fileName');
const analyzeBtn = document.getElementById('analyzeBtn');
const tracksSection = document.getElementById('tracksSection');
const videoTracksList = document.getElementById('videoTracks');
const audioTracksList = document.getElementById('audioTracks');
const settingsSection = document.getElementById('settingsSection');
const threadSelect = document.getElementById('threadSelect');
const filenameInput = document.getElementById('filename');
const downloadPath = document.getElementById('downloadPath');
const selectFolderBtn = document.getElementById('selectFolderBtn');
const downloadBtn = document.getElementById('downloadBtn');
const progressContainer = document.getElementById('progressContainer');
const progressFill = document.getElementById('progressFill');
const progressPercent = document.getElementById('progressPercent');
const successSection = document.getElementById('successSection');
const showFileBtn = document.getElementById('showFileBtn');
const downloadError = document.getElementById('downloadError');

function applyTheme() {
    document.documentElement.setAttribute('data-theme', state.theme);
    if (state.theme === 'dark') {
        themeIcon.textContent = '☀️';
        themeText.textContent = 'Светлая тема';
    } else {
        themeIcon.textContent = '🌙';
        themeText.textContent = 'Тёмная тема';
    }
}

function toggleTheme() {
    state.theme = state.theme === 'light' ? 'dark' : 'light';
    localStorage.setItem('theme', state.theme);
    applyTheme();
}

function showError(container, message) {
    container.textContent = message;
    container.style.display = 'block';
}

function hideError(container) {
    container.style.display = 'none';
}

function resetTracks() {
    state.videoTracks = [];
    state.audioTracks = [];
    state.selectedVideo = null;
    state.selectedAudio = null;
    videoTracksList.innerHTML = '';
    audioTracksList.innerHTML = '';
    tracksSection.hidden = true;
    settingsSection.hidden = true;
    updateDownloadButton();
}

function formatBandwidth(bandwidth) {
    if (typeof bandwidth !== 'number') {
        const parsed = Number(bandwidth);
        if (!Number.isFinite(parsed)) {
            return 'Не указано';
        }
        bandwidth = parsed;
    }
    if (bandwidth >= 1_000_000) {
        return `${(bandwidth / 1_000_000).toFixed(1)} Мбит/с`;
    }
    if (bandwidth >= 1_000) {
        return `${(bandwidth / 1_000).toFixed(1)} кбит/с`;
    }
    return `${bandwidth} бит/с`;
}

function createTrackElement(track, type) {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = 'track-item';
    element.dataset.type = type;
    element.dataset.id = track.id;

    const title = document.createElement('div');
    title.className = 'track-title';
    if (type === 'video') {
        const resolution = track.resolution || 'Не указано';
        title.textContent = `${resolution}`;
    } else {
        title.textContent = track.name || `Аудио #${track.id + 1}`;
    }

    const details = document.createElement('div');
    details.className = 'track-details';
    if (type === 'video') {
        const parts = [];
        if (track.bandwidth) parts.push(`Битрейт: ${formatBandwidth(track.bandwidth)}`);
        if (track.codec) parts.push(`Кодек: ${track.codec}`);
        if (track.frame_rate) parts.push(`FPS: ${track.frame_rate}`);
        details.textContent = parts.join(' • ') || 'Без доп. данных';
    } else {
        const parts = [];
        if (track.language) parts.push(`Язык: ${track.language.toUpperCase()}`);
        if (track.is_default) parts.push('По умолчанию');
        if (track.codec) parts.push(`Кодек: ${track.codec}`);
        details.textContent = parts.join(' • ') || 'Без доп. данных';
    }

    element.appendChild(title);
    element.appendChild(details);
    return element;
}

function renderTracks() {
    videoTracksList.innerHTML = '';
    audioTracksList.innerHTML = '';

    state.videoTracks.forEach((track) => {
        const element = createTrackElement(track, 'video');
        if (state.selectedVideo === track.id) {
            element.classList.add('selected');
        }
        element.addEventListener('click', () => {
            state.selectedVideo = track.id;
            renderTracks();
            revealSettings();
        });
        videoTracksList.appendChild(element);
    });

    const emptyAudio = document.createElement('button');
    emptyAudio.type = 'button';
    emptyAudio.className = 'track-item';
    emptyAudio.dataset.type = 'audio';
    emptyAudio.dataset.id = '-1';
    emptyAudio.innerHTML = '<div class="track-title">Использовать звук из выбранного видео</div><div class="track-details">Отдельная аудиодорожка не будет скачиваться</div>';
    if (state.selectedAudio === null) {
        emptyAudio.classList.add('selected');
    }
    emptyAudio.addEventListener('click', () => {
        state.selectedAudio = null;
        renderTracks();
        revealSettings();
    });
    audioTracksList.appendChild(emptyAudio);

    state.audioTracks.forEach((track) => {
        const element = createTrackElement(track, 'audio');
        if (state.selectedAudio === track.id) {
            element.classList.add('selected');
        }
        element.addEventListener('click', () => {
            state.selectedAudio = track.id;
            renderTracks();
            revealSettings();
        });
        audioTracksList.appendChild(element);
    });
}

function revealSettings() {
    if (!settingsSection.hidden) {
        updateDownloadButton();
        return;
    }
    settingsSection.hidden = false;
    populateThreads();
    updateDownloadButton();
}

function populateThreads() {
    if (threadSelect.childElementCount > 0) {
        return;
    }
    for (let i = 1; i <= 10; i += 1) {
        const option = document.createElement('option');
        option.value = i;
        option.textContent = `${i}`;
        if (i === 4) {
            option.selected = true;
        }
        threadSelect.appendChild(option);
    }
}

function updateDownloadButton() {
    const hasFile = Boolean(state.filePath);
    const hasVideo = state.selectedVideo !== null && state.selectedVideo !== undefined;
    const hasFolder = Boolean(state.downloadFolder);
    const hasName = filenameInput.value.trim().length > 0;

    downloadBtn.disabled = !(hasFile && hasVideo && hasFolder && hasName);
}

function resetProgress() {
    progressFill.style.width = '0%';
    progressPercent.textContent = '0%';
    progressContainer.style.display = 'none';
    successSection.style.display = 'none';
}

function handleFile(file) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.m3u8')) {
        showError(errorMessage, 'Пожалуйста, выберите файл с расширением .m3u8');
        return;
    }
    hideError(errorMessage);
    state.filePath = file.path;
    state.fileName = file.name;
    fileNameLabel.textContent = file.name;
    fileMeta.hidden = false;
    analyzeBtn.disabled = false;
    resetTracks();
    const baseName = file.name.replace(/\.m3u8$/i, '');
    filenameInput.value = baseName;
    updateDownloadButton();
}

async function analyzeFile() {
    if (!state.filePath) return;
    try {
        analyzeBtn.disabled = true;
        analyzeBtn.textContent = 'Анализ...';
        hideError(errorMessage);
        resetTracks();

        const tracks = await window.electronAPI.getTracks(state.filePath);
        state.videoTracks = Array.isArray(tracks.video) ? tracks.video : [];
        state.audioTracks = Array.isArray(tracks.audio) ? tracks.audio : [];

        if (state.videoTracks.length === 0) {
            showError(errorMessage, 'Видео-дорожки не найдены в плейлисте.');
            analyzeBtn.textContent = 'Показать дорожки';
            analyzeBtn.disabled = false;
            return;
        }

        state.selectedVideo = state.videoTracks[0]?.id ?? null;
        state.selectedAudio = null;

        tracksSection.hidden = false;
        renderTracks();
        revealSettings();
    } catch (error) {
        console.error('Ошибка анализа файла:', error);
        const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
        showError(errorMessage, `Не удалось разобрать файл: ${message}`);
    } finally {
        analyzeBtn.textContent = 'Показать дорожки';
        analyzeBtn.disabled = false;
    }
}

async function initializeDownloadPath() {
    try {
        const defaultPath = await window.electronAPI.getDownloadsPath();
        if (defaultPath) {
            state.downloadFolder = defaultPath;
            downloadPath.textContent = defaultPath;
            downloadPath.title = defaultPath;
        }
    } catch (error) {
        console.error('Не удалось получить папку загрузок:', error);
    } finally {
        updateDownloadButton();
    }
}

async function selectFolder() {
    try {
        const folder = await window.electronAPI.selectFolder();
        if (folder) {
            state.downloadFolder = folder;
            downloadPath.textContent = folder;
            downloadPath.title = folder;
            updateDownloadButton();
        }
    } catch (error) {
        console.error('Ошибка выбора папки:', error);
        showError(downloadError, 'Не удалось открыть диалог выбора папки.');
    }
}

function animateProgress(value) {
    progressFill.style.width = `${value}%`;
    progressPercent.textContent = `${Math.round(value)}%`;
}

async function startDownload() {
    if (downloadBtn.disabled) {
        return;
    }
    hideError(downloadError);
    resetProgress();
    progressContainer.style.display = 'block';
    animateProgress(12);
    downloadBtn.disabled = true;

    try {
        const payload = {
            filePath: state.filePath,
            videoIndex: state.selectedVideo,
            audioIndex: state.selectedAudio,
            outputDir: state.downloadFolder,
            filename: filenameInput.value.trim(),
            threads: Number(threadSelect.value) || 1,
        };

        const result = await window.electronAPI.startDownload(payload);

        if (!result || !result.success) {
            throw new Error(result?.error || 'Скачивание завершилось с ошибкой');
        }

        animateProgress(100);
        state.downloadResultPath = result.output_path;
        successSection.style.display = 'block';
        downloadBtn.disabled = false;
    } catch (error) {
        console.error('Ошибка скачивания:', error);
        const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
        showError(downloadError, `Не удалось скачать файл: ${message}`);
        downloadBtn.disabled = false;
        progressContainer.style.display = 'none';
    }
}

async function showDownloadedFile() {
    if (!state.downloadResultPath) {
        return;
    }
    try {
        await window.electronAPI.showFile(state.downloadResultPath);
    } catch (error) {
        console.error('Ошибка открытия папки:', error);
        showError(downloadError, 'Не удалось открыть расположение файла.');
    }
}

function setupDragAndDrop() {
    dropZone.addEventListener('dragover', (event) => {
        event.preventDefault();
        dropZone.classList.add('dragover');
    });

    dropZone.addEventListener('dragleave', (event) => {
        event.preventDefault();
        dropZone.classList.remove('dragover');
    });

    dropZone.addEventListener('drop', (event) => {
        event.preventDefault();
        dropZone.classList.remove('dragover');
        const files = Array.from(event.dataTransfer.files || []);
        const file = files.find((item) => item.name.toLowerCase().endsWith('.m3u8'));
        if (file) {
            handleFile(file);
        } else {
            showError(errorMessage, 'Здесь можно разместить только файлы формата .m3u8');
        }
    });

    dropZone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (event) => {
        const file = event.target.files?.[0];
        if (file) {
            handleFile(file);
        }
    });
}

function setupEvents() {
    themeToggle.addEventListener('click', toggleTheme);
    analyzeBtn.addEventListener('click', analyzeFile);
    filenameInput.addEventListener('input', updateDownloadButton);
    threadSelect.addEventListener('change', updateDownloadButton);
    downloadBtn.addEventListener('click', startDownload);
    selectFolderBtn.addEventListener('click', selectFolder);
    downloadPath.addEventListener('click', selectFolder);
    downloadPath.addEventListener('keypress', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            selectFolder();
        }
    });
    showFileBtn.addEventListener('click', showDownloadedFile);
}

function init() {
    applyTheme();
    setupDragAndDrop();
    setupEvents();
    initializeDownloadPath();
    resetProgress();
}

window.addEventListener('DOMContentLoaded', init);
