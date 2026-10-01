# Agents

User-facing install and feature notes are in `README.md`. Do not add DOM docs, fixtures, capture steps, or other technical references there.

Implemented behavior is the plugin source plus the docs below.

## Read first

- `docs/CHAT_INTERFACE.md` — post-game DOM, selectors, identity, and what this plugin already changes.
- `docs/CAPTURE.md` — how to capture a live client before changing selectors or adding a new screen.
- `docs/fixtures/` — trimmed exports named from those docs.
- Plugin source: `pengu-plugin/better-lol-chat/`.

If a selector fails after a patch, re-check the live element. Do not invent a new one.

## Product

This repo is the Pengu plugin. It changes Riot's existing post-game chat screen.

## Client constraints

Settings live in the League client's `localStorage` under `blc-settings`. On load, merge saved values over the defaults so a new key does not wipe prior choices. Do not write settings through `context.fs`. Losing them if the user wipes client storage is acceptable.

Do not call `textarea.focus()`. That scrolls the whole client.

Do not set `z-index` unless a live check shows the element is covered, or is covering something it should not. Leave stacking alone until that is proven.

The plugin runs inside the League client:

- It cannot raise its own permissions. `context.fs` cannot write outside the plugin folder. Program Files is read-only from that process.
- Pengu only loads `index.js` from its `plugins` folder. A second writable folder is not a plugin and is not reachable through `context.fs`.
- Do not self-update from inside the client.
- The user still turns Pengu on once. A League patch that breaks Pengu is fixed by Pengu's own update.

The client plugin stays useful on its own. Do not paywall champion names, team colors, or basic readability. Do not inject ads into the League client. Macros stay user-initiated: do not auto-send on game end, auto-reply, or schedule chat.

## Screens that are not captured yet

Pre-game chat is not started. Champion mapping comes from the end-of-game stats block, which does not exist in champ select or the lobby. Pre-game needs its own room type, its own player list (picks change during select), and a DOM capture before the same behavior can apply.

Arena rows only have `mine`, `my-team`, and `other-team`. Every opponent shares `other-team`, so team id has to come from the end-of-game `teams[]` block. Capture that screen first (`docs/CAPTURE.md`). Each Arena team gets its own name color. Your duo stays the ally color. Mark each team on the Arena scoreboard with that same color. Duplicate champions on that screen stay with this work: keep players mapped by puuid and summoner id.
