"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "terma-ui-state-revision-"));
process.env.TERMA_DATA_DIR = path.join(temporaryRoot, "data");

const db = require(path.join(path.resolve(__dirname, ".."), "dist", "db"));
const {handleUiStateRoutes} = require(path.join(path.resolve(__dirname, ".."), "dist", "routes", "ui-state-routes"));

(async () => {
  try {
    const initialRevision = db.databaseRevision();
    db.run("INSERT INTO app_meta(key,value) VALUES(?,?)", ["unrelated-check", "1"]);
    assert.equal(
      db.databaseRevision(),
      initialRevision,
      "unrelated database writes must not invalidate connection and remote-profile views"
    );

    const timestamp = db.now();
    const inserted = db.run(
      "INSERT INTO connections(name,group_name,ssh_host,ssh_user,created_at,updated_at) VALUES(?,?,?,?,?,?)",
      ["Revision check", "Checks", "127.0.0.1", "tester", timestamp, timestamp]
    );
    const afterInsert = db.databaseRevision();
    assert.ok(afterInsert > initialRevision, "connection inserts must advance the UI revision");

    db.run("UPDATE connections SET name=? WHERE id=?", ["Revision check updated", Number(inserted.lastInsertRowid)]);
    const afterUpdate = db.databaseRevision();
    assert.ok(afterUpdate > afterInsert, "same-second connection updates must advance the UI revision");

    db.run("DELETE FROM connections WHERE id=?", [Number(inserted.lastInsertRowid)]);
    const afterDelete = db.databaseRevision();
    assert.ok(afterDelete > afterUpdate, "connection deletes must advance the UI revision");

    let responsePayload = null;
    const handled = await handleUiStateRoutes(
      {method:"GET"},
      {},
      "/api/ui-state/revision",
      {
        databaseRevision:() => afterDelete,
        securitySettingsRevision:() => "security:7",
        securityDiagnostics:() => ({sessions:2, desktop_browser_grants:1}),
        sendJson:(_response, payload) => { responsePayload = payload; }
      }
    );
    assert.equal(handled, true);
    assert.equal(responsePayload.revision, `${afterDelete}:security:7:2:1`);

    const ignored = await handleUiStateRoutes(
      {method:"POST"},
      {},
      "/api/ui-state/revision",
      {
        databaseRevision:() => 0,
        securitySettingsRevision:() => "0:0",
        securityDiagnostics:() => ({}),
        sendJson:() => { throw new Error("unexpected response"); }
      }
    );
    assert.equal(ignored, false, "the revision endpoint must remain read-only");

    console.log("UI state revision check passed.");
  } finally {
    db.closeDatabase();
    fs.rmSync(temporaryRoot, {recursive:true, force:true});
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
