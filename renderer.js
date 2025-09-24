const state = {
    theme: localStorage.getItem('theme') || 'light',
    currentStep: 'file-selection', // file-selection, track-selection, download-settings
    filePath: null,
    fileName: null,
    videoTracks: [],
    audioTracks: [],
    selectedVideo: null,
    selectedAudio: null,
    downloadFolder: null,
    downloadResultPath: null,
};

// DOM элементы - получаем безопасно после загрузки DOM
let themeToggle, themeIcon, themeText, backBtn, nextBtn, dropZone, fileInput, errorMessage;
let fileMeta, fileNameLabel, analyzeBtn, tracksSection, videoTracksList, audioTracksList;
let settingsSection, threadRange, threadValue, filenameInput, downloadPath, selectFolderBtn;
let downloadBtn, progressContainer, progressFill, progressPercent, progressStatus, progressStages;
let logContainer, logToggle, logContent, successSection, showFileBtn, downloadError;

// Флаги для предотвращения race conditions
let isDownloading = false;
let currentProgressListener = null;
let currentTrackRenderKey = null;
let logEntryCount = 0;
const MAX_LOG_ENTRIES = 100;
let lastLoggedProgress = -1;
let lastLoggedStatus = '';
let defaultThreadValue = 4;

function initDomElements() {
    themeToggle = document.getElementById('themeToggle');
    themeIcon = document.getElementById('themeIcon');
    themeText = document.getElementById('themeText');
    backBtn = document.getElementById('backBtn');
    nextBtn = document.getElementById('nextBtn');
    dropZone = document.getElementById('dropZone');
    fileInput = document.getElementById('fileInput');
    errorMessage = document.getElementById('errorMessage');
    fileMeta = document.getElementById('fileMeta');
    fileNameLabel = document.getElementById('fileName');
    analyzeBtn = document.getElementById('analyzeBtn');
    tracksSection = document.getElementById('tracksSection');
    videoTracksList = document.getElementById('videoTracks');
    audioTracksList = document.getElementById('audioTracks');
    settingsSection = document.getElementById('settingsSection');
    threadRange = document.getElementById('threadRange');
    threadValue = document.getElementById('threadValue');
    filenameInput = document.getElementById('filename');
    downloadPath = document.getElementById('downloadPath');
    selectFolderBtn = document.getElementById('selectFolderBtn');
    downloadBtn = document.getElementById('downloadBtn');
    progressContainer = document.getElementById('progressContainer');
    progressFill = document.getElementById('progressFill');
    progressPercent = document.getElementById('progressPercent');
    progressStatus = document.getElementById('progressStatus');
    progressStages = document.getElementById('progressStages');
    logContainer = document.getElementById('logContainer');
    logToggle = document.getElementById('logToggle');
    logContent = document.getElementById('logContent');
    successSection = document.getElementById('successSection');
    showFileBtn = document.getElementById('showFileBtn');
    downloadError = document.getElementById('downloadError');

    if (threadRange) {
        const rawDefault = Number(threadRange.defaultValue ?? threadRange.value ?? threadRange.min);
        defaultThreadValue = Number.isFinite(rawDefault) ? rawDefault : 4;
    }
}

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

function showStep(stepName) {
    // Hide all steps
    document.querySelectorAll('.step').forEach(step => {
        step.hidden = true;
    });

    // Show current step
    const currentStepElement = document.getElementById(stepName);
    if (currentStepElement) {
        currentStepElement.hidden = false;
    }

    // Update back button visibility
    const backBtn = document.getElementById('backBtn');
    if (backBtn) {
        backBtn.classList.toggle('hidden', stepName === 'file-selection');
    }

    state.currentStep = stepName;
}

function goToNextStep() {
    if (state.currentStep === 'file-selection') {
        showStep('track-selection');
    } else if (state.currentStep === 'track-selection') {
        showStep('download-settings');
        // Инициализируем загрузки при переходе к настройкам
        initializeDownloadPath();
        updateDownloadButton();
    }
}

function goToPreviousStep() {
    if (state.currentStep === 'track-selection') {
        resetDownloadWorkflow({ preserveFolder: true });
        showStep('file-selection');
    } else if (state.currentStep === 'download-settings') {
        showStep('track-selection');
    }
}

