import {
  buildLink,
  safeFetch,
  isInIgnoredRange,
  pick,
  CONST,
  SENS,
  buildMainDomains,
  buildSubscriptionHeaders,
  buildSettingsUrl,
  resolveIPv4ViaDoH,
  fetchDomainIpPool,
  countryCodeToFlagEmoji,
  cacheGetJson,
  cachePutJson,
  pickRandomProxyPort,
  API_HEADERS,
} from "./core.js";

import panelB64 from "./panel.b64";

let panelHtml = null;
function getPanelHtml() {
  if (!panelHtml) {
    panelHtml = new TextDecoder("utf-8").decode(
      Uint8Array.from(atob(panelB64), (c) => c.charCodeAt(0)),
    );
  }
  return panelHtml;
}

export async function handleIpSubscription(
  request,
  core,
  userID,
  hostName,
  ctx,
  enhanced = false,
  cfg = null,
  env = null,
) {
  const url = new URL(request.url);
  const subName = url.searchParams.get("name");

  const mainDomains = buildMainDomains(hostName);

  const httpsPorts = [443, 8443, 2053, 2083, 2087, 2096];
  const httpPorts = [80, 8080, 8880, 2052, 2082, 2086, 2095];
  let links = [];
  const isPagesDeployment = hostName.endsWith(".pages.dev");
  const includeTcp = core === "xray" && enhanced && !isPagesDeployment;

  mainDomains.forEach((domain, i) => {
    links.push(
      buildLink({
        core,
        proto: "tls",
        userID,
        hostName,
        address: domain,
        port: pick(httpsPorts),
        tag: `Domain${i + 1}`,
        enhanced,
      }),
    );
  });

  try {
    const cache = caches.default;
    const cacheKey = new Request("https://cf-ip-cache.local");
    let response = await cache.match(cacheKey);
    if (!response) {
      const r = await safeFetch(
        "https://raw.githubusercontent.com/NiREvil/vless/refs/heads/main/Cloudflare-IPs.json",
        {},
        4000,
      );
      if (r.ok) {
        response = new Response(await r.text(), {
          headers: { "Cache-Control": "public, max-age=86400" },
        });
        ctx.waitUntil(cache.put(cacheKey, response.clone()));
      }
    }
    if (response) {
      const json = await response.json();
      const ips = [...(json.ipv4 || []), ...(json.ipv6 || [])]
        .map((x) => x.ip)
        .filter((ip) => !isInIgnoredRange(ip))
        .slice(0, 20);
      ips.forEach((ip, i) => {
        const formattedAddress = ip.includes(":") ? `[${ip}]` : ip;
        links.push(
          buildLink({
            core,
            proto: "tls",
            userID,
            hostName,
            address: formattedAddress,
            port: pick(httpsPorts),
            tag: `IP${i + 1}`,
            enhanced,
          }),
        );
        if (includeTcp) {
          links.push(
            buildLink({
              core,
              proto: "tcp",
              userID,
              hostName,
              address: formattedAddress,
              port: pick(httpPorts),
              tag: `IP${i + 1}`,
              enhanced,
            }),
          );
        }
      });
    }
  } catch (e) {
    console.error("Cached IP fetch failed", e);
  }

  links.push(
    buildLink({
      core,
      proto: "tls",
      userID,
      hostName,
      address: hostName,
      port: 443,
      tag: "NAT64",
      enhanced,
      overrides: { nat64: true },
    }),
  );

  if (cfg) {
    try {
      const pool = await buildProxyIpPool(cfg, ctx, hostName);
      const sorted = [...pool].sort((a, b) => (a.score ?? 999) - (b.score ?? 999));

      const selected = [];
      const seenCountries = new Set();
      for (const entry of sorted) {
        const countryKey = entry.country || "Unknown";
        if (!seenCountries.has(countryKey)) {
          seenCountries.add(countryKey);
          selected.push(entry);
        }
      }

      const MIN_TOTAL = 10;
      if (selected.length < MIN_TOTAL) {
        const selectedIds = new Set(selected.map((e) => `${e.host}:${e.ip}`));
        for (const entry of sorted) {
          if (selected.length >= MIN_TOTAL) break;
          const id = `${entry.host}:${entry.ip}`;
          if (!selectedIds.has(id)) {
            selected.push(entry);
            selectedIds.add(id);
          }
        }
      }
      selected.sort((a, b) => (a.score ?? 999) - (b.score ?? 999));

      selected.forEach((entry, i) => {
        const tag = proxyEntryTag(entry, i);
        const overrides = { proxyIP: `${entry.ip}:${entry.port}` };
        const { proto, port } = pickRandomProxyPort(isPagesDeployment);
        links.push(
          buildLink({
            core,
            proto,
            userID,
            hostName,
            address: hostName,
            port,
            tag,
            enhanced,
            overrides,
          }),
        );
      });
    } catch (e) {
      console.error("ProxyIP pool for subscription failed", e);
    }
  }

  const headers = {
    "Content-Type": "text/plain;charset=utf-8",
    ...buildSubscriptionHeaders(subName),
  };
  return new Response(btoa(links.join("\n")), { headers });
}

