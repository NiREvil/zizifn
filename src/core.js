const decodeSecure = (encoded) => atob(encoded);

export const SENS = {
  vless: () => decodeSecure("dmxlc3M="),
  ws: () => decodeSecure("d3M="),
  wsOpts: () => decodeSecure("d3Mtb3B0czo="),
  edLine: () => decodeSecure("ZWFybHktZGF0YS1oZWFkZXItbmFtZTog"),
  hiddify: () => decodeSecure("aGlkZGlmZTovL2luc3RhbGwtY29uZmlnP3VybD0="),
  v2rayng: () => decodeSecure("djJyYXluZzovL2luc3RhbGwtY29uZmlnP3VybD0="),
  clash: () => decodeSecure("Y2xhc2g6Ly9pbnN0YWxsLWNvbmZpZz91cmw9"),
  exclave: () => decodeSecure("c246Ly9zdWJzY3JpcHRpb24/dXJsPQ=="),
};

export const CONST = {
  ED_PARAMS: { ed: 2560, eh: decodeSecure("U2VjLVdlYlNvY2tldC1Qcm90b2NvbA==") },
  AT_SYMBOL: "@",
  VLESS_PROTOCOL: decodeSecure("dmxlc3M="),
  WS_READY_STATE_OPEN: 1,
  WS_READY_STATE_CLOSING: 2,
  CIPHER_SUITES:
    "TLS_AES_256_GCM_SHA384TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384:TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384:TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256:TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256:TLS_ECDHE_ECDSA_WITH_CHACHA20_POLY1305_SHA256:TLS_ECDHE_RSA_WITH_CHACHA20_POLY1305_SHA256:TLS_ECDHE_ECDSA_WITH_AES_256_CBC_SHA:TLS_ECDHE_RSA_WITH_AES_256_CBC_SHA:TLS_ECDHE_ECDSA_WITH_AES_128_CBC_SHA256:TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA256",
  FINAL_MASK: JSON.stringify({
    tcp: [
      {
        type: "fragment",
        settings: { packets: "tlshello", lengths: ["0", "104", "1"], delays: ["0"], maxSplit: "0" },
      },
      {
        type: "fragment",
        settings: { packets: "1-1", lengths: ["114", "1"], delays: ["1"], maxSplit: "11" },
      },
    ],
  }),
};

export const Config = {
  userID: "be0ff9df-1468-41a0-8865-796d1c6800db",
  proxyIPs: ["di.nscl.ir:443", "tr.diam4.ggff.net:443"],
  fromEnv(env) {
    const pool = env.PROXYIP
      ? [env.PROXYIP, ...this.proxyIPs.filter((ip) => ip !== env.PROXYIP)]
      : this.proxyIPs;
    return {
      userID: env.UUID || this.userID,
      proxyPool: pool,
      proxyAddress: pool[0],
      workerName: env.WORKERNAME || "",
      nat64: env.NAT64 !== "off",
    };
  },
};

const IPV4_REGEX = /^\d{1,3}(\.\d{1,3}){3}$/;
export const API_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.8083.38 Safari/537.36",
  Accept: "application/json",
};

