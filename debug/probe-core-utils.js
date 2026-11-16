import {
  buildSettingsUrl,
  generateRandomPath,
  countryCodeToFlagEmoji,
  isInIgnoredRange,
  buildMainDomains,
} from "../src/core.js";

export default {
  fetch() {
    return new Response(
      JSON.stringify({
        settings: buildSettingsUrl("test"),
        path: generateRandomPath(10),
        flag: countryCodeToFlagEmoji("US"),
        ignored: isInIgnoredRange("198.41.208.1"),
        domains: buildMainDomains("example.com").length,
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  },
};