export async function handleMyConnection(request, env, ctx) {
  const clientIP = request.headers.get("CF-Connecting-IP") || "127.0.0.1";
  const cf = request.cf || {};
  let threatScore = null;
  let risk = "Unknown";
  let country = cf.country || "";
  let city = cf.city || "";
  let isp = cf.asOrganization || "";

  try {
    const harmonicaRes = await safeFetch(
      `https://api-serpents.pages.dev/${clientIP}`,
      { headers: API_HEADERS },
      4000,
    );
    if (harmonicaRes.ok) {
      const data = await harmonicaRes.json();
      if (data) {
        const targetObj = data.info || data;
        threatScore = targetObj.score ?? targetObj.fraud_score ?? targetObj.threatScore ?? null;
        if (targetObj.risk) risk = targetObj.risk.charAt(0).toUpperCase() + targetObj.risk.slice(1);

        const details = data.details || {};
        if (!country) country = details.country || "";
        if (!city) city = details.city || "";
        if (!isp) isp = details.isp || details.organization || "";
      }
    }
  } catch (e) {
    console.error("Serpents api my-connection fetch failed:", e.toString());
  }

  if (!country || country === "N/A" || !isp || isp === "N/A") {
    try {
      const fallbackMeta = await fetchFreeIpMeta(clientIP);
      if (fallbackMeta) {
        if (!country || country === "N/A") country = fallbackMeta.country || country;
        if (!city) city = fallbackMeta.city || city;
        if (!isp || isp === "N/A") isp = fallbackMeta.org || isp;
      }
    } catch (e) {
      console.error("my-connection fallback failed:", e.toString());
    }
  }

  return new Response(
    JSON.stringify({
      ip: clientIP,
      country: country || "N/A",
      city: city || "",
      isp: isp || "N/A",
      threatScore,
      risk,
    }),
    { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } },
  );
}

export async function handleResolveDomain(request) {
  const url = new URL(request.url);
  const domain = url.searchParams.get("domain");
  if (!domain)
    return new Response(JSON.stringify({ error: "Missing domain" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });

  const headers = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(domain)) {
    return new Response(JSON.stringify({ ip: domain }), { headers });
  }

  try {
    const dnsRes = await safeFetch(
      `https://1.1.1.1/dns-query?name=${encodeURIComponent(domain)}&type=A`,
      { headers: { accept: "application/dns-json" } },
      4000,
    );
    const dnsData = await dnsRes.json();
    const ipAnswer = dnsData.Answer?.find((a) => a.type === 1);
    return new Response(JSON.stringify({ ip: ipAnswer ? ipAnswer.data : null }), { headers });
  } catch (error) {
    return new Response(JSON.stringify({ ip: null, error: error.toString() }), { headers });
  }
}

