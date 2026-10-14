const { NetworkController } = require('./Controller.js');
const { wait, getRndInteger, Login, CheckSessions, loadSessions, saveSessions, SpawnLoc } = require("./utils/Extra.js");
const { parseDenState } = require('../scraper/DenStateParser.js');
const { parseDsi } = require('../scraper/DsiParser.js');
const { parseTradeList } = require('../scraper/TradeListParser.js');
const { logAnomaly } = require('../scraper/AnomalyLog.js');
const { parseProxyUrl } = require('./utils/proxy.js');

class Client {
  username;
  password;
  connection;
  roomid;
  pose;
  posing;
  activity;
  activityAt;

  constructor({ username, password }) {
    this.username = username;
    this.password = password;
    this.controller = null;
    this.pose = "14";
    this.posing = "0"
    this.activity = 'starting';
    this.activityAt = Date.now();
    this.lastProductiveAt = Date.now();
  }

  setActivity(state) {
    this.activity = state;
    this.activityAt = Date.now();
  }

  get connection() {
    return this.controller;
  }

  async init() {
    const sessions = await loadSessions();
    let auth_token = sessions[this.username] || "";
    const isValid = await CheckSessions(auth_token);
    if (!isValid) {
      auth_token = await Login(this.username, this.password);

      if (auth_token) {
        sessions[this.username] = auth_token;
        await saveSessions(sessions);
        console.log("Login successful!");
      } else {
        console.log("User has failed to Auth");
        throw new Error("Auth Failed");
      }
    } else {
      console.log("Using stored session token.");
    }

     if (!auth_token || typeof auth_token !== 'string' || auth_token.trim() === '') {
      throw new Error("No valid auth token available. Aborting controller init.!");
    }

    this.controller = new NetworkController({
      username: this.username,
      auth_token,
      domain: "flash",
      proxy: parseProxyUrl()
    });

    await this.controller.connect();
    this.Log('Connected to server!');
    this.setActivity('idle');
    this.KeepAlive();
  }

  Log(message) {
    this.controller.Log(message);
  }

  async Wait() {
    await wait(500);
  }

  KeepAlive() {
    this._kaTimer = setInterval(() => {
      try {
        if (this.controller && this.controller.roomid && this.controller.roomid !== "-1") {
          this.controller.sendXTMessage(["ka", this.controller.roomid]);
        }
      } catch {}
    }, 180000);
  }

  async JoinDen(username,Instantiate = true) {
    await this.controller.sendXTMessage(["dj", this.controller.roomid, `den${username}`, "1", "-1"]);
    await this.Wait();
    if (Instantiate) {
      await this.MoveTo(197, 415);
    }
    this.Log("Joined Room!!!")
  }

  async JoinWorld(world,Instantiate = true) { 
    await this.controller.sendXTMessage(["rj", this.controller.roomid, world, "1","0","0"]);
    await this.Wait();
    if (Instantiate) {
      const worldspawn = SpawnLoc[world.split("#")[0]];
      if (worldspawn) {
        this.Log(worldspawn);
        await this.MoveTo(worldspawn.x, worldspawn.y);
      } else {
        await this.MoveTo(197, 415);
      }
    }
    this.Log("Joined World!!!");
  }

  async MoveTo(x, y) {
    await this.controller.sendXTMessage(["au", this.controller.roomid, "1", x.toString(), y.toString(), this.pose, this.posing]);
  }

