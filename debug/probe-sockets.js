import { ProtocolOverWSHandler } from "../src/network.js";

const config = {
  userID: "be0ff9df-1468-41a0-8865-796d1c6800db",
  proxyPool: [],
  nat64: false,
};

export default {
  async fetch(request) {
    const upgrade = request.headers.get("Upgrade");

    if (!upgrade || upgrade.toLowerCase() !== "websocket") {
      return Response.json(
        {
          success: true,
          probe: "vless-websocket",
          websocketRequired: true,
        },
        {
          headers: {
            "Cache-Control": "no-store",
          },
        },
      );
    }

    return ProtocolOverWSHandler(request, config);
  },
};
