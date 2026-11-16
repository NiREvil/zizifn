import { resolveIPv4ViaDoH, safeFetch } from "../src/core.js";

export default {
  async fetch() {
    const ip = await resolveIPv4ViaDoH("1.2.3.4");
    return new Response(JSON.stringify({ ip }), {
      headers: { "Content-Type": "application/json" },
    });
  },
};
