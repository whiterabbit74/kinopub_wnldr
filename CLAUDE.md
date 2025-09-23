# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an Electron application for downloading videos from M3U8 playlists with an Apple-inspired design aesthetic. The app features a hybrid architecture combining Node.js/Electron for the UI and Python for M3U8 processing and video downloads.

## Architecture

### Process Communication Flow
1. **Renderer Process** (`renderer.js` + `index.html`) - UI layer handling file drag/drop, track selection, and progress display
2. **Main Process** (`main.js`) - Electron main process that bridges UI with Python backend via IPC
3. **Preload Script** (`preload.js`) - Security layer with IPC validation between renderer and main processes
4. **Python Backend** (`python_script.py` + `utils.py`) - M3U8 parsing and FFmpeg-based downloading

### Key Communication Pattern
- Renderer → Preload → Main → Python Script → FFmpeg
- Python responses are JSON-formatted and parsed by main process
- All IPC channels are validated in preload.js for security

### Python Integration
The main.js includes a `resolvePython()` function that searches for Python executables in this order:
1. Local virtual environments (`venv/`, `.venv/`)
2. System Python (`python3`, `python`)

Python scripts communicate via JSON stdout/stderr and expect these commands:
- `get-tracks <filepath>` - Parse M3U8 and return track information
- `download <filepath> --video <index> --audio <index> --output-dir <dir> --filename <name> --threads <count>`

## Common Commands

```bash
# Development
npm install              # Install dependencies
npm start               # Run in development mode
npm run dev             # Run with CSS watching (requires Tailwind setup)

# Building distributable app
npm run build           # Build for current platform
npm run build:mac       # Build specifically for macOS (creates .app, .dmg, .zip)

# ⚠️ ВАЖНО: По умолчанию собираем только ARM64!
npm run build:arm64               # Рекомендуемый способ сборки (только ARM64)
npm run build -- --mac --arm64   # Альтернативный способ

# The build outputs to dist/ directory and creates:
# - .app file for direct execution
# - .dmg installer for distribution
# - .zip archive for manual installation
```

## Dependencies

### Required for runtime:
- **Node.js** - Electron host
- **Python 3.9+** - M3U8 processing backend
- **FFmpeg** - Video downloading and processing (must be in PATH)

### Key Python modules used:
- `subprocess` for FFmpeg integration
- `pathlib` for cross-platform path handling
- Custom `utils.py` for M3U8 parsing

## Theme System

The app uses CSS custom properties for Apple-style light/dark theming. Theme state is persisted in localStorage and toggled via a button in the top-right corner. The design follows Apple's Human Interface Guidelines with San Francisco fonts and muted color palette.

## Security Considerations

- Context isolation is enabled in Electron
- No direct Node.js API access from renderer
- All IPC channels are explicitly validated
- Python scripts run in isolated processes with controlled arguments

## Build Configuration

The electron-builder configuration in package.json targets macOS with both x64 and arm64 architectures. The build excludes development files and includes all necessary runtime assets for both Electron and Python components.