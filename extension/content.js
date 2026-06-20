const BUTTON_ID = "voided-video-downloader-download";
const MENU_ID = "voided-video-downloader-menu";
const ASK_ALWAYS_ITEM_ID = "voided-video-downloader-ask-always";
const DEFAULT_FOLDER_ITEM_ID = "voided-video-downloader-default-folder";
const STATUS_ID = "voided-video-downloader-status";
const DOWNLOAD_PULSE_ID = "voided-video-downloader-download-pulse";
const DOWNLOAD_NOTIFICATION_ID = "voided-video-downloader-download-notification";

let cachedSettings = {
  askAlways: true,
  defaultDir: ""
};
let downloadStartIndicatorShown = false;

const DOWNLOAD_FORMAT_LABELS = {
  video_original: "original video",
  video_mp4: "MP4 video",
  audio_m4a: "M4A audio",
  audio_mp3: "MP3 audio"
};

function playerHost() {
  return document.fullscreenElement || document.querySelector(".html5-video-player") || document.body;
}

function currentVideoUrl() {
  const videoId =
    new URLSearchParams(window.location.search).get("v") ||
    document.querySelector("ytd-watch-flexy")?.getAttribute("video-id");

  if (videoId) {
    return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
  }

  return window.location.href;
}

function showStatus(message, level = "info") {
  let status = document.getElementById(STATUS_ID);
  const host = playerHost();

  if (!status) {
    status = document.createElement("div");
    status.id = STATUS_ID;
    status.className = "voided-video-downloader-status";
  }

  if (status.parentElement !== host) {
    host.appendChild(status);
  }

  status.dataset.fixed = host === document.body ? "true" : "false";
  status.textContent = "";
  status.dataset.level = level;
  status.dataset.visible = "true";

  const messageNode = document.createElement("span");
  messageNode.className = "voided-video-downloader-status-message";
  messageNode.textContent = message;
  status.appendChild(messageNode);

  if (level === "error") {
    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.className = "voided-video-downloader-copy-button";
    copyButton.textContent = "Copy";
    copyButton.title = "Copy error message";
    copyButton.addEventListener("click", (event) => {
      event.stopPropagation();
      copyText(message);
      copyButton.textContent = "Copied";
      window.setTimeout(() => {
        copyButton.textContent = "Copy";
      }, 1400);
    });
    status.appendChild(copyButton);
  }

  window.clearTimeout(showStatus.hideTimer);
  if (level !== "busy") {
    showStatus.hideTimer = window.setTimeout(() => {
      status.dataset.visible = "false";
    }, 5000);
  }
}

function hideStatus() {
  const status = document.getElementById(STATUS_ID);
  if (status) {
    status.dataset.visible = "false";
  }
  window.clearTimeout(showStatus.hideTimer);
}

function showDownloadStartIndicator(downloadFormat) {
  const existing = document.getElementById(DOWNLOAD_PULSE_ID);
  if (existing) existing.remove();

  const pulse = document.createElement("div");
  pulse.id = DOWNLOAD_PULSE_ID;
  pulse.className = "voided-video-downloader-download-pulse";
  pulse.setAttribute("role", "status");
  pulse.setAttribute("aria-live", "polite");
  pulse.innerHTML = `
    <span class="voided-video-downloader-download-pulse-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" focusable="false">
        <path d="M12 3v11m0 0 4-4m-4 4-4-4M5 19h14" />
      </svg>
    </span>
    <span class="voided-video-downloader-download-pulse-text">${DOWNLOAD_FORMAT_LABELS[downloadFormat] || "Download"} started</span>
  `;

  document.body.appendChild(pulse);
  window.setTimeout(() => pulse.dataset.visible = "true", 20);
  window.setTimeout(() => {
    pulse.dataset.visible = "false";
    window.setTimeout(() => pulse.remove(), 220);
  }, 1250);
}

function displayNameFromPath(path) {
  if (!path) return "Download complete";
  const parts = String(path).split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] || path;
}

