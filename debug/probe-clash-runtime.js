import { handleClashConfig } from "../src/clash.js";

export default {
  async fetch(request, env, ctx) {
    return handleClashConfig(
      request,
      "be0ff9df-1468-41a0-8865-796d1c6800db",
      new URL(request.url).hostname,
      ctx,
    );
  },
};
