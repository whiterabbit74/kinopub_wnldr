// Theme management
let currentTheme = localStorage.getItem('theme') || 'light';

// DOM elements
const themeToggle = document.getElementById('themeToggle');
const themeIcon = document.getElementById('themeIcon');
const themeText = document.getElementById('themeText');
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const errorMessage = document.getElementById('errorMessage');
const tracksSection = document.getElementById('tracksSection');
const tracksList = document.getElementById('tracksList');
const downloadSection = document.getElementById('downloadSection');
const filenameInput = document.getElementById('filename');
const downloadPath = document.getElementById('downloadPath');
const selectFolderBtn = document.getElementById('selectFolderBtn');
const startDownloadBtn = document.getElementById('startDownloadBtn');
const progressContainer = document.getElementById('progressContainer');
const progressFill = document.getElementById('progressFill');
const progressPercent = document.getElementById('progressPercent');
const successSection = document.getElementById('successSection');
const showFileBtn = document.getElementById('showFileBtn');
const downloadError = document.getElementById('downloadError');

// Global state
let selectedFile = null;
let selectedTrack = null;
let selectedFolder = null;
let downloadedFilePath = null;

// Initialize theme
function initializeTheme() {
    document.documentElement.setAttribute('data-theme', currentTheme);
    updateThemeUI();
}

function updateThemeUI() {
    if (currentTheme === 'dark') {
        themeIcon.textContent = '☀️';
        themeText.textContent = 'Light';
    } else {
        themeIcon.textContent = '🌙';
        themeText.textContent = 'Dark';
    }
}

function toggleTheme() {
    currentTheme = currentTheme === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', currentTheme);
    localStorage.setItem('theme', currentTheme);
    updateThemeUI();
}

// Error handling
function showError(message, container = errorMessage) {
    container.textContent = message;
    container.style.display = 'block';
    setTimeout(() => {
        container.style.display = 'none';
    }, 5000);
}

function hideError(container = errorMessage) {
    container.style.display = 'none';
}

// File handling
function handleFile(file) {
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.m3u8')) {
        showError('Please select a valid M3U8 file.');
        return;
    }

    selectedFile = file;
    hideError();

    // Generate filename from file
    const baseName = file.name.replace(/\.m3u8$/i, '');
    filenameInput.value = baseName;

    // Analyze file for tracks
    analyzeFile(file);
}

async function analyzeFile(file) {
    try {
        const filePath = file.path;
        const tracks = await window.electronAPI.getTracks(filePath);

        if (tracks.length === 0) {
            showError('No video tracks found in the M3U8 file.');
            return;
        }

        displayTracks(tracks);
        tracksSection.style.display = 'block';

    } catch (error) {
        console.error('Error analyzing file:', error);
        showError('Failed to analyze M3U8 file. Please check the file format.');
    }
}

function displayTracks(tracks) {
    tracksList.innerHTML = '';

    tracks.forEach((track, index) => {
        const trackElement = document.createElement('div');
        trackElement.className = 'track-item';
        trackElement.dataset.index = index;

        const resolution = track.resolution || 'Unknown';
        const bandwidth = track.bandwidth ? formatBandwidth(track.bandwidth) : 'Unknown';
        const codec = track.codec || 'Unknown';

        trackElement.innerHTML = `
            <div class="track-info">
                <div class="track-title">Track ${index + 1} - ${resolution}</div>
                <div class="track-details">Bandwidth: ${bandwidth} | Codec: ${codec}</div>
            </div>
        `;

        trackElement.addEventListener('click', () => selectTrack(index, track, trackElement));
        tracksList.appendChild(trackElement);
    });
}

function selectTrack(index, track, element) {
    // Remove previous selection
    document.querySelectorAll('.track-item').forEach(item => {
        item.classList.remove('selected');
    });

    // Select current track
    element.classList.add('selected');
    selectedTrack = { index, ...track };

    // Show download section
    downloadSection.style.display = 'block';
    updateDownloadButton();
}

function formatBandwidth(bandwidth) {
    const bps = parseInt(bandwidth);
    if (bps >= 1000000) {
        return `${(bps / 1000000).toFixed(1)} Mbps`;
    } else if (bps >= 1000) {
        return `${(bps / 1000).toFixed(1)} Kbps`;
    }
    return `${bps} bps`;
}

