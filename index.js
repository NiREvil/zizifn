import { handleClashConfig } from "./src/clash.js";
import { ProtocolOverWSHandler } from "./src/network.js";
import { Config, buildSettingsUrl } from "./src/core.js";
import {
  handleConfigPage,
  handleIpSubscription,
  handleMyConnection,
  handleResolveDomain,
  handleProxyIpsInfo,
  handleProxyHostInfo,
} from "./src/routes.js";

function notFoundPage(hostName, workerName) {
  const settingsUrl = buildSettingsUrl(workerName);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Service Gateway</title>
<style>
  body {
    background: #0d1117;
    color: #c9d1d9;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100vh;
    margin: 0;
    text-align: center;
    padding: 24px;
  }
  .box { max-width: 480px; }
  h1 { color: #966600; font-size: 22px; margin-bottom: 12px; }
  p { line-height: 1.6; color: #8b949e; }
  code {
    background: #161b22;
    border: 1px solid #30363d;
    color: #966600;
    padding: 2px 6px;
    border-radius: 4px;
  }
  a.btn {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 10px 16px;
    background: #161b22;
    border: 1px solid #966600;
    border-radius: 8px;
    color: #966600;
    text-decoration: none;
    font-weight: 600;
    font-size: 14px;
    margin-top: 20px;
  }
</style>
</head>
<body>
  <div class="box">
    <h1>Access Key Required</h1>
    <p>This endpoint requires a valid authorization token in the request path.</p>
    <p>Try visiting <code>https://${hostName}/&lt;access-key&gt;</code></p>
    <a class="btn" href="${settingsUrl}" target="_blank" rel="noopener noreferrer">🔑 View Configuration on Cloudflare</a>
  </div>
</body>
</html>`;
}

export default {
  async fetch(request, env, ctx) {
    try {
      const cfg = Config.fromEnv(env);
      const url = new URL(request.url);
      const upgradeHeader = request.headers.get("Upgrade");

      if (upgradeHeader && upgradeHeader.toLowerCase() === "websocket") {
        return await ProtocolOverWSHandler(request, {
          userID: cfg.userID,
          proxyPool: cfg.proxyPool,
          nat64: cfg.nat64,
        });
      }

      if (url.pathname === "/resolve-domain") return await handleResolveDomain(request);
      if (url.pathname === "/proxy-host-info") return await handleProxyHostInfo(request, env, ctx);
      if (url.pathname === "/my-connection") return await handleMyConnection(request, env, ctx);
      if (url.pathname.startsWith(`/proxy-ips/${cfg.userID}`))
        return await handleProxyIpsInfo(request, cfg, url.hostname, ctx, env);
      if (url.pathname.startsWith(`/xray-enhanced/${cfg.userID}`))
        return await handleIpSubscription(request, "xray", cfg.userID, url.hostname, ctx, true, cfg, env);
      if (url.pathname.startsWith(`/xray/${cfg.userID}`))
        return await handleIpSubscription(request, "xray", cfg.userID, url.hostname, ctx, false, cfg, env);
      if (url.pathname.startsWith(`/sb/${cfg.userID}`))
        return await handleIpSubscription(request, "sb", cfg.userID, url.hostname, ctx, false, cfg, env);
      if (url.pathname.startsWith(`/clash/${cfg.userID}`))
        return await handleClashConfig(request, cfg.userID, url.hostname, ctx);
      if (url.pathname.startsWith(`/${cfg.userID}`))
        return await handleConfigPage(
          cfg.userID,
          url.hostname,
          cfg.proxyAddress,
          cfg.workerName,
          cfg.nat64,
        );

      return new Response(notFoundPage(url.hostname, cfg.workerName), {
        status: 404,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    } catch (err) {
      console.error(err.stack || err);
      return new Response(`Worker Logic Error: ${err.message}\n${err.stack}`, {
        status: 500,
        headers: { "Content-Type": "text/plain" },
      });
    }
  },
};
