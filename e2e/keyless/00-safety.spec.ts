import { expect, test } from "@playwright/test";

// Runs first: refuse to continue unless every provider points at the mock, so the
// keyless suite can never spend real credits.
test("app is wired to the mock upstream with dummy keys", async ({ request }) => {
  const health = await (await request.get("/api/health")).json();
  expect(health.mockUpstreams).toBe(true);
  expect(health.auth).toBe("password");
  expect(Object.values(health.providers).every(Boolean)).toBe(true);
});
