(() => {
  "use strict";

  const INSTALL_FLAG = Symbol.for("chatgpt-model-inspector.v1.installed");
  const MESSAGE_SOURCE = "chatgpt-model-inspector-v1";
  const MAX_BUFFER_LENGTH = 4096;
  const xhrMeta = new WeakMap();

  if (window[INSTALL_FLAG]) {
    return;
  }

  Object.defineProperty(window, INSTALL_FLAG, {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false
  });

  const isTargetUrl = (value) => {
    try {
      const url = new URL(String(value), location.href);
      return /(?:^|\/)(?:backend-api\/)?(?:f\/)?conversations?(?:\/|$)/i.test(url.pathname)
        || /(?:^|\/)responses?(?:\/|$)/i.test(url.pathname);
    } catch (_error) {
      return /(?:conversation|response)/i.test(String(value));
    }
  };

  const normalizeSlug = (value) => {
    if (typeof value !== "string") {
      return null;
    }

    const slug = value.trim();
    return /^[a-z0-9][a-z0-9._:/-]{1,127}$/i.test(slug) ? slug : null;
  };

  const emitSlug = (modelSlug, transport, url) => {
    const normalized = normalizeSlug(modelSlug);
    if (!normalized) {
      return;
    }

    window.postMessage({
      source: MESSAGE_SOURCE,
      type: "MODEL_SLUG_DETECTED",
      payload: {
        modelSlug: normalized,
        transport,
        url: String(url || location.href),
        detectedAt: new Date().toISOString()
      }
    }, location.origin);
  };

  const walkJson = (value, results, seen) => {
    if (!value || typeof value !== "object" || seen.has(value)) {
      return;
    }

    seen.add(value);
    for (const [key, child] of Object.entries(value)) {
      if (key === "model_slug" || key === "modelSlug") {
        const slug = normalizeSlug(child);
        if (slug) {
          results.add(slug);
        }
      }

      if (child && typeof child === "object") {
        walkJson(child, results, seen);
      }
    }
  };

  const extractSlugs = (value) => {
    const results = new Set();

    if (value && typeof value === "object") {
      walkJson(value, results, new WeakSet());
      return [...results];
    }

    if (typeof value !== "string" || !value) {
      return [];
    }

    const patterns = [
      /["']model_slug["']\s*:\s*["']([a-z0-9._:/-]{2,128})["']/gi,
      /\\["']model_slug\\["']\s*:\s*\\["']([a-z0-9._:/-]{2,128})\\["']/gi
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(value)) !== null) {
        const slug = normalizeSlug(match[1]);
        if (slug) {
          results.add(slug);
        }
      }
    }

    if (results.size === 0) {
      for (const line of value.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) {
          continue;
        }

        const data = trimmed.slice(5).trim();
        if (!data || data === "[DONE]") {
          continue;
        }

        try {
          walkJson(JSON.parse(data), results, new WeakSet());
        } catch (_error) {
          // An SSE chunk may contain an incomplete JSON object. The rolling
          // text buffer and the next progress event will try it again.
        }
      }
    }

    return [...results];
  };

  const inspect = (value, transport, url) => {
    for (const slug of extractSlugs(value)) {
      emitSlug(slug, transport, url);
    }
  };

  const inspectFetchResponse = async (response, requestUrl) => {
    if (!response || !isTargetUrl(response.url || requestUrl)) {
      return;
    }

    const responseUrl = response.url || requestUrl;
    let clone;
    try {
      clone = response.clone();
    } catch (_error) {
      return;
    }

    if (!clone.body || typeof clone.body.getReader !== "function") {
      try {
        inspect(await clone.text(), "fetch", responseUrl);
      } catch (_error) {
        // Inspection is best-effort and must never affect the page request.
      }
      return;
    }

    const reader = clone.body.getReader();
    const decoder = new TextDecoder();
    let rollingBuffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          rollingBuffer += decoder.decode();
          inspect(rollingBuffer, "fetch", responseUrl);
          break;
        }

        rollingBuffer += decoder.decode(value, { stream: true });
        inspect(rollingBuffer, "fetch", responseUrl);
        if (rollingBuffer.length > MAX_BUFFER_LENGTH) {
          rollingBuffer = rollingBuffer.slice(-MAX_BUFFER_LENGTH);
        }
      }
    } catch (_error) {
      // Ignore clone/read errors; the original Response stays untouched.
    } finally {
      try {
        reader.releaseLock();
      } catch (_error) {
        // The stream may already be closed.
      }
    }
  };

  const originalFetch = window.fetch;
  if (typeof originalFetch === "function") {
    window.fetch = new Proxy(originalFetch, {
      apply(target, thisArg, args) {
        const request = args[0];
        const requestUrl = typeof request === "string" || request instanceof URL
          ? String(request)
          : request && request.url;
        const promise = Reflect.apply(target, thisArg, args);

        Promise.resolve(promise).then((response) => {
          void inspectFetchResponse(response, requestUrl);
        }).catch(() => {
          // Preserve the original promise and error behavior.
        });

        return promise;
      }
    });
  }

  const xhrPrototype = window.XMLHttpRequest && window.XMLHttpRequest.prototype;
  if (xhrPrototype) {
    const originalOpen = xhrPrototype.open;
    const originalSend = xhrPrototype.send;

    xhrPrototype.open = function inspectorOpen(method, url, ...rest) {
      xhrMeta.set(this, {
        url: String(url || ""),
        installed: false,
        cursor: 0,
        tail: ""
      });
      return Reflect.apply(originalOpen, this, [method, url, ...rest]);
    };

    xhrPrototype.send = function inspectorSend(...args) {
      const meta = xhrMeta.get(this);
      if (meta && isTargetUrl(meta.url) && !meta.installed) {
        meta.installed = true;

        this.addEventListener("progress", () => {
          try {
            if (this.responseType !== "" && this.responseType !== "text") {
              return;
            }

            const text = this.responseText || "";
            const next = text.slice(meta.cursor);
            meta.cursor = text.length;
            const candidate = meta.tail + next;
            inspect(candidate, "xhr", this.responseURL || meta.url);
            meta.tail = candidate.slice(-MAX_BUFFER_LENGTH);
          } catch (_error) {
            // Some response types do not expose responseText.
          }
        });

        this.addEventListener("loadend", () => {
          try {
            const value = this.responseType === "json" ? this.response : this.responseText;
            inspect(value, "xhr", this.responseURL || meta.url);
          } catch (_error) {
            // Inspection is isolated from the page's XHR lifecycle.
          }
        });
      }

      return Reflect.apply(originalSend, this, args);
    };
  }

  window.postMessage({
    source: MESSAGE_SOURCE,
    type: "HOOK_READY"
  }, location.origin);
})();
