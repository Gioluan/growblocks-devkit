---
name: growblocks-game
description: Build, check and ship a browser game on GrowBlocks with the growblocks_* tools. Use when the user wants to make a game, a three.js browser game, a multiplayer party game, or anything for GrowBlocks or its Dev Kit, or works in a folder with game.js and growblocks.json.
---

# Making a GrowBlocks game

GrowBlocks runs your `game.js` on its own engine: three.js 0.170, Rapier physics, characters, multiplayer rooms, hosting. You write the game; GrowBlocks reviews it and players get it at growblocks.xyz.

## The loop
1. **Folder.** If the current folder has no `game.js`, call `growblocks_new_game` and pass the folder it made as `dir` to every other tool.
2. **API first.** Call `growblocks_docs` (or one `topic`, e.g. `gb.net`, `Pitfalls`) before writing code. Use only the `gb.*` calls it documents.
3. **Reuse.** Call `growblocks_blocks` before writing something common (checkpoints, boost pads, enemy AI, pickups, round timers). `growblocks_add_block` copies one into `blocks/<slug>/`. Never edit files under `blocks/`: the block is recognised by them and its author earns from the game.
4. **Write `game.js`**: `export default async function game(gb){...}`. Never make a renderer, canvas, scene, camera or loop; use `gb.renderer`, `gb.scene`, `gb.camera`, `gb.onUpdate`. Always add a floor.
5. **Check after every change**: `growblocks_check` with `play: true`. Look at the screenshot it returns (a floor, the character, a readable HUD) and fix everything it reports.
6. **Ship only when asked.** `growblocks_push` uploads an unlisted test build and returns its link. `growblocks_create_game` needs a name and address from the human. `growblocks_submit` only when the human says so.

## Hard rules
- No `localStorage`, `alert`, `window.open`, npm packages at runtime or direct AI API calls: use `gb.store`, `gb.ui`, `gb.ui.share`, `gb.ai`.
- Imports: `three`, `three/addons/...`, relative files, `https://cdn.jsdelivr.net/...`.
- Assets inside the folder: at most 3 MB a file, 200 files, 30 MB in all.
- Leave the bottom-right corner (about 190 x 40 px) empty for the "Built with GrowBlocks" badge.
- "Not signed in": call `growblocks_login` and give the human the link and code. Never ask for or print tokens.

Money (collections, coins, earnings) stays in the human's browser at https://growblocks.xyz/devkit.html.