export async function resolveIPv4ViaDoH(hostname) {
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

export async function fetchDomainIpPool(domain, timeout = 60000) {
  const parseResults = (data) => {
    if (!data || data.success === false || !Array.isArray(data.results)) return [];
    return data.results
      .filter((r) => r && typeof r.ip === "string" && IPV4_REGEX.test(r.ip))
      .map((r) => ({
        ip: r.ip,
        score: typeof r.fraud_score === "number" ? r.fraud_score : null,
        risk: r.risk ? r.risk.charAt(0).toUpperCase() + r.risk.slice(1) : "Unknown",
        country: r.details?.country || "Unknown",
        countryCode: (r.details?.country_code || "").toLowerCase(),
      }));
  };

  try {
    const resPages = await safeFetch(
      `https://cf-connected.pages.dev/api/domain/${encodeURIComponent(domain)}`,
      { headers: API_HEADERS },
      timeout,
    );
    if (resPages.ok) {
      const dataPages = await resPages.json();
      const pool = parseResults(dataPages);
      if (pool.length > 0) return pool;
    }
  } catch (e) {
    console.error("Primary — fetchDomainIpPool failed:", e.toString());
  }

  try {
    const resHarmonica = await safeFetch(
      `https://api-serpents.pages.dev/api/domain/${encodeURIComponent(domain)}`,
      { headers: API_HEADERS },
      timeout,
    );
    if (resHarmonica.ok) {
      const dataHarmonica = await resHarmonica.json();
      return parseResults(dataHarmonica);
    }
  } catch (e) {
    console.error("Secondary — fetchDomainIpPool failed:", e.toString());
  }

  return [];
}

export async function safeFetch(url, options = {}, timeout = 4000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

const ZIZIFN_PROXY_POOL_URL =
  "https://raw.githubusercontent.com/NiREvil/vless/refs/heads/main/sub/ProxyIP-for-zizifn.json";

const ZIZIFN_PROXY_POOL_FRESH_TTL = 21600;
const ZIZIFN_PROXY_POOL_STALE_TTL = 259200;

function createProxyPoolCacheKey(type) {
  return new Request(`https://cf-zizifn-proxy-pool.local/${type}`);
}

function validateZizifnProxyPool(data) {
  if (!data || typeof data !== "object") {
    throw new Error("Invalid ProxyIP dataset");
  }

  if (!Array.isArray(data.proxies)) {
    throw new Error("ProxyIP dataset has no proxies array");
  }

  if (!data.proxies.length) {
    throw new Error("ProxyIP dataset is empty");
  }

  const validProxies = data.proxies.filter(
    (proxy) =>
      proxy &&
      typeof proxy.ip === "string" &&
      proxy.ip.length > 0 &&
      Number.isInteger(proxy.port),
  );

  if (!validProxies.length) {
    throw new Error("ProxyIP dataset contains no valid proxies");
  }

  return {
    ...data,
    proxies: validProxies,
  };
}

export async function fetchZizifnProxyPool(ctx) {
  const cache = caches.default;
  const freshKey = createProxyPoolCacheKey("fresh");
  const staleKey = createProxyPoolCacheKey("stale");

  try {
    const fresh = await cache.match(freshKey);

    if (fresh) {
      return validateZizifnProxyPool(await fresh.json());
    }
  } catch (error) {
    console.error("ProxyIP fresh cache read failed:", error);
  }

  try {
    const response = await safeFetch(
      ZIZIFN_PROXY_POOL_URL,
      {
        headers: {
          Accept: "application/json",
        },
      },
      8000,
    );

    if (!response.ok) {
      throw new Error(`GitHub returned HTTP ${response.status}`);
    }

    const text = await response.text();

    if (!text || text.length < 100) {
      throw new Error("GitHub returned an unexpectedly small dataset");
    }

    const data = validateZizifnProxyPool(JSON.parse(text));

    const cacheResponse = new Response(text, {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": `public, max-age=${ZIZIFN_PROXY_POOL_FRESH_TTL}`,
      },
    });

    const staleResponse = new Response(text, {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": `public, max-age=${ZIZIFN_PROXY_POOL_STALE_TTL}`,
      },
    });

    ctx?.waitUntil(
      Promise.all([
        cache.put(freshKey, cacheResponse),
        cache.put(staleKey, staleResponse),
      ]),
    );

    return data;
  } catch (error) {
    console.error("ProxyIP GitHub fetch failed:", error);

    try {
      const stale = await cache.match(staleKey);

      if (stale) {
        console.warn("Using stale ProxyIP dataset");
        return validateZizifnProxyPool(await stale.json());
      }
    } catch (staleError) {
      console.error("ProxyIP stale cache read failed:", staleError);
    }

    throw new Error("ProxyIP dataset unavailable");
  }
}

