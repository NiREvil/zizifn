
import { connect } from "cloudflare:sockets";

const TARGET_HOST = "13.62.228.245";
const TARGET_PORT = 22;
const READ_TIMEOUT_MS = 8000;
const MAX_RESPONSE_BYTES = 4096;

const decoder = new TextDecoder();

async function readWithTimeout(reader, timeoutMs) {
  let timer;

  try {
    return await Promise.race([
      reader.read(),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve({ timeout: true }), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export default {
  async fetch(request) {
    if (request.method !== "GET") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const startedAt = Date.now();

    let socket;
    let reader;
    let stage = "connect";
    let connectMs = null;
    let firstByteMs = null;
    let bytesReceived = 0;
    let responseText = "";
    let readOutcome = "not_started";
    let error = null;

    try {
      socket = connect({
        hostname: TARGET_HOST,
        port: TARGET_PORT,
        secureTransport: "off",
      });

      await socket.opened;
      connectMs = Date.now() - startedAt;

      stage = "read";
      reader = socket.readable.getReader();

      const deadline = Date.now() + READ_TIMEOUT_MS;

      while (
        Date.now() < deadline &&
        bytesReceived < MAX_RESPONSE_BYTES
      ) {
        const remaining = deadline - Date.now();
        const result = await readWithTimeout(reader, remaining);

        if (result.timeout) {
          readOutcome = "timeout";
          break;
        }

        if (result.done) {
          readOutcome = "closed";
          break;
        }

        if (firstByteMs === null) {
          firstByteMs = Date.now() - startedAt;
        }

        bytesReceived += result.value.byteLength;
        responseText += decoder.decode(result.value, { stream: true });

        if (responseText.includes("\n")) {
          readOutcome = "data_received";
          break;
        }

        if (bytesReceived >= MAX_RESPONSE_BYTES) {
          readOutcome = "max_bytes";
          break;
        }
      }

      if (readOutcome === "not_started") {
        readOutcome = "timeout";
      }
    } catch (cause) {
      error = {
        name: cause?.name ?? "Error",
        message: cause?.message ?? String(cause),
      };
    } finally {
      if (reader) {
        try {
          await reader.cancel();
        } catch {}
      }

      if (socket) {
        try {
          socket.close();
        } catch {}
      }
    }

    const sshBanner = responseText.split(/\r?\n/, 1)[0] || null;
    const sshBannerReceived = /^SSH-\d+\.\d+-/.test(sshBanner ?? "");

    return Response.json(
      {
        success: sshBannerReceived,
        target: `${TARGET_HOST}:${TARGET_PORT}`,
        stage,
        connectMs,
        firstByteMs,
        totalMs: Date.now() - startedAt,
        bytesReceived,
        readOutcome,
        sshBanner,
        error,
      },
      {
        status: sshBannerReceived
          ? 200
          : readOutcome === "timeout"
            ? 504
            : 502,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  },
};