export async function handleProxyHostInfo(request, env, ctx) {
  const url = new URL(request.url);
  const host = url.searchParams.get("host");
  const headers = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
  if (!host)
    return new Response(JSON.stringify({ error: true, reason: "Missing host" }), {
      status: 400,
      headers,
    });

  try {
    let ip = host;
    if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) {
      const resolved = await resolveIPv4ViaDoH(host);
      if (!resolved)
        return new Response(JSON.stringify({ error: true, reason: "Could not resolve host" }), {
          headers,
        });
      ip = resolved;
    }
    const meta = await getIpMeta(ctx, ip);
    return new Response(
      JSON.stringify({
        ip,
        city: meta.city || "",
        country_name: meta.country,
        country_code: meta.countryCode,
        org: meta.org || "",
      }),
      { headers },
    );
  } catch (error) {
    return new Response(JSON.stringify({ error: true, reason: error.toString() }), { headers });
  }
}

async function fetchFreeIpMeta(ip) {
  try {
    const res = await safeFetch(`https://ipwho.is/${ip}`, { headers: API_HEADERS }, 4000);
    if (res.ok) {
      const data = await res.json();
      if (data && data.success !== false) {
        return {
          country: data.country || "Unknown",
          countryCode: (data.country_code || "").toLowerCase(),
          city: data.city || "",
          org: data.connection?.isp || data.connection?.org || "",
        };
      }
    }
  } catch (e) {
    console.error("ipwho.is fallback fetch failed:", e.toString());
  }

  try {
    const res = await safeFetch(`https://ipapi.co/${ip}/json/`, { headers: API_HEADERS }, 4000);
    if (res.ok) {
      const data = await res.json();
      if (data && !data.error) {
        return {
          country: data.country_name || "Unknown",
          countryCode: (data.country_code || "").toLowerCase(),
          city: data.city || "",
          org: data.org || data.asn || "",
        };
      }
    }
  } catch (e) {
    console.error("ipapi.co fallback fetch failed:", e.toString());
  }

  return null;
}

async function FetchIPData(ip) {
  let country = "Unknown";
  let countryCode = "";
  let city = "";
  let org = "";
  let score = 0;
  let risk = "Unknown";
  let harmonicaSuccess = false;

  try {
    const res = await safeFetch(
      `https://cf-connected.pages.dev/${ip}`,
      { headers: API_HEADERS },
      4000,
    );
    if (res.ok) {
      const data = await res.json();
      if (data) {
        harmonicaSuccess = true;
        const info = data.info || {};
        const details = data.details || {};
        score = info.score ?? info.fraud_score ?? info.threatScore ?? 0;
        risk = info.risk ? info.risk.charAt(0).toUpperCase() + info.risk.slice(1) : "Unknown";
        country = details.country || "Unknown";
        countryCode = (details.country_code || "").toLowerCase();
        city = details.city || "";
        org = details.isp || details.organization || "";
      }
    }
  } catch (e) {
    console.error("CF-Connected api — FetchIPData failed:", e.toString());
  }

  const hasLocationInfo = country && country !== "Unknown";
  if (!harmonicaSuccess || !hasLocationInfo) {
    try {
      const fallbackMeta = await fetchFreeIpMeta(ip);
      if (fallbackMeta) {
        if (!hasLocationInfo) {
          country = fallbackMeta.country || country;
          countryCode = fallbackMeta.countryCode || countryCode;
          city = fallbackMeta.city || city;
          org = fallbackMeta.org || org;
        }
      }
    } catch (e) {
      console.error("FetchIPData fallback failed:", e.toString());
    }
  }

  return {
    country,
    countryCode,
    city,
    org,
    score,
    risk,
  };
}