export function buildSettingsUrl(workerName) {
  return workerName
    ? `https://dash.cloudflare.com/?to=/:account/workers/services/view/${workerName}/production/settings`
    : `https://dash.cloudflare.com/?to=/:account/workers-and-pages`;
}

export function generateRandomPath(length = 28, query = "") {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `/${result}${query ? `?${query}` : ""}`;
}

export function withConfigOverrides(path, { nat64, proxyIP } = {}) {
  const params = [];
  if (nat64 !== undefined) {
    params.push(`nat64=${nat64 ? "on" : "off"}`);
  }
  if (proxyIP) {
    const normalizedProxyIP = proxyIP.replace(/%3a/gi, ":");
    params.push(`proxyip=${normalizedProxyIP}`);
  }
  if (!params.length) return path;
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}${params.join("&")}`;
}

export const CORE_PRESETS = {
  xray: {
    tls: {
      path: () => generateRandomPath(18, "ed=2560"),
      security: "tls",
      fp: "chrome",
      alpn: "http/1.1",
      extra: {},
    },
    tcp: {
      path: () => generateRandomPath(18, "ed=2048"),
      security: "none",
      fp: "chrome",
      alpn: "http/1.1",
      extra: {},
    },
  },
  sb: {
    tls: {
      path: () => generateRandomPath(20),
      security: "tls",
      fp: "chrome",
      alpn: "http/1.1",
      extra: CONST.ED_PARAMS,
    },
    tcp: {
      path: () => generateRandomPath(20),
      security: "none",
      fp: "chrome",
      alpn: "http/1.1",
      extra: CONST.ED_PARAMS,
    },
  },
};

export const CF_TLS_PORTS = [443, 2053, 2083, 2087, 2096, 8443];
export const CF_NON_TLS_PORTS = [80, 8080, 2052, 2082, 2086, 2095, 8880];

export function pickRandomProxyPort(isPagesDeployment) {
  const pool = isPagesDeployment
    ? CF_TLS_PORTS.map((port) => ({ port, proto: "tls" }))
    : [
        ...CF_TLS_PORTS.map((port) => ({ port, proto: "tls" })),
        ...CF_NON_TLS_PORTS.map((port) => ({ port, proto: "tcp" })),
      ];
  return pool[Math.floor(Math.random() * pool.length)];
}

export function countryCodeToFlagEmoji(countryCode) {
  if (!countryCode || countryCode.length !== 2) return "";
  const code = countryCode.toUpperCase();
  const points = [...code].map((c) => 0x1f1e6 + (c.charCodeAt(0) - 65));
  if (points.some((p) => p < 0x1f1e6 || p > 0x1f1ff)) return "";
  return String.fromCodePoint(...points);
}

export async function cacheGetJson(key) {
  try {
    const res = await caches.default.match(
      new Request(`https://cf-ipmeta-cache.local/${encodeURIComponent(key)}`),
    );
    if (!res) return null;
    return await res.json();
  } catch (e) {
    return null;
  }
}

export async function cachePutJson(ctx, key, value, maxAgeSeconds = 21600) {
  try {
    const res = new Response(JSON.stringify(value), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": `public, max-age=${maxAgeSeconds}`,
      },
    });
    const put = caches.default.put(
      new Request(`https://cf-ipmeta-cache.local/${encodeURIComponent(key)}`),
      res,
    );
    if (ctx?.waitUntil) ctx.waitUntil(put);
    else await put;
  } catch (e) {}
}

export function makeName(tag, proto) {
  return `${tag}-${proto.toUpperCase()}`;
}

