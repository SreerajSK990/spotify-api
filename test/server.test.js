const assert = require("node:assert/strict");
const { after, before, describe, it } = require("node:test");

const { createServer, parseLimit } = require("../server");

let server;
let baseUrl;

before(async () => {
  server = createServer();
  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

describe("parseLimit", () => {
  it("uses the documented default when no limit is supplied", () => {
    assert.equal(parseLimit(null), 10);
  });

  it("accepts integer limits from 1 through 50", () => {
    assert.equal(parseLimit("1"), 1);
    assert.equal(parseLimit("50"), 50);
  });

  it("rejects non-integer, zero, and oversized limits", () => {
    for (const value of ["abc", "1.5", "0", "51"]) {
      assert.throws(
        () => parseLimit(value),
        (error) =>
          error.statusCode === 400 &&
          error.message === "limit must be an integer between 1 and 50"
      );
    }
  });
});

describe("HTTP behavior", () => {
  it("returns an empty 204 response for CORS preflight requests", async () => {
    const response = await fetch(baseUrl, { method: "OPTIONS" });

    assert.equal(response.status, 204);
    assert.equal(await response.text(), "");
    assert.equal(response.headers.get("access-control-allow-origin"), "*");
  });

  it("rejects an invalid recommendation limit before calling Spotify", async () => {
    const response = await fetch(
      `${baseUrl}/api/similar-tracks?url=spotify:track:0yQKGjwHEcxZ2RQzLcFhyD&limit=51`
    );

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: "limit must be an integer between 1 and 50",
    });
  });
});