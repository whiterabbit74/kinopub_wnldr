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
let isRenderingTracks = false;
let isDownloading = false;
let currentProgressListener = null;

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
        backBtn.style.display = stepName === 'file-selection' ? 'none' : 'block';
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

function renderTracks() {
    // Предотвращаем race condition
    if (isRenderingTracks) {
        return;
    }
    isRenderingTracks = true;

    try {
        if (!videoTracksList || !audioTracksList) {
            console.error('DOM elements not ready for renderTracks');
            return;
        }

        videoTracksList.innerHTML = '';
        audioTracksList.innerHTML = '';

        state.videoTracks.forEach((track) => {
            const element = createTrackElement(track, 'video');
            if (state.selectedVideo === track.id) {
                element.classList.add('selected');
            }
            element.addEventListener('click', () => {
                if (!isRenderingTracks) {
                    state.selectedVideo = track.id;
                    // Используем debounced перерисовку
                    debounceRenderTracks();
                    updateNextButton();
                }
            });
            videoTracksList.appendChild(element);
        });

    const emptyAudio = document.createElement('button');
    emptyAudio.type = 'button';
    emptyAudio.className = 'track-item';
    emptyAudio.dataset.type = 'audio';
    emptyAudio.dataset.id = '-1';

    const radio = document.createElement('div');
    radio.className = 'track-radio';

    const info = document.createElement('div');
    info.className = 'track-info';

    const title = document.createElement('div');
    title.className = 'track-title';
    title.textContent = 'Использовать звук из видео';

    const details = document.createElement('div');
    details.className = 'track-details';
    details.textContent = 'Отдельная аудиодорожка не скачается';

    info.appendChild(title);
    info.appendChild(details);
    emptyAudio.appendChild(radio);
    emptyAudio.appendChild(info);
    if (state.selectedAudio === null) {
        emptyAudio.classList.add('selected');
    }
    emptyAudio.addEventListener('click', () => {
        if (!isRenderingTracks) {
            state.selectedAudio = null;
            debounceRenderTracks();
            updateNextButton();
        }
    });
    audioTracksList.appendChild(emptyAudio);

    state.audioTracks.forEach((track) => {
        const element = createTrackElement(track, 'audio');
        if (state.selectedAudio === track.id) {
            element.classList.add('selected');
        }
        element.addEventListener('click', () => {
            if (!isRenderingTracks) {
                state.selectedAudio = track.id;
                // Используем debounced перерисовку
                debounceRenderTracks();
                updateNextButton();
            }
        });
        audioTracksList.appendChild(element);
    });
    } finally {
        isRenderingTracks = false;
    }
}

// Debounced версия renderTracks для предотвращения множественных вызовов
let renderTracksTimeout = null;
function debounceRenderTracks() {
    if (renderTracksTimeout) {
        clearTimeout(renderTracksTimeout);
    }
    renderTracksTimeout = setTimeout(() => {
        renderTracks();
        renderTracksTimeout = null;
    }, 50);
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
    progressFill.style.width = '0%';
    progressPercent.textContent = '0%';
    progressStatus.textContent = 'Подготовка…';
    progressContainer.style.display = 'none';
    successSection.style.display = 'none';
    resetStages();
    clearLog();
}

function resetStages() {
    const stages = progressStages.querySelectorAll('.stage');
    stages.forEach(stage => {
        stage.classList.remove('active', 'completed');
    });
}

function setStageActive(stageType) {
    resetStages();
    const stage = progressStages.querySelector(`[data-stage="${stageType}"]`);
    if (stage) {
        stage.classList.add('active');
    }
}

function setStageCompleted(stageType) {
    const stage = progressStages.querySelector(`[data-stage="${stageType}"]`);
    if (stage) {
        stage.classList.remove('active');
        stage.classList.add('completed');
    }
}

