const workerUrl = process.env.WORKER_URL;
const userID = "be0ff9df-1468-41a0-8865-796d1c6800db";

if (!workerUrl) {
  throw new Error("WORKER_URL is required");
}

const wsUrl = workerUrl.replace(/^https:/, "wss:").replace(/^http:/, "ws:");

const uuidBytes = Uint8Array.from(
  userID.replaceAll("-", "").match(/.{2}/g).map((byte) => parseInt(byte, 16)),
);

const domain = new TextEncoder().encode("example.com");
const payload = new TextEncoder().encode(
  "GET / HTTP/1.1\r\nHost: example.com\r\nConnection: close\r\n\r\n",
);

const header = new Uint8Array(1 + 16 + 1 + 1 + 2 + 1 + 1 + domain.length);

let offset = 0;
header[offset++] = 0;
header.set(uuidBytes, offset);
offset += 16;
header[offset++] = 0;
header[offset++] = 1;
header[offset++] = 0;
header[offset++] = 80;
header[offset++] = 2;
header[offset++] = domain.length;
header.set(domain, offset);

const requestData = new Uint8Array(header.length + payload.length);
requestData.set(header);
requestData.set(payload, header.length);

const startedAt = performance.now();
const ws = new WebSocket(`${wsUrl}/ws`);

ws.binaryType = "arraybuffer";

let received = false;

const timeout = setTimeout(() => {
  console.error("TIMEOUT: No response received within 15 seconds");
  ws.close();
  process.exitCode = 1;
}, 15000);

ws.addEventListener("open", () => {
  console.log("WEBSOCKET_OPEN");
  ws.send(requestData);
  console.log("VLESS_REQUEST_SENT");
});

ws.addEventListener("message", (event) => {
  received = true;
  clearTimeout(timeout);

  const data = new Uint8Array(event.data);

  if (data.length < 2) {
    console.error("INVALID_RESPONSE: VLESS response header is missing");
    ws.close();
    process.exitCode = 1;
    return;
  }

  const version = data[0];
  const optionLength = data[1];
  const response = new TextDecoder().decode(data.slice(2 + optionLength));

  console.log(
    JSON.stringify(
      {
        success: version === 0,
        version,
        optionLength,
        responseLength: response.length,
        responsePreview: response.slice(0, 500),
        durationMs: Math.round(performance.now() - startedAt),
      },
      null,
      2,
    ),
  );

  if (!response.startsWith("HTTP/")) {
    console.error("UNEXPECTED_RESPONSE: HTTP response was not detected");
    process.exitCode = 1;
  }

  ws.close();
});

ws.addEventListener("error", () => {
  clearTimeout(timeout);
  console.error("WEBSOCKET_ERROR");
  process.exitCode = 1;
});

ws.addEventListener("close", (event) => {
  clearTimeout(timeout);

  console.log(
    JSON.stringify({
      websocketClosed: true,
      code: event.code,
      reason: event.reason,
      received,
    }),
  );

  if (!received) process.exitCode = 1;
});
