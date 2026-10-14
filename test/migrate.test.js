const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('../db/Database.js');

test('_addColumn ignores duplicate-column races but rethrows real errors', () => {
  const db = new Database(':memory:');
  assert.doesNotThrow(() => db._addColumn('ALTER TABLE usernames ADD COLUMN last_seen INTEGER'));
  assert.throws(() => db._addColumn('ALTER TABLE no_such_table ADD COLUMN x INTEGER'));
});

test('opening the same db file twice re-runs _migrate without throwing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marketeer-migrate-'));
  const dbPath = path.join(dir, 'test.db');
  const first = new Database(dbPath);
  try {
    first.enqueueUsername('TestUser', 'manual');
    let second;
    assert.doesNotThrow(() => {
      second = new Database(dbPath);
      second.stats();
    });
    second.close();
  } finally {
    first.close();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});
