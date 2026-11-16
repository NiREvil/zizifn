import * as target from "../src/clash.js";

export default {
  fetch() {
    return new Response(`CLASH_IMPORT_OK: ${Object.keys(target).length}`, {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  },
};
