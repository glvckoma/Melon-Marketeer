const test = require('node:test');
const assert = require('node:assert');
const Database = require('../db/Database.js');

test('enqueueUsernames batches and counts added and duplicate names', () => {
  const db = new Database(':memory:');
  db.enqueueUsername('Existing', 'user');
  const r = db.enqueueUsernames(['Alice', 'Bob', 'existing', 'Alice', ''], 'user');
  assert.strictEqual(r.added, 2, 'Alice + Bob are new');
  assert.strictEqual(r.duplicate, 2, 'existing (NOCASE) + the repeated Alice');

  const queued = db.getQueuedUsernames().map((n) => n.toLowerCase());
  assert.ok(queued.includes('alice') && queued.includes('bob'), 'new names are queued');
});
