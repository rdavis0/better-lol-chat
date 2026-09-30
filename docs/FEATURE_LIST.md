# better-lol-chat — Feature backlog

## Planned — client (Pengu)
- [ ] **Automatically focus chat** — put the caret in the input when chat opens. Do not use `textarea.focus()` until a capture shows a way that does not scroll the whole client.
- [ ] **Report a bug** — link in the options menu, next to the update check. Github Issues?

### Pre-game chat
Not started. Post-game was the prototype because champion mapping comes from the end-of-game stats block, which does not exist in champ select or the lobby. Pre-game needs its own room type, its own player list (picks change during select), and a DOM capture before the same toggles can apply.

- [ ] Champion names, team colors, and champion icons in champ-select chat
- [ ] Same options as post-game, once that screen’s chat DOM is captured

### Arena
The chat row only has `mine`, `my-team`, and `other-team`. Every opponent shares `other-team`, so team id has to come from the end-of-game `teams[]` block. Duplicate champions on that screen stay with this work: keep players mapped by puuid and summoner id.

- [ ] **Multi-team color coding**
  Give each Arena team its own name color. Your duo stays the ally color. The other duos do not all stay red.
- [ ] **Scoreboard team highlight**
  Mark each team on the Arena scoreboard with that same color.

## Planned — companion app

Standalone desktop app (own window). These do not belong in the League client.

- [ ] Detect the `postGame` room and show messages live
- [ ] Send a message through the LCU conversation endpoint
- [ ] Resizable / detachable chat, including a larger or full-screen window
- [ ] Second-monitor support and always-on-top
- [ ] Persistent chat history after Riot destroys the room
- [ ] Search previous conversations
- [ ] Filter by game, player, champion, or date
- [ ] Friend chats alongside post-game chats
- [ ] Multiple chat tabs
- [ ] Custom themes and layouts
- [ ] Font size and message-density controls
- [ ] Champion icons
- [ ] Copy / export conversations
- [ ] Notifications
- [ ] Manual quick-message buttons (user presses the button; the app sends that text)
- [ ] **Emoji input** (standalone app only)
- [ ] Translation
- [ ] Cloud sync of history and settings

### Premium companion tier

Free companion may include ads in its own window. Premium (subscription or one-time) can add:

- [ ] Remove ads
- [ ] Unlimited chat history
- [ ] Advanced search and filtering
- [ ] Extra themes and customization
- [ ] Multiple chat windows
- [ ] Cloud-synced history and settings
- [ ] Translation
- [ ] Custom macro sets
- [ ] Advanced notification options

## Planned — install and updates

- [ ] Bundle Pengu largely unchanged (portable zip, not a fork) and keep its license in the installer
- [ ] If Pengu is already installed, use that directory. Do not install a second copy
- [ ] If Pengu is missing, extract it to a user-writable folder (for example under `%LOCALAPPDATA%\better-lol-chat`), outside the League and Riot Client directories
- [ ] Copy the Client Package into that Pengu `plugins` folder
- [ ] Standalone App replaces plugin files, requesting elevation when the folder is under Program Files