async function getIpMeta(ctx, ip) {
  const cacheKey = `ipmeta:${ip}`;
  const cached = await cacheGetJson(cacheKey);
  if (cached) return cached;
  const meta = (await FetchIPData(ip)) || {
    country: "Unknown",
    countryCode: "",
    city: "",
    org: "",
    score: 0,
    risk: "Unknown",
  };
  if (meta.country && meta.country !== "Unknown") await cachePutJson(ctx, cacheKey, meta);
  return meta;
}

async function enrichWithPersistentCache(ctx, entries) {
  return Promise.all(
    entries.map(async (entry) => {
      const cacheKey = `ipmeta:${entry.ip}`;
      const cached = await cacheGetJson(cacheKey);
      if (cached) return { ...entry, ...cached };
      if (!entry.country || entry.country === "Unknown") {
        const meta = await getIpMeta(ctx, entry.ip);
        return { ...entry, ...meta };
      }
      await cachePutJson(ctx, cacheKey, entry);
      return entry;
    }),
  );
}

async function resolveProxyPoolHost(host, port, ctx) {
  const isIPHost = /^\d{1,3}(\.\d{1,3}){3}$/.test(host);

  if (isIPHost) {
    if (isInIgnoredRange(host)) return [];
    const meta = await getIpMeta(ctx, host);
    return [{ host, port, ip: host, hostType: "ip", ...meta }];
  }

  let pool = await fetchDomainIpPool(host);
  if (!pool.length) {
    const single = await resolveIPv4ViaDoH(host);
    if (single) {
      const meta = await getIpMeta(ctx, single);
      pool = [{ ip: single, ...meta }];
    }
  }

  pool = pool.filter((p) => p.ip && !isInIgnoredRange(p.ip)).slice(0, 15);
  pool = await enrichWithPersistentCache(ctx, pool);

  return pool.map((p) => ({
    host,
    port,
    ip: p.ip,
    hostType: "domain",
    country: p.country,
    countryCode: p.countryCode,
    score: p.score,
    risk: p.risk,
  }));
}

async function buildProxyIpPool(cfg, ctx, hostName, forceRefresh = false) {
  const cache = caches.default;
  const poolCacheKey = new Request(`https://cf-proxyip-pool-cache.local/${hostName}`);
  if (ctx && !forceRefresh) {
    const cachedRes = await cache.match(poolCacheKey);
    if (cachedRes) return cachedRes.json();
  }

  const seenHosts = new Set();
  const hosts = (cfg.proxyPool || [])
    .map((raw) => {
      const [host, port = "443"] = raw.split(":");
      return { host, port };
    })
    .filter(({ host }) => {
      if (!host || seenHosts.has(host)) return false;
      seenHosts.add(host);
      return true;
    });

  const results = (
    await Promise.all(hosts.map(({ host, port }) => resolveProxyPoolHost(host, port, ctx)))
  ).flat();

  if (ctx && results.length) {
    const cacheResponse = new Response(JSON.stringify(results), {
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=21600" },
    });
    ctx.waitUntil(cache.put(poolCacheKey, cacheResponse));
  }

  return results;
}

function proxyEntryTag(entry, index) {
  const countryTag = entry.countryCode
    ? entry.countryCode.toUpperCase()
    : (entry.country || "XX").slice(0, 2).toUpperCase();
  const flag = countryCodeToFlagEmoji(entry.countryCode);
  const hostTag = entry.hostType === "ip" ? "IP" : "Domain";
  return `${flag}${countryTag}-${hostTag}-${index + 1}`;
}

