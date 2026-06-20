import json
import os
import re
import shutil
import struct
import subprocess
import sys
import tempfile
import uuid
from pathlib import Path
from urllib.parse import urlparse

try:
    import tkinter as tk
    from tkinter import filedialog
except Exception:
    tk = None
    filedialog = None


AUTH_ERROR_MARKERS = (
    "sign in to confirm",
    "confirm you're not a bot",
    "confirm you are not a bot",
    "cookies",
    "login",
    "private video",
    "age-restricted",
    "members-only",
)

FORMAT_ERROR_MARKER = "requested format is not available"
APP_NAME = "VoidedVideoDownloader"
SETTINGS_FILE_NAME = "settings.json"
INVALID_FILE_CHARS = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
DOWNLOAD_FORMATS = {
    "video_original": {
        "label": "Original video",
        "media_type": "video",
        "extension": "",
    },
    "video_mp4": {
        "label": "MP4 video",
        "media_type": "video",
        "extension": ".mp4",
    },
    "audio_m4a": {
        "label": "M4A audio",
        "media_type": "audio",
        "extension": ".m4a",
    },
    "audio_mp3": {
        "label": "MP3 audio",
        "media_type": "audio",
        "extension": ".mp3",
    },
}


class DownloadCanceled(Exception):
    pass


def send_message(payload):
    encoded = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("<I", len(encoded)))
    sys.stdout.buffer.write(encoded)
    sys.stdout.buffer.flush()


def read_message():
    raw_length = sys.stdin.buffer.read(4)
    if not raw_length:
        return None
    length = struct.unpack("<I", raw_length)[0]
    raw_message = sys.stdin.buffer.read(length)
    if len(raw_message) != length:
        raise ValueError("Received a truncated native messaging payload.")
    return json.loads(raw_message.decode("utf-8"))


def validate_url(url):
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"}:
        raise ValueError("Only http and https URLs can be downloaded.")
    if not parsed.netloc:
        raise ValueError("The download URL is missing a host.")
    return url


def cookie_line(cookie):
    domain = str(cookie.get("domain") or "")
    path = str(cookie.get("path") or "/")
    name = str(cookie.get("name") or "")
    value = str(cookie.get("value") or "")

    if not domain or not name:
        return None

    http_only = bool(cookie.get("httpOnly"))
    include_subdomains = "TRUE" if domain.startswith(".") else "FALSE"
    secure = "TRUE" if cookie.get("secure") else "FALSE"
    expires = int(float(cookie.get("expirationDate") or 0))
    netscape_domain = f"#HttpOnly_{domain}" if http_only else domain

    return "\t".join([
        netscape_domain,
        include_subdomains,
        path,
        secure,
        str(expires),
        name,
        value,
    ])


def write_cookie_file(cookie_dir, cookies):
    if not cookies:
        return None

    cookie_path = cookie_dir / f"cookies-{uuid.uuid4().hex}.txt"
    lines = ["# Netscape HTTP Cookie File"]

    for cookie in cookies:
        line = cookie_line(cookie)
        if line:
            lines.append(line)

    if len(lines) == 1:
        return None

    cookie_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return cookie_path


def settings_dir():
    base = os.environ.get("LOCALAPPDATA")
    if base:
        return Path(base) / APP_NAME
    return Path.home() / ".config" / APP_NAME


def settings_path():
    return settings_dir() / SETTINGS_FILE_NAME


def default_output_dir():
    return Path.home() / "Downloads" / "yt-dlp"


def dialog_initial_dir(path):
    path = Path(path).expanduser()
    if path.exists() and path.is_dir():
        return path

    parent = path.parent
    if parent.exists() and parent.is_dir():
        return parent

    return Path.home()


def load_settings():
    settings = {}
    path = settings_path()

    if path.exists():
        try:
            settings = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            settings = {}

    return {
        "ask_always": bool(settings.get("ask_always", True)),
        "default_dir": str(settings.get("default_dir") or settings.get("output_dir") or default_output_dir()),
    }