// Download path management
async function selectDownloadFolder() {
    try {
        const folderPath = await window.electronAPI.selectFolder();
        if (folderPath) {
            selectedFolder = folderPath;
            downloadPath.textContent = folderPath;
            downloadPath.title = folderPath;
            updateDownloadButton();
        }
    } catch (error) {
        console.error('Error selecting folder:', error);
        showError('Failed to select download folder.');
    }
}

function updateDownloadButton() {
    const hasTrack = selectedTrack !== null;
    const hasFolder = selectedFolder !== null;
    const hasFilename = filenameInput.value.trim() !== '';

    startDownloadBtn.disabled = !(hasTrack && hasFolder && hasFilename);
}

// Download management
async function startDownload() {
    if (!selectedFile || !selectedTrack || !selectedFolder || !filenameInput.value.trim()) {
        showError('Please complete all required fields.');
        return;
    }

    try {
        hideError(downloadError);
        progressContainer.style.display = 'block';
        successSection.style.display = 'none';
        startDownloadBtn.disabled = true;

        const downloadOptions = {
            filePath: selectedFile.path,
            trackIndex: selectedTrack.index,
            outputDir: selectedFolder,
            filename: filenameInput.value.trim()
        };

        const result = await window.electronAPI.startDownload(downloadOptions);

        if (result.success) {
            downloadedFilePath = result.outputPath;
            showDownloadSuccess();
        } else {
            throw new Error(result.error || 'Download failed');
        }

    } catch (error) {
        console.error('Download error:', error);
        showError(error.message || 'Download failed. Please try again.', downloadError);
        progressContainer.style.display = 'none';
        startDownloadBtn.disabled = false;
    }
}

function showDownloadSuccess() {
    progressContainer.style.display = 'none';
    successSection.style.display = 'block';
    startDownloadBtn.disabled = false;
}

async function showDownloadedFile() {
    if (downloadedFilePath) {
        try {
            await window.electronAPI.showFile(downloadedFilePath);
        } catch (error) {
            console.error('Error showing file:', error);
            showError('Could not open file location.');
        }
    }
}

// Drag and drop handlers
function handleDragOver(e) {
    e.preventDefault();
    dropZone.classList.add('dragover');
}

function handleDragLeave(e) {
    e.preventDefault();
    dropZone.classList.remove('dragover');
}

function handleDrop(e) {
    e.preventDefault();
    dropZone.classList.remove('dragover');

    const files = Array.from(e.dataTransfer.files);
    const m3u8File = files.find(file => file.name.toLowerCase().endsWith('.m3u8'));

    if (m3u8File) {
        handleFile(m3u8File);
    } else {
        showError('Please drop a valid M3U8 file.');
    }
}

// Progress update handler
function updateProgress(percent) {
    progressFill.style.width = `${percent}%`;
    progressPercent.textContent = `${Math.round(percent)}%`;
}

// Initialize default download path
async function initializeDownloadPath() {
    try {
        const defaultPath = await window.electronAPI.getDownloadsPath();
        if (defaultPath) {
            selectedFolder = defaultPath;
            downloadPath.textContent = defaultPath;
            downloadPath.title = defaultPath;
            updateDownloadButton();
        }
    } catch (error) {
        console.error('Error getting default downloads path:', error);
    }
}

// Event listeners
themeToggle.addEventListener('click', toggleTheme);

dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('dragover', handleDragOver);
dropZone.addEventListener('dragleave', handleDragLeave);
dropZone.addEventListener('drop', handleDrop);

fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) handleFile(file);
});

filenameInput.addEventListener('input', updateDownloadButton);
selectFolderBtn.addEventListener('click', selectDownloadFolder);
downloadPath.addEventListener('click', selectDownloadFolder);
startDownloadBtn.addEventListener('click', startDownload);
showFileBtn.addEventListener('click', showDownloadedFile);

// Listen for download progress updates
window.electronAPI.onDownloadProgress((percent) => {
    updateProgress(percent);
});

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    initializeTheme();
    initializeDownloadPath();
});

// Prevent default drag behaviors on the document
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => e.preventDefault());