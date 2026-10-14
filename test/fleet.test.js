const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { AccountStore, isPermanentFailure } = require('../fleet/AccountStore.js');
const FleetMaintainer = require('../fleet/FleetMaintainer.js');

function tmpStore() {
  const p = path.join(os.tmpdir(), `mm-store-${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e6)}.json`);
  return { path: p, cleanup: () => { try { fs.unlinkSync(p); } catch {} } };
}

function fakeAM(entries) {
  const m = new Map();
  for (const e of entries) m.set(e.username, { status: 'offline', lastAttemptAt: 0, error: null, ...e });
  return {
    entries: m,
    loginCalls: [],
    async login(username) {
      const e = m.get(username);
      this.loginCalls.push(username);
      e.status = e.willBe || 'online';
      return { username, status: e.status, error: e.error };
    }
  };
}

function fakeStore(quarantined = [], good = []) {
  return { isQuarantined: (u) => quarantined.includes(u), isGood: (u) => good.includes(u) };
}

test('isPermanentFailure flags bad-credential auth failures only', () => {
  assert.ok(isPermanentFailure('AJ auth failed (status 401): {"error_code":102}'));
  assert.ok(isPermanentFailure('AJ auth failed (status 403): banned'));
  assert.ok(isPermanentFailure('something error_code:103 here'));
  assert.ok(!isPermanentFailure('AJ authenticator returned non-JSON (status 429): <html>'));
  assert.ok(!isPermanentFailure('Auth Packet Failed'));
  assert.ok(!isPermanentFailure('Connection closed.'));
  assert.ok(!isPermanentFailure('AJ auth failed (status 500): server error'));
  assert.ok(!isPermanentFailure(''));
});

test('AccountStore quarantines, persists, and reloads', () => {
  const { path: p, cleanup } = tmpStore();
  const s = new AccountStore(p);
  assert.strictEqual(s.quarantine('badbot', 'AJ auth failed (status 401)', 111), true);
  assert.strictEqual(s.quarantine('badbot', 'again'), false, 'already quarantined returns false');
  assert.ok(s.isQuarantined('badbot'));

  const reloaded = new AccountStore(p);
  assert.ok(reloaded.isQuarantined('badbot'), 'quarantine survives reload');
  assert.strictEqual(reloaded.stats().quarantined, 1);
  cleanup();
});

test('AccountStore markGood clears quarantine and is mutually exclusive', () => {
  const { path: p, cleanup } = tmpStore();
  const s = new AccountStore(p);
  s.quarantine('flip', 'bad', 1);
  s.markGood('flip', 2);
  assert.ok(s.isGood('flip'));
  assert.ok(!s.isQuarantined('flip'), 'markGood lifts quarantine');

  s.quarantine('flip', 'bad again', 3);
  assert.ok(s.isQuarantined('flip'));
  assert.ok(!s.isGood('flip'), 'quarantine drops good flag');
  cleanup();
});

test('selectCandidates prefers good, skips quarantined and active', () => {
  const am = fakeAM([
    { username: 'online1', status: 'online' },
    { username: 'connecting1', status: 'connecting' },
    { username: 'quar1' },
    { username: 'fresh1' },
    { username: 'good1' }
  ]);
  const fm = new FleetMaintainer({ accountManager: am, store: fakeStore(['quar1'], ['good1']), target: 10 });

  const picks = fm.selectCandidates(10, 1000);
  assert.deepStrictEqual(picks, ['good1', 'fresh1'], 'good first, no quarantined/active');
});

test('selectCandidates honors retry cooldown for failed accounts', () => {
  const am = fakeAM([
    { username: 'recentFail', status: 'failed', lastAttemptAt: 1000 },
    { username: 'oldFail', status: 'failed', lastAttemptAt: 1 }
  ]);
  const fm = new FleetMaintainer({ accountManager: am, store: fakeStore(), target: 10, retryCooldownMs: 500 });

  const picks = fm.selectCandidates(10, 1000);
  assert.deepStrictEqual(picks, ['oldFail'], 'only a failed account past its cooldown is retried');
});

test('fill logs in candidates up to target and stops there', async () => {
  const am = fakeAM([
    { username: 'a' }, { username: 'b' }, { username: 'c' }, { username: 'd' }, { username: 'e' }
  ]);
  const fm = new FleetMaintainer({ accountManager: am, store: fakeStore(), target: 3, staggerMs: 0 });

  const res = await fm.fill();
  assert.strictEqual(res.active, 3);
  assert.strictEqual(res.filled, 3);
  assert.strictEqual(am.loginCalls.length, 3, 'stops once target reached');
});

test('fill backfills only the deficit when some are already online', async () => {
  const am = fakeAM([
    { username: 'up1', status: 'online' },
    { username: 'a' }, { username: 'b' }, { username: 'c' }
  ]);
  const fm = new FleetMaintainer({ accountManager: am, store: fakeStore(), target: 2, staggerMs: 0 });

  const res = await fm.fill();
  assert.strictEqual(res.active, 2);
  assert.strictEqual(am.loginCalls.length, 1, 'only one needed to reach target of 2');
});

test('rotateIdle kicks online accounts idle past the threshold, only when work is queued', () => {
  const now = 1_000_000;
  const am = {
    entries: new Map([
      ['stuck', { username: 'stuck', status: 'online', client: { lastProductiveAt: now - 9 * 60000 } }],
      ['busy', { username: 'busy', status: 'online', client: { lastProductiveAt: now - 1 * 60000 } }],
      ['offline1', { username: 'offline1', status: 'offline', client: null }],
      ['fresh', { username: 'fresh', status: 'online', client: { lastProductiveAt: now } }]
    ])
  };
  let work = true;
  const fm = new FleetMaintainer({ accountManager: am, store: fakeStore(), idleRotateMs: 8 * 60000, hasWork: () => work });
  assert.deepStrictEqual(fm.rotateIdle(now), ['stuck'], 'only the >8m-idle online account is rotated');
  work = false;
  assert.deepStrictEqual(fm.rotateIdle(now), [], 'no rotation when there is no work');
});

test('rotateIdle is disabled without idleRotateMs/hasWork', () => {
  const am = { entries: new Map([['stuck', { username: 'stuck', status: 'online', client: { lastProductiveAt: 0 } }]]) };
  const fm = new FleetMaintainer({ accountManager: am, store: fakeStore() });
  assert.deepStrictEqual(fm.rotateIdle(1_000_000), [], 'no rotation when the feature is not configured');
});