function showDownloadCompleteNotification(message) {
  const existing = document.getElementById(DOWNLOAD_NOTIFICATION_ID);
  if (existing) existing.remove();

  const notification = document.createElement("div");
  notification.id = DOWNLOAD_NOTIFICATION_ID;
  notification.className = "voided-video-downloader-download-notification";
  notification.dataset.hasFile = message.filePath ? "true" : "false";
  notification.setAttribute("role", "status");
  notification.setAttribute("aria-live", "polite");
  notification.tabIndex = message.filePath ? 0 : -1;

  const icon = document.createElement("span");
  icon.className = "voided-video-downloader-download-notification-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.innerHTML = `
    <svg viewBox="0 0 24 24" focusable="false">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  `;

  const body = document.createElement("span");
  body.className = "voided-video-downloader-download-notification-body";

  const title = document.createElement("span");
  title.className = "voided-video-downloader-download-notification-title";
  title.textContent = "Download complete";

  const filename = document.createElement("span");
  filename.className = "voided-video-downloader-download-notification-filename";
  filename.textContent = displayNameFromPath(message.filePath);

  body.append(title, filename);

  const folderButton = document.createElement("button");
  folderButton.type = "button";
  folderButton.className = "voided-video-downloader-download-folder-button";
  folderButton.title = "Open folder";
  folderButton.setAttribute("aria-label", "Open download folder");
  folderButton.innerHTML = `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H10l2 2h6.5A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5z" />
    </svg>
  `;
  folderButton.addEventListener("click", (event) => {
    event.stopPropagation();
    revealDownloadedFile(message);
  });

  notification.addEventListener("click", () => openDownloadedFile(message));
  notification.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openDownloadedFile(message);
    }
  });

  notification.append(icon, body, folderButton);
  document.body.appendChild(notification);
  window.setTimeout(() => notification.dataset.visible = "true", 20);

  window.clearTimeout(showDownloadCompleteNotification.hideTimer);
  showDownloadCompleteNotification.hideTimer = window.setTimeout(() => {
    notification.dataset.visible = "false";
    window.setTimeout(() => notification.remove(), 220);
  }, 12000);
}

function openDownloadedFile(message) {
  if (!message.filePath) return;
  sendSettingsAction("openPath", { path: message.filePath }, (error, response) => {
    if (error || !response?.ok) {
      showStatus(response?.error || response?.message || error || "Could not open the downloaded file.", "error");
    }
  });
}

function revealDownloadedFile(message) {
  const path = message.folderPath || message.filePath;
  if (!path) return;
  sendSettingsAction("revealPath", { path }, (error, response) => {
    if (error || !response?.ok) {
      showStatus(response?.error || response?.message || error || "Could not open the download folder.", "error");
    }
  });
}

function copyText(text) {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).catch(() => fallbackCopyText(text));
    return;
  }

  fallbackCopyText(text);
}

function fallbackCopyText(text) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.left = "-9999px";
  textarea.style.position = "fixed";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function setControlsBusy(busy) {
  const button = document.getElementById(BUTTON_ID);

  if (button) {
    button.disabled = busy;
    button.dataset.busy = busy ? "true" : "false";
    const label = busy ? "Preparing download with yt-dlp..." : "Download options";
    button.dataset.tooltipTitle = label;
    button.dataset.titleNoTooltip = label;
  }
}

function startDownload(downloadFormat) {
  if (document.getElementById(BUTTON_ID)?.disabled) return;

  closeMenu();
  setControlsBusy(true);
  downloadStartIndicatorShown = false;
  showStatus(`Preparing ${DOWNLOAD_FORMAT_LABELS[downloadFormat] || "download"} with yt-dlp...`, "busy");

  chrome.runtime.sendMessage(
    {
      type: "voided-video-downloader-download",
      downloadFormat,
      url: currentVideoUrl(),
      title: document.title.replace(/ - YouTube$/, "")
    },
    (response) => {
      const error = chrome.runtime.lastError && chrome.runtime.lastError.message;
      if (error || !response?.ok) {
        setControlsBusy(false);
        showStatus(response?.error || error || "Could not start download.", "error");
      }
    }
  );
}

function sendSettingsAction(action, payload = {}, callback = () => {}) {
  chrome.runtime.sendMessage(
    {
      type: "voided-video-downloader-settings",
      action,
      ...payload
    },
    (response) => {
      const error = chrome.runtime.lastError && chrome.runtime.lastError.message;
      if (response?.settings) {
        cachedSettings = response.settings;
        updateSettingsMenu();
      }
      callback(error, response);
    }
  );
}

function refreshSettings() {
  sendSettingsAction("getSettings");
}

function setAskAlways(askAlways) {
  closeMenu();
  showStatus("Updating download settings...", "busy");
  sendSettingsAction("setAskAlways", { askAlways }, (error, response) => {
    if (error || !response?.ok) {
      showStatus(response?.error || response?.message || error || "Could not update settings.", "error");
      return;
    }

    showStatus(response.message || "Settings updated.", "success");
  });
}

function chooseDefaultFolder() {
  closeMenu();
  showStatus("Choose a default download folder...", "busy");
  sendSettingsAction("chooseDefaultFolder", {}, (error, response) => {
    if (error || response?.status === "error") {
      showStatus(response?.error || response?.message || error || "Could not set default folder.", "error");
      return;
    }

    showStatus(response?.message || "Default folder unchanged.", response?.ok ? "success" : "info");
  });
}

function updateSettingsMenu() {
  const askItem = document.getElementById(ASK_ALWAYS_ITEM_ID);
  const defaultFolderItem = document.getElementById(DEFAULT_FOLDER_ITEM_ID);

  if (askItem) {
    askItem.textContent = cachedSettings.askAlways ? "Ask every time: On" : "Ask every time: Off";
    askItem.setAttribute("aria-checked", cachedSettings.askAlways ? "true" : "false");
  }

  if (defaultFolderItem) {
    defaultFolderItem.title = cachedSettings.defaultDir
      ? `Default folder: ${cachedSettings.defaultDir}`
      : "Set default download folder";
  }
}

function createDownloadButton() {
  const button = document.createElement("button");
  button.id = BUTTON_ID;
  button.type = "button";
  button.className = "ytp-button voided-video-downloader-button";
  button.dataset.tooltipTitle = "Download options";
  button.dataset.titleNoTooltip = "Download options";
  button.setAttribute("aria-label", "Open download options");
  button.setAttribute("aria-haspopup", "menu");
  button.setAttribute("aria-expanded", "false");
  button.innerHTML = `
    <svg class="voided-video-downloader-icon" height="24" viewBox="0 0 24 24" width="24" aria-hidden="true" focusable="false">
      <path fill="white" d="M12 16 5 9l1.4-1.4 4.6 4.6V2h2v10.2l4.6-4.6L19 9l-7 7ZM4 22q-.8 0-1.4-.6T2 20v-4h2v4h16v-4h2v4q0 .8-.6 1.4T20 22H4Z"/>
    </svg>`;
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleMenu(button);
  });

  return button;
}

function injectButton() {
  if (document.getElementById(BUTTON_ID)) return;

  const controls = document.querySelector(".ytp-chrome-controls");
  const rightControls = controls?.querySelector(".ytp-right-controls");
  const target = rightControls?.querySelector(".ytp-right-controls-left") || rightControls || controls;

  if (!target) return;

  target.insertBefore(createDownloadButton(), target.firstChild);
}

function ensureMenu() {
  let menu = document.getElementById(MENU_ID);
  const host = playerHost();

  if (menu) {
    if (menu.parentElement !== host) {
      host.appendChild(menu);
    }
    return menu;
  }

  menu = document.createElement("div");
  menu.id = MENU_ID;
  menu.className = "voided-video-downloader-menu";
  menu.setAttribute("role", "menu");
  menu.dataset.open = "false";
  renderMainMenu(menu);
  host.appendChild(menu);
  return menu;
}

function renderMainMenu(menu) {
  const mp4Item = createDownloadMenuItem("Video MP4", "video_mp4", "video");
  const mp3Item = createDownloadMenuItem("Audio MP3", "audio_mp3", "audio");
  const moreItem = createMenuItem("More...", () => {
    renderMoreMenu(menu);
    openMenu(document.getElementById(BUTTON_ID));
  });

  menu.replaceChildren(mp4Item, mp3Item, moreItem);
}

function renderMoreMenu(menu) {
  const backItem = createMenuItem("â† Back", () => {
    renderMainMenu(menu);
    openMenu(document.getElementById(BUTTON_ID));
  });
  const originalItem = createDownloadMenuItem("Original video", "video_original");
  const m4aItem = createDownloadMenuItem("Audio M4A", "audio_m4a");
  const divider = document.createElement("div");
  divider.className = "voided-video-downloader-menu-divider";
  divider.setAttribute("role", "separator");
  const askAlwaysItem = createMenuItem("", () => setAskAlways(!cachedSettings.askAlways));
  askAlwaysItem.id = ASK_ALWAYS_ITEM_ID;
  askAlwaysItem.setAttribute("role", "menuitemcheckbox");
  const defaultFolderItem = createMenuItem("Set default folder", chooseDefaultFolder);
  defaultFolderItem.id = DEFAULT_FOLDER_ITEM_ID;

  menu.replaceChildren(backItem, originalItem, m4aItem, divider, askAlwaysItem, defaultFolderItem);
  updateSettingsMenu();
}

function createMenuItem(label, onClick) {
  const item = document.createElement("button");
  item.type = "button";
  item.className = "voided-video-downloader-menu-item";
  item.setAttribute("role", "menuitem");
  item.textContent = label;
  item.addEventListener("click", (event) => {
    event.stopPropagation();
    onClick();
  });
  return item;
}

function createDownloadMenuItem(label, downloadFormat, iconType = "") {
  const item = document.createElement("button");
  item.type = "button";
  item.className = "voided-video-downloader-menu-item";
  item.setAttribute("role", "menuitem");
  if (iconType) item.appendChild(createMenuIcon(iconType));
  item.appendChild(document.createTextNode(label));
  item.addEventListener("click", () => startDownload(downloadFormat));
  return item;
}

function createMenuIcon(iconType) {
  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  icon.classList.add("voided-video-downloader-menu-item-icon");
  icon.setAttribute("viewBox", "0 0 24 24");
  icon.setAttribute("aria-hidden", "true");
  icon.innerHTML = iconType === "video"
    ? '<path fill="currentColor" d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v13a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 18.5v-13ZM10 8v8l6-4-6-4Z"/>'
    : '<path fill="currentColor" d="M18 3v12.2A3.5 3.5 0 1 1 16 12V7l-7 1.5v8.7A3.5 3.5 0 1 1 7 14V5.8L18 3Z"/>';
  return icon;
}

function openMenu(anchor) {
  const menu = ensureMenu();
  const rect = anchor.getBoundingClientRect();

  menu.dataset.open = "true";
  menu.style.left = `${Math.max(8, Math.round(rect.right - menu.offsetWidth))}px`;
  menu.style.top = `${Math.max(8, Math.round(rect.top - menu.offsetHeight - 8))}px`;
  anchor.setAttribute("aria-expanded", "true");
}

function closeMenu() {
  const menu = document.getElementById(MENU_ID);
  const button = document.getElementById(BUTTON_ID);

  if (menu) menu.dataset.open = "false";
  if (button) button.setAttribute("aria-expanded", "false");
}

function toggleMenu(anchor) {
  const menu = ensureMenu();

  if (menu.dataset.open === "true") {
    closeMenu();
  } else {
    renderMainMenu(menu);
    refreshSettings();
    openMenu(anchor);
  }
}

chrome.runtime.onMessage.addListener((message) => {
  if (!message || message.type !== "voided-video-downloader-status") return;

  if (!downloadStartIndicatorShown && message.message?.startsWith("Saving with yt-dlp")) {
    downloadStartIndicatorShown = true;
    showDownloadStartIndicator(message.downloadFormat);
  }

  if (message.level === "progress") {
    showStatus(message.message, "busy");
  } else if (message.status === "complete") {
    setControlsBusy(false);
    downloadStartIndicatorShown = false;
    hideStatus();
    showDownloadCompleteNotification(message);
  } else if (message.status === "canceled") {
    setControlsBusy(false);
    downloadStartIndicatorShown = false;
    showStatus(message.message || "Download canceled.", "info");
  } else if (message.status === "error") {
    setControlsBusy(false);
    downloadStartIndicatorShown = false;
    showStatus(message.message || "Download failed.", "error");
  } else if (message.message) {
    showStatus(message.message, message.level || "info");
  }
});

document.addEventListener("click", (event) => {
  const menu = document.getElementById(MENU_ID);
  const button = document.getElementById(BUTTON_ID);

  if (!menu || menu.dataset.open !== "true") return;
  if (menu.contains(event.target) || button?.contains(event.target)) return;

  closeMenu();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeMenu();
});

window.addEventListener("scroll", closeMenu, true);
window.addEventListener("resize", closeMenu);

const observer = new MutationObserver(injectButton);
observer.observe(document.documentElement, {
  childList: true,
  subtree: true
});

injectButton();
window.setInterval(injectButton, 1500);