function toggleTheme() {
    state.theme = state.theme === 'light' ? 'dark' : 'light';
    localStorage.setItem('theme', state.theme);
    applyTheme();
}

function showError(container, message) {
    container.textContent = message;
    container.classList.add('visible');
    container.classList.remove('hidden');
}

function hideError(container) {
    container.classList.remove('visible');
    container.classList.add('hidden');
}

function resetTracks() {
    state.videoTracks = [];
    state.audioTracks = [];
    state.selectedVideo = null;
    state.selectedAudio = null;
    if (videoTracksList) {
        videoTracksList.innerHTML = '';
    }
    if (audioTracksList) {
        audioTracksList.innerHTML = '';
    }
    currentTrackRenderKey = null;
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

    // Radio button indicator
    const radio = document.createElement('div');
    radio.className = 'track-radio';

    // Track info container
    const info = document.createElement('div');
    info.className = 'track-info';

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
        if (track.bandwidth) parts.push(`${formatBandwidth(track.bandwidth)}`);
        if (track.codec) parts.push(`${track.codec}`);
        if (track.frame_rate) parts.push(`${track.frame_rate} FPS`);
        details.textContent = parts.join(' • ') || 'Основное качество';
    } else {
        const parts = [];
        if (track.language) parts.push(`${track.language.toUpperCase()}`);
        if (track.is_default) parts.push('По умолчанию');
        if (track.codec) parts.push(`${track.codec}`);
        details.textContent = parts.join(' • ') || 'Стандартный звук';
    }

    info.appendChild(title);
    info.appendChild(details);
    element.appendChild(radio);
    element.appendChild(info);
    return element;
}

function attachTrackListHandlers() {
    if (videoTracksList && !videoTracksList.dataset.listenerAttached) {
        videoTracksList.addEventListener('click', handleTrackSelection);
        videoTracksList.dataset.listenerAttached = 'true';
    }
    if (audioTracksList && !audioTracksList.dataset.listenerAttached) {
        audioTracksList.addEventListener('click', handleTrackSelection);
        audioTracksList.dataset.listenerAttached = 'true';
    }
}

function handleTrackSelection(event) {
    const button = event.target.closest('.track-item');
    if (!button) {
        return;
    }

    const type = button.dataset.type;
    const id = Number(button.dataset.id);

    if (type === 'video') {
        state.selectedVideo = Number.isNaN(id) ? null : id;
    } else if (type === 'audio') {
        state.selectedAudio = Number.isNaN(id) ? null : id;
    }

    updateTrackSelections();
    updateNextButton();
}

function updateTrackSelections() {
    if (!videoTracksList || !audioTracksList) {
        return;
    }

    videoTracksList.querySelectorAll('.track-item').forEach((item) => {
        const id = Number(item.dataset.id);
        if (!Number.isNaN(id) && state.selectedVideo === id) {
            item.classList.add('selected');
        } else {
            item.classList.remove('selected');
        }
    });

    audioTracksList.querySelectorAll('.track-item').forEach((item) => {
        const id = Number(item.dataset.id);
        if (!Number.isNaN(id) && state.selectedAudio === id) {
            item.classList.add('selected');
        } else {
            item.classList.remove('selected');
        }
    });
}

function renderTracks(force = false) {
    if (!videoTracksList || !audioTracksList) {
        console.error('DOM elements not ready for renderTracks');
        return;
    }

    attachTrackListHandlers();

    const renderKey = `${state.filePath || ''}:${state.videoTracks.length}:${state.audioTracks.length}`;
    if (force || currentTrackRenderKey !== renderKey) {
        const videoFragment = document.createDocumentFragment();
        state.videoTracks.forEach((track) => {
            const element = createTrackElement(track, 'video');
            videoFragment.appendChild(element);
        });
        videoTracksList.replaceChildren(videoFragment);

        const audioFragment = document.createDocumentFragment();
        state.audioTracks.forEach((track) => {
            const element = createTrackElement(track, 'audio');
            audioFragment.appendChild(element);
        });
        audioTracksList.replaceChildren(audioFragment);

        currentTrackRenderKey = renderKey;
    }

    updateTrackSelections();
}


