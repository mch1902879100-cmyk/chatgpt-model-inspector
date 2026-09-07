# ChatGPT Model Inspector

A tiny Manifest V3 browser extension that surfaces the `model_slug` returned in ChatGPT network responses.

> 一个轻量的 Edge / Chrome 扩展：直接显示 ChatGPT 网络响应里出现的 `model_slug`。

![ChatGPT Model Inspector screenshot](assets/model-inspector.png)

## What it does

- Watches ChatGPT `fetch` and `XMLHttpRequest` responses for `model_slug` values.
- Handles common JSON, XHR text, and streaming SSE response shapes.
- Shows the latest detected slug in a small in-page panel.
- Keeps up to 30 recent non-duplicate detections in `chrome.storage.local`.
- Adds a visible warning when the returned slug contains a standalone `mini` segment.
- Lets you copy the latest detection result with one click.

## Why

Checking `model_slug` manually usually means opening DevTools, finding the relevant network request, and searching through the response. This extension turns that repeated inspection step into a small always-available panel.

It does **not** determine a model's hidden capabilities or prove why a model was routed. It only surfaces `model_slug` values that are explicitly present in responses observed by the page.

## Screenshot

The panel is intentionally small: current `model_slug`, a lightweight status label, detection time/transport, local history count, and a copy button.

## Install

### Edge / Edge Dev

1. Open `edge://extensions/`.
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select this repository folder.
5. Open or refresh `https://chatgpt.com/`.
6. Send a new message and wait for the panel to detect a response.

### Chrome

1. Open `chrome://extensions/`.
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select this repository folder.
5. Refresh ChatGPT and send a new message.

If ChatGPT was already open when the extension was installed or updated, refresh the tab so the network hook is installed from page start.

## Usage

Use ChatGPT normally. When a supported response contains `model_slug`, the panel updates automatically.

To inspect the locally stored history from DevTools, switch the Console JavaScript context to the extension content-script context and run:

```js
chrome.storage.local.get("modelSlugHistory").then(console.log)
```

Each stored record contains fields similar to:

```json
{
  "modelSlug": "gpt-example-model",
  "transport": "fetch",
  "url": "https://chatgpt.com/backend-api/conversation",
  "detectedAt": "2026-09-03T00:00:00.000Z"
}
```

## How it works

The extension uses Manifest V3 content scripts in two worlds:

- `src/page-hook.js` runs in the page's `MAIN` world and observes `fetch` / XHR responses.
- `src/content.js` runs in the isolated extension world, validates messages, renders the panel, and stores recent detections.
- `src/panel.css` styles the panel inside a closed Shadow DOM.

Network responses are inspected from a cloned `fetch` response where possible. The extension does not intentionally rewrite request parameters, response bodies, or ChatGPT callbacks.

## Development

Run the local smoke test with:

```bash
node tests/page-hook.smoke.js
```

The smoke test checks both fetch and XHR extraction and verifies that reading a cloned fetch response does not consume the response received by the page.

## Limitations

- The extension depends on ChatGPT's current frontend network behavior and response structure; future changes can require updates.
- It only reports `model_slug` when that field is observable in a response handled by the page.
- The `mini` warning is a naming-based convenience indicator, not proof of a specific routing decision or quality level.
- This is currently a developer-mode unpacked extension; it is not distributed through the Chrome Web Store or Edge Add-ons store.

## Version

Current public-preview version: **v0.1.0**.

See GitHub Releases for packaged versions and release notes once published.

## License

No open-source license has been selected yet. Until a license is added, normal copyright rules apply.

## 中文说明

这是一个很小的开发者工具，目标不是“判断 ChatGPT 真正是什么模型”，而是减少每次手动打开 F12 → Network → 找请求 → 搜 `model_slug` 的重复操作。

安装后，只要页面响应里明确出现 `model_slug`，右上角面板就会显示最近一次检测结果。当前版本仅适合开发者模式下本地加载。
