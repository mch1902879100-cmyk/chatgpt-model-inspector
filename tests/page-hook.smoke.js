"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");

const messages = [];

global.window = globalThis;
global.location = new URL("https://chatgpt.com/");
global.postMessage = (message) => messages.push(message);

class MockXMLHttpRequest extends EventTarget {
  constructor() {
    super();
    this.responseType = "";
    this.responseText = "";
    this.responseURL = "";
  }

  open(_method, url) {
    this.responseURL = String(url);
  }

  send() {
    this.responseText = 'data: {"message":{"metadata":{"model_slug":"gpt-5-mini"}}}\n\n';
    this.dispatchEvent(new Event("progress"));
    this.dispatchEvent(new Event("loadend"));
  }
}

global.XMLHttpRequest = MockXMLHttpRequest;

const fetchBody = 'data: {"message":{"metadata":{"model_slug":"gpt-5.5-mini"}}}\n\n';
global.fetch = async () => new Response(new ReadableStream({
  start(controller) {
    const encoder = new TextEncoder();
    controller.enqueue(encoder.encode(fetchBody.slice(0, 38)));
    controller.enqueue(encoder.encode(fetchBody.slice(38, 55)));
    controller.enqueue(encoder.encode(fetchBody.slice(55)));
    controller.close();
  }
}), {
  headers: { "content-type": "text/event-stream" }
});

require(path.join(__dirname, "..", "src", "page-hook.js"));

const waitFor = async (predicate, timeoutMs = 1000) => {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out waiting for model_slug detection");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

(async () => {
  const response = await fetch("https://chatgpt.com/backend-api/conversation");
  assert.equal(await response.text(), fetchBody, "the original fetch response must remain readable");

  const xhr = new XMLHttpRequest();
  xhr.open("POST", "https://chatgpt.com/backend-api/f/conversation");
  xhr.send();

  await waitFor(() => messages.some((message) => (
    message.type === "MODEL_SLUG_DETECTED"
      && message.payload.modelSlug === "gpt-5.5-mini"
  )));

  assert.ok(messages.some((message) => (
    message.type === "MODEL_SLUG_DETECTED"
      && message.payload.modelSlug === "gpt-5-mini"
      && message.payload.transport === "xhr"
  )), "XHR model_slug should be detected");

  console.log("page-hook smoke test: PASS");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
