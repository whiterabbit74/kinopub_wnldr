# Video Downloader

Video Downloader is a desktop application built with Python and PyQt5 that allows you to download videos from various online sources and local M3U/M3U8 playlist files. It provides a user-friendly interface to select video/audio quality, manage downloads, and choose output settings.

## Features

*   **Versatile Video Downloading:** Supports downloading from direct URLs and local playlist files (M3U, M3U8).
*   **User-Friendly GUI:** Built with PyQt5, offering an intuitive interface for all operations.
*   **Quality Selection:** Allows users to choose preferred video and audio quality before downloading.
*   **Customizable Output:** Users can specify the output directory and a custom filename for downloads.
*   **Adjustable Download Threads:** Provides the option to set the number of threads for downloading.
*   **Real-time Progress:** Displays a progress bar and status updates during the download process.
*   **Theme Support:** Includes both Light and Dark themes for user preference.
*   **Drag-and-Drop:** Supports dragging and dropping M3U/M3U8 files directly into the application.
*   **FFmpeg Integration:** Automatically detects and utilizes FFmpeg for video processing tasks, with fallback if not found.

## Requirements

*   Python 3.x
*   yt-dlp
*   PyQt5
*   FFmpeg (Recommended for full functionality, especially for combining formats and handling certain streams. The application will attempt to use a bundled version or a system-installed version.)

A detailed list of Python dependencies can be found in `requirements.txt`.

## Installation and Usage

### Running from Source

1.  **Clone the repository:**
    ```bash
    git clone <repository_url> # TODO: Replace <repository_url> with the actual URL of this repository
    cd video-downloader # Or your project's directory name
    ```
2.  **Install dependencies:**
    It's recommended to create a virtual environment first.
    ```bash
    python -m venv venv
    source venv/bin/activate  # On Windows: venv\Scripts\activate
    pip install -r requirements.txt
    ```
3.  **Ensure FFmpeg is available:**
    *   You can download FFmpeg from [https://ffmpeg.org/download.html](https://ffmpeg.org/download.html).
    *   Make sure `ffmpeg` (and `ffprobe`) are in your system's PATH.
    *   Alternatively, for development, you can place the `ffmpeg` executable in the `bin` directory of this project. The application attempts to locate FFmpeg in the project's `bin` directory, then in the system PATH. For bundled applications, FFmpeg is expected to be included.
4.  **Run the application:**
    ```bash
    python main.py
    ```

### Using Pre-built Binaries

(Information about where to find pre-built binaries, if available, would go here. The project includes build scripts like `build_app.py`, suggesting binaries can be created.)

## Building from Source

This project uses PyInstaller to create standalone executables.

1.  **Ensure PyInstaller is installed:**
    If not already listed in `requirements.txt` or installed:
    ```bash
    pip install pyinstaller
    ```
2.  **Build the application:**
    You can use the provided spec file or the build script:
    *   Using the spec file:
        ```bash
        pyinstaller VideoDownloader.spec
        ```
    *   Using the build script (if it handles specific configurations):
        ```bash
        python build_app.py
        ```
    The executable will typically be found in the `dist` directory.

## Logging

The application generates log files to help with troubleshooting and tracking its activity:

*   `app_debug.log`: This file is created when the application is run from source (`python main.py`). It's located in the root directory of the project.
*   `video_downloader.log`: This file is created when the application is run as a compiled executable (e.g., after building with PyInstaller). It's typically located in the same directory as the executable or, on macOS, within the app bundle's Contents directory.

These logs contain information about the application's startup, download progress, errors, and other relevant events.

## Contributing

Contributions are welcome! If you have suggestions for improvements or encounter any issues, please feel free to:

*   Open an issue on the project's GitHub page (if applicable).
*   Fork the repository, make your changes, and submit a pull request.

## License

This project is currently not licensed. Please add a license file (e.g., `LICENSE.txt` or `LICENSE.md`) to the project and update this section accordingly. Common open-source licenses include MIT, Apache 2.0, and GPLv3.
