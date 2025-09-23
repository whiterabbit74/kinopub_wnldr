# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an Electron application for downloading videos from M3U8 playlists with an Apple-inspired design aesthetic. The app использует полностью Node.js-реализацию для обработки M3U8 и скачивания через FFmpeg.

## Architecture

### Process Communication Flow
1. **Renderer Process** (`renderer.js` + `index.html`) - UI layer handling file drag/drop, track selection, and progress display
2. **Main Process** (`main.js`) - Electron main process that общается с Node.js-бэкендом через IPC
3. **Preload Script** (`preload.js`) - Security layer with IPC validation between renderer and main processes
4. **Node Backend** (`native-backend.js`) - M3U8 parsing and FFmpeg-based downloading без участия Python

### Key Communication Pattern
- Renderer → Preload → Main → Node Backend → FFmpeg
- Node backend возвращает структуры JavaScript и рассылает прогресс напрямую в main-процесс
- All IPC channels are validated in preload.js for security

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
- **Node.js** - Electron host и backend
- **FFmpeg** - Video downloading and processing (must be in PATH)

## Theme System

The app uses CSS custom properties for Apple-style light/dark theming. Theme state is persisted in localStorage and toggled via a button in the top-right corner. The design follows Apple's Human Interface Guidelines with San Francisco fonts and muted color palette.

## Security Considerations

- Context isolation is enabled in Electron
- No direct Node.js API access from renderer
- All IPC channels are explicitly validated
- Node backend использует child_process.spawn только для FFmpeg и тщательно фильтрует входные параметры

## Build Configuration

The electron-builder configuration in package.json targets macOS with both x64 and arm64 architectures. The build excludes development files and включает все необходимые ресурсы для Node.js-бэкенда.