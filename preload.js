const { contextBridge, ipcRenderer } = require('electron');

// Define allowed IPC channels for security
const ALLOWED_CHANNELS = [
    'get-tracks',
    'start-download',
    'select-folder',
    'show-file',
    'get-downloads-path'
];

// Validate IPC channel
function isValidChannel(channel) {
    return ALLOWED_CHANNELS.includes(channel);
}

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
    // Get tracks from M3U8 file
    getTracks: async (filePath) => {
        if (typeof filePath !== 'string') {
            throw new Error('Invalid file path');
        }
        return await ipcRenderer.invoke('get-tracks', filePath);
    },

    // Start download process
    startDownload: async (options) => {
        if (!options || typeof options !== 'object') {
            throw new Error('Invalid download options');
        }

        const { filePath, videoIndex, audioIndex, outputDir, filename, threads } = options;

        if (typeof filePath !== 'string' ||
            typeof outputDir !== 'string' ||
            typeof filename !== 'string') {
            throw new Error('Invalid download parameters');
        }

        return await ipcRenderer.invoke('start-download', {
            filePath,
            videoIndex: typeof videoIndex === 'number' ? videoIndex : null,
            audioIndex: typeof audioIndex === 'number' ? audioIndex : null,
            outputDir,
            filename,
            threads: typeof threads === 'number' ? threads : 1
        });
    },

    // Select download folder
    selectFolder: async () => {
        return await ipcRenderer.invoke('select-folder');
    },

    // Show file in system file manager
    showFile: async (filePath) => {
        if (typeof filePath !== 'string') {
            throw new Error('Invalid file path');
        }
        return await ipcRenderer.invoke('show-file', filePath);
    },

    // Get default downloads path
    getDownloadsPath: async () => {
        return await ipcRenderer.invoke('get-downloads-path');
    },

    // Listen for download progress updates
    onDownloadProgress: (callback) => {
        if (typeof callback !== 'function') {
            throw new Error('Progress callback must be a function');
        }
        ipcRenderer.on('download-progress', (event, data) => callback(data));
    },

    // Remove progress listener
    removeProgressListener: () => {
        ipcRenderer.removeAllListeners('download-progress');
    },

    // Remove all listeners (for cleanup)
    removeAllListeners: () => {
        ALLOWED_CHANNELS.forEach(channel => {
            ipcRenderer.removeAllListeners(channel);
        });
        ipcRenderer.removeAllListeners('download-progress');
    }
});

// Security: Remove any global Node.js APIs that might be exposed
delete window.require;
delete window.exports;
delete window.module;

// Prevent navigation and new window creation for security
window.addEventListener('DOMContentLoaded', () => {
    // Prevent drag and drop of external content that could lead to navigation
    document.addEventListener('drop', (e) => {
        // Only allow file drops on specific elements
        if (!e.target.closest('.drop-zone')) {
            e.preventDefault();
        }
    });

    // Prevent navigation
    document.addEventListener('click', (e) => {
        if (e.target.tagName === 'A' && e.target.href) {
            e.preventDefault();
        }
    });
});

// Log initialization
console.log('Preload script loaded successfully');

// Export validation function for testing (development only)
if (process.env.NODE_ENV === 'development') {
    window.__electronAPI_isValidChannel = isValidChannel;
}