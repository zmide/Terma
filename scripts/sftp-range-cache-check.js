const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Readable } = require("node:stream");

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "terma-sftp-range-cache-check-"));

async function collect(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function main() {
  const sourcePath = require.resolve("../dist/sftp-range-cache");
  delete require.cache[sourcePath];
  let rangeCache = require(sourcePath);
  const merged = [[20, 29], [0, 9]];
  rangeCache.__addRange(merged, 8, 21);
  assert.deepEqual(merged, [[0, 29]], "overlapping and adjacent ranges must merge deterministically");
  assert.deepEqual(rangeCache.__segmentsForRange([[0, 9], [20, 29]], 5, 24), [
    {start:5, end:9, cached:true},
    {start:10, end:19, cached:false},
    {start:20, end:24, cached:true}
  ]);

  const payload = Buffer.alloc(2 * 1024 * 1024 + 333);
  for (let index = 0; index < payload.length; index += 1) payload[index] = (index * 17 + 11) & 0xff;
  const sourceStarts = [];
  let firstAttempt = true;
  let metadataWrites = 0;
  const originalWriteFileSync = fs.writeFileSync;
  fs.writeFileSync = function(file, ...args) {
    if (String(file).includes(".json.") && String(file).endsWith(".tmp")) metadataWrites += 1;
    return originalWriteFileSync.call(this, file, ...args);
  };
  try {
    const stream = rangeCache.openCachedRange({
      root:temporaryRoot,
      keyParts:["connection-1", "/fixture.bin", payload.length, 1234],
      size:payload.length,
      retries:2,
      openSource:async (start, end) => {
        sourceStarts.push(start);
        return Readable.from((async function* () {
          const limit = firstAttempt ? Math.min(end + 1, start + 256 * 1024) : end + 1;
          for (let cursor = start; cursor < limit; cursor += 128 * 1024) {
            yield payload.subarray(cursor, Math.min(limit, cursor + 128 * 1024));
          }
          if (firstAttempt) {
            firstAttempt = false;
            throw new Error("simulated interrupted range read");
          }
        })());
      }
    });
    assert.deepEqual(await collect(stream), payload, "an interrupted native drag range must retry from the last persisted byte");
  } finally {
    fs.writeFileSync = originalWriteFileSync;
  }
  assert.deepEqual(sourceStarts.slice(0, 2), [0, 256 * 1024]);
  assert.ok(metadataWrites > 0 && metadataWrites < 10, `range metadata writes must be throttled, observed ${metadataWrites}`);

  delete require.cache[sourcePath];
  rangeCache = require(sourcePath);
  let cacheMisses = 0;
  const cachedSlice = await collect(rangeCache.openCachedRange({
    root:temporaryRoot,
    keyParts:["connection-1", "/fixture.bin", payload.length, 1234],
    size:payload.length,
    start:512 * 1024,
    end:768 * 1024 - 1,
    openSource:async () => {
      cacheMisses += 1;
      throw new Error("fully cached ranges must not reopen the remote source");
    }
  }));
  assert.deepEqual(cachedSlice, payload.subarray(512 * 1024, 768 * 1024));
  assert.equal(cacheMisses, 0);
  const metadata = JSON.parse(fs.readFileSync(path.join(temporaryRoot, `${rangeCache.cacheKey(["connection-1", "/fixture.bin", payload.length, 1234])}.json`), "utf8"));
  assert.deepEqual(metadata.ranges, [[0, payload.length - 1]]);
  console.log("SFTP native drag range cache check passed.");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  try { fs.rmSync(temporaryRoot, {recursive:true, force:true}); } catch {}
});
