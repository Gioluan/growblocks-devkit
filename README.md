# GrowBlocks Dev Kit for Claude, Cursor and other AI assistants

Make a browser game with an AI assistant and ship it on [GrowBlocks](https://growblocks.xyz/devkit.html): three.js, Rapier physics, characters, multiplayer rooms and hosting, with no setup.

The assistant reads the API, writes `game.js`, **plays the game headless and looks at a screenshot after every change**, reuses parts other developers published (blocks), and pushes an unlisted test build you can share. Nothing goes public until you submit it and GrowBlocks reviews it.

## Install

**Claude Code (plugin: tools + skill)**
```
/plugin marketplace add Gioluan/growblocks-devkit
/plugin install growblocks@growblocks
```

**Claude Code (just the MCP server)**
```
claude mcp add growblocks -- npx -y growblocks mcp
```

**Claude Desktop:** download `growblocks.mcpb` from the latest release and open it.

**Cursor / Windsurf / any MCP client**
```json
{ "mcpServers": { "growblocks": { "command": "npx", "args": ["-y", "growblocks", "mcp"] } } }
```

**Terminal:** `npx growblocks new my-game`, then `npx growblocks help`.

Then ask: *"Make me a GrowBlocks game where frogs race across lily pads"*, or use the `make_game` prompt.

## Tools

| Tool | What it does |
|---|---|
| `growblocks_docs` | The Dev Kit API (or one section of it) |
| `growblocks_check` | Static checks; with `play` it plays the game headless and returns a screenshot |
| `growblocks_new_game` | A new game folder from the starter kit |
| `growblocks_blocks`, `growblocks_block_info`, `growblocks_add_block` | Find and add published blocks (their authors earn when your game ships them) |
| `growblocks_login`, `growblocks_whoami` | Sign in with a code you confirm in your browser |
| `growblocks_create_game`, `growblocks_link_game`, `growblocks_update_game` | Make the game on GrowBlocks and set its name, logo and details |
| `growblocks_push` | Upload an unlisted test build and get its link |
| `growblocks_status`, `growblocks_games` | Builds, links and the review note |
| `growblocks_submit`, `growblocks_publish_block` | Only when you ask: submit for review, publish a block |

Every tool takes `dir`, the game folder. Prompts: `make_game`, `ship_game`. Resources: `llms.txt`, `gb.d.ts`.

Money (collections, the coin, earnings) never goes through the assistant: it stays in your browser at growblocks.xyz. Developers keep 70% of the fees their game generates.

## Layout
- `.claude-plugin/marketplace.json`: this repo as a Claude Code plugin marketplace
- `plugins/growblocks/`: the plugin (`.mcp.json` runs `npx growblocks@1.2.0 mcp`, plus the `growblocks-game` skill)
- `desktop/`: the Claude Desktop extension; build it with `npx @anthropic-ai/mcpb pack desktop growblocks.mcpb`
- `server.json`: the entry for the official MCP Registry
- `TERMS.md`: the Dev Kit terms

The server is one dependency-free file, [`growblocks.mjs`](growblocks.mjs), published on npm as [`growblocks`](https://www.npmjs.com/package/growblocks).
