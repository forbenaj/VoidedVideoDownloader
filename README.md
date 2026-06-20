# Voided Video Downloader

Adds a download button to browser video players. Clicking it sends the current video URL to a local backend, which runs `yt-dlp`.

## Installer

### What It Installs

- `extension/`: unpacked Chrome extension files.
- `host/ytp_downloader_host.py`: native backend that runs `yt-dlp`.
- `install.ps1`: registers the native host for Chrome under the current Windows user.
- `uninstall.ps1`: removes the native host registration.

### Installation

From PowerShell, in the main repo folder, execute:

```powershell
.\install.ps1
```

The installer checks for `ffmpeg` and `ffprobe`. If either is missing and `winget` is available, it can install FFmpeg for MP3 conversion.

Then open `chrome://extensions`, enable `Developer mode`, choose `Load unpacked`, and select the repository's `extension` folder. The installer prints its full path for convenience.

## Use

After installing the extension, a download icon should appear in the video controls of the supported providers. Clicking it opens menu for Video or Audio download. Either prompts a save-file dialog with the current video title as the suggested filename, then downloads the original video/audio to that path.

Available formats:

- `MP4 video`: best single MP4 file available without conversion.
- `MP3 audio`: converted MP3 audio.
- `Original video`: best single file provided by YouTube, preserving the real container extension.
- `M4A audio`: audio-only M4A when YouTube provides it.

By default, every download asks where to save the file.

If `Ask every time` is off, downloads save directly to the default folder. If you never set one, the backend uses:

```text
%USERPROFILE%\Downloads\yt-dlp
```

## Notes

- `yt-dlp` must be available on `PATH`.
- `ffmpeg` and `ffprobe` must be available on `PATH` for `MP3 audio` conversion. The installer can install FFmpeg through `winget` when available.
- YouTube downloads pass relevant Chrome cookies through the extension API into a temporary `cookies.txt` file for `yt-dlp`. This avoids locked Chrome cookie database errors from `--cookies-from-browser chrome`.
- This uses Chrome native messaging because content scripts cannot run local executables directly.
