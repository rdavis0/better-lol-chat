# Agents

User-facing install and feature notes are in `README.md`. Do not add DOM docs, fixtures, capture steps, or other technical references there.

`docs/FEATURE_LIST.md` is a personal checklist. Implemented behavior is the plugin source plus the docs below. Do not treat the checklist prose or its checkboxes as the spec.

## Read first

- `docs/CHAT_INTERFACE.md` — post-game DOM, selectors, identity, and what this plugin already changes.
- `docs/CAPTURE.md` — how to capture a live client before changing selectors or adding a new screen.
- `docs/fixtures/` — trimmed exports named from those docs.
- Plugin source: `pengu-plugin/better-lol-chat/`.

If a selector fails after a patch, re-check the live element. Do not invent a new one.

## Product

One product name, two packages:

- **Client package** — this Pengu plugin. It changes Riot's existing screen.
- **Standalone app** — a separate window. Not started. "Plus" is a premium tier inside that app, not a second product name.

Emoji input and the rest of the companion feature set stay in the standalone app.

## Client constraints

Settings live in the League client's `localStorage` under `blc-settings`. On load, merge saved values over the defaults so a new key does not wipe prior choices. Do not write settings through `context.fs`. Losing them if the user wipes client storage is acceptable.

Do not call `textarea.focus()`. That scrolls the whole client.

The plugin runs inside the League client:

- It cannot raise its own permissions. `context.fs` cannot write outside the plugin folder. Program Files is read-only from that process.
- Pengu only loads `index.js` from its `plugins` folder. A second writable folder is not a plugin and is not reachable through `context.fs`.
- Do not self-update from inside the client. The standalone app or the installer replaces plugin files. A Program Files install starts a separate updater so Windows can show the elevation prompt, then asks for a League restart. One prompt per update, not from inside a game. A `%LOCALAPPDATA%` install can copy files with no prompt.
- Bundle Pengu largely unchanged, not as a fork, and keep its license. If Pengu is already installed, use that directory. If it is missing, extract it to a user-writable folder (for example `%LOCALAPPDATA%\better-lol-chat`), outside the League and Riot Client directories.
- The user still turns Pengu on once. A League patch that breaks Pengu is fixed by Pengu's own update.

The client plugin stays useful on its own. Do not paywall champion names, team colors, or basic readability. Do not inject ads into the League client. Ads and premium stay in the companion window. Macros stay user-initiated: do not auto-send on game end, auto-reply, or schedule chat. A public or monetized LCU product needs Riot's developer approval before release.

## Screens that are not captured yet

Pre-game chat is not started. Champion mapping comes from the end-of-game stats block, which does not exist in champ select or the lobby. Pre-game needs its own room type, its own player list (picks change during select), and a DOM capture before the same behavior can apply.

Arena rows only have `mine`, `my-team`, and `other-team`. Every opponent shares `other-team`, so team id has to come from the end-of-game `teams[]` block. Capture that screen first (`docs/CAPTURE.md`). Each Arena team gets its own name color. Your duo stays the ally color. Mark each team on the Arena scoreboard with that same color.

When one champion appears more than once (One for All, Arena duplicates, blind-pick mirrors), keep players mapped by puuid and summoner id. Disambiguate the chat label. Scoreboard icons follow the player, not the champion name alone.
