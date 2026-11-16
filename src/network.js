import { connect } from "cloudflare:sockets";
import { CONST, safeFetch } from "./core.js";

const IPV4_REGEX = /^\d{1,3}(\.\d{1,3}){3}$/;

const byteToHex = Array.from({ length: 256 }, (_, i) => (i + 0x100).toString(16).slice(1));

function unsafeStringify(arr, offset = 0) {
  return (
    byteToHex[arr[offset]] +
    byteToHex[arr[offset + 1]] +
    byteToHex[arr[offset + 2]] +
    byteToHex[arr[offset + 3]] +
    "-" +
    byteToHex[arr[offset + 4]] +
    byteToHex[arr[offset + 5]] +
    "-" +
    byteToHex[arr[offset + 6]] +
    byteToHex[arr[offset + 7]] +
    "-" +
    byteToHex[arr[offset + 8]] +
    byteToHex[arr[offset + 9]] +
    "-" +
    byteToHex[arr[offset + 10]] +
    byteToHex[arr[offset + 11]] +
    byteToHex[arr[offset + 12]] +
    byteToHex[arr[offset + 13]] +
    byteToHex[arr[offset + 14]] +
    byteToHex[arr[offset + 15]]
  ).toLowerCase();
}

export function parseHeader(chunk, userIDs) {
  const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
  if (bytes.byteLength < 24) {
    return {
      has_error: true,
      message: "invalid data",
      address_remote: "",
      port_remote: 0,
      raw_data_index: 0,
      is_udp: false,
      version: 0,
    };
  }

  const version = bytes[0];
  const clientUUID = unsafeStringify(bytes, 1);
  const uuids = (userIDs || "").split(",").map((id) => id.trim().toLowerCase());
  const isValidUser = uuids.includes(clientUUID);

  if (!isValidUser) {
    return {
      has_error: true,
      message: "invalid user",
      address_remote: "",
      port_remote: 0,
      raw_data_index: 0,
      is_udp: false,
      version,
    };
  }

  const optLength = bytes[17];
  const commandIndex = 18 + optLength;
  if (bytes.byteLength <= commandIndex) {
    return {
      has_error: true,
      message: "invalid data",
      address_remote: "",
      port_remote: 0,
      raw_data_index: 0,
      is_udp: false,
      version,
    };
  }

  const command = bytes[commandIndex];
  if (command !== 1 && command !== 2) {
    return {
      has_error: true,
      message: `command ${command} is not supported`,
      address_remote: "",
      port_remote: 0,
      raw_data_index: 0,
      is_udp: false,
      version,
    };
  }
  const isUdp = command === 2;

  const portIndex = commandIndex + 1;
  if (bytes.byteLength < portIndex + 3) {
    return {
      has_error: true,
      message: "invalid data",
      address_remote: "",
      port_remote: 0,
      raw_data_index: 0,
      is_udp: isUdp,
      version,
    };
  }

  const portRemote = (bytes[portIndex] << 8) | bytes[portIndex + 1];
  const addressType = bytes[portIndex + 2];
  let currentIdx = portIndex + 3;
  let addressRemote = "";

  switch (addressType) {
    case 1: { // IPv4
      if (bytes.byteLength < currentIdx + 4) {
        return {
          has_error: true,
          message: "invalid data",
          address_remote: "",
          port_remote: portRemote,
          raw_data_index: 0,
          is_udp: isUdp,
          version,
        };
      }
      addressRemote = `${bytes[currentIdx]}.${bytes[currentIdx + 1]}.${bytes[currentIdx + 2]}.${bytes[currentIdx + 3]}`;
      currentIdx += 4;
      break;
    }
    case 2: { // Domain
      if (bytes.byteLength < currentIdx + 1) {
        return {
          has_error: true,
          message: "invalid data",
          address_remote: "",
          port_remote: portRemote,
          raw_data_index: 0,
          is_udp: isUdp,
          version,
        };
      }
      const addressLength = bytes[currentIdx];
      currentIdx += 1;
      if (bytes.byteLength < currentIdx + addressLength) {
        return {
          has_error: true,
          message: "invalid data",
          address_remote: "",
          port_remote: portRemote,
          raw_data_index: 0,
          is_udp: isUdp,
          version,
        };
      }
      addressRemote = new TextDecoder().decode(bytes.slice(currentIdx, currentIdx + addressLength));
      currentIdx += addressLength;
      break;
    }
    case 3: { // IPv6
      if (bytes.byteLength < currentIdx + 16) {
        return {
          has_error: true,
          message: "invalid data",
          address_remote: "",
          port_remote: portRemote,
          raw_data_index: 0,
          is_udp: isUdp,
          version,
        };
      }
      const segments = [];
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      for (let i = 0; i < 8; i++) {
        segments.push(view.getUint16(currentIdx + i * 2).toString(16));
      }
      addressRemote = segments.join(":");
      currentIdx += 16;
      break;
    }
    default:
      return {
        has_error: true,
        message: `invalid addressType: ${addressType}`,
        address_remote: "",
        port_remote: portRemote,
        raw_data_index: 0,
        is_udp: isUdp,
        version,
      };
  }

  return {
    has_error: false,
    message: "success",
    address_remote: addressRemote,
    port_remote: portRemote,
    raw_data_index: currentIdx,
    is_udp: isUdp,
    version,
  };
}