def save_settings(settings):
    path = settings_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(settings, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def settings_payload(settings):
    return {
        "askAlways": bool(settings.get("ask_always", True)),
        "defaultDir": str(settings.get("default_dir") or default_output_dir()),
        "settingsPath": str(settings_path()),
    }


def make_dialog_root():
    if not tk or not filedialog:
        return None

    root = tk.Tk()
    root.withdraw()
    root.attributes("-topmost", True)
    return root


def prompt_for_default_dir(initial_dir):
    root = make_dialog_root()
    if not root:
        return None

    try:
        chosen = filedialog.askdirectory(
            title="Choose the default yt-dlp download folder",
            initialdir=str(dialog_initial_dir(initial_dir)),
            mustexist=True,
            parent=root,
        )
    finally:
        root.destroy()

    if not chosen:
        return None

    return Path(chosen)


def prompt_for_save_path(suggested_name, initial_dir, download_format):
    root = make_dialog_root()
    if not root:
        return None

    info = download_format_info(download_format)
    extension = info["extension"]
    filetypes = filetypes_for_download_format(download_format)

    try:
        chosen = filedialog.asksaveasfilename(
            title="Save YouTube download as",
            initialdir=str(dialog_initial_dir(initial_dir)),
            initialfile=suggested_name,
            defaultextension=extension,
            filetypes=filetypes,
            parent=root,
        )
    finally:
        root.destroy()

    if not chosen:
        return None

    return Path(chosen)


def download_format_info(download_format):
    return DOWNLOAD_FORMATS.get(download_format) or DOWNLOAD_FORMATS["video_original"]


def filetypes_for_download_format(download_format):
    if download_format == "video_mp4":
        return [("MP4 video", "*.mp4"), ("All files", "*.*")]
    if download_format == "audio_m4a":
        return [("M4A audio", "*.m4a"), ("All files", "*.*")]
    if download_format == "audio_mp3":
        return [("MP3 audio", "*.mp3"), ("All files", "*.*")]
    return [("Original container", "*.*"), ("All files", "*.*")]


def safe_file_stem(title, download_format):
    info = download_format_info(download_format)
    fallback = "YouTube audio" if info["media_type"] == "audio" else "YouTube video"
    stem = INVALID_FILE_CHARS.sub("_", (title or fallback).strip())
    stem = re.sub(r"\s+", " ", stem).strip(" .")
    return (stem or fallback)[:180]


def suggested_file_name(title, download_format):
    info = download_format_info(download_format)
    return f"{safe_file_stem(title, download_format)}{info['extension']}"


def unique_path(path):
    if not path.exists():
        return path

    for index in range(1, 1000):
        candidate = path.with_name(f"{path.stem} ({index}){path.suffix}")
        if not candidate.exists():
            return candidate

    return path


def unique_original_base_path(path):
    base_path = path.with_suffix("")
    if not list(base_path.parent.glob(f"{base_path.name}.*")):
        return base_path

    for index in range(1, 1000):
        candidate = base_path.with_name(f"{base_path.name} ({index})")
        if not list(candidate.parent.glob(f"{candidate.name}.*")):
            return candidate

    return base_path


def resolve_output_path(title, download_format):
    settings = load_settings()
    default_dir = Path(settings["default_dir"]).expanduser()
    suggested_name = suggested_file_name(title, download_format)

    if settings["ask_always"]:
        send_message({
            "type": "status",
            "level": "info",
            "message": "Choose where to save the download..."
        })
        selected = prompt_for_save_path(suggested_name, default_dir, download_format)
        if selected:
            if download_format == "video_original":
                return selected.with_suffix("")
            return selected
        if tk and filedialog:
            raise DownloadCanceled("Download canceled.")

    default_dir.mkdir(parents=True, exist_ok=True)
    if download_format == "video_original":
        return unique_original_base_path(default_dir / suggested_name)
    return unique_path(default_dir / suggested_name)


def update_default_folder():
    settings = load_settings()
    initial_dir = Path(settings["default_dir"]).expanduser()
    chosen = prompt_for_default_dir(initial_dir)
    if not chosen:
        send_message({
            "type": "canceled",
            "level": "info",
            "message": "Default folder unchanged.",
            "settings": settings_payload(settings),
        })
        return

    settings["default_dir"] = str(chosen)
    save_settings(settings)
    send_message({
        "type": "complete",
        "level": "success",
        "message": f"Default folder set to {chosen}",
        "settings": settings_payload(settings),
    })


def update_ask_always(ask_always):
    settings = load_settings()
    settings["ask_always"] = bool(ask_always)
    save_settings(settings)
    send_message({
        "type": "complete",
        "level": "success",
        "message": "Download prompt enabled." if settings["ask_always"] else "Downloads will use the default folder.",
        "settings": settings_payload(settings),
    })


def ensure_format_tools(download_format):
    if download_format != "audio_mp3":
        return

    missing = [tool for tool in ("ffmpeg", "ffprobe") if not shutil.which(tool)]
    if missing:
        raise FileNotFoundError(
            "MP3 conversion requires ffmpeg and ffprobe on PATH. "
            "Install ffmpeg, then restart Chrome and try again."
        )


def media_command_options(download_format):
    if download_format == "audio_m4a":
        return {
            "format": "bestaudio[ext=m4a]/bestaudio[acodec^=mp4a]",
            "extra_args": [],
        }

    if download_format == "audio_mp3":
        return {
            "format": "bestaudio/best",
            "extra_args": ["-x", "--audio-format", "mp3"],
        }

    if download_format == "video_mp4":
        return {
            "format": "best[ext=mp4]",
            "extra_args": [],
        }

    return {
        "format": "best",
        "extra_args": [],
    }


def attempts_for(download_format):
    info = download_format_info(download_format)
    options = media_command_options(download_format)

    if info["media_type"] == "video":
        return [
            {"label": info["label"], "format": options["format"], "cookies": False, "extra_args": options["extra_args"]},
            {"label": f"{info['label']} with cookies", "format": options["format"], "cookies": True, "auth_only": True, "extra_args": options["extra_args"]},
        ]

    if info["media_type"] == "audio":
        return [
            {"label": info["label"], "format": options["format"], "cookies": False, "extra_args": options["extra_args"]},
            {"label": f"{info['label']} with cookies", "format": options["format"], "cookies": True, "auth_only": True, "extra_args": options["extra_args"]},
        ]

    raise ValueError("Unsupported download format.")


def output_template_for(output_path, download_format):
    escaped_path = str(output_path).replace("%", "%%")
    if download_format == "video_original":
        return f"{escaped_path}.%(ext)s"
    return escaped_path


def build_command(yt_dlp, output_path, download_format, cookie_path, format_selector, extra_args, url):
    output_template = output_template_for(output_path, download_format)
    command = [
        yt_dlp,
        "--ignore-config",
        "--newline",
        "--no-playlist",
        "-o",
        output_template,
    ]

    if cookie_path:
        command.extend(["--cookies", str(cookie_path)])

    if format_selector:
        command.extend(["-f", format_selector])

    command.extend(extra_args)
    command.append(url)
    return command


def run_yt_dlp(command, label):
    send_message({
        "type": "status",
        "level": "info",
        "message": f"Saving with yt-dlp ({label})..."
    })

    process = subprocess.Popen(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
    )

    assert process.stdout is not None
    last_line = ""
    output_lines = []

    for line in process.stdout:
        line = line.strip()
        if not line:
            continue
        last_line = line
        output_lines.append(line)
        send_message({
            "type": "status",
            "level": "progress",
            "message": line[:500]
        })

    return_code = process.wait()
    return return_code, last_line, "\n".join(output_lines)


def has_auth_error(output_text):
    lowered = output_text.lower()
    return any(marker in lowered for marker in AUTH_ERROR_MARKERS)


def has_format_error(output_text):
    return FORMAT_ERROR_MARKER in output_text.lower()


def matching_original_outputs(output_path):
    return set(output_path.parent.glob(f"{output_path.name}.*"))


def display_output_path(output_path, download_format, before_outputs):
    if download_format != "video_original":
        return output_path

    new_outputs = matching_original_outputs(output_path) - before_outputs
    if new_outputs:
        return max(new_outputs, key=lambda path: path.stat().st_mtime)

    existing_outputs = matching_original_outputs(output_path)
    if existing_outputs:
        return max(existing_outputs, key=lambda path: path.stat().st_mtime)

    return Path(output_template_for(output_path, download_format))


def open_path(path):
    if not path or not str(path).strip():
        raise ValueError("A path is required.")
    target = Path(str(path)).expanduser()
    if not target.exists():
        raise FileNotFoundError(f"Path does not exist: {target}")
    os.startfile(str(target))


def reveal_path(path):
    if not path or not str(path).strip():
        raise ValueError("A path is required.")
    target = Path(str(path)).expanduser()
    if not target.exists():
        raise FileNotFoundError(f"Path does not exist: {target}")

    if target.is_dir():
        os.startfile(str(target))
        return

    subprocess.Popen(["explorer", f"/select,{target}"])


def run_download(url, download_format, cookies, title):
    yt_dlp = shutil.which("yt-dlp")
    if not yt_dlp:
        raise FileNotFoundError("yt-dlp was not found on PATH.")

    if download_format not in DOWNLOAD_FORMATS:
        download_format = "video_original"

    ensure_format_tools(download_format)
    output_path = resolve_output_path(title, download_format)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    before_outputs = matching_original_outputs(output_path) if download_format == "video_original" else set()

    cookie_dir = Path(tempfile.gettempdir()) / "voided-video-downloader-cookies"
    cookie_dir.mkdir(parents=True, exist_ok=True)
    cookie_path = None
    saw_auth_error = False
    last_error = ""

    try:
        for attempt in attempts_for(download_format):
            if attempt.get("auth_only") and not saw_auth_error:
                continue

            if attempt["cookies"]:
                cookie_path = cookie_path or write_cookie_file(cookie_dir, cookies)
                if not cookie_path:
                    continue

            command = build_command(
                yt_dlp,
                output_path,
                download_format,
                cookie_path if attempt["cookies"] else None,
                attempt["format"],
                attempt["extra_args"],
                url,
            )
            return_code, last_line, output_text = run_yt_dlp(command, attempt["label"])

            if return_code == 0:
                saved_path = display_output_path(output_path, download_format, before_outputs)
                send_message({
                    "type": "complete",
                    "level": "success",
                    "message": f"Download complete. Saved as {saved_path}",
                    "filePath": str(saved_path),
                    "folderPath": str(saved_path.parent),
                })
                return

            last_error = last_line or f"yt-dlp exited with code {return_code}."

            if has_auth_error(output_text):
                saw_auth_error = True
                send_message({
                    "type": "status",
                    "level": "info",
                    "message": "YouTube asked for sign-in; retrying with Chrome cookies..."
                })
                continue

            raise RuntimeError(last_error)

        raise RuntimeError(last_error or "yt-dlp could not complete the download.")
    finally:
        if cookie_path and cookie_path.exists():
            cookie_path.unlink()


def handle_message(message):
    action = message.get("action")

    if action == "getSettings":
        settings = load_settings()
        send_message({
            "type": "complete",
            "level": "success",
            "settings": settings_payload(settings),
        })
        return

    if action == "chooseDefaultFolder":
        update_default_folder()
        return

    if action == "setAskAlways":
        update_ask_always(message.get("askAlways", True))
        return

    if action == "openPath":
        open_path(message.get("path"))
        send_message({
            "type": "complete",
            "level": "success",
            "message": "Opened downloaded file.",
        })
        return

    if action == "revealPath":
        reveal_path(message.get("path"))
        send_message({
            "type": "complete",
            "level": "success",
            "message": "Opened download folder.",
        })
        return

    if action != "download":
        raise ValueError("Unsupported action.")

    url = validate_url(str(message.get("url") or ""))
    download_format = str(message.get("downloadFormat") or "")
    if not download_format:
        media_type = str(message.get("mediaType") or "video")
        download_format = "audio_m4a" if media_type == "audio" else "video_original"
    title = str(message.get("title") or "")
    cookies = message.get("cookies") or []
    run_download(url, download_format, cookies, title)


def main():
    try:
        message = read_message()
        if message is None:
            return
        handle_message(message)
    except DownloadCanceled as exc:
        send_message({
            "type": "canceled",
            "level": "info",
            "message": str(exc)
        })
    except Exception as exc:
        send_message({
            "type": "error",
            "level": "error",
            "message": str(exc)
        })


if __name__ == "__main__":
    os.environ.setdefault("PYTHONIOENCODING", "utf-8")
    main()
