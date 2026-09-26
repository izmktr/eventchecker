import test from "node:test";
import assert from "node:assert/strict";
import { isCloudRequest, storageMode } from "../lib/cloud-config";

test("Vercel never falls back to local SQLite", () => {
  assert.equal(storageMode({}), "sqlite");
  assert.equal(storageMode({ VERCEL: "1" }), "supabase");
  assert.throws(() =>
    storageMode({ VERCEL: "1", EVENTCHECKER_STORAGE: "sqlite" }),
  );
  assert.throws(() => storageMode({ EVENTCHECKER_STORAGE: "typo" }));
});

test("cloud requests must match the configured host and browser origin", () => {
  const origin = "https://eventchecker.example.com";
  assert.equal(
    isCloudRequest(
      new Headers({ host: "eventchecker.example.com", origin }),
      origin,
    ),
    true,
  );
  assert.equal(
    isCloudRequest(
      new Headers({
        host: "eventchecker.example.com",
        origin: "https://evil.example",
      }),
      origin,
    ),
    false,
  );
  assert.equal(
    isCloudRequest(new Headers({ host: "evil.example", origin }), origin),
    false,
  );
  assert.equal(
    isCloudRequest(
      new Headers({
        host: "eventchecker.example.com",
        "sec-fetch-site": "cross-site",
      }),
      origin,
    ),
    false,
  );
  assert.equal(
    isCloudRequest(
      new Headers({ host: "eventchecker.example.com" }),
      "http://eventchecker.example.com",
    ),
    false,
  );
  assert.equal(
    isCloudRequest(
      new Headers({ host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000" }),
      "http://127.0.0.1:3000",
    ),
    true,
  );
});