async function resolveIPv4(hostname) {
  if (IPV4_REGEX.test(hostname)) return hostname;
  try {
    const resp = await safeFetch(
      `https://1.1.1.1/dns-query?name=${encodeURIComponent(hostname)}&type=A`,
      { headers: { accept: "application/dns-json" } },
      4000,
    );
    const data = await resp.json();
    const answer = (data.Answer || []).find((a) => a.type === 1);
    return answer ? answer.data : null;
  } catch (error) {
    return null;
  }
}

function toNAT64Address(ipv4) {
  if (!ipv4 || !IPV4_REGEX.test(ipv4)) return null;
  const octets = ipv4.split(".").map(Number);
  if (octets.some((n) => n < 0 || n > 255)) return null;
  const hex = octets.map((n) => n.toString(16).padStart(2, "0"));
  return `64:ff9b::${hex[0]}${hex[1]}:${hex[2]}${hex[3]}`;
}

function parsePathOverrides(url) {
  const overrides = {};
  for (const [rawKey, rawValue] of url.searchParams) {
    const key = rawKey.toLowerCase();
    if (key === "nat64") {
      overrides.nat64 = rawValue.toLowerCase() === "on";
    } else if (key === "proxyip" || key === "proxyips") {
      overrides.proxyPool = rawValue
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }
  return overrides;
}

export function parseHostAndPort(addr, defaultPort = 443) {
  if (!addr) return { host: "", port: defaultPort };
  const str = String(addr).trim();
  if (str.startsWith("[")) {
    const closeBracketIdx = str.indexOf("]");
    if (closeBracketIdx !== -1) {
      const host = str.slice(1, closeBracketIdx);
      const rest = str.slice(closeBracketIdx + 1);
      const port = rest.startsWith(":") ? parseInt(rest.slice(1), 10) || defaultPort : defaultPort;
      return { host, port };
    }
  }
  const lastColon = str.lastIndexOf(":");
  if (lastColon !== -1 && str.indexOf(":") === lastColon) {
    const host = str.slice(0, lastColon);
    const port = parseInt(str.slice(lastColon + 1), 10) || defaultPort;
    return { host, port };
  }
  if (lastColon !== -1) {
    return { host: str, port: defaultPort };
  }
  return { host: str, port: defaultPort };
}

export function formatConnectHost(address) {
  if (!address) return "";
  const host = String(address).trim();
  if (host.includes(":") && !host.startsWith("[")) {
    return `[${host}]`;
  }
  return host;
}

export async function ProtocolOverWSHandler(request, config) {
  const overrides = parsePathOverrides(new URL(request.url));
  config = { ...config, ...overrides };

  const webSocketPair = new WebSocketPair();
  const [client, webSocket] = Object.values(webSocketPair);
  webSocket.accept();

  let address = "";
  let portWithRandomLog = "";
  let udpStreamWriter = null;

  const log = (info, event) => {
    console.log(`[${address}:${portWithRandomLog}] ${info}`, event || "");
  };

  const earlyDataHeader = request.headers.get(CONST.ED_PARAMS.eh) || "";
  const readableWebSocketStream = MakeReadableWebSocketStream(webSocket, earlyDataHeader, log);
  let remoteSocketWapper = { value: null };

  readableWebSocketStream
    .pipeTo(
      new WritableStream({
        async write(chunk, controller) {
          if (udpStreamWriter) return udpStreamWriter(chunk);
          if (remoteSocketWapper.value) {
            const writer = remoteSocketWapper.value.writable.getWriter();
            try {
              await writer.write(chunk);
            } catch (error) {
              safeCloseWebSocket(webSocket);
            } finally {
              writer.releaseLock();
            }
            return;
          }
          
          const header = parseHeader(chunk, config.userID);
          if (header.has_error) throw new Error(header.message);

          address = header.address_remote;
          portWithRandomLog = `${header.port_remote}--${Math.random()} ${header.is_udp ? "udp" : "tcp"} `;
          const vlessResponseHeader = new Uint8Array([header.version, 0]);
          const rawClientData = chunk.slice(header.raw_data_index);

          if (header.is_udp) {
            if (header.port_remote === 53) {
              const dnsPipeline = await createDnsPipeline(webSocket, vlessResponseHeader, log);
              udpStreamWriter = dnsPipeline.write;
              await udpStreamWriter(rawClientData);
            } else {
              log(`udp:${header.port_remote} not supported (dns-only), closing gently`);
              safeCloseWebSocket(webSocket);
            }
            return;
          }

          HandleTCPOutBound(
            remoteSocketWapper,
            header.address_remote,
            header.port_remote,
            rawClientData,
            webSocket,
            vlessResponseHeader,
            log,
            config,
          ).catch((error) => {
            console.error("HandleTCPOutBound failed:", error.stack || error);
            safeCloseWebSocket(webSocket);
          });
        },
        close() {
          log(`readableWebSocketStream closed`);
        },
        abort(err) {
          log(`readableWebSocketStream aborted`, err);
        },
      }),
    )
    .catch((err) => {
      console.error("Pipeline failed:", err.stack || err);
    });

  return new Response(null, { status: 101, webSocket: client });
}


async function HandleTCPOutBound(
  remoteSocket,
  addressRemote,
  portRemote,
  rawClientData,
  webSocket,
  protocolResponseHeader,
  log,
  config,
) {
  async function connectAndWrite(address, port) {
    const formattedHost = formatConnectHost(address);
    const tcpSocket = connect({
      hostname: formattedHost,
      port: Number(port),
    });

    remoteSocket.value = tcpSocket;

    const writer = tcpSocket.writable.getWriter();
    try {
      await writer.write(rawClientData);
      log("TCP write completed", {
        byteLength: rawClientData.byteLength,
        host: formattedHost,
        port: Number(port),
      });
      log(`connected to ${formattedHost}:${port}`);
      return tcpSocket;
    } catch (error) {
      try {
        tcpSocket.close();
      } catch {}
      remoteSocket.value = null;
      throw error;
    } finally {
      writer.releaseLock();
    }
  }

  async function retryWithPool(pool, index) {
    log("Retry pool entered", {
      poolLength: pool.length,
      index,
    });
    if (index >= pool.length) {
      log("Retry pool exhausted", {
        poolLength: pool.length,
      });
      await retryWithNAT64();
      return;
    }

    const { host: proxyHost, port: proxyPort } = parseHostAndPort(pool[index], 443);

    try {
      const tcpSocket = await connectAndWrite(proxyHost, proxyPort);

      RemoteSocketToWS(
        tcpSocket,
        webSocket,
        protocolResponseHeader,
        () => retryWithPool(pool, index + 1),
        log,
      ).catch((error) => {
        console.error("Proxy RemoteSocketToWS failed:", error.stack || error);
        safeCloseWebSocket(webSocket);
      });
    } catch (error) {
      log(`proxy ${proxyHost}:${proxyPort} failed`, error);
      await retryWithPool(pool, index + 1);
    }
  }
    
async function retryWithNAT64() {
  log("NAT64 fallback entered", {
    enabled: config.nat64 !== false,
  });

  if (config.nat64 === false) {
    log("NAT64 fallback disabled");
    safeCloseWebSocket(webSocket);
    return;
  }

  const ipv4 = await resolveIPv4(addressRemote);
  const nat64Address = toNAT64Address(ipv4);

  if (!nat64Address) {
    log(`NAT64 fallback failed: could not resolve ${addressRemote}`);
    safeCloseWebSocket(webSocket);
    return;
  }

  log(`falling back to NAT64: ${nat64Address}`);

  try {
    const tcpSocket = await connectAndWrite(nat64Address, portRemote);

    RemoteSocketToWS(
      tcpSocket,
      webSocket,
      protocolResponseHeader,
      null,
      log,
    ).catch((error) => {
      console.error("NAT64 RemoteSocketToWS failed:", error.stack || error);
      safeCloseWebSocket(webSocket);
    });
  } catch (error) {
    log("NAT64 connect failed", error);
    safeCloseWebSocket(webSocket);
  }
}

  try {
    const tcpSocket = await connectAndWrite(addressRemote, portRemote);

    RemoteSocketToWS(
      tcpSocket,
      webSocket,
      protocolResponseHeader,
      () => retryWithPool(config.proxyPool || [], 0),
      log,
    ).catch((error) => {
      console.error("Direct RemoteSocketToWS failed:", error.stack || error);
      safeCloseWebSocket(webSocket);
    });
  } catch (error) {
    log(`direct connection failed: ${addressRemote}:${portRemote}`, error);
    await retryWithPool(config.proxyPool || [], 0);
  }
}

function MakeReadableWebSocketStream(webSocketServer, earlyDataHeader, log) {
  return new ReadableStream({
    start(controller) {
      webSocketServer.addEventListener("message", (event) => {
        try {
          const data = event.data;
          log("WebSocket message received", {
            type: Object.prototype.toString.call(data),
            byteLength: data?.byteLength ?? data?.size ?? null,
          });
          controller.enqueue(data);
        } catch (error) {
          log("WebSocket message enqueue failed", {
            message: error?.message,
            stack: error?.stack,
          });
          safeCloseWebSocket(webSocketServer);
        }
      });

      webSocketServer.addEventListener("close", () => {
        safeCloseWebSocket(webSocketServer);
        try {
          controller.close();
        } catch (error) {
          log("WebSocket stream already closed");
        }
      });

      webSocketServer.addEventListener("error", (error) => {
        log("WebSocket server error", {
          message: error?.message,
        });
        controller.error(error);
      });

      const { earlyData, error } = base64ToArrayBuffer(earlyDataHeader);

      if (error) {
        log("Early Data decoding failed", {
          message: error?.message,
        });
        controller.error(error);
      } else if (earlyData) {
        log("Early Data received", {
          byteLength: earlyData.byteLength,
        });
        controller.enqueue(earlyData);
      }
    },

    pull() {},

    cancel(reason) {
      log("WebSocket stream canceled", {
        reason: String(reason),
      });
      safeCloseWebSocket(webSocketServer);
    },
  });
}


async function RemoteSocketToWS(
  remoteSocket,
  webSocket,
  protocolResponseHeader,
  retry,
  log,
) {
  let hasIncomingData = false;
  let headerSent = false;

  log("RemoteSocketToWS started");

  try {
    await remoteSocket.readable.pipeTo(
      new WritableStream({
        async write(chunk) {
          log("TCP data received", {
            byteLength: chunk.byteLength,
            webSocketState: webSocket.readyState,
          });

          if (webSocket.readyState !== CONST.WS_READY_STATE_OPEN) {
            throw new Error("WebSocket is not open");
          }

          hasIncomingData = true;

          let dataToSend = chunk;

          if (!headerSent && protocolResponseHeader) {
            const merged = new Uint8Array(
              protocolResponseHeader.length + chunk.byteLength,
            );

            merged.set(protocolResponseHeader, 0);
            merged.set(new Uint8Array(chunk), protocolResponseHeader.length);

            dataToSend = merged.buffer;
            headerSent = true;
          }

          webSocket.send(dataToSend);

          log("TCP data forwarded to WebSocket", {
            byteLength: dataToSend.byteLength,
          });
        },

        close() {
          log("TCP-to-WebSocket stream completed", {
            hasIncomingData,
            headerSent,
          });
        },

        abort(reason) {
          log("TCP-to-WebSocket stream aborted", {
            reason: String(reason),
          });
        },
      }),
    );
  } catch (error) {
    log("RemoteSocketToWS failed", {
      name: error?.name,
      message: error?.message,
      stack: error?.stack,
      hasIncomingData,
    });
  }

  log("RemoteSocketToWS completed", {
    hasIncomingData,
    retryAvailable: Boolean(retry),
  });

  if (!hasIncomingData && retry) {
    log("Retry started");

    try {
      await retry();
      log("Retry completed");
    } catch (error) {
      log("Retry failed", {
        name: error?.name,
        message: error?.message,
        stack: error?.stack,
      });

      safeCloseWebSocket(webSocket);
    }

    return;
  }

  safeCloseWebSocket(webSocket);
}

function base64ToArrayBuffer(base64Str) {
  if (!base64Str) return { earlyData: null, error: null };
  try {
    const binaryStr = atob(base64Str.replace(/-/g, "+").replace(/_/g, "/"));
    const buffer = new ArrayBuffer(binaryStr.length);
    const view = new Uint8Array(buffer);
    for (let i = 0; i < binaryStr.length; i++) view[i] = binaryStr.charCodeAt(i);
    return { earlyData: buffer, error: null };
  } catch (error) {
    return { earlyData: null, error };
  }
}

function safeCloseWebSocket(socket) {
  try {
    if (
      socket.readyState === CONST.WS_READY_STATE_OPEN ||
      socket.readyState === CONST.WS_READY_STATE_CLOSING
    )
      socket.close();
  } catch (error) {
    console.error("safeCloseWebSocket error:", error);
  }
}

async function createDnsPipeline(webSocket, vlessResponseHeader, log) {
  
let isHeaderSent = false;
let pending = new Uint8Array(0);

const transformStream = new TransformStream({
  transform(chunk, controller) {
    const incoming =
      chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);

    const data = new Uint8Array(pending.length + incoming.length);
    data.set(pending, 0);
    data.set(incoming, pending.length);

    let offset = 0;

    while (data.length - offset >= 2) {
      const udpPacketLength = (data[offset] << 8) | data[offset + 1];
      const frameLength = udpPacketLength + 2;

      if (data.length - offset < frameLength) break;

      controller.enqueue(data.slice(offset + 2, offset + frameLength));
      offset += frameLength;
    }

    pending = data.slice(offset);
  },

  flush() {
    if (pending.length !== 0) {
      throw new Error("Incomplete DNS-over-WebSocket frame");
    }
  },
});

  transformStream.readable
    .pipeTo(
      new WritableStream({
        async write(chunk) {
          try {
            const resp = await safeFetch(
              `https://1.1.1.1/dns-query`,
              {
                method: "POST",
                headers: { "content-type": "application/dns-message" },
                body: chunk,
              },
              4000,
            );
            const dnsQueryResult = await resp.arrayBuffer();
            const udpSize = dnsQueryResult.byteLength;
            const udpSizeBuffer = new Uint8Array([(udpSize >> 8) & 0xff, udpSize & 0xff]);

            if (webSocket.readyState === CONST.WS_READY_STATE_OPEN) {
              if (isHeaderSent) {
                webSocket.send(await new Blob([udpSizeBuffer, dnsQueryResult]).arrayBuffer());
              } else {
                webSocket.send(
                  await new Blob([
                    vlessResponseHeader,
                    udpSizeBuffer,
                    dnsQueryResult,
                  ]).arrayBuffer(),
                );
                isHeaderSent = true;
              }
            }
          } catch (error) {
            log("DNS query error: " + error);
          }
        },
      }),
    )
    .catch((e) => log("DNS stream error: " + e));

  const writer = transformStream.writable.getWriter();
  return { write: (chunk) => writer.write(chunk) };
}
