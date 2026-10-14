const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class UsernameCollector {
  constructor(db) {
    this.db = db;
    this.attached = new Map();
  }

  attach(controller) {
    if (this.attached.has(controller)) return;
    const onPacket = (data) => {
      try { this.handle(data); } catch {}
    };
    controller.on('received', onPacket);
    this.attached.set(controller, onPacket);
  }

  handle(data) {
    const packet = data.toString();
    if (packet.indexOf('%xt%') === -1) return;
    const parts = packet.split('%');
    if (parts[1] !== 'xt') return;
    switch (parts[2]) {
      case 'ac': this._playerAdd(parts); break;
      case 'bl': this._buddyList(parts); break;
      case 'ba': this._buddyAdded(parts); break;
      case 'bon': this._buddyOnline(parts); break;
    }
  }

  _record(name, source) {
    if (!name) return;
    if (/^\d+$/.test(name)) return;
    if (UUID_REGEX.test(name)) return;
    this.db.enqueueUsername(name, source);
    this.db.markLive(name);
  }

  _playerAdd(parts) {
    if (parts.length >= 9) this._record(parts[8], 'nearby');
  }

  _buddyList(parts) {
    if (parts.length < 6 || parts[4] !== '0') return;
    let currentIndex = 5;
    while (currentIndex < parts.length) {
      let uuidIndex = -1;
      for (let j = currentIndex; j < parts.length; j++) {
        if (parts[j] && UUID_REGEX.test(parts[j])) { uuidIndex = j; break; }
      }
      if (uuidIndex === -1) break;
      if (uuidIndex > currentIndex) this._record(parts[uuidIndex - 1], 'buddy');
      currentIndex = uuidIndex + 1;
    }
  }

  _buddyAdded(parts) {
    if (parts.length >= 7) this._record(parts[4], 'buddy');
  }

  _buddyOnline(parts) {
    if (parts.length >= 5) this._record(parts[4], 'buddy');
  }
}

module.exports = UsernameCollector;
