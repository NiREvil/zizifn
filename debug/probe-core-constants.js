import { SENS, CONST } from "../src/core.js";

export default {
  fetch() {
    return new Response(
      JSON.stringify({
        vless: SENS.vless(),
        clash: SENS.clash(),
        protocol: CONST.VLESS_PROTOCOL,
        readyState: CONST.WS_READY_STATE_OPEN,
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  },
};
