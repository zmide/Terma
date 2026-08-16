const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { handleSftpJobRoutes, parseHttpByteRange } = require("../dist/routes/sftp-job-routes");

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "terma-sftp-job-range-check-"));
const fixturePath = path.join(temporaryRoot, "fixture.bin");
fs.writeFileSync(fixturePath, Buffer.from("0123456789", "utf8"));

async function main() {
  assert.deepEqual(parseHttpByteRange(undefined, 10), null);
  assert.deepEqual(parseHttpByteRange("bytes=2-5", 10), {start:2, end:5});
  assert.deepEqual(parseHttpByteRange("bytes=7-", 10), {start:7, end:9});
  assert.deepEqual(parseHttpByteRange("bytes=-3", 10), {start:7, end:9});
  assert.equal(parseHttpByteRange("bytes=10-11", 10), false);
  assert.equal(parseHttpByteRange("bytes=1-2,4-5", 10), false);

  let delivered = 0;
  const sftpJobs = {
    getSftpJobFile:id => {
      assert.equal(id, "fixture");
      return {path:fixturePath, name:"fixture.bin"};
    },
    markSftpJobDelivered:() => { delivered += 1; return {ok:true}; },
    listSftpJobs:() => [],
    clearFinishedSftpJobs:() => ({ok:true}),
    cancelSftpJob:() => ({ok:true}),
    deleteSftpJob:() => ({ok:true}),
    pauseSftpJob:() => ({ok:true}),
    receiveUploadJobContent:async () => ({ok:true}),
    resumeSftpJob:() => ({ok:true})
  };
  const server = http.createServer((request, response) => {
    handleSftpJobRoutes(request, response, new URL(request.url, "http://terma.invalid").pathname, {
      sftpJobs,
      sendJson:(target, data, status=200) => {
        target.writeHead(status, {"Content-Type":"application/json"});
        target.end(JSON.stringify(data));
      }
    }).then(handled => {
      if (!handled && !response.writableEnded) {
        response.writeHead(404);
        response.end();
      }
    }).catch(error => {
      if (!response.writableEnded) {
        response.writeHead(500);
        response.end(error.message);
      }
    });
  });
  await new Promise((resolve, reject) => server.listen(0, "127.0.0.1", error => error ? reject(error) : resolve()));
  try {
    const base = `http://127.0.0.1:${server.address().port}/api/sftp/jobs/fixture/fetch`;
    const partial = await fetch(base, {headers:{Range:"bytes=2-5"}});
    assert.equal(partial.status, 206);
    assert.equal(partial.headers.get("content-range"), "bytes 2-5/10");
    assert.equal(partial.headers.get("accept-ranges"), "bytes");
    assert.equal(await partial.text(), "2345");
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(delivered, 0, "partial responses must not mark the browser artifact as fully delivered");

    const suffix = await fetch(base, {headers:{Range:"bytes=-3"}});
    assert.equal(suffix.status, 206);
    assert.equal(await suffix.text(), "789");

    const invalid = await fetch(base, {headers:{Range:"bytes=20-30"}});
    assert.equal(invalid.status, 416);
    assert.equal(invalid.headers.get("content-range"), "bytes */10");

    const complete = await fetch(base);
    assert.equal(complete.status, 200);
    assert.equal(await complete.text(), "0123456789");
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(delivered, 1, "a complete response must mark the browser artifact as delivered once");
    console.log("SFTP job HTTP range check passed.");
  } finally {
    await new Promise(resolve => server.close(() => resolve()));
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  try { fs.rmSync(temporaryRoot, {recursive:true, force:true}); } catch {}
});