export function createVlessLink({
  userID,
  address,
  port,
  host,
  path,
  security,
  sni,
  fp,
  alpn,
  extra = {},
  enhanced = false,
  name,
}) {
  const params = new URLSearchParams({ type: decodeSecure("d3M="), host, path });
  if (security) params.set("security", security);
  if (sni) params.set("sni", sni);
  if (fp) params.set("fp", fp);
  if (alpn) params.set("alpn", alpn);
  if (enhanced) {
    if (security === "tls") params.set("cs", CONST.CIPHER_SUITES);
    params.set("fm", CONST.FINAL_MASK);
  }
  for (const [k, v] of Object.entries(extra)) params.set(k, v);
  return `${CONST.VLESS_PROTOCOL}://${userID}@${address}:${port}?${params.toString()}#${encodeURIComponent(name)}`;
}

export function buildLink({
  core,
  proto,
  userID,
  hostName,
  address,
  port,
  tag,
  enhanced = false,
  overrides,
}) {
  const p = CORE_PRESETS[core][proto];
  const path = overrides ? withConfigOverrides(p.path(), overrides) : p.path();
  return createVlessLink({
    userID,
    address,
    port,
    host: hostName,
    path,
    security: p.security,
    sni: p.security === "tls" ? hostName : undefined,
    fp: enhanced && p.security === "tls" ? "unsafe" : p.fp,
    alpn: p.alpn,
    extra: p.extra,
    enhanced,
    name: makeName(tag, proto) + (enhanced ? "-Enhanced" : ""),
  });
}

export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export function isInIgnoredRange(ip) {
  return ip.startsWith("198.41.208.");
}

export function buildMainDomains(hostName) {
  return [
    hostName,
    "creativecommons.org",
    "sky.rethinkdns.com",
    "www.speedtest.net",
    "singapore.com",
    "go.inmobi.com",
    "www.visa.com",
    "www.wto.org",
    "chatgpt.com",
    "medium.com",
    "lb.nscl.ir",
    "nodejs.org",
    "linkerd.io",
    "harbor.io",
    "npmjs.com",
    "csgo.com",
    "fbi.gov",
    "ip.sb",
    "time.is",
    "icook.hk",
    "unpkg.com",
    "mfa.gov.ua",
    "codepen.io",
    "jsdelivr.com",
    "store.ubi.com",
    "www.cdnjs.com",
    "cf.090227.xyz",
    "cf.877774.xyz",
    "cf.130519.xyz",
    "auth.vercel.com",
    "www.udacity.com",
    "www.gitbook.com",
    "www.ipaddress.my",
    "www.glassdoor.com",
    "www.ipchicken.com",
    "static.cloudflareinsights.com",
  ];
}

export function buildSubscriptionHeaders(subName) {
  const CAKE_INFO = { total_TB: 380, base_GB: 42000, daily_growth_GB: 250 };
  const GB_in_bytes = 1024 * 1024 * 1024;
  const TB_in_bytes = 1024 * GB_in_bytes;
  const total_bytes = CAKE_INFO.total_TB * TB_in_bytes;
  const base_bytes = CAKE_INFO.base_GB * GB_in_bytes;
  const now = new Date();
  const hours_passed = now.getHours() + now.getMinutes() / 60;
  const daily_growth_bytes = (hours_passed / 24) * (CAKE_INFO.daily_growth_GB * GB_in_bytes);
  const cake_download = base_bytes + daily_growth_bytes / 2;
  const cake_upload = base_bytes + daily_growth_bytes / 2;
  const expire_timestamp = Math.floor(Date.now() / 1000) + 2 * 365 * 24 * 60 * 60;
  const subInfo = `upload=${Math.round(cake_upload)}; download=${Math.round(cake_download)}; total=${total_bytes}; expire=${expire_timestamp}`;
  const headers = {
    "Profile-Update-Interval": "8",
    "Subscription-Userinfo": subInfo,
  };
  if (subName) {
    headers["Profile-Title"] = /^[\x20-\x7e]+$/.test(subName)
      ? subName
      : `base64:${btoa(String.fromCharCode(...new TextEncoder().encode(subName)))}`;
  }
  return headers;
 }
