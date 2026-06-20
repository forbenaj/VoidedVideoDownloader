const HOST_NAME = "com.voided.video_downloader";

function sendToTab(tabId, payload) {
  if (!tabId) return;
  chrome.tabs.sendMessage(tabId, payload, () => {
    void chrome.runtime.lastError;
  });
}

function isYouTubeUrl(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    return ["youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"].includes(host);
  } catch {
    return false;
  }
}

function collectCookiesForUrl(url, callback) {
  if (!isYouTubeUrl(url)) {
    callback([]);
    return;
  }

  const domains = ["youtube.com", "google.com", "accounts.google.com", "youtu.be"];
  const cookiesByKey = new Map();
  let pending = domains.length;

  for (const domain of domains) {
    chrome.cookies.getAll({ domain }, (cookies) => {
      const error = chrome.runtime.lastError && chrome.runtime.lastError.message;

      if (!error) {
        for (const cookie of cookies) {
          const key = `${cookie.domain}\n${cookie.path}\n${cookie.name}`;
          cookiesByKey.set(key, {
            domain: cookie.domain,
            path: cookie.path,
            secure: cookie.secure,
            httpOnly: cookie.httpOnly,
            expirationDate: cookie.expirationDate || 0,
            name: cookie.name,
            value: cookie.value
          });
        }
      }

      pending -= 1;
      if (pending === 0) {
        callback([...cookiesByKey.values()]);
      }
    });
  }
}

function runNativeDownload(message, tabId, sendResponse) {
  let port;

  try {
    port = chrome.runtime.connectNative(HOST_NAME);
  } catch (error) {
    sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
    return;
  }

  let finished = false;

  port.onMessage.addListener((hostMessage) => {
    sendToTab(tabId, {
      type: "voided-video-downloader-status",
      status: hostMessage.type,
      level: hostMessage.level,
      message: hostMessage.message,
      downloadFormat: message.downloadFormat || "video_original",
      filePath: hostMessage.filePath,
      folderPath: hostMessage.folderPath
    });

    if (["complete", "error", "canceled"].includes(hostMessage.type)) {
      finished = true;
      port.disconnect();
    }
  });

  port.onDisconnect.addListener(() => {
    const error = chrome.runtime.lastError && chrome.runtime.lastError.message;
    if (!finished && error) {
      sendToTab(tabId, {
        type: "voided-video-downloader-status",
        status: "error",
        level: "error",
        message: error
      });
    }
  });

  collectCookiesForUrl(message.url, (cookies) => {
    port.postMessage({
      action: "download",
      url: message.url,
      downloadFormat: message.downloadFormat || "video_original",
      title: message.title || "",
      cookies
    });
  });

  sendResponse({ ok: true });
}

function runNativeSettings(message, sendResponse) {
  let port;

  try {
    port = chrome.runtime.connectNative(HOST_NAME);
  } catch (error) {
    sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
    return;
  }

  let finished = false;

  port.onMessage.addListener((hostMessage) => {
    if (!["complete", "error", "canceled"].includes(hostMessage.type)) return;

    finished = true;
    sendResponse({
      ok: hostMessage.type === "complete",
      status: hostMessage.type,
      level: hostMessage.level,
      message: hostMessage.message || "",
      settings: hostMessage.settings || null
    });
    port.disconnect();
  });

  port.onDisconnect.addListener(() => {
    const error = chrome.runtime.lastError && chrome.runtime.lastError.message;
    if (!finished) {
      sendResponse({
        ok: false,
        error: error || "Native host disconnected before returning settings."
      });
    }
  });

  port.postMessage({
    action: message.action,
    askAlways: message.askAlways,
    path: message.path
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message) {
    return undefined;
  }

  if (message.type === "voided-video-downloader-download") {
    runNativeDownload(message, sender.tab && sender.tab.id, sendResponse);
    return true;
  }

  if (message.type === "voided-video-downloader-settings") {
    runNativeSettings(message, sendResponse);
    return true;
  }

  return undefined;
});
