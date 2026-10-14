const Client = require('../bot/Client.js');

const RECONNECT_DELAY = 2000;

class AccountManager {
  constructor({ accounts = [], onReady = () => {}, onClose = () => {}, onFailed = () => {}, autoReconnect = true } = {}) {
    this.onReady = onReady;
    this.onClose = onClose;
    this.onFailed = onFailed;
    this.autoReconnect = autoReconnect;
    this.entries = new Map();
    this.online = [];
    for (const { username, password } of accounts) this.add(username, password);
  }

  add(username, password) {
    if (!username || this.entries.has(username)) return;
    this.entries.set(username, { username, password, status: 'offline', intend: 'offline', error: null, client: null });
  }

  list() {
    return [...this.entries.values()].map((e) => ({
      username: e.username,
      status: e.status,
      error: e.error,
      room: e.client && e.client.controller ? e.client.controller.roomid : null,
      activity: e.client ? e.client.activity : null,
      activityAt: e.client ? e.client.activityAt : 0
    }));
  }

  snapshot(e) {
    return { username: e.username, status: e.status, error: e.error };
  }

  async login(username) {
    const e = this.entries.get(username);
    if (!e) return { error: 'unknown account', username };
    if (e.status === 'online' || e.status === 'connecting') return this.snapshot(e);
    e.intend = 'online';
    e.status = 'connecting';
    e.error = null;
    try {
      await this._spawn(e);
    } catch (err) {
      e.status = 'failed';
      e.error = err.message;
      e.client = null;
      this.onFailed(e.username, err.message);
    }
    return this.snapshot(e);
  }

  async logout(username) {
    const e = this.entries.get(username);
    if (!e) return { error: 'unknown account', username };
    e.intend = 'offline';
    const client = e.client;
    if (client && client.controller) {
      try { await client.controller.close(); } catch {}
    }
    this._removeOnline(client);
    e.status = 'offline';
    e.client = null;
    return this.snapshot(e);
  }

  async loginMany(usernames) {
    return Promise.all(usernames.map((u) => this.login(u)));
  }

  async logoutMany(usernames) {
    return Promise.all(usernames.map((u) => this.logout(u)));
  }

  async _spawn(e) {
    const client = new Client({ username: e.username, password: e.password });
    e.client = client;
    await client.init();

    client.controller.on('ready', () => {
      if (e.intend !== 'online') {
        try { client.controller.close(); } catch {}
        return;
      }
      e.status = 'online';
      if (!this.online.includes(client)) this.online.push(client);
      this.onReady(client);
    });

    client.controller.once('close', () => {
      this._removeOnline(client);
      this.onClose(client);
      try { client.dispose(); } catch {}
      e.client = null;
      if (e.intend === 'online' && this.autoReconnect) {
        e.status = 'connecting';
        setTimeout(() => {
          if (e.intend === 'online' && !e.client) {
            this._spawn(e).catch((err) => {
              e.status = 'failed';
              e.error = err.message;
              e.client = null;
              this.onFailed(e.username, err.message);
            });
          }
        }, RECONNECT_DELAY);
      } else {
        e.status = 'offline';
      }
    });
  }

  _removeOnline(client) {
    if (!client) return;
    const i = this.online.indexOf(client);
    if (i !== -1) this.online.splice(i, 1);
  }
}

module.exports = AccountManager;