function buildProxyEntryConfigs(entry, hostName, userID, index) {
  const tag = proxyEntryTag(entry, index);
  const proxyIP = `${entry.ip}:${entry.port}`;
  const isPagesDeployment = hostName.endsWith(".pages.dev");
  const xrayPort = pickRandomProxyPort(isPagesDeployment);
  const sbPort = pickRandomProxyPort(isPagesDeployment);
  const xray = buildLink({
    core: "xray",
    proto: xrayPort.proto,
    userID,
    hostName,
    address: hostName,
    port: xrayPort.port,
    enhanced: true,
    tag,
    overrides: { proxyIP },
  });
  const xrayNormal = buildLink({
    core: "xray",
    proto: xrayPort.proto,
    userID,
    hostName,
    address: hostName,
    port: xrayPort.port,
    tag,
    overrides: { proxyIP },
  });
  const sb = buildLink({
    core: "sb",
    proto: sbPort.proto,
    userID,
    hostName,
    address: hostName,
    port: sbPort.port,
    tag,
    overrides: { proxyIP },
  });
  return {
    host: entry.host,
    ip: entry.ip,
    hostType: entry.hostType,
    risk: entry.risk,
    score: entry.score,
    xrayNormalLink: xrayNormal,
    configs: [
      { label: "Xray", link: xray },
      { label: "Singbox", link: sb },
    ],
  };
}

export async function handleProxyIpsInfo(request, cfg, hostName, ctx, env) {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "public, max-age=21600",
  };

  try {
    const url = new URL(request.url);
    const forceRefresh = url.searchParams.get("refresh") === "1";

    const cache = caches.default;
    const cacheKey = new Request(`https://cf-proxyips-cache.local/${hostName}`);
    if (!forceRefresh) {
      const cached = await cache.match(cacheKey);
      if (cached) return cached;
    }

    const enriched = await buildProxyIpPool(cfg, ctx, hostName, forceRefresh);

    const countryMap = new Map();
    enriched.forEach((entry) => {
      const countryKey = entry.country || "Unknown";
      if (!countryMap.has(countryKey)) {
        countryMap.set(countryKey, {
          country: countryKey,
          countryCode: entry.countryCode || "",
          hostsMap: new Map(),
        });
      }
      const countryGroup = countryMap.get(countryKey);
      if (!countryGroup.countryCode && entry.countryCode)
        countryGroup.countryCode = entry.countryCode;
      const hostKey = entry.host;
      if (!countryGroup.hostsMap.has(hostKey)) {
        countryGroup.hostsMap.set(hostKey, {
          host: hostKey,
          hostType: entry.hostType,
          entries: [],
        });
      }
      countryGroup.hostsMap.get(hostKey).entries.push(entry);
    });

    const groups = [...countryMap.values()]
      .map((countryGroup) => {
        const hosts = [...countryGroup.hostsMap.values()]
          .map((hostGroup) => {
            const sortedEntries = [...hostGroup.entries].sort(
              (a, b) => (a.score ?? 999) - (b.score ?? 999),
            );
            return {
              host: hostGroup.host,
              hostType: hostGroup.hostType,
              entries: sortedEntries.map((entry, i) =>
                buildProxyEntryConfigs(entry, hostName, cfg.userID, i),
              ),
            };
          })
          .sort((a, b) => (a.entries[0]?.score ?? 999) - (b.entries[0]?.score ?? 999));

        const lowestEntry = hosts[0]?.entries[0];
        return {
          country: countryGroup.country,
          countryCode: countryGroup.countryCode,
          flag: countryCodeToFlagEmoji(countryGroup.countryCode),
          lowestScore: lowestEntry?.score ?? null,
          lowestRisk: lowestEntry?.risk ?? "Unknown",
          hosts,
        };
      })
      .sort((a, b) => (a.lowestScore ?? 999) - (b.lowestScore ?? 999));

    const response = new Response(JSON.stringify({ groups }), { headers });
    if (groups.length) ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  } catch (e) {
    return new Response(JSON.stringify({ groups: [], error: e.toString() }), { headers });
  }
}

