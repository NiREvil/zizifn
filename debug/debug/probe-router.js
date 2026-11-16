import worker from "../index.js";

const userID = "be0ff9df-1468-41a0-8865-796d1c6800db";

export default {
  async fetch(request) {
    const base = new URL(request.url).origin;
    const env = {};
    const ctx = {
      waitUntil(promise) {
        Promise.resolve(promise).catch(() => {});
      },
    };

    const cases = [
      ["root", "/"],
      ["panel", `/${userID}`],
      ["clash", `/clash/${userID}`],
      ["xray", `/xray/${userID}`],
      ["singbox", `/sb/${userID}`],
      ["my-connection", "/my-connection"],
      ["proxy-host-info", "/proxy-host-info?host=1.1.1.1"],
      ["proxy-ips", `/proxy-ips/${userID}`],
    ];

    const results = [];

    for (const [name, path] of cases) {
      const startedAt = performance.now();

      try {
        const response = await worker.fetch(
          new Request(new URL(path, base)),
          env,
          ctx,
        );

        const body = await response.text();

        results.push({
          name,
          success: true,
          status: response.status,
          contentType: response.headers.get("Content-Type"),
          bodyLength: body.length,
          durationMs: Math.round(performance.now() - startedAt),
        });
      } catch (error) {
        results.push({
          name,
          success: false,
          errorName: error?.name,
          errorMessage: error?.message,
          stack: error?.stack,
          durationMs: Math.round(performance.now() - startedAt),
        });
      }
    }

    return new Response(
      JSON.stringify({
        success: results.every((result) => result.success),
        total: results.length,
        passed: results.filter((result) => result.success).length,
        failed: results.filter((result) => !result.success).length,
        results,
      }),
      {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
        },
      },
    );
  },
};
