const assert = require("node:assert/strict");
const { performance } = require("node:perf_hooks");
const {
  __mapNativeSftpEntries,
  paginateRemoteEntries
} = require("../dist/sftp");

function makeEntries(count) {
  return Array.from({length:count}, (_, index) => ({
    filename: index % 17 === 0 ? `目录-${String(index).padStart(5, "0")}` : `file-${String(index).padStart(5, "0")}.txt`,
    attrs: {
      mode: index % 17 === 0 ? 0o040755 : 0o100644,
      size: index * 13,
      mtime: 1700000000 + index,
      uid: 1000,
      gid: 1000
    }
  }));
}

function runCase(count) {
  const raw = makeEntries(count);
  const start = performance.now();
  const entries = __mapNativeSftpEntries({sftp_filename_encoding:"utf8"}, "/srv/data", raw);
  const mappedMs = performance.now() - start;
  assert.equal(entries.length, count);
  assert.equal(entries[0].type, "dir");
  assert.equal(entries[1].type, "file");
  assert.equal(entries[1].mode, "644");
  assert.equal(entries[1].owner, "1000");

  const orderCache = new Map();
  const pageStart = performance.now();
  const first = paginateRemoteEntries(entries, {page:1, page_size:50, sort:"name", dir:"asc"}, orderCache);
  const firstPageMs = performance.now() - pageStart;
  const secondStart = performance.now();
  const second = paginateRemoteEntries(entries, {page:2, page_size:50, sort:"name", dir:"asc"}, orderCache);
  const cachedPageMs = performance.now() - secondStart;
  assert.equal(first.entries.length, 50);
  assert.equal(second.entries.length, 50);
  assert.equal(first.total, count);
  assert.equal(second.total, count);
  assert.equal(orderCache.size, 1);

  // These are intentionally generous CI budgets. They catch accidental
  // remote-style per-entry work without making the test host-sensitive.
  assert.ok(mappedMs < 1500, `${count} native entries mapped too slowly: ${mappedMs.toFixed(1)}ms`);
  assert.ok(firstPageMs < 1500, `${count} entry first page sorted too slowly: ${firstPageMs.toFixed(1)}ms`);
  assert.ok(cachedPageMs < 250, `${count} entry cached page too slowly: ${cachedPageMs.toFixed(1)}ms`);
  return {count, mappedMs, firstPageMs, cachedPageMs};
}

const results = [runCase(1000), runCase(10000)];
console.log(`SFTP native performance checks passed: ${results.map(item => `${item.count}=${item.mappedMs.toFixed(1)}ms`).join(", ")}`);
