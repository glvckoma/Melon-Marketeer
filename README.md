# Melon Marketeer

Melon Marketeer is a shop-price tracker for Animal Jam Classic. A small fleet of bot accounts visits player dens, reads the items and prices in their personal shops, and saves every observation to a local SQLite database. A website on top of that data lets you look up what an item sells for, who is selling it, how prices differ by color, and how they change over time. It also pulls item worth from the community item-worth wiki for comparison.

It ran publicly as melonmarketeer.com and is now archived. The code is published here so you can run it on your own computer, either to browse the final dataset or to collect fresh prices yourself.

## Built on AJCBots

The bot layer in `bot/` comes from [AJCBots](https://github.com/DrEmoji/AJCBots) by DrEmoji, a socket-based bot framework for Animal Jam Classic. Full credit for that foundation goes to them. If you build on this project, keep the credit to both AJCBots and Melon Marketeer.

## Requirements

- Node.js 22.13 or newer (the database uses the built-in `node:sqlite` module)
- About 1 GB of free disk space for the dataset (the finished database is about 600 MB), plus 1.2 GB if you download the images

## Quick start A: browse the data (no bot accounts needed)

This imports the public snapshot from [Marketeer-Data](https://github.com/glvckoma/Marketeer-Data) (about 3.2 million price observations from 10,951 shops) and starts the website.

```
npm install
npm run refresh-defpacks
npm run import-snapshot
npm run serve
```

Open <http://localhost:3200>.

`refresh-defpacks` downloads the game's item definition packs and saves the item names to your database. `import-snapshot` downloads the latest snapshot release (about 74 MB compressed) and takes a minute or two. To import a file you already downloaded, pass its path: `npm run import-snapshot -- path/to/marketeer-public.sqlite.gz`.

Item images load straight from the wikis they came from. To keep your own copy instead, run `npm run download-images` (about 35,000 images, roughly 1.2 GB).

## Quick start B: scrape prices yourself

1. Run `npm install` and `npm run refresh-defpacks` if you have not already.
2. Copy `accounts.example.txt` to `accounts.txt` and put one Animal Jam Classic account per line as `username:password`.
3. Copy `.env.example` to `.env` and set `PROXY_URL` (see the warning below).
4. Run `npm start`, then open the admin hub at <http://localhost:3100>.
5. In the hub, log in some accounts and start the continuous scraper. New prices show up on the website (`npm run serve`) as they are collected.

To run without the hub, set `AUTO_START=1` in `.env` and `npm start` logs in accounts and starts scraping by itself. From the website you can also add usernames to the scrape queue and request a re-check of any shop.

The scraper has three modes. `dead` scrapes the known username pool. `live` roams busy rooms to find players who are online right now. `auto` does live first and falls back to the pool. Pacing, batch sizes and cooldowns can all be changed from the hub while it runs.

Accounts get banned. Expect only a small share of a large account list to stay usable, and use throwaway accounts only.

## Warning: your IP address

Without a proxy, every login and game connection comes from your own IP address, and Animal Jam can ban that IP. Set `PROXY_URL` in `.env` to an HTTP proxy (a rotating residential proxy works best):

```
PROXY_URL=http://user:password@proxy.example.com:8080
```

Logins, session checks and the game socket all go through it.

## Scripts

| Command | What it does |
| --- | --- |
| `npm start` | Bot fleet and admin hub (:3100) |
| `npm run serve` | Website (:3200) |
| `npm test` | Unit and integration tests |
| `npm run refresh-defpacks` | Download the latest item definition packs and save item names |
| `npm run import-snapshot` | Import the public dataset into `data/marketeer.db` |
| `npm run download-images` | Save every wiki image locally |
| `node tools/wikiSync.js crawl` | Index every page of the item-worth wiki |
| `node tools/wikiSync.js images 200` | Find images for up to 200 newly matched items |
| `node tools/wikiSync.js colorworth 200` | Fetch per-color worth for up to 200 items |
| `node tools/rebuildWikiMatches.js` | Rebuild the item to wiki page matches |
| `node tools/importUsernames.js [file]` | Add usernames to the scrape pool (defaults to Strawberry Jam's username log) |
| `node tools/exportPublicData.js [dir]` | Export a shareable copy of your database with bot names removed |
| `npm run pm2` | Run the bot and website under PM2 with auto-restart |

## Project layout

```
index.js      entry point: bot fleet and admin hub
bot/          one bot: login, socket, protocol handlers (AJCBots)
fleet/        account login/logout, rotation and quarantine
scraper/      continuous scraper, username collector and packet parsers
items/        colors, wiki matching and worth parsing
defpacks/     game definition pack decoder and name resolver
db/           SQLite schema and queries
api/          read models shared by the hub and the website
admin/        operator hub (server and pages)
web/          website (server and single-page app); downloaded images go in web/public/wiki
shared/       design tokens used by both sites
data/         color palette, plus your database and the downloaded definition packs
tools/        maintenance scripts
test/         node:test suites
```

## Related

- [Marketeer-Data](https://github.com/glvckoma/Marketeer-Data): the public dataset
- [Strawberry Jam](https://github.com/glvckoma/Strawberry-Jam)
- [Berry Breach](https://github.com/glvckoma/Berry-Breach)

## License

PolyForm Noncommercial License 1.0.0, matching the upstream AJCBots license. Noncommercial use, modification and sharing are allowed; commercial use is not. See [LICENSE](LICENSE), and keep the Required Notice lines when you redistribute.

## Disclaimer

This project is not affiliated with, endorsed by, or associated with WildWorks. All trademarks and game assets belong to their owners. Using socket bots may break Animal Jam Classic's Terms of Service and can get accounts and IP addresses banned. Use it at your own risk. The software is provided as is, without warranty or promise of support.

If WildWorks or an authorized representative asks for this project to be taken down, open an issue in this repository and it will be removed as soon as the request is verified.
