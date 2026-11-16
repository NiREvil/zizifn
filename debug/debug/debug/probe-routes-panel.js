import { handleConfigPage } from "../src/routes.js";

export default {
  async fetch(request) {
    return handleConfigPage(
      "be0ff9df-1468-41a0-8865-796d1c6800db",
      new URL(request.url).hostname,
      "example.com:443",
      "syncc-debug",
      true,
    );
  },
};