  _awaitXT(action, trigger, timeout = 8000) {
    const controller = this.controller;
    return new Promise((resolve, reject) => {
      if (!controller) {
        reject(new Error('no controller'));
        return;
      }
      const onPacket = (data) => {
        const packet = data.toString();
        if (packet.indexOf('%xt%') === -1) return;
        const parts = packet.split('%');
        if (parts[1] === 'xt' && parts[2] === action) {
          cleanup();
          resolve(parts);
        }
      };
      const cleanup = () => {
        clearTimeout(timer);
        controller.removeListener('received', onPacket);
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`timeout waiting for ${action}`));
      }, timeout);
      controller.on('received', onPacket);
      Promise.resolve()
        .then(() => trigger && trigger())
        .catch((err) => { cleanup(); reject(err); });
    });
  }

  async RequestTradeList(owner, options = {}) {
    const controller = this.controller;
    if (!controller) return { status: 'disconnected', owner, items: [] };
    const timeout = options.timeout || 8000;
    try {
      const parts = await this._awaitXT('tl', () => controller.sendXTMessage(['tl', controller.roomid, owner]), timeout);
      const parsed = parseTradeList(parts);
      logAnomaly('tradelist_capture', owner, parts.join('%'));
      return { status: 'ok', ...(parsed || { owner, count: 0, items: [] }) };
    } catch (err) {
      return { status: 'error', owner, items: [], error: err.message };
    }
  }

  async ScrapeDenShops(ownerUsername, { defs, options = {} }) {
    const controller = this.controller;
    if (!controller) return { status: 'disconnected', shopIds: [], items: [] };

    const dsTimeout = options.dsTimeout || 8000;
    const dsiTimeout = options.dsiTimeout || 8000;
    const maxShops = options.maxShopsPerDen || 50;

    const before = controller.lastDenStateAt || 0;
    let dsParts = null;
    try {
      dsParts = await this._awaitXT('ds', () => this.JoinDen(ownerUsername, false), dsTimeout);
    } catch {
      if (this.controller && this.controller.lastDenStateAt > before) {
        dsParts = this.controller.lastDenState;
      }
    }
    if (!this.controller) return { status: 'disconnected', shopIds: [], items: [] };
    if (!dsParts) return { status: 'joinfail', shopIds: [], items: [] };

    try { await this.MoveTo(197, 415); } catch {}
    await wait(getRndInteger(250, 500));
    if (!this.controller) return { status: 'disconnected', shopIds: [], items: [] };

    const denState = parseDenState(dsParts, (defId) => defs.specialTypeOf(defId));
    if (denState.truncated) {
      logAnomaly('ds_truncated', ownerUsername, dsParts.join('%'), {
        numDenItems: denState.numDenItems,
        parsed: denState.denItems.length,
        shopsFound: denState.shopInvIdxs.length
      });
    }
    const shopIds = denState.shopInvIdxs.slice(0, maxShops);

    if (denState.truncated && shopIds.length === 0) {
      for (const den of denState.denItems) {
        if (shopIds.length >= maxShops) break;
        shopIds.push(den.invIdx);
      }
    }

    const items = [];
    await this._scrapeShopsByIds(ownerUsername, shopIds, options, items);

    const result = {
      status: shopIds.length === 0 ? 'empty' : 'ok',
      shopIds,
      items,
      portals: denState.portals || []
    };

    const maxPortalHops = options.maxPortalHops || 0;
    if (maxPortalHops > 0 && result.portals.length) {
      logAnomaly('portals_detected', ownerUsername, '', {
        count: result.portals.length,
        names: result.portals.map((p) => p.name).slice(0, 12)
      });
      try {
        const targetDens = await this._followPortals(ownerUsername, result.portals, options, defs);
        if (targetDens.length) {
          result.dens = [{ owner: ownerUsername, status: result.status, shopIds, items }, ...targetDens];
        }
      } catch (err) {
        this.Log(`portal hop failed: ${err.message}`);
      }
    }

    return result;
  }

  async _scrapeShopsByIds(ownerForDsi, shopIds, options, items) {
    const controller = this.controller;
    if (!controller) return;
    const dsiTimeout = options.dsiTimeout || 8000;
    for (const shopId of shopIds) {
      if (!this.controller) return;
      let dsiParts = null;
      try {
        dsiParts = await this._awaitXT(
          'dsi',
          () => controller.sendXTMessage(['dsi', controller.roomid, ownerForDsi, shopId]),
          dsiTimeout
        );
      } catch {
        continue;
      }
      const parsed = parseDsi(dsiParts);
      if (parsed.ok && !parsed.empty) {
        for (const it of parsed.items) {
          items.push({ ...it, shopId, shopState: parsed.shopState });
        }
      } else if (!parsed.ok) {
        logAnomaly('dsi_parse', ownerForDsi, dsiParts.join('%'), {
          shopId,
          reason: parsed.reason || parsed.badType || 'truncated'
        });
      }
      await wait(getRndInteger(options.dsiDelayMin || 150, options.dsiDelayMax || 400));
    }
  }

  _portalOwner(portal) {
    const name = portal && portal.name;
    if (!name || typeof name !== 'string') return null;
    if (/^\d+$/.test(name)) return null;
    if (!/^[A-Za-z0-9._-]{3,30}$/.test(name)) return null;
    return name;
  }

  async _followPortals(originOwner, portals, options, defs) {
    const controller = this.controller;
    const dens = [];
    const visited = new Set([String(originOwner).toLowerCase()]);
    const maxHops = options.maxPortalHops || 0;
    const dsTimeout = options.dsTimeout || 8000;
    const maxShops = options.maxShopsPerDen || 50;
    let hops = 0;

    for (const portal of portals) {
      if (hops >= maxHops || !this.controller) break;
      const targetOwner = this._portalOwner(portal);
      if (!targetOwner || visited.has(targetOwner.toLowerCase())) {
        logAnomaly('portal_skip', originOwner, '', {
          reason: targetOwner ? 'revisited' : 'no_owner',
          name: portal.name,
          x: portal.x,
          y: portal.y
        });
        continue;
      }
      visited.add(targetOwner.toLowerCase());

      const beforeAt = controller.lastDenStateAt || 0;
      let dsParts = null;
      try {
        dsParts = await this._awaitXT('ds', () => this.JoinDen(targetOwner, false), dsTimeout);
      } catch {
        if (this.controller && this.controller.lastDenStateAt > beforeAt) dsParts = this.controller.lastDenState;
      }
      if (!dsParts || !this.controller) {
        logAnomaly('portal_skip', originOwner, '', { reason: 'no_ds', name: portal.name, target: targetOwner });
        continue;
      }
      hops++;
      try { await this.MoveTo(197, 415); } catch {}
      await wait(getRndInteger(250, 500));

      const targetDen = parseDenState(dsParts, (id) => defs.specialTypeOf(id));
      const shopIds = targetDen.shopInvIdxs.slice(0, maxShops);
      logAnomaly('portal_hop', originOwner, dsParts.join('%'), {
        target: targetOwner,
        shops: shopIds.length,
        portalName: portal.name
      });

      const items = [];
      await this._scrapeShopsByIds(targetOwner, shopIds, options, items);
      dens.push({ owner: targetOwner, status: shopIds.length === 0 ? 'empty' : 'ok', shopIds, items });
    }

    if (this.controller && hops > 0) {
      try {
        await this._awaitXT('ds', () => this.JoinDen(originOwner, false), dsTimeout);
        await this.MoveTo(197, 415);
      } catch {}
    }
    return dens;
  }

  dispose() {
    if (this._kaTimer) {
      clearInterval(this._kaTimer);
      this._kaTimer = null;
    }
    if (this.controller) {
      this.controller.removeAllListeners();
      this.controller = null;
    }
  }
}

module.exports = Client
