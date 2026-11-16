import * as target from "../src/routes.js";

export default {
  fetch() {
    return new Response(`ROUTES_IMPORT_OK: ${Object.keys(target).length}`, {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  },
};