export async function handleConfigPage(userID, hostName, proxyAddress, workerName, nat64 = true) {
  const dream = buildLink({
    core: "xray",
    proto: "tls",
    userID,
    hostName,
    address: hostName,
    port: 443,
    tag: `${hostName}-Xray`,
  });
  const freedom = buildLink({
    core: "sb",
    proto: "tls",
    userID,
    hostName,
    address: hostName,
    port: 443,
    tag: `${hostName}-Singbox`,
  });

  const pattng = buildLink({
    core: "xray",
    proto: "tls",
    userID,
    hostName,
    address: hostName,
    port: 443,
    tag: `${hostName}-PTN`,
    enhanced: true,
  });

  const nat64On = buildLink({
    core: "xray",
    proto: "tls",
    userID,
    hostName,
    address: hostName,
    port: 443,
    tag: "NAT64",
    overrides: { nat64: true },
  });
  const nat64Off = buildLink({
    core: "xray",
    proto: "tls",
    userID,
    hostName,
    address: hostName,
    port: 443,
    tag: "NAT64",
    overrides: { nat64: false },
  });
  const nat64OnEnhanced = buildLink({
    core: "xray",
    proto: "tls",
    userID,
    hostName,
    address: hostName,
    port: 443,
    tag: "NAT64",
    enhanced: true,
    overrides: { nat64: true },
  });
  const nat64OffEnhanced = buildLink({
    core: "xray",
    proto: "tls",
    userID,
    hostName,
    address: hostName,
    port: 443,
    tag: "NAT64",
    enhanced: true,
    overrides: { nat64: false },
  });

  const settingsUrl = buildSettingsUrl(workerName);
  const workerLabel = hostName.split(".")[0] || "0x00";
  const encodedSubName = encodeURIComponent(workerLabel);
  const subXrayUrlH = `https://${hostName}/xray/${userID}?name=${encodedSubName}`;
  const subXrayUrlV = `https://${hostName}/xray/${userID}#${encodedSubName}`;
  const subXrayUrlVEnhanced = `https://${hostName}/xray-enhanced/${userID}#${encodedSubName}`;
  const subClashUrl = `https://${hostName}/clash/${userID}?name=${encodedSubName}`;
  const subSbUrl = `https://${hostName}/sb/${userID}?name=${encodedSubName}`;
  const subProxyIpsUrl = `https://${hostName}/proxy-ips/${userID}`;

  const finalHTML = getPanelHtml()
    .replace(/{{PROXY_ADDRESS}}/g, proxyAddress)
    .replace(/{{CONFIG_DREAM}}/g, dream)
    .replace(/{{CONFIG_FREEDOM}}/g, freedom)
    .replace(/{{CONFIG_PATTNG}}/g, pattng)
    .replace(/{{NAT64_DEFAULT}}/g, nat64 ? "on" : "off")
    .replace(/{{CONFIG_NAT64_ON_NORMAL}}/g, nat64On)
    .replace(/{{CONFIG_NAT64_ON_ENHANCED}}/g, nat64OnEnhanced)
    .replace(/{{CONFIG_NAT64_OFF_NORMAL}}/g, nat64Off)
    .replace(/{{CONFIG_NAT64_OFF_ENHANCED}}/g, nat64OffEnhanced)
    .replace(/{{URL_PROXYIPS}}/g, subProxyIpsUrl)
    .replace(/{{URL_WORKER_SETTINGS}}/g, settingsUrl)
    .replace(/{{URL_V2RAYNG_ENHANCED}}/g, `${SENS.v2rayng()}${subXrayUrlVEnhanced}`)
    .replace(/{{URL_V2RAYNG}}/g, `${SENS.v2rayng()}${subXrayUrlV}`)
    .replace(/{{URL_CLASH}}/g, `${SENS.clash()}${encodeURIComponent(subClashUrl)}`)
    .replace(/{{URL_HIDDIFY}}/g, `${SENS.hiddify()}${encodeURIComponent(subXrayUrlH)}`)
    .replace(
      /{{URL_EXCLAVE}}/g,
      `${SENS.exclave()}${encodeURIComponent(subSbUrl)}&name=${encodedSubName}`,
    );

  return new Response(finalHTML, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