function clearLog() {
    logContent.innerHTML = '';
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
    logContent.scrollTop = logContent.scrollHeight;

    // Ограничиваем количество записей в логе (максимум 100)
    const entries = logContent.querySelectorAll('.log-entry');
    if (entries.length > 100) {
        logContent.removeChild(entries[0]);
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

    hideError(errorMessage);
    state.filePath = file.path;
    state.fileName = file.name;

    // Автоматически анализируем файл и переходим к следующему блоку
    analyzeFileAndProceed();
}

async function analyzeFileAndProceed() {
    if (!state.filePath) return;

    try {
        hideError(errorMessage);
        resetTracks();

        // Добавляем таймаут для операции
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Таймаут анализа файла (30 сек)')), 30000);
        });

        const tracksPromise = window.electronAPI.getTracks(state.filePath);
        const tracks = await Promise.race([tracksPromise, timeoutPromise]);
        state.videoTracks = Array.isArray(tracks.video) ? tracks.video : [];
        state.audioTracks = Array.isArray(tracks.audio) ? tracks.audio : [];

        if (state.videoTracks.length === 0) {
            showError(errorMessage, 'Видео-дорожки не найдены в плейлисте.');
            return;
        }

        state.selectedVideo = state.videoTracks[0]?.id ?? null;
        state.selectedAudio = null;

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

function updateProgress(value, status) {
    progressFill.style.width = `${value}%`;
    progressPercent.textContent = `${Math.round(value)}%`;
    if (status) {
        progressStatus.textContent = status;
    }
}


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
    progressContainer.style.display = 'block';
    downloadBtn.disabled = true;
    downloadBtn.textContent = 'Скачивается...';

    // Лог остается свернутым по умолчанию

    try {
        addLogEntry('Начинается процесс скачивания', 'info');

        // Set initial stage
        setStageActive('video');
        updateProgress(5, 'Подготовка к скачиванию...');

        // Очищаем предыдущий listener если есть
        if (currentProgressListener) {
            window.electronAPI.removeProgressListener();
        }

        // Setup progress listener
        currentProgressListener = (progressData) => {
            const { progress, status } = progressData;

            // Более плавное обновление прогресса
            let currentProgress = parseInt(progressFill.style.width) || 0;
            let targetProgress = Math.min(100, Math.max(0, progress));

            // Плавная анимация к целевому прогрессу
            if (Math.abs(targetProgress - currentProgress) > 1) {
                const step = (targetProgress - currentProgress) / 10;
                const animate = () => {
                    currentProgress += step;
                    if ((step > 0 && currentProgress < targetProgress) || (step < 0 && currentProgress > targetProgress)) {
                        updateProgress(currentProgress, status);
                        requestAnimationFrame(animate);
                    } else {
                        updateProgress(targetProgress, status);
                    }
                };
                animate();
            } else {
                updateProgress(targetProgress, status);
            }

            // Синхронизируем этапы с реальным статусом
            let currentStage = 'video';
            let stageText = status || 'Скачивание...';

            if (status && status.includes('аудио')) {
                currentStage = 'audio';
            } else if (status && (status.includes('Финализация') || status.includes('Склеивание') || status.includes('мерж'))) {
                currentStage = 'merge';
            } else if (progress >= 85) {
                currentStage = 'merge';
                stageText = 'Финализация файла...';
            } else if (progress >= 50) {
                currentStage = 'audio';
                stageText = 'Обработка аудио...';
            }

            setStageActive(currentStage);

            addLogEntry(`${Math.round(targetProgress)}% - ${stageText}`, 'info');
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
        setStageActive('video');
        updateProgress(10, 'Скачивается видео...');

        // Start real download with progress tracking and timeout
        const downloadTimeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Таймаут скачивания (10 минут)')), 10 * 60 * 1000);
        });

        const downloadPromise = window.electronAPI.startDownload(payload);
        const result = await Promise.race([downloadPromise, downloadTimeoutPromise]);

        if (!result || !result.success) {
            throw new Error(result?.error || 'Скачивание завершилось с ошибкой');
        }

        // Complete all stages
        setStageCompleted('video');
        setStageCompleted('audio');
        setStageCompleted('merge');
        updateProgress(100, 'Загрузка завершена');

        state.downloadResultPath = result.output_path;
        addLogEntry(`Файл успешно сохранен: ${result.output_path}`, 'success');
        successSection.style.display = 'block';
    } catch (error) {
        console.error('Ошибка скачивания:', error);
        const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
        addLogEntry(`Ошибка: ${message}`, 'error');
        showError(downloadError, `Не удалось скачать файл: ${message}`);
        resetStages();
        progressContainer.style.display = 'none';
    } finally {
        // Всегда восстанавливаем состояние
        isDownloading = false;
        downloadBtn.disabled = false;
        downloadBtn.textContent = 'Скачать';

        // Clean up progress listener
        if (currentProgressListener) {
            window.electronAPI.removeProgressListener();
            currentProgressListener = null;
        }
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
