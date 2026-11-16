import * as target from "../src/core.js";

export default {
  fetch() {
    return new Response(`CORE_IMPORT_OK: ${Object.keys(target).length}`, {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  },
};
