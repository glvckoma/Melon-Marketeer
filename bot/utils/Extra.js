const { ANIMAL_JAM_AUTHENTICATOR, ANIMAL_JAM_BASE_URL } = require('./Constants.js')
const { v4: uuidv4 } = require('uuid');
const { readFile, writeFile } = require('fs/promises');
const path = require('path');
const { proxiedFetch } = require('./proxy.js');

let cachedFlashvars = null;

function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function getRndInteger(min, max) {
  return Math.floor(Math.random() * (max - min)) + min;
}

async function Login(username,password) {
    return new Promise(async (resolve, reject) => {
        try {
            const response = await proxiedFetch(`${ANIMAL_JAM_AUTHENTICATOR}/authenticate`, {
                method: 'POST',
                includeHost: false,
                headers: {
                    'host': 'authenticator.animaljam.com',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) AJClassic/1.5.7 Chrome/87.0.4280.141 Electron/11.5.0 Safari/537.36',
                },
                body: JSON.stringify({
                    username: username,
                    password: password,
                    domain: 'flash',
                    df: uuidv4()
                })
            });
            const text = await response.text();
            let parsedbody;
            try {
                parsedbody = JSON.parse(text);
            } catch {
                throw new Error(`AJ authenticator returned non-JSON (status ${response.status}): ${text.slice(0, 200)}`);
            }
            if (!response.ok || !parsedbody.auth_token) {
                throw new Error(`AJ auth failed (status ${response.status}): ${parsedbody.error || text.slice(0, 200)}`);
            }
            resolve(parsedbody['auth_token']);
        } catch (error) {
            reject(error);
        }
    });
}
const parentDir = path.resolve(__dirname, '..', '..');
const SESSIONS_PATH = path.resolve(parentDir, 'sessions.json');

async function loadSessions() {
  try {
    const data = await readFile(SESSIONS_PATH, 'utf-8');
    return JSON.parse(data);
  } catch (err) {
    return {};
  }
}

async function fetchFlashvars(proxy = null) {
    if (cachedFlashvars) {
        return cachedFlashvars;
    }

    return new Promise(async (resolve, reject) => {
        try {
            const response = await proxiedFetch(`${ANIMAL_JAM_BASE_URL}/flashvars`, {
                method: 'GET',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) AJClassic/1.5.7 Chrome/87.0.4280.141 Electron/11.5.0 Safari/537.36',
                }
            });
            const data = await response.json();
            cachedFlashvars = data;
            console.log('Flashvars fetched and cached successfully');
            resolve(cachedFlashvars);
        } catch (error) {
            console.error('Failed to fetch flashvars:', error.message);
            reject(error);
        }
    });
}

fetchFlashvars().catch(err => {
    console.error('[System] Failed to fetch flashvars on startup:', err.message);
});

function getFlashvars() {
    return cachedFlashvars;
};

async function saveSessions(sessions) {
  await writeFile(SESSIONS_PATH, JSON.stringify(sessions, null, 2));
}

async function CheckSessions(auth) {
    try {
        const response = await proxiedFetch("https://player-session-data.animaljam.com/player?domain=flash&client_version=1714", {
            headers: {
                "Authorization": `Bearer ${auth}`,
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) AJClassic/1.5.7 Chrome/87.0.4280.141 Electron/11.5.0 Safari/537.36"
            }
        });

        return response.status === 200;

    } catch (error) {
        console.error("Fetch error:", error);
        return false;
    }
}

const SpawnLoc = {
  "jamaa_township.room_main": { x: 690, y: 650 },
  "crystal_sands.room_main": { x: 1098, y: 896 },
  "coral_canyons.room_main": { x: 85, y: 1100 },
  "sarepia_forest.room_main": { x: -60, y: -720 },
  "lost_temple_of_zios.room_main": { x: 1712, y: 854 },
  "appondale.room_main": { x: 480, y: 640 },
  "balloosh.room_main": { x: 1530, y: 1330 },
  "mt_shiveer.room_main": { x: 1430, y: 2050 },
  "kani_cove.room_main": { x: 2100, y: 2300 },
  "crystal_reef.room_main": { x: 1950, y: 1950 },
  "deep_blue.room_main": { x: 2400, y: 2450 }
};


module.exports = {
    wait,
    getRndInteger,
    Login,
    CheckSessions,
    saveSessions,
    loadSessions,
    fetchFlashvars,
    getFlashvars,
    SpawnLoc
};