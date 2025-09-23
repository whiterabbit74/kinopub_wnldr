# Video Downloader - Electron App

A modern, Apple-style Electron application for downloading video streams from M3U8 playlist files. Features a clean interface with dark/light theme support and works exclusively with local M3U8 files.

## Features

- **Apple-style Design**: Clean, modern interface with San Francisco fonts and Apple design system
- **Dark/Light Theme**: Toggle between themes with persistent settings
- **M3U8 File Support**: Drag & drop or browse for M3U8 playlist files
- **Track Selection**: Choose from available video tracks with quality information
- **Progress Tracking**: Real-time download progress with percentage indicator
- **Folder Selection**: Choose custom download location
- **File Management**: "Show in Finder" functionality after download
- **Security**: Sandboxed preload script with IPC validation

## Screenshots

### Light Theme
- Clean, minimalist interface with muted colors
- Apple-style buttons and form elements
- Smooth transitions and hover effects

### Dark Theme
- Dark background with high contrast text
- Consistent design language across themes
- Easy on the eyes for extended use

## Installation

### Prerequisites

- Node.js (v14 or higher)
- Python 3.7+ (for M3U8 processing)
- FFmpeg (optional, for better video concatenation)

### Setup

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd kinopub-electron
   ```

2. **Install Node.js dependencies**
   ```bash
   npm install
   ```

3. **Install Python dependencies**
   ```bash
   pip install requests
   ```

4. **Optional: Install FFmpeg**
   ```bash
   # macOS (using Homebrew)
   brew install ffmpeg

   # Ubuntu/Debian
   sudo apt update && sudo apt install ffmpeg

   # Windows (using Chocolatey)
   choco install ffmpeg
   ```

## Usage

### Starting the Application

```bash
npm start
```

### Using the Application

1. **Select M3U8 File**
   - Drag and drop an M3U8 file onto the drop zone, or
   - Click the drop zone to browse and select a file

2. **Choose Track**
   - After file analysis, available tracks will be displayed
   - Click on a track to select it (shows resolution, bandwidth, codec)

3. **Configure Download**
   - Enter a filename for the output video
   - Select download folder (defaults to system Downloads folder)

4. **Start Download**
   - Click "Start Download" to begin the process
   - Monitor progress with the real-time progress bar

5. **Access Downloaded File**
   - Click "Show in Finder" when download completes

### Supported File Formats

- **Input**: M3U8 playlist files only
- **Output**: MP4 video files
- **Segments**: TS, M4S, MP4 segments

## Architecture

### Frontend (Renderer Process)
- **index.html**: Apple-style UI with CSS custom properties for theming
- **renderer.js**: Application logic, event handling, and progress updates
- **CSS**: Modern design with smooth transitions and responsive layout

### Backend Integration
- **preload.js**: Secure IPC bridge with channel validation
- **main.js**: Electron main process with Python script integration
- **python_script.py**: M3U8 parsing and download functionality
- **utils.py**: Utility functions for file processing

### Security Features
- Sandboxed renderer process
- IPC channel validation
- No direct Node.js API exposure
- Content Security Policy (CSP) ready

## Development

### Scripts

```bash
# Start development server
npm start

# Build for production (requires electron-builder setup)
npm run build

# Run linting
npm run lint

# Run tests
npm test
```

### File Structure

```
kinopub-electron/
├── index.html          # Main UI
├── renderer.js         # Frontend logic
├── preload.js          # Security bridge
├── main.js             # Electron main process
├── python_script.py    # M3U8 downloader
├── utils.py            # Python utilities
├── package.json        # Node.js configuration
├── .gitignore         # Git ignore rules
└── README.md          # Documentation
```

### Configuration

The application uses localStorage for theme persistence and automatically detects the system Downloads folder as the default download location.

## Troubleshooting

### Common Issues

1. **Python Script Not Found**
   - Ensure Python 3.7+ is installed and accessible
   - Check that `python_script.py` has execute permissions

2. **FFmpeg Not Available**
   - The app works without FFmpeg but provides better video quality with it
   - Install FFmpeg for optimal video concatenation

3. **Download Failures**
   - Check internet connection for online M3U8 playlists
   - Verify M3U8 file format and segment availability
   - Ensure write permissions in selected download folder

4. **Theme Not Persisting**
   - Check browser localStorage functionality
   - Clear application data and restart

### Debug Mode

Set `NODE_ENV=development` for additional debugging features and console output.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

This project is licensed under the MIT License. See LICENSE file for details.

## Acknowledgments

- Apple Human Interface Guidelines for design inspiration
- Electron community for framework support
- FFmpeg project for video processing capabilities

## Version History

- **v1.0.0**: Initial release with core functionality
  - M3U8 file support
  - Apple-style design
  - Dark/light theme toggle
  - Progress tracking
  - File management integration