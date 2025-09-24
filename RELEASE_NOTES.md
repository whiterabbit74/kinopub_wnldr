# Video Downloader v1.1.0 Release Notes

## Overview
Complete redesign and rewrite of the Video Downloader application with Apple macOS-inspired liquid glass design and improved functionality.

## What's New in v1.1.0

### 🚀 Major Improvements
- **Bundled FFmpeg 6.0** - No need to install FFmpeg separately!
- **HTTP Support** - Download from both HTTP and HTTPS sources
- **Better URL Detection** - Fixed issues with file vs URL recognition
- **Zero Dependencies** - Works out of the box on any system

## What's New Since v1.0.0

### 🎨 Complete UI/UX Redesign
- **Apple macOS liquid glass design** with backdrop-filter effects
- **San Francisco font system** integration
- **Light and dark theme support** with automatic system detection
- **Compact, minimal interface** following Apple Human Interface Guidelines
- **Smooth progress animations** with realistic download staging

### 🔧 Technical Improvements
- **Migrated from Python to Node.js backend** for better integration
- **Fixed critical M3U8 parser bugs** that prevented track detection
- **Improved file extension handling** - all outputs now properly saved as .mp4
- **Enhanced progress tracking** with 5-stage download process
- **Removed domain validation restrictions** for cross-CDN content
- **Removed download timeout limitations** for large files

### 📦 Cross-Platform Support
- **macOS** (Intel and Apple Silicon)
- **Windows** (x64 and x86)
- **Linux** (x64 and ARM64)

### 🚀 Performance & Reliability
- **Smooth progress bar animations** using requestAnimationFrame
- **Realistic download progress simulation** based on video duration
- **Better error handling** with detailed progress stages
- **Enhanced security** with proper IPC communication patterns

## Download Options

### macOS
- **macOS Apple Silicon (ARM64)**: `Video Downloader-1.1.0-arm64-mac.zip` (~158 MB)
- **macOS Intel (x64)**: `Video Downloader-1.1.0-mac.zip` (~162 MB)

### Windows
- **Windows x64**: `Video Downloader-1.1.0-win.zip` (~169 MB)
- **Windows x86**: `Video Downloader-1.1.0-ia32-win.zip` (~165 MB)
- **Windows Setup**: `Video Downloader Setup 1.1.0.exe` (installer)
- **Windows Portable**: `Video Downloader 1.1.0.exe` (portable)

## Installation Instructions

### macOS
1. Download the appropriate .zip file for your Mac
2. Extract the archive
3. Move `Video Downloader.app` to your Applications folder
4. Right-click and select "Open" on first launch (due to Gatekeeper)

### Windows
1. Download the appropriate .zip file for your system
2. Extract the archive
3. Run `video-downloader.exe`
4. Windows may show a security warning - click "More info" then "Run anyway"

## System Requirements
- **macOS**: 10.14 Mojave or later
- **Windows**: Windows 7 SP1 or later
- **FFmpeg**: Required for video processing (automatically detected)

## Known Issues
- First launch may take a few seconds to initialize
- Some antivirus software may flag the Windows build (false positive)

## Feedback
Please report any issues or suggestions on the GitHub repository.

---
*Built with Electron and lots of ❤️*