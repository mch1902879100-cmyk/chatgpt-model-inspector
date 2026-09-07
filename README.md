# ChatGPT Model Inspector

**简体中文** | [English](README_EN.md)

> 把每次 `F12 → Network → 找请求 → 搜 model_slug` 的重复动作，变成 ChatGPT 右上角一眼确认。

`v0.1.0` · `Edge / Chrome` · `Manifest V3`

![ChatGPT Model Inspector](assets/model-inspector.png)

## 30 秒看懂

以前想看一次 `model_slug`，通常要打开开发者工具、找到相关网络请求，再去响应里搜索字段。

现在的流程更短：正常发消息，插件在页面响应里看到 `model_slug` 后，直接把最近一次结果显示在右上角。

![Before and now workflow](assets/workflow-example.svg)

例如，某次响应里出现了一个类似这样的字段：

```json
{
  "model_slug": "gpt-example-model"
}
```

面板会显示最近一次检测到的 slug。点击 **“复制检测结果”**，会得到类似：

```text
ChatGPT Model Inspector
model_slug: gpt-example-model
level: 🟡 标准模型
transport: fetch
url: https://chatgpt.com/backend-api/conversation
time: 2026-09-03T00:00:00.000Z
```

这里使用的是泛化示例，不代表某次真实会话当前一定会返回这个名字。

## 为什么做这个

这个工具起点很简单：我有时会想确认 ChatGPT 页面响应里到底返回了什么 `model_slug`。

手动查当然可以，但每次都走一遍 **F12 → Network → 找 conversation / response → 搜字段**，属于那种“不难，但很烦”的重复动作。

所以就把它做成了一个很小的浏览器扩展：不替你判断结论，只把原本藏在响应里的字段更快地摆到眼前。

## 它能告诉你什么

- 页面处理到的响应里，如果明确出现 `model_slug`，插件会尝试把它提取出来。
- 显示最近一次检测到的 slug、传输方式和检测时间。
- 最多保留 30 条最近的非快速重复记录在浏览器本地存储中。
- slug 名称中如果出现独立的 `mini` 段，会给出一个醒目的命名提示。

## 它不能告诉你什么

- **不能证明** 某个模型内部真实使用了什么能力配置。
- **不能解释** 为什么一次请求被路由到某个模型。
- **不能把 `mini` 提示当成质量结论**；它只是根据 slug 名称做的便利提示。
- 如果页面响应里没有可观察到的 `model_slug`，插件也不会凭界面标签去猜。

这也是这个项目最重要的边界：**它是一个响应字段查看器，不是模型真伪鉴定器。**

## 适合谁

- 经常会开 F12 看 ChatGPT 网络响应的人。
- 想快速记录不同会话里返回 slug 的开发者或重度用户。
- 在调试浏览器扩展、网页请求或模型路由现象时，希望少做几步重复操作的人。

如果你平时完全不会看 Network 面板，这个工具可能就没有那么必要。

## 安装

当前版本是 **开发者模式加载的未打包扩展**，还没有发布到 Chrome Web Store 或 Edge Add-ons。

### 方法一：下载 Release 压缩包

1. 从 GitHub Releases 下载 `chatgpt-model-inspector-v0.1.0.zip`。
2. 解压到一个固定目录。
3. Edge 打开 `edge://extensions/`；Chrome 打开 `chrome://extensions/`。
4. 开启 **开发者模式 / Developer mode**。
5. 点击 **加载解压缩的扩展 / Load unpacked**。
6. 选择刚刚解压的文件夹。
7. 刷新 `https://chatgpt.com/`，再发送一条新消息。

### 方法二：直接从源码加载

Clone 或下载本仓库，然后在扩展管理页选择仓库根目录即可。根目录里应该能直接看到 `manifest.json`。

> 如果 ChatGPT 页面在安装或更新扩展之前就已经打开，请刷新一次页面，让网络监听从页面初始化阶段安装。

## 使用

安装后正常使用 ChatGPT 即可，不需要额外点按钮启动监听。

当支持的响应中出现 `model_slug`：

1. 右上角面板更新当前 slug。
2. 显示检测时间和 `fetch` / `XHR` 来源。
3. 可点击复制结果。
4. 面板可以折叠，避免一直占空间。

如果想看本地历史记录，可以在开发者工具 Console 中切换到扩展 content script 的 JavaScript 上下文，然后执行：

```js
chrome.storage.local.get("modelSlugHistory").then(console.log)
```

记录结构类似：

```json
{
  "modelSlug": "gpt-example-model",
  "transport": "fetch",
  "url": "https://chatgpt.com/backend-api/conversation",
  "detectedAt": "2026-09-03T00:00:00.000Z"
}
```

## 权限与本地数据

当前 `manifest.json` 声明的扩展权限很少：

- `storage`：用于保存最近检测记录。
- `https://chatgpt.com/*`
- `https://chat.openai.com/*`

历史记录保存在 `chrome.storage.local`。项目当前没有配置独立后台服务；如果你对浏览器扩展权限比较敏感，可以直接查看 `manifest.json`、`src/page-hook.js` 和 `src/content.js`。

## 它是怎么工作的

这个扩展使用 Manifest V3 的两套 content script 世界：

- `src/page-hook.js` 运行在页面 `MAIN` world，观察与 conversation / response 相关的 `fetch` 和 XHR 响应。
- `src/content.js` 运行在扩展隔离环境里，接收并校验页面消息、渲染面板、保存本地历史。
- `src/panel.css` 负责 Shadow DOM 面板样式。

对 `fetch` 响应，插件会尽量读取 `Response.clone()` 的副本；对 XHR 主要通过事件监听读取文本。设计目标是“旁路观察”，不主动改写请求参数、响应正文或页面回调。

## 已知限制

- ChatGPT 前端接口路径或响应结构未来可能变化，届时需要跟着更新。
- 只有页面可观察到的响应中出现 `model_slug` 时，插件才有结果。
- 某些响应可能重复携带同一个 slug，因此本地记录会过滤短时间快速重复项。
- 当前仅提供开发者模式本地加载，没有浏览器商店自动更新。

## 开发与测试

本地可以运行：

```bash
node tests/page-hook.smoke.js
```

冒烟测试会检查：

- `fetch` 响应中的 slug 提取。
- XHR 响应中的 slug 提取。
- 读取 clone 不会消费页面原始 `fetch` 响应。

项目结构：

```text
chatgpt-model-inspector/
├─ assets/
│  ├─ model-inspector.png
│  └─ workflow-example.svg
├─ manifest.json
├─ README.md
├─ README_EN.md
├─ src/
│  ├─ content.js
│  ├─ page-hook.js
│  └─ panel.css
└─ tests/
   └─ page-hook.smoke.js
```

## 版本

当前公开预览版本：**v0.1.0**。

版本规则采用 `0.x.y`：小修复升 patch，新增明显功能升 minor；在功能和兼容性足够稳定前保持 `0.x`。

## License

当前还没有选定开源许可证。正式确定 License 之前，请不要默认本仓库代码已经获得 MIT / Apache 等许可授权。

---

如果这个工具最终能帮你少开几次 F12，它就已经完成任务了。
