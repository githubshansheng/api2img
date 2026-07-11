import { createServer as createHttpServer } from "node:http";

export const TEST_IMAGE_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    request.on("error", reject);
    request.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

function sendJson(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(payload));
}

function sendResponsesSse(response, base64) {
  response.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  response.write(
    `event: response.output_item.done\ndata: ${JSON.stringify({
      item: {
        type: "image_generation_call",
        result: base64,
      },
    })}\n\n`,
  );
  response.write(
    `event: response.completed\ndata: ${JSON.stringify({
      response: {
        status: "completed",
        output: [
          {
            type: "image_generation_call",
            result: base64,
          },
        ],
      },
    })}\n\n`,
  );
  response.end("data: [DONE]\n\n");
}

function extractJsonStringField(text, fieldName) {
  const match = text.match(new RegExp(`"${fieldName}"\\s*:\\s*"([^"]+)"`));
  return match?.[1] || "";
}

function extractListingQuantity(text) {
  const explicit = extractJsonStringField(text, "skuPackQuantityText");
  if (explicit) {
    return explicit;
  }
  if (/4\s+Pack\s*\/\s*6\s+Pack/i.test(text)) {
    return "4 Pack / 6 Pack";
  }
  if (/2\s+Pack\s*\/\s*3\s+Pack/i.test(text)) {
    return "2 Pack / 3 Pack";
  }
  const count = text.match(/"skuBundleCount"\s*:\s*(\d{1,3})/)?.[1];
  return count && Number(count) > 1 ? `${Number(count)} Pack` : "1 Pack";
}

function extractListingProductName(text) {
  return (
    extractJsonStringField(text, "productName") ||
    extractJsonStringField(text, "skuTitle") ||
    "Regression Product"
  );
}

function makeListingDraft(text) {
  const quantity = extractListingQuantity(text);
  const productName = extractListingProductName(text);
  const title = `${quantity} ${productName} US Marketplace Product Visual Set`;
  return {
    title,
    sellingPoints: [
      `${productName} quantity and product details are organized for quick comparison.`,
      "Saved visual evidence keeps the marketplace text aligned with the generated asset set.",
    ],
    painPoints: [
      "Crowded product pages can make core use details hard to scan; this copy keeps the usage scene direct.",
      "Unclear presentation can slow purchase decisions during browsing; concise feature wording supports faster review.",
    ],
    fiveBullets: [
      `CORE VALUE: ${quantity} ${productName} presentation keeps the main offer clear for US shoppers.`,
      "VISUAL CONTEXT: Saved generation evidence guides benefit wording without adding unsupported claims.",
      "REAL-LIFE USE: Concise scene language helps buyers understand when the product is useful.",
      "SIZE & FIT: Product details stay readable while avoiding speculative measurement promises.",
      "PACKAGE SNAPSHOT: Keyword-focused structure supports marketplace search and seller review.",
    ],
    description: `${productName} marketplace text for US shoppers, organized around the saved product inputs and generated visual evidence.`,
    backendSearchTerms: `${productName} product visual set marketplace copy`,
    keywordBuckets: {
      exact: [productName],
      longTail: [`${quantity} ${productName}`],
      traffic: ["marketplace product"],
      descriptive: ["clear product copy"],
    },
    missingInfo: [],
  };
}

function parseJsonBody(buffer) {
  const text = buffer.toString("utf8");
  if (!text.trim().startsWith("{")) {
    return {};
  }
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

export async function createOpenAiCompatibleUpstreamServer(options = {}) {
  const requests = [];
  const base64 = options.base64 || TEST_IMAGE_BASE64;
  const server = createHttpServer(async (request, response) => {
    const bodyBuffer = await readRequestBody(request);
    const bodyText = bodyBuffer.toString("utf8");
    requests.push({
      method: request.method,
      url: request.url,
      headers: request.headers,
      body: bodyText,
    });

    if (request.method !== "POST") {
      sendJson(response, 405, { error: { message: "method not allowed" } });
      return;
    }

    if (request.url === "/v1/images/generations" || request.url === "/v1/images/edits") {
      sendJson(response, 200, {
        created: Math.floor(Date.now() / 1000),
        data: [{ b64_json: base64 }],
      });
      return;
    }

    if (request.url === "/v1/chat/completions") {
      sendJson(response, 200, {
        choices: [
          {
            message: {
              content: base64,
            },
          },
        ],
      });
      return;
    }

    if (request.url === "/v1/responses") {
      const body = parseJsonBody(bodyBuffer);
      const isListingRequest = Boolean(body?.text?.format?.name === "creation_listing_draft_json");
      if (isListingRequest) {
        sendJson(response, 200, {
          output_text: JSON.stringify(makeListingDraft(String(body.input || bodyText))),
        });
        return;
      }

      if (body?.stream === false) {
        sendJson(response, 200, {
          output: [
            {
              type: "image_generation_call",
              result: base64,
            },
          ],
        });
        return;
      }

      sendResponsesSse(response, base64);
      return;
    }

    sendJson(response, 404, {
      error: {
        message: `unexpected upstream request ${request.method} ${request.url}`,
      },
    });
  });

  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    requests,
  };
}

export async function stopHttpServer(server) {
  if (!server?.listening) {
    return;
  }
  await new Promise((resolveClose) => {
    server.close(() => resolveClose());
  });
}
