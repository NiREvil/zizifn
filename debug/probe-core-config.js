import { Config } from "../src/core.js";

export default {
  fetch() {
    const config = Config.fromEnv({});
    return new Response(JSON.stringify(config), {
      headers: { "Content-Type": "application/json" },
    });
  },
};
