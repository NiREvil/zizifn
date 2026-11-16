import * as target from "../src/network.js";

export default {
  fetch() {
    return new Response(`NETWORK_IMPORT_OK: ${Object.keys(target).length}`, {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  },
};
