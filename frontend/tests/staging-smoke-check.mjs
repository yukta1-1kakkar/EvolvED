import assert from "node:assert/strict";

const baseUrl = (process.env.EVOLVED_STAGING_URL || process.argv[2] || "").replace(/\/$/, "");
assert(baseUrl, "Set EVOLVED_STAGING_URL or pass the staging URL as the first argument.");

const [frontend, backend] = await Promise.all([
  fetch(`${baseUrl}/`),
  fetch(`${baseUrl}/api/docs`),
]);

assert.equal(frontend.status, 200, `Frontend returned ${frontend.status}.`);
assert.equal(backend.status, 200, `Backend proxy returned ${backend.status}.`);
assert.match(await backend.text(), /EvolvED Backend/, "Backend docs did not contain the EvolvED API title.");

console.log(`Staging smoke check passed: ${baseUrl}`);
