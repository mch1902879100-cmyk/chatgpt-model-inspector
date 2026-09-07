(() => {
  "use strict";

  const MESSAGE_SOURCE = "chatgpt-model-inspector-v1";
  const STORAGE_KEY = "modelSlugHistory";
  const MAX_HISTORY = 30;
  const HOST_ID = "chatgpt-model-inspector-host";

  let panel = null;
  let currentModel = null;
  let historyCount = 0;
  let hookReady = true;
  let saveQueue = Promise.resolve();

  const storageGet = (key) => new Promise((resolve) => {
    chrome.storage.local.get(key, resolve);
  });

  const storageSet = (value) => new Promise((resolve) => {
    chrome.storage.local.set(value, resolve);
  });

  const isMiniModel = (slug) => /(?:^|[-_.])mini(?:$|[-_.])/i.test(slug || "");

  const getModelLevel = (slug) => {
    if (!slug) return "未知";
    if (isMiniModel(slug)) return "🔴 mini / 可能降级";
    if (/thinking|pro|5\.6|5\.5/i.test(slug)) return "🟢 高级模型";
    return "🟡 标准模型";
  };

  const formatTime = (isoString) => {
    if (!isoString) {
      return "--:--:--";
    }

    try {
      return new Intl.DateTimeFormat(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
      }).format(new Date(isoString));
    } catch (_error) {
      return "--:--:--";
    }
  };

  const render = () => {
    if (!panel) {
      return;
    }

    const modelElement = panel.querySelector("[data-model]");
    const statusElement = panel.querySelector("[data-status]");
    const warningElement = panel.querySelector("[data-warning]");
    const historyElement = panel.querySelector("[data-history]");
    const levelElement = panel.querySelector("[data-level]");

    modelElement.textContent = currentModel ? currentModel.modelSlug : "等待响应…";
    statusElement.textContent = currentModel
      ? `检测于 ${formatTime(currentModel.detectedAt)} · ${currentModel.transport}`
      : (hookReady ? "监听已就绪，请发送一条消息" : "正在安装网络监听…");
    historyElement.textContent = `本地记录 ${historyCount} 条`;
    levelElement.textContent = currentModel ? getModelLevel(currentModel.modelSlug) : "等待检测";

    const showWarning = currentModel && isMiniModel(currentModel.modelSlug);
    warningElement.hidden = !showWarning;
    panel.classList.toggle("is-warning", Boolean(showWarning));
  };

  const createPanel = () => {
    if (document.getElementById(HOST_ID)) {
      return;
    }

    const host = document.createElement("div");
    host.id = HOST_ID;
    host.setAttribute("aria-live", "polite");
    const shadow = host.attachShadow({ mode: "closed" });

    const stylesheet = document.createElement("link");
    stylesheet.rel = "stylesheet";
    stylesheet.href = chrome.runtime.getURL("src/panel.css");

    panel = document.createElement("section");
    panel.className = "inspector";
    panel.innerHTML = `
      <div class="header">
        <span class="eyebrow">MODEL INSPECTOR</span>
        <button class="collapse" type="button" aria-label="折叠模型检测面板" title="折叠/展开">−</button>
      </div>
      <div class="body">
        <div class="label">当前 model_slug</div>
        <div class="model" data-model>等待响应…</div>
        <div class="level" data-level>等待检测</div>
        <div class="warning" data-warning hidden>⚠ 检测到 mini 模型，可能发生模型降级</div>
        <div class="status" data-status>正在安装网络监听…</div>
        <div class="history" data-history>本地记录 0 条</div>
        <button class="copy" type="button">复制检测结果</button>
      </div>
    `;

    panel.querySelector(".collapse").addEventListener("click", (event) => {
      const collapsed = panel.classList.toggle("is-collapsed");
      event.currentTarget.textContent = collapsed ? "+" : "−";
      event.currentTarget.setAttribute("aria-label", collapsed ? "展开模型检测面板" : "折叠模型检测面板");
    });

    panel.querySelector(".copy").addEventListener("click", async () => {
      if (!currentModel) return;
      const text = [
        "ChatGPT Model Inspector",
        `model_slug: ${currentModel.modelSlug}`,
        `level: ${getModelLevel(currentModel.modelSlug)}`,
        `transport: ${currentModel.transport}`,
        `url: ${currentModel.url}`,
        `time: ${currentModel.detectedAt}`
      ].join("\n");
      await navigator.clipboard.writeText(text);
    });

    shadow.append(stylesheet, panel);
    (document.documentElement || document.body).appendChild(host);
    render();
  };

  const ensurePanel = () => {
    if (document.documentElement) {
      createPanel();
      return;
    }

    const observer = new MutationObserver(() => {
      if (document.documentElement) {
        observer.disconnect();
        createPanel();
      }
    });
    observer.observe(document, { childList: true, subtree: true });
  };

  const saveDetection = async (payload) => {
    const stored = await storageGet(STORAGE_KEY);
    const history = Array.isArray(stored[STORAGE_KEY]) ? stored[STORAGE_KEY] : [];
    const latest = history[0];

    const isRapidDuplicate = latest
      && latest.modelSlug === payload.modelSlug
      && Date.parse(payload.detectedAt) - Date.parse(latest.detectedAt) < 5000;

    if (!isRapidDuplicate) {
      history.unshift(payload);
      history.splice(MAX_HISTORY);
      await storageSet({ [STORAGE_KEY]: history });
    }

    historyCount = history.length;
    render();
  };

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== location.origin) {
      return;
    }

    const message = event.data;
    if (!message || message.source !== MESSAGE_SOURCE) {
      return;
    }

    if (message.type === "HOOK_READY") {
      hookReady = true;
      render();
      return;
    }

    if (message.type !== "MODEL_SLUG_DETECTED" || !message.payload) {
      return;
    }

    const payload = message.payload;
    if (typeof payload.modelSlug !== "string" || !payload.modelSlug.trim()) {
      return;
    }

    const detection = {
      modelSlug: payload.modelSlug.trim(),
      transport: payload.transport === "xhr" ? "XHR" : "fetch",
      url: String(payload.url || ""),
      detectedAt: payload.detectedAt || new Date().toISOString()
    };
    currentModel = detection;
    render();
    saveQueue = saveQueue.then(() => saveDetection(detection)).catch(() => {
      // A storage failure must not interrupt future detections or page logic.
    });
  });

  void storageGet(STORAGE_KEY).then((stored) => {
    const history = Array.isArray(stored[STORAGE_KEY]) ? stored[STORAGE_KEY] : [];
    historyCount = history.length;
    render();
  });

  ensurePanel();
})();