function getDefaultVideoId() {
    if (!Array.isArray(state.videoTracks) || state.videoTracks.length === 0) {
        return null;
    }
    const lastTrack = state.videoTracks[state.videoTracks.length - 1];
    return typeof lastTrack?.id === 'number' ? lastTrack.id : null;
}

function getDefaultAudioId() {
    if (!Array.isArray(state.audioTracks) || state.audioTracks.length === 0) {
        return null;
    }
    const preferred = state.audioTracks.find((track) => track.is_default);
    const target = preferred || state.audioTracks[0];
    return typeof target?.id === 'number' ? target.id : null;
}


function updateThreadValue() {
    threadValue.textContent = threadRange.value;
}

function validateFileName(filename) {
    if (!filename || typeof filename !== 'string') {
        return false;
    }
    const trimmed = filename.trim();
    if (trimmed.length === 0 || trimmed.length > 200) {
        return false;
    }
    // Check for invalid characters
    const invalidChars = /[<>:"/\\|?*]/;
    return !invalidChars.test(trimmed);
}

function validateDownloadFolder(path) {
    return Boolean(path && typeof path === 'string' && path.trim().length > 0);
}

function updateNextButton() {
    if (nextBtn) {
        const hasVideo = state.selectedVideo !== null && state.selectedVideo !== undefined;
        nextBtn.disabled = !hasVideo;
    }
}

function updateDownloadButton() {
    if (!downloadBtn || !filenameInput) {
        console.error('Download button or filename input not found');
        return;
    }

    const hasFile = Boolean(state.filePath);
    const hasVideo = state.selectedVideo !== null && state.selectedVideo !== undefined;
    const hasFolder = validateDownloadFolder(state.downloadFolder);
    const hasName = validateFileName(filenameInput.value);

    downloadBtn.disabled = !(hasFile && hasVideo && hasFolder && hasName);
}

function resetProgress() {
    ProgressTracker.reset();
    if (progressFill) {
        progressFill.style.width = '0%';
    }
    if (progressPercent) {
        progressPercent.textContent = '0%';
    }
    if (progressStatus) {
        progressStatus.textContent = 'Подготовка…';
    }
    if (progressContainer) {
        progressContainer.classList.remove('visible');
    }
    if (successSection) {
        successSection.classList.remove('visible');
    }
    resetStages();
    clearLog();
    lastLoggedProgress = -1;
    lastLoggedStatus = '';
    if (logContent) {
        logContent.classList.remove('expanded');
    }
    if (logToggle) {
        logToggle.textContent = '↓';
    }
}

function resetStages() {
    const stages = progressStages.querySelectorAll('.stage');
    stages.forEach(stage => {
        stage.classList.remove('active', 'completed');
    });
}

function setStageActive(stageType) {
    const stages = progressStages.querySelectorAll('.stage');
    stages.forEach((stage) => {
        if (stage.dataset.stage === stageType) {
            stage.classList.add('active');
        } else if (!stage.classList.contains('completed')) {
            stage.classList.remove('active');
        }
    });
}

function setStageCompleted(stageType) {
    const stage = progressStages.querySelector(`[data-stage="${stageType}"]`);
    if (stage) {
        stage.classList.remove('active');
        stage.classList.add('completed');
    }
}

function clearLog() {
    if (!logContent) {
        return;
    }
    while (logContent.firstChild) {
        logContent.removeChild(logContent.firstChild);
    }
    logEntryCount = 0;
}

function detachProgressListener() {
    if (currentProgressListener) {
        window.electronAPI.removeProgressListener();
        currentProgressListener = null;
    }
}

function resetDownloadWorkflow({ preserveFolder = true } = {}) {
    detachProgressListener();
    isDownloading = false;

    state.filePath = null;
    state.fileName = null;

    state.videoTracks = [];
    state.audioTracks = [];
    state.selectedVideo = null;
    state.selectedAudio = null;
    state.downloadResultPath = null;
    currentTrackRenderKey = null;

    resetTracks();
    if (tracksSection) {
        tracksSection.hidden = true;
    }
    resetProgress();

    if (dropZone) {
        dropZone.classList.remove('dragover');
    }

    if (fileInput) {
        fileInput.value = '';
    }

    if (filenameInput) {
        filenameInput.value = '';
    }

    if (threadRange) {
        threadRange.value = `${defaultThreadValue}`;
        if (threadValue) {
            updateThreadValue();
        }
    }

    if (!preserveFolder) {
        state.downloadFolder = null;
        if (downloadPath) {
            downloadPath.textContent = 'Определяется…';
            downloadPath.title = '';
        }
    }

    if (errorMessage) {
        hideError(errorMessage);
    }
    if (downloadError) {
        hideError(downloadError);
    }

    if (downloadBtn) {
        downloadBtn.disabled = true;
        downloadBtn.textContent = 'Скачать';
    }

    if (nextBtn) {
        nextBtn.disabled = true;
    }

    if (analyzeBtn) {
        analyzeBtn.disabled = false;
        analyzeBtn.textContent = 'Показать дорожки';
    }

    updateNextButton();
    updateDownloadButton();
}

function addLogEntry(message, type = 'info') {
    if (!logContent) {
        console.error('Log content element not ready');
        return;
    }

    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;

    // Безопасная очистка сообщения от потенциального HTML
    const sanitizedMessage = String(message).replace(/[<>&"']/g, (char) => {
        const entities = {
            '<': '&lt;',
            '>': '&gt;',
            '&': '&amp;',
            '"': '&quot;',
            "'": '&#x27;'
        };
        return entities[char];
    });

    entry.textContent = `${new Date().toLocaleTimeString()} - ${sanitizedMessage}`;
    logContent.appendChild(entry);
    logEntryCount += 1;
    logContent.scrollTop = logContent.scrollHeight;

    while (logEntryCount > MAX_LOG_ENTRIES && logContent.firstChild) {
        logContent.removeChild(logContent.firstChild);
        logEntryCount -= 1;
    }
}

function toggleLog() {
    const isExpanded = logContent.classList.contains('expanded');
    if (isExpanded) {
        logContent.classList.remove('expanded');
        logToggle.textContent = '↓';
    } else {
        logContent.classList.add('expanded');
        logToggle.textContent = '↑';
    }
}

function handleFile(file) {
    if (!file) return;

    // Улучшенная валидация файла
    if (!file.name.toLowerCase().endsWith('.m3u8')) {
        showError(errorMessage, 'Пожалуйста, выберите файл с расширением .m3u8');
        return;
    }

    // Проверяем размер файла (максимум 10MB для M3U8)
    if (file.size > 10 * 1024 * 1024) {
        showError(errorMessage, 'Файл слишком большой. M3U8 файлы обычно меньше 10MB.');
        return;
    }

    // M3U8 файлы могут иметь различные MIME типы или вообще не иметь их
    // Поэтому полагаемся в основном на расширение файла

    resetDownloadWorkflow({ preserveFolder: true });
    hideError(errorMessage);
    state.filePath = file.path;
    state.fileName = file.name;

    // Автоматически анализируем файл и переходим к следующему блоку
    analyzeFileAndProceed();
}

async function analyzeFileAndProceed() {
    if (!state.filePath) return;

    const targetFile = state.filePath;
    try {
        hideError(errorMessage);
        resetTracks();

        // Анализируем файл
        const tracks = await window.electronAPI.getTracks(targetFile);
        if (state.filePath !== targetFile) {
            // Пользователь выбрал другой файл во время анализа
            return;
        }
        state.videoTracks = Array.isArray(tracks.video) ? tracks.video : [];
        state.audioTracks = Array.isArray(tracks.audio) ? tracks.audio : [];

        if (state.videoTracks.length === 0) {
            showError(errorMessage, 'Видео-дорожки не найдены в плейлисте.');
            return;
        }

        state.selectedVideo = getDefaultVideoId();
        state.selectedAudio = getDefaultAudioId();

        // Заполняем имя файла
        const baseName = state.fileName.replace(/\.m3u8$/i, '');
        filenameInput.value = baseName;

        renderTracks();
        updateNextButton();
        showStep('track-selection');
    } catch (error) {
        console.error('Ошибка анализа файла:', error);
        const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
        showError(errorMessage, `Не удалось разобрать файл: ${message}`);
    }
}

async function analyzeFile() {
    if (!state.filePath) return;
    const targetFile = state.filePath;
    try {
        analyzeBtn.disabled = true;
        analyzeBtn.textContent = 'Анализ...';
        hideError(errorMessage);
        resetTracks();

        const tracks = await window.electronAPI.getTracks(targetFile);
        if (state.filePath !== targetFile) {
            return;
        }
        state.videoTracks = Array.isArray(tracks.video) ? tracks.video : [];
        state.audioTracks = Array.isArray(tracks.audio) ? tracks.audio : [];

        if (state.videoTracks.length === 0) {
            showError(errorMessage, 'Видео-дорожки не найдены в плейлисте.');
            analyzeBtn.textContent = 'Показать дорожки';
            analyzeBtn.disabled = false;
            return;
        }

        state.selectedVideo = getDefaultVideoId();
        state.selectedAudio = getDefaultAudioId();

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

// Система детального отслеживания прогресса
const ProgressTracker = {
    currentProgress: 0,

    reset() {
        this.currentProgress = 0;
        progressFill.style.width = '0%';
        progressPercent.textContent = '0%';
        progressStatus.textContent = 'Подготовка…';
        resetStages();
    },

    setProgress(progress, status) {
        const clamped = Math.min(100, Math.max(0, progress));

        // Плавная анимация прогресс-бара
        if (Math.abs(clamped - this.currentProgress) > 0.1) {
            this.animateProgress(this.currentProgress, clamped);
        }

        this.currentProgress = clamped;
        progressPercent.textContent = `${Math.round(clamped)}%`;
        if (status) {
            progressStatus.textContent = status;
        }
        this.updateStages(clamped);
    },

    animateProgress(from, to) {
        const duration = 800; // 800ms анимация
        const startTime = performance.now();
        const difference = to - from;

        const animate = (currentTime) => {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1);

            // Использование easing функции для плавности
            const easeOutCubic = 1 - Math.pow(1 - progress, 3);
            const currentValue = from + (difference * easeOutCubic);

            progressFill.style.width = `${currentValue}%`;

            if (progress < 1) {
                requestAnimationFrame(animate);
            } else {
                progressFill.style.width = `${to}%`;
            }
        };

        requestAnimationFrame(animate);
    },

    updateStages(progress) {
        if (progress >= 100) {
            setStageCompleted('video');
            setStageCompleted('audio');
            setStageCompleted('merge');
            return;
        }

        if (progress >= 85) {
            setStageCompleted('video');
            setStageCompleted('audio');
            setStageActive('merge');
        } else if (progress >= 60) {
            setStageCompleted('video');
            setStageActive('audio');
        } else {
            setStageActive('video');
        }
    }
};

async function startDownload() {
    // Защита от двойных кликов
    if (downloadBtn.disabled || isDownloading) {
        return;
    }

    // Additional validation before starting
    if (!state.filePath) {
        showError(downloadError, 'Выберите файл M3U8');
        return;
    }
    if (state.selectedVideo === null || state.selectedVideo === undefined) {
        showError(downloadError, 'Выберите видео дорожку');
        return;
    }
    if (!validateDownloadFolder(state.downloadFolder)) {
        showError(downloadError, 'Выберите папку для сохранения');
        return;
    }
    if (!validateFileName(filenameInput.value)) {
        showError(downloadError, 'Введите корректное имя файла (без символов < > : " / \\ | ? *)');
        return;
    }

    // Устанавливаем флаги блокировки
    isDownloading = true;
    hideError(downloadError);
    resetProgress();
    progressContainer.classList.add('visible');
    downloadBtn.disabled = true;
    downloadBtn.textContent = 'Скачивается...';

    // Лог остается свернутым по умолчанию

    try {
        addLogEntry('Начинается процесс скачивания', 'info');

        // Set initial stage
        setStageActive('video');
        ProgressTracker.setProgress(1, 'Подготовка к скачиванию...');

        // Очищаем предыдущий listener если есть
        detachProgressListener();

        currentProgressListener = (progressData) => {
            const rawProgress = Number(progressData?.progress ?? 0);
            const progress = Math.min(100, Math.max(0, rawProgress));
            const status = typeof progressData?.status === 'string' && progressData.status.trim().length > 0
                ? progressData.status.trim()
                : 'Загрузка...';

            ProgressTracker.setProgress(progress, status);

            if (Math.abs(progress - lastLoggedProgress) >= 1 || status !== lastLoggedStatus) {
                addLogEntry(`${Math.round(progress)}% — ${status}`, 'info');
                lastLoggedProgress = progress;
                lastLoggedStatus = status;
            }
        };

        window.electronAPI.onDownloadProgress(currentProgressListener);

        const payload = {
            filePath: state.filePath,
            videoIndex: state.selectedVideo,
            audioIndex: state.selectedAudio,
            outputDir: state.downloadFolder,
            filename: filenameInput.value.trim(),
            threads: Number(threadRange.value) || 1,
        };

        addLogEntry('Запуск FFmpeg для скачивания сегментов', 'info');
        ProgressTracker.setProgress(2, 'Инициализация загрузки...');

        // Start real download with progress tracking
        const result = await window.electronAPI.startDownload(payload);

        if (!result || !result.success) {
            throw new Error(result?.error || 'Скачивание завершилось с ошибкой');
        }

        ProgressTracker.setProgress(100, 'Загрузка завершена');
        setStageCompleted('video');
        setStageCompleted('audio');
        setStageCompleted('merge');

        state.downloadResultPath = result.output_path;
        addLogEntry(`Файл успешно сохранен: ${result.output_path}`, 'success');
        successSection.classList.add('visible');
    } catch (error) {
        console.error('Ошибка скачивания:', error);
        const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
        addLogEntry(`Ошибка: ${message}`, 'error');
        showError(downloadError, `Не удалось скачать файл: ${message}`);
        resetStages();
        progressContainer.classList.remove('visible');
    } finally {
        // Всегда восстанавливаем состояние
        isDownloading = false;
        downloadBtn.disabled = false;
        downloadBtn.textContent = 'Скачать';

        // Clean up progress listener
        detachProgressListener();
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
    if (!themeToggle || !downloadBtn || !nextBtn) {
        console.error('Critical DOM elements not found in setupEvents');
        return false;
    }

    themeToggle.addEventListener('click', toggleTheme);
    backBtn.addEventListener('click', goToPreviousStep);
    nextBtn.addEventListener('click', goToNextStep);
    if (analyzeBtn) analyzeBtn.addEventListener('click', analyzeFile);
    filenameInput.addEventListener('input', updateDownloadButton);
    threadRange.addEventListener('input', () => {
        updateThreadValue();
        updateDownloadButton();
    });
    downloadBtn.addEventListener('click', startDownload);
    selectFolderBtn.addEventListener('click', selectFolder);
    downloadPath.addEventListener('click', selectFolder);
    downloadPath.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            selectFolder();
        } else if (event.key === ' ') {
            event.preventDefault();
            selectFolder();
        }
    });
    showFileBtn.addEventListener('click', showDownloadedFile);
    logToggle.addEventListener('click', toggleLog);
    return true;
}

function init() {
    // Инициализируем DOM элементы
    initDomElements();

    // Проверяем что все элементы загружены
    if (!themeToggle || !dropZone || !downloadBtn) {
        console.error('Critical DOM elements not found, retrying in 100ms');
        setTimeout(init, 100);
        return;
    }

    applyTheme();
    setupDragAndDrop();

    // Проверяем что события установились успешно
    if (!setupEvents()) {
        console.error('Failed to setup events, retrying in 100ms');
        setTimeout(init, 100);
        return;
    }

    initializeDownloadPath();
    resetProgress();
    showStep('file-selection'); // Показываем первый блок
}

// Безопасная инициализация с проверкой готовности DOM
if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', init);
} else {
    // DOM уже загружен
    init();
}
