import './style.css';
import frameCss from './frame.css?raw';
import { buildMessageLog, championLabel, takeChatStamp, takeLeaveStamp } from './labels.js';
import { mountUpdateStatus } from './update.js';

const LOG = '[better-lol-chat]';
const VERSION = '0.3';
const CREDIT_TEXT = `better-lol-chat by wryguy`;
const JOIN_TEXT = /joined(\s+the)?\s+(room|lobby)/i;
const POSTGAME_PHASES = new Set([
  'WaitingForStats',
  'PreEndOfGame',
  'EndOfGame',
]);

const ROOM_SEL = 'lol-social-chat-room[type="postGame"]';
const TOGGLE_SEL = '.chat-toggle-button';
const FRAME_SEL = 'iframe#embedded-messages-frame, iframe';
const FOCUSED_CLASS = 'focused-chat-box';
const COLLAPSED_CLASS = 'blc-collapsed';

let socket = null;
let inPostGame = false;
let windowCollapsed = false;
const COLLAPSE_TIP_KEY = 'blc-collapse-tip';
const COLLAPSE_TIP_TEXT = 'click to collapse chat window';
let collapseTipVisible = false;
let collapseTipDismissed = false;
let applying = false;
let chatRoom = null;
let focusClassObserver = null;
let chatBottomViewport = 0;
let onScoreboard = false;
let wasOnScoreboard = false;
const frameObservers = new WeakMap();

const byPuuid = new Map();
const bySummonerId = new Map();
let nameIndex = [];
let roster = [];

const SETTINGS_KEY = 'blc-settings';
const DISCLAIMER =
  "better-lol-chat isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games, and all associated properties are trademarks or registered trademarks of Riot Games, Inc.";

const COLOR_DEFAULTS = {
  nameAlly: '#16cae5',
  nameEnemy: '#ff1a3e',
  nameMine: '#fabe0a',
  messageAlly: '#a1deed',
  messageEnemy: '#e7c1c8',
  messageMine: '#bfb9a5',
};

const COLOR_VARS = {
  nameAlly: '--blc-name-ally',
  nameEnemy: '--blc-name-enemy',
  nameMine: '--blc-name-mine',
  messageAlly: '--blc-message-ally',
  messageEnemy: '--blc-message-enemy',
  messageMine: '--blc-message-mine',
};

const TOGGLES = [
  ['tallerChat', 'Large chat window'],
  ['strongDim', 'Stronger inactive player dim'],
  ['autoOpen', 'Automatically open chat'],
  ['showTimestamps', 'Message timestamps'],
];

const NAME_CHOICES = [
  ['summoner', 'Summoner names'],
  ['champion', 'Champion names'],
  ['both', 'Summoner & Champion names'],
];

const COLOR_FIELDS = [
  { group: 'Names', key: 'nameAlly', label: 'Ally', reset: 'Reset ally name color' },
  { group: 'Names', key: 'nameEnemy', label: 'Enemy', reset: 'Reset enemy name color' },
  { group: 'Names', key: 'nameMine', label: 'You', reset: 'Reset your name color' },
  { group: 'Messages', key: 'messageAlly', label: 'Ally', reset: 'Reset ally message color' },
  { group: 'Messages', key: 'messageEnemy', label: 'Enemy', reset: 'Reset enemy message color' },
  { group: 'Messages', key: 'messageMine', label: 'You', reset: 'Reset your message color' },
];

const PAINT_PROPS = [
  'backgroundImage',
  'backgroundPosition',
  'backgroundSize',
  'backgroundRepeat',
  'webkitMaskImage',
  'webkitMaskPosition',
  'webkitMaskSize',
  'webkitMaskRepeat',
  'maskImage',
  'maskPosition',
  'maskSize',
  'maskRepeat',
];

let settings = loadSettings();
let postGameConversationId = null;
let messageLog = [];
let lastMessageFetch = 0;
let lastMapLog = '';
let identityGen = 0;
const chromeToken = String(Math.random());
applyHostSettings();

export function init(context) {
  socket = context.socket;

  socket.observe('/lol-gameflow/v1/gameflow-phase', ({ data }) => {
    onPhase(typeof data === 'string' ? data : data?.phase || data);
  });
  socket.observe('/lol-end-of-game/v1/eog-stats-block', () => {
    if (inPostGame) refreshIdentities().catch((err) => console.warn(LOG, err));
  });
  socket.observe('/lol-chat/v1/conversations', () => {
    if (inPostGame) refreshIdentities().catch((err) => console.warn(LOG, err));
  });
}

export function load() {
  console.log(LOG, `v${VERSION}`);

  fetch('/lol-gameflow/v1/gameflow-phase')
    .then((r) => (r.ok ? r.json() : null))
    .then((phase) => onPhase(phase))
    .catch(() => {});

  const observer = new MutationObserver(() => {
    if (!inPostGame || applying) return;
    scheduleEnhance();
    scheduleEnsureOpen();
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'room-changed-messages'],
  });

  armCollapseTipDismiss(document);
  document.addEventListener('pointerdown', onHostPointerDown, true);
  document.addEventListener('pointerdown', onToggleIntercept, true);
  document.addEventListener('click', onToggleIntercept, true);
  document.addEventListener('pointerdown', onInputOpen, true);
  document.addEventListener('focusin', onInputOpen, true);
  document.addEventListener('pointerdown', onOutsidePointerDown, true);
  document.addEventListener('pointerup', onOutsidePointerUp, true);
  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('focusout', onFocusOut, true);

  window.addEventListener('blur', () => {
    if (!inPostGame) return;
    scheduleEnsureOpen(0);
    scheduleEnsureOpen(50);
    scheduleEnsureOpen(150);
  });
  window.addEventListener('focus', () => {
    if (!inPostGame) return;
    scheduleEnsureOpen(0);
  });
  document.addEventListener('visibilitychange', () => {
    if (!inPostGame) return;
    scheduleEnsureOpen();
  });

  setInterval(() => {
    if (!inPostGame) return;
    ensureOpen();
    if (!settings.showTimestamps) return;
    if (Date.now() - lastMessageFetch < 3000) return;
    refreshMessageLog().catch((err) => console.warn(LOG, err));
  }, 250);

  window.addEventListener('resize', () => {
    clearStretch(chatRoom);
    if (inPostGame) scheduleEnsureOpen(0);
  });
}

function onPhase(phase) {
  const next = POSTGAME_PHASES.has(String(phase || ''));
  if (next === inPostGame && next) return;
  inPostGame = next;
  if (!inPostGame) {
    windowCollapsed = false;
    clearStretch(chatRoom);
    chatRoom = null;
    onScoreboard = false;
    wasOnScoreboard = false;
    byPuuid.clear();
    bySummonerId.clear();
    nameIndex = [];
    roster = [];
    postGameConversationId = null;
    messageLog = [];
    lastMapLog = '';
    clearScoreboardIcons();
    closeOptions();
    if (collapseTipVisible) dismissCollapseTip();
    else hideCollapseTip();
    return;
  }
  windowCollapsed = false;
  refreshIdentities()
    .then(() => {
      scheduleEnhance();
      ensureOpen();
      setTimeout(ensureOpen, 300);
      setTimeout(ensureOpen, 1000);
      setTimeout(ensureOpen, 2500);
    })
    .catch((err) => console.warn(LOG, err));
}

async function lcu(path) {
  const res = await fetch(path);
  if (!res.ok) return null;
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function refreshIdentities() {
  const gen = ++identityGen;
  lastMessageFetch = Date.now();
  const [me, eog, champs, conversations] = await Promise.all([
    lcu('/lol-summoner/v1/current-summoner'),
    lcu('/lol-end-of-game/v1/eog-stats-block'),
    lcu('/lol-game-data/assets/v1/champion-summary.json'),
    lcu('/lol-chat/v1/conversations'),
  ]);
  if (gen !== identityGen) return;

  const champNames = new Map();
  const champIcons = new Map();
  for (const c of champs || []) {
    if (!c || c.id == null) continue;
    const id = Number(c.id);
    champNames.set(id, c.name || c.alias);
    if (c.squarePortraitPath) champIcons.set(id, c.squarePortraitPath);
  }

  const players = dedupePlayers(collectPlayers(eog, me, champNames, champIcons));
  roster = players;
  byPuuid.clear();
  bySummonerId.clear();
  const aliases = [];

  for (const player of players) {
    if (player.puuid) byPuuid.set(String(player.puuid), player);
    if (player.summonerId != null && player.summonerId !== '' && Number(player.summonerId) !== 0) {
      bySummonerId.set(String(player.summonerId), player);
    }
    for (const alias of player.aliases) {
      if (alias) aliases.push({ name: alias, player });
    }
  }

  const postGame = (conversations || []).find((c) => c?.type === 'postGame');
  postGameConversationId = postGame?.id || postGame?.pid || null;

  aliases.sort((a, b) => b.name.length - a.name.length);
  nameIndex = aliases;
  const mapLog = `${players.length}:${postGameConversationId || ''}`;
  if (mapLog !== lastMapLog) {
    lastMapLog = mapLog;
    console.log(LOG, 'mapped', players.length, 'players', { conversation: postGameConversationId });
  }

  let messages = [];
  if (postGameConversationId) {
    messages = (await lcu(
      `/lol-chat/v1/conversations/${encodeURIComponent(postGameConversationId)}/messages`,
    )) || [];
    if (gen !== identityGen) return;
    applyJoinRoomMapping(messages);
  }
  if (gen !== identityGen) return;
  messageLog = buildMessageLog(messages);
}

async function refreshMessageLog() {
  if (!postGameConversationId) {
    await refreshIdentities();
    scheduleEnhance();
    return;
  }
  const gen = ++identityGen;
  const id = postGameConversationId;
  lastMessageFetch = Date.now();
  const messages = (await lcu(`/lol-chat/v1/conversations/${encodeURIComponent(id)}/messages`)) || [];
  if (gen !== identityGen) return;
  applyJoinRoomMapping(messages);
  messageLog = buildMessageLog(messages);
  scheduleEnhance();
}

function collectPlayers(eog, me, champNames, champIcons) {
  if (!eog) return [];
  const myPuuid = me?.puuid;
  const mySummonerId = me?.summonerId;
  const list = [];

  const push = (raw, allyHint, teamId) => {
    if (!raw) return;
    const championId = Number(raw.championId);
    const championName =
      champNames.get(championId) ||
      raw.championName ||
      (raw.skinName ? String(raw.skinName) : null) ||
      'Unknown';
    const gameName = String(raw.riotIdGameName || raw.gameName || raw.summonerName || '').trim();
    const tagLine = String(raw.riotIdTagLine || raw.tagLine || '').trim();
    const iconPath =
      champIcons.get(championId) ||
      (championId ? `/lol-game-data/assets/v1/champion-icons/${championId}.png` : '');
    const aliases = unique([
      raw.riotIdGameName && raw.riotIdTagLine
        ? `${raw.riotIdGameName}#${raw.riotIdTagLine}`
        : null,
      raw.gameName && raw.tagLine ? `${raw.gameName}#${raw.tagLine}` : null,
      raw.riotIdGameName,
      raw.gameName,
      raw.summonerName,
      raw.displayName,
      raw.riotId,
    ]);
    list.push({
      puuid: raw.puuid || raw.playerPuuid || null,
      summonerId: raw.summonerId ?? raw.userId ?? null,
      teamId: teamId ?? raw.teamId ?? null,
      championName,
      gameName,
      tagLine,
      iconPath,
      ally: allyHint,
      aliases,
    });
  };

  if (Array.isArray(eog.teams) && eog.teams.length) {
    for (const team of eog.teams) {
      const ally = team.isPlayerTeam === true;
      for (const p of team.players || []) push(p, ally, p.teamId ?? team.teamId);
    }
  }

  if (!list.length) {
    for (const p of eog.teamPlayerParticipantStats || []) push(p, true, p.teamId);
    for (const p of eog.otherTeamPlayerParticipantStats || []) push(p, false, p.teamId);
  }

  const mine = list.find(
    (p) =>
      (myPuuid && p.puuid === myPuuid) ||
      (mySummonerId != null && String(p.summonerId) === String(mySummonerId)),
  );
  if (mine) {
    const myTeam = mine.teamId;
    const anyAllyHint = list.some((p) => p.ally === true);
    if (!anyAllyHint && myTeam != null) {
      for (const p of list) p.ally = String(p.teamId) === String(myTeam);
    } else {
      mine.ally = true;
    }
  }

  return list;
}

function dedupePlayers(list) {
  const out = [];
  const seen = new Set();
  for (const player of list) {
    const key = player.puuid
      ? `p:${player.puuid}`
      : player.summonerId != null && Number(player.summonerId) !== 0
        ? `s:${player.summonerId}`
        : '';
    if (key) {
      if (seen.has(key)) continue;
      seen.add(key);
    }
    out.push(player);
  }
  return out;
}

function applyJoinRoomMapping(messages) {
  for (const msg of messages || []) {
    if (msg?.type !== 'system') continue;
    if (String(msg.body) !== 'joined_room' && String(msg.body) !== 'left_room') continue;
    const puuid = msg.fromPuuid && String(msg.fromPuuid);
    const sid = msg.fromSummonerId;
    if (!puuid || sid == null || Number(sid) === 0) continue;
    const player = byPuuid.get(puuid) || bySummonerId.get(String(sid));
    if (!player) continue;
    player.puuid = player.puuid || puuid;
    player.summonerId = player.summonerId || sid;
    byPuuid.set(puuid, player);
    bySummonerId.set(String(sid), player);
  }
}

function unique(values) {
  const out = [];
  const seen = new Set();
  for (const v of values) {
    const s = String(v || '').trim();
    if (!s || seen.has(s.toLowerCase())) continue;
    seen.add(s.toLowerCase());
    out.push(s);
  }
  return out;
}

function findPostGameRoom() {
  return (
    document.querySelector(ROOM_SEL) ||
    [...document.querySelectorAll('lol-social-chat-room')].find(
      (el) => el.getAttribute('type') === 'postGame',
    ) ||
    null
  );
}

function getChatBox(room) {
  return room?.querySelector?.('.chat-box') || room;
}

function isChatOpen(room = chatRoom || findPostGameRoom()) {
  if (!room) return false;
  const box = getChatBox(room);
  if (box?.classList?.contains(FOCUSED_CLASS)) return true;
  if (room.classList?.contains(FOCUSED_CLASS)) return true;
  if (room.querySelector?.(`.${FOCUSED_CLASS}`)) return true;
  return false;
}

function forceFocusedClass(room = chatRoom || findPostGameRoom()) {
  if (!room) return;
  room.classList.add(FOCUSED_CLASS);
  const box = getChatBox(room);
  if (box && box !== room) box.classList.add(FOCUSED_CLASS);
}

function clearFocusedClass(room = chatRoom || findPostGameRoom()) {
  if (!room) return;
  room.classList.remove(FOCUSED_CLASS);
  getChatBox(room)?.classList?.remove(FOCUSED_CLASS);
  room.querySelectorAll(`.${FOCUSED_CLASS}`).forEach((el) => el.classList.remove(FOCUSED_CLASS));
}

function withFrozenScroll(fn) {
  const nodes = [
    document.documentElement,
    document.body,
    document.scrollingElement,
    document.querySelector('.lol-responsive-app'),
    document.querySelector('#rcp-fe-viewport-root'),
    document.querySelector('[data-screen-root]'),
  ].filter(Boolean);

  const snaps = nodes.map((el) => ({ el, top: el.scrollTop, left: el.scrollLeft }));
  const wx = window.scrollX;
  const wy = window.scrollY;
  try {
    return fn();
  } finally {
    for (const s of snaps) {
      try {
        s.el.scrollTop = s.top;
        s.el.scrollLeft = s.left;
      } catch {
        /* ignore */
      }
    }
    try {
      window.scrollTo(wx, wy);
    } catch {
      /* ignore */
    }
  }
}

function watchFocusClass(room) {
  if (!room) return;
  if (focusClassObserver) {
    focusClassObserver.disconnect();
    focusClassObserver = null;
  }
  const targets = [room, getChatBox(room)].filter(Boolean);
  focusClassObserver = new MutationObserver(() => {
    if (!inPostGame || !onScoreboard) return;
    if (windowCollapsed) {
      if (isChatOpen(room)) withFrozenScroll(() => clearFocusedClass(room));
      return;
    }
    if (!settings.autoOpen) return;
    if (!isChatOpen(room)) withFrozenScroll(() => forceFocusedClass(room));
  });
  for (const el of targets) {
    focusClassObserver.observe(el, { attributes: true, attributeFilter: ['class'] });
  }
}

let ensureTimer = 0;
function scheduleEnsureOpen(delay = 0) {
  if (ensureTimer) clearTimeout(ensureTimer);
  ensureTimer = setTimeout(() => {
    ensureTimer = 0;
    ensureOpen();
  }, delay);
}

function ensureOpen() {
  if (!inPostGame) return;
  const room = findPostGameRoom();
  if (!room) {
    onScoreboard = scoreboardIsShowing();
    if (onScoreboard) placeScoreboardIcons();
    else clearScoreboardIcons();
    syncCollapseTip(null);
    return;
  }
  chatRoom = room;
  onScoreboard = scoreboardIsShowing();
  if (wasOnScoreboard && !onScoreboard) {
    clearStretch(room);
    withFrozenScroll(() => clearFocusedClass(room));
  }
  wasOnScoreboard = onScoreboard;
  watchFocusClass(room);
  ensurePlayerMessagesVisible(room);

  if (!onScoreboard) {
    syncCredit(room);
    clearScoreboardIcons();
    syncCollapseTip(room);
    return;
  }

  if (windowCollapsed) {
    clearStretch(room);
    room.classList.add(COLLAPSED_CLASS);
    updateCollapsePlaceholder(room, true);
    withFrozenScroll(() => clearFocusedClass(room));
    syncCredit(room);
    placeScoreboardIcons();
    syncCollapseTip(room);
    return;
  }

  if (!settings.autoOpen && !isChatOpen(room)) {
    clearStretch(room);
    syncCredit(room);
    placeScoreboardIcons();
    syncCollapseTip(room);
    return;
  }

  room.classList.remove(COLLAPSED_CLASS);
  updateCollapsePlaceholder(room, false);
  if (settings.autoOpen) withFrozenScroll(() => forceFocusedClass(room));
  if (settings.tallerChat) stretchChat(room);
  else clearStretch(room);
  syncCredit(room);
  placeScoreboardIcons();
  placeOptionsPanel();
  syncCollapseTip(room);
}

function ensurePlayerMessagesVisible(room) {
  if (!room) return;
  room.classList.add('blc-messages-unlocked');

  room.removeAttribute('can-hide-player-messages');
  room.querySelector('lol-social-chat-input')?.removeAttribute('can-hide-player-messages');

  const toggle = room.querySelector(TOGGLE_SEL);
  if (toggle) {
    toggle.classList.remove('can-hide-player-messages');
  }
}

function updateCollapsePlaceholder(room, collapsed) {
  const toggle = room?.querySelector?.(TOGGLE_SEL);
  if (!toggle) return;
  const hint = toggle.querySelector('.chat-placeholder-text');
  if (!hint) return;
  if (collapsed) {
    toggle.classList.add('has-placeholder');
    hint.classList.add('chat-placeholder-visible');
    if (!hint.dataset.blcOrig) hint.dataset.blcOrig = hint.textContent || '';
    hint.textContent = hint.dataset.blcOrig || 'Click or Enter to View';
  } else {
    hint.classList.remove('chat-placeholder-visible');
    toggle.classList.remove('has-placeholder');
  }
}

const ROW_SEL =
  '.scoreboard-row-component, .strawberry-scoreboard-row-component, .jade-scoreboard-row-component';
const ITEMS_SEL =
  '.scoreboard-row-items-container, .strawberry-scoreboard-row-items-container, .jade-scoreboard-row-items-container';
const STAT_SEL = '.scoreboard-row-stat-display-component';
const ROW_NAME_SEL =
  '.scoreboard-row-player-name, .strawberry-scoreboard-row-player-name, .jade-scoreboard-row-player-name';
const ROW_CHAMP_SEL =
  '.scoreboard-row-champ-name, .strawberry-scoreboard-row-champ-name, .jade-scoreboard-row-champ-name';

function clearScoreboardIcons() {
  document.querySelectorAll('.blc-row-champ').forEach((el) => el.remove());
}

function playerForRow(row) {
  const name = stripBidi(row.querySelector(ROW_NAME_SEL)?.textContent || '').trim();
  const byName = name && matchAlias(name);
  if (byName?.player?.iconPath) return byName.player;
  const champ = stripBidi(row.querySelector(ROW_CHAMP_SEL)?.textContent || '')
    .trim()
    .toLowerCase();
  if (!champ) return null;
  const hits = roster.filter((p) => p.championName && p.championName.toLowerCase() === champ && p.iconPath);
  return hits.length === 1 ? hits[0] : null;
}

function statAfterItems(row, anchorRight) {
  let best = null;
  let bestLeft = Infinity;
  for (const stat of row.querySelectorAll(STAT_SEL)) {
    const left = stat.getBoundingClientRect().left;
    if (left + 1 < anchorRight) continue;
    if (left < bestLeft) {
      bestLeft = left;
      best = stat;
    }
  }
  return best;
}

function champIconSize() {
  const icon = document.querySelector(
    '.postgame-player-keystone-icon.circle-icon-holder:not(.is-sub-style)',
  );
  const rect = icon?.getBoundingClientRect();
  const measured = rect ? Math.round(Math.min(rect.width, rect.height)) : 0;
  return measured >= 16 ? measured : 30;
}

function placeScoreboardIcons() {
  if (!onScoreboard || !roster.length) {
    clearScoreboardIcons();
    return;
  }
  const size = champIconSize();
  const seen = new Set();
  for (const row of document.querySelectorAll(ROW_SEL)) {
    const items = row.querySelector(ITEMS_SEL);
    if (!items) continue;
    const rowRect = row.getBoundingClientRect();
    if (rowRect.width < 1 || rowRect.height < 1) continue;
    const itemsRect = items.getBoundingClientRect();
    const lastItem = items.querySelector('.postgame-player-item:last-of-type');
    const anchorRight = (lastItem || items).getBoundingClientRect().right;
    const stat =
      row.querySelector('.scoreboard-row-stat-display-component.INDIVIDUAL_KDA') ||
      statAfterItems(row, anchorRight);
    if (!stat) continue;
    const statRect = stat.getBoundingClientRect();
    const gap = statRect.left - anchorRight;
    let img = row.querySelector(':scope > .blc-row-champ');
    const player = playerForRow(row);
    if (!player?.iconPath) {
      img?.remove();
      continue;
    }
    if (getComputedStyle(row).position === 'static') row.style.position = 'relative';
    if (!img) {
      img = document.createElement('img');
      img.className = 'blc-row-champ';
      img.alt = '';
      row.appendChild(img);
    }
    if (img.getAttribute('src') !== player.iconPath) img.src = player.iconPath;
    const centerX = anchorRight + gap / 2;
    const centerY = (itemsRect.top + itemsRect.bottom + statRect.top + statRect.bottom) / 4;
    img.style.left = `${Math.round(centerX - rowRect.left - size / 2)}px`;
    img.style.top = `${Math.round(centerY - rowRect.top - size / 2)}px`;
    img.style.width = `${size}px`;
    img.style.height = `${size}px`;
    seen.add(img);
  }
  document.querySelectorAll('.blc-row-champ').forEach((el) => {
    if (!seen.has(el)) el.remove();
  });
}

function scoreboardIsShowing() {
  const team = firstTeamContainer();
  if (!team) return false;
  const rect = team.getBoundingClientRect();
  const viewW = window.innerWidth || document.documentElement.clientWidth;
  const viewH = window.innerHeight || document.documentElement.clientHeight;
  if (rect.bottom < 0 || rect.right < 0 || rect.top > viewH || rect.left > viewW) return false;
  const style = getComputedStyle(team);
  if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
  return true;
}

function firstTeamContainer() {
  const nodes = document.querySelectorAll('.scoreboard-team-container');
  let best = null;
  let bestTop = Infinity;
  for (const el of nodes) {
    const rect = el.getBoundingClientRect();
    if (rect.height < 1 || rect.width < 1) continue;
    if (rect.top < bestTop) {
      bestTop = rect.top;
      best = el;
    }
  }
  return best;
}

function clearStretch(room) {
  chatBottomViewport = 0;
  clearHeaderShift();
  if (!room) return;
  room.classList.remove('blc-stretched');
  for (const name of ['--blc-chat-h', '--blc-chat-top', '--blc-chat-left', '--blc-chat-w', '--blc-frame-h']) {
    room.style.removeProperty(name);
  }
}

function setVar(el, name, value) {
  if (el.style.getPropertyValue(name) !== value) el.style.setProperty(name, value);
}

function stretchChat(room) {
  if (!room || windowCollapsed) return;
  const header = playerTeamHeader();
  const anchor = header || firstTeamContainer();
  if (!anchor) return;

  const parent = room.offsetParent instanceof Element ? room.offsetParent : room.parentElement;
  if (!parent) return;
  const parentRect = parent.getBoundingClientRect();

  if (!room.classList.contains('blc-stretched') || !chatBottomViewport) {
    const rect = room.getBoundingClientRect();
    if (rect.height < 1 || rect.width < 1) return;
    chatBottomViewport = rect.bottom;
    setVar(room, '--blc-chat-left', `${Math.round(rect.left - parentRect.left)}px`);
    setVar(room, '--blc-chat-w', `${Math.round(rect.width)}px`);
  }

  const anchorTop = anchor.getBoundingClientRect().top;
  const height = Math.round(chatBottomViewport - anchorTop);
  if (height < 48) return;

  const input = room.querySelector('lol-social-chat-input');
  const inputH = Math.round(input?.getBoundingClientRect().height || 0);
  setVar(room, '--blc-chat-top', `${Math.round(anchorTop - parentRect.top)}px`);
  setVar(room, '--blc-chat-h', `${height}px`);
  setVar(room, '--blc-frame-h', `${Math.max(48, height - inputH)}px`);
  if (!room.classList.contains('blc-stretched')) {
    withFrozenScroll(() => room.classList.add('blc-stretched'));
  }
  if (header) shiftHeadersToChat(room);
  else clearHeaderShift();
}

function playerTeamHeader() {
  const nodes = document.querySelectorAll('.scoreboard-header-component.is-player-team');
  let best = null;
  let bestTop = Infinity;
  for (const el of nodes) {
    const rect = el.getBoundingClientRect();
    if (rect.height < 1 || rect.width < 1) continue;
    if (rect.top < bestTop) {
      bestTop = rect.top;
      best = el;
    }
  }
  return best;
}

function visibleScoreboardHeaders() {
  const headers = [];
  for (const el of document.querySelectorAll('.scoreboard-header-component')) {
    const rect = el.getBoundingClientRect();
    if (rect.height < 1 || rect.width < 1) continue;
    headers.push(el);
  }
  return headers;
}

function clearHeaderShift() {
  document.querySelectorAll('.blc-header-chat-gutter').forEach((el) => el.remove());
  document.querySelectorAll('.scoreboard-header-component.blc-header-shifted').forEach((el) => {
    el.classList.remove('blc-header-shifted');
    el.style.removeProperty('--blc-header-gutter');
  });
  document.querySelectorAll('.scoreboard-header-content').forEach((content) => {
    content.style.removeProperty('width');
    content.style.removeProperty('min-width');
    content.style.removeProperty('max-width');
    content.style.removeProperty('flex');
  });
}

function releaseHeaderContentWidth(header) {
  const content = header.querySelector(':scope > .scoreboard-header-content');
  if (!content) return null;
  content.style.setProperty('width', 'max-content', 'important');
  content.style.setProperty('min-width', '0', 'important');
  content.style.setProperty('max-width', 'none', 'important');
  content.style.setProperty('flex', '0 0 auto', 'important');
  return content;
}

function viewportToCss(el, viewportPx) {
  const width = el.getBoundingClientRect().width;
  const local = el.offsetWidth;
  if (width < 1 || local < 1) return viewportPx;
  return viewportPx * (local / width);
}

function ensureHeaderGutter(header) {
  let gutter = header.querySelector(':scope > .blc-header-chat-gutter');
  if (!gutter) {
    gutter = document.createElement('div');
    gutter.className = 'blc-header-chat-gutter';
    gutter.setAttribute('aria-hidden', 'true');
  }
  if (header.firstElementChild !== gutter) header.insertBefore(gutter, header.firstChild);
  header.classList.add('blc-header-shifted');
  return gutter;
}

function setHeaderGutter(headers, px) {
  const value = `${Math.max(0, Math.round(px))}px`;
  for (const header of headers) {
    const gutter = ensureHeaderGutter(header);
    gutter.style.setProperty('width', value, 'important');
    setVar(header, '--blc-header-gutter', value);
  }
}

function shiftHeadersToChat(room) {
  const headers = visibleScoreboardHeaders();
  const player = headers.find((el) => el.classList.contains('is-player-team'));
  const chatWidth = room?.getBoundingClientRect().width || 0;
  if (!player || chatWidth < 1) {
    clearHeaderShift();
    return;
  }

  for (const header of headers) releaseHeaderContentWidth(header);
  setHeaderGutter(headers, viewportToCss(player, chatWidth));
}

function collapseWindow(room = findPostGameRoom()) {
  if (!room) return;
  windowCollapsed = true;
  clearStretch(room);
  room.classList.add(COLLAPSED_CLASS);
  updateCollapsePlaceholder(room, true);
  withFrozenScroll(() => clearFocusedClass(room));
  room.querySelector('textarea.chat-input, textarea')?.blur?.();
  console.log(LOG, 'toggled off — vanilla unfocused chat');
}

function expandWindow(room = findPostGameRoom()) {
  if (!room) return;
  windowCollapsed = false;
  room.classList.remove(COLLAPSED_CLASS);
  updateCollapsePlaceholder(room, false);
  ensurePlayerMessagesVisible(room);
  withFrozenScroll(() => forceFocusedClass(room));
  console.log(LOG, 'expanded');
}

function toggleFullWindow(room = findPostGameRoom()) {
  if (!room) return;
  if (windowCollapsed || !isChatOpen(room) || room.classList.contains(COLLAPSED_CLASS)) {
    expandWindow(room);
  } else {
    collapseWindow(room);
  }
}

function onToggleIntercept(event) {
  if (!inPostGame) return;
  const room = findPostGameRoom();
  if (!room) return;
  const toggle = event.target?.closest?.(TOGGLE_SEL);
  if (!toggle || !room.contains(toggle)) return;

  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();

  if (event.type === 'pointerdown' && event.button === 0) {
    toggleFullWindow(room);
  }
}

function onInputOpen(event) {
  if (!inPostGame || !windowCollapsed) return;
  if (event.type === 'pointerdown' && event.button !== 0) return;
  const room = findPostGameRoom();
  if (!room || !room.contains(event.target)) return;
  if (event.target.closest?.(TOGGLE_SEL)) return;
  const field = event.target.closest?.(
    'textarea, input.chat-input, lol-social-chat-input, .chat-placeholder-text, .input-sizer',
  );
  if (!field) return;
  expandWindow(room);
}

function onHostPointerDown(event) {
  if (event.target?.closest?.('#blc-options')) return;
  closeOptions();
}

function onOutsidePointerDown(event) {
  if (!inPostGame || !settings.autoOpen || !onScoreboard || windowCollapsed) return;
  const room = findPostGameRoom();
  if (!room) return;
  if (event.target?.closest?.(TOGGLE_SEL)) return;
  if (room.contains(event.target)) return;
  withFrozenScroll(() => forceFocusedClass(room));
}

function onOutsidePointerUp(event) {
  if (!inPostGame || !settings.autoOpen || !onScoreboard || windowCollapsed) return;
  const room = findPostGameRoom();
  if (!room) return;
  if (event.target?.closest?.(TOGGLE_SEL)) return;

  if (!room.contains(event.target)) {
    const restore = () => withFrozenScroll(() => forceFocusedClass(room));
    restore();
    requestAnimationFrame(restore);
    setTimeout(restore, 0);
    setTimeout(restore, 50);
    setTimeout(restore, 150);
  }
}

function onFocusOut(event) {
  if (!inPostGame || !onScoreboard || windowCollapsed) return;
  const room = findPostGameRoom();
  if (!room) return;
  const leaving = event.target;
  if (!room.contains(leaving)) return;
  const next = event.relatedTarget;
  if (next && room.contains(next)) return;
  const panel = document.getElementById('blc-options');
  const inOptions = !!(panel && !panel.hidden && next && panel.contains(next));
  if (!settings.autoOpen && !inOptions) return;
  withFrozenScroll(() => forceFocusedClass(room));
}

function onKeyDown(event) {
  if (event.key === 'Escape') {
    onEscape(event);
    return;
  }
  if (!inPostGame) return;
  if (event.key !== 'Enter') return;
  if (windowCollapsed) {
    expandWindow(findPostGameRoom());
    return;
  }
  scheduleEnsureOpen(0);
}

function optionsAreOpen() {
  const panel = document.getElementById('blc-options');
  return !!panel && !panel.hidden;
}

function foreignTextEntry(room) {
  const active = document.activeElement;
  if (!active || active === document.body || active === document.documentElement) return false;
  if (room?.contains(active)) return false;
  if (active.closest?.('#blc-options')) return false;
  return active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || !!active.isContentEditable;
}

function chatWindowIsFocused(room = findPostGameRoom()) {
  if (!inPostGame || !onScoreboard || windowCollapsed || !room) return false;
  if (room.classList.contains(COLLAPSED_CLASS) || !isChatOpen(room)) return false;
  if (foreignTextEntry(room)) return false;
  return true;
}

function onEscape(event) {
  if (event.key !== 'Escape') return;
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  if (optionsAreOpen()) {
    closeOptions();
    return;
  }
  const room = findPostGameRoom();
  if (!chatWindowIsFocused(room)) return;
  event.preventDefault();
  event.stopPropagation();
  collapseWindow(room);
}

function collapseTipFinished() {
  if (collapseTipDismissed) return true;
  if (collapseTipVisible) return false;
  try {
    return sessionStorage.getItem(COLLAPSE_TIP_KEY) === '1';
  } catch {
    return false;
  }
}

function rememberCollapseTip() {
  try {
    sessionStorage.setItem(COLLAPSE_TIP_KEY, '1');
  } catch {
    /* ignore quota / private mode */
  }
}

function hideCollapseTip() {
  const tip = document.getElementById('blc-collapse-tip');
  if (tip) tip.hidden = true;
  findPostGameRoom()?.querySelector(TOGGLE_SEL)?.removeAttribute('aria-describedby');
}

function dismissCollapseTip() {
  if (!collapseTipVisible) return;
  collapseTipVisible = false;
  collapseTipDismissed = true;
  rememberCollapseTip();
  hideCollapseTip();
}

function ensureCollapseTipElement() {
  let tip = document.getElementById('blc-collapse-tip');
  if (tip) return tip;
  tip = document.createElement('div');
  tip.id = 'blc-collapse-tip';
  tip.className = 'blc-collapse-tip';
  tip.setAttribute('role', 'tooltip');
  tip.textContent = COLLAPSE_TIP_TEXT;
  tip.hidden = true;
  document.body.appendChild(tip);
  return tip;
}

function placeCollapseTip(toggle, tip) {
  tip.hidden = false;
  const rect = toggle.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) {
    tip.hidden = true;
    return false;
  }
  const margin = 8;
  const tipW = tip.offsetWidth;
  const tipH = tip.offsetHeight;
  if (tipW < 1 || tipH < 1) {
    tip.hidden = true;
    return false;
  }
  let left = rect.left + rect.width / 2 - tipW / 2;
  left = Math.max(margin, Math.min(left, window.innerWidth - tipW - margin));
  let top = rect.top - tipH - 10;
  const above = top >= margin;
  if (!above) top = Math.min(window.innerHeight - tipH - margin, rect.bottom + 10);
  tip.classList.toggle('blc-collapse-tip-below', !above);
  tip.style.left = `${Math.round(left)}px`;
  tip.style.top = `${Math.round(top)}px`;
  const arrow = Math.max(12, Math.min(tipW - 12, rect.left + rect.width / 2 - left));
  tip.style.setProperty('--blc-tip-arrow', `${Math.round(arrow)}px`);
  return true;
}

function syncCollapseTip(room) {
  if (collapseTipFinished()) {
    hideCollapseTip();
    return;
  }
  const toggle = room?.querySelector?.(TOGGLE_SEL);
  const ready = !!(
    room &&
    onScoreboard &&
    !windowCollapsed &&
    !room.classList.contains(COLLAPSED_CLASS) &&
    isChatOpen(room) &&
    toggle
  );
  if (!ready) {
    hideCollapseTip();
    return;
  }
  const tip = ensureCollapseTipElement();
  if (!placeCollapseTip(toggle, tip)) return;
  toggle.setAttribute('aria-describedby', tip.id);
  if (!collapseTipVisible) rememberCollapseTip();
  collapseTipVisible = true;
}

function armCollapseTipDismiss(doc) {
  const root = doc?.documentElement;
  if (!root || root.dataset.blcTipHooked) return;
  root.dataset.blcTipHooked = '1';
  doc.addEventListener('pointerdown', dismissCollapseTip, true);
  doc.addEventListener('keydown', dismissCollapseTip, true);
}

function armFrameEscape(doc) {
  const root = doc?.documentElement;
  if (!root || root.dataset.blcEscHooked) return;
  root.dataset.blcEscHooked = '1';
  doc.addEventListener('keydown', onEscape, true);
}

let enhanceTimer = 0;
function scheduleEnhance() {
  if (enhanceTimer) cancelAnimationFrame(enhanceTimer);
  enhanceTimer = requestAnimationFrame(() => {
    enhanceTimer = 0;
    enhance();
  });
}

function enhance() {
  if (!inPostGame || applying) return;
  applying = true;
  try {
    const room = findPostGameRoom();
    if (!room) return;
    chatRoom = room;
    ensurePlayerMessagesVisible(room);
    stripRoomChangedJoinNoise(room);
    hookMessageFrame(room);
    const doc = getFrameDocument(room);
    if (doc) {
      injectFrameStyles(doc);
      insertCredit(doc);
      // Class before name rewrite: Riot IDs still match aliases. groupchat rows
      // often ship with fromSummonerId 0, so the client marks allies as other-team.
      fixTeamClasses(doc);
      rewriteNames(doc);
      rewriteLobbyMessages(doc);
      fixTeamClasses(doc);
      applyTimestamps(doc);
      syncCredit(room);
    }
  } catch (err) {
    console.warn(LOG, err);
  } finally {
    applying = false;
  }
}

function stripRoomChangedJoinNoise(room) {
  const raw = room.getAttribute('room-changed-messages');
  if (!raw) return;
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return;
    const filtered = arr.filter((s) => !JOIN_TEXT.test(String(s)));
    if (filtered.length !== arr.length) {
      room.setAttribute('room-changed-messages', JSON.stringify(filtered));
    }
  } catch {
    /* ignore */
  }
}

function getFrameDocument(room) {
  const iframe = room.querySelector(FRAME_SEL);
  if (!iframe) return null;
  try {
    return iframe.contentDocument || iframe.contentWindow?.document || null;
  } catch (err) {
    console.warn(LOG, 'cannot access messages iframe (cross-origin?)', err);
    return null;
  }
}

function hookMessageFrame(room) {
  const iframe = room.querySelector(FRAME_SEL);
  if (!iframe || iframe.dataset.blcHooked === '1') return;
  iframe.dataset.blcHooked = '1';

  const attach = () => {
    const doc = getFrameDocument(room);
    if (!doc) return;
    armCollapseTipDismiss(doc);
    armFrameEscape(doc);
    if (frameObservers.has(doc)) return;
    const mo = new MutationObserver(() => {
      if (!inPostGame || applying) return;
      scheduleEnhance();
    });
    mo.observe(doc.documentElement || doc.body || doc, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    frameObservers.set(doc, mo);
    injectFrameStyles(doc);
    insertCredit(doc);
  };

  iframe.addEventListener('load', attach);
  attach();
  let tries = 0;
  const poll = setInterval(() => {
    attach();
    const doc = getFrameDocument(room);
    if ((doc && frameObservers.has(doc)) || ++tries > 40) clearInterval(poll);
  }, 250);
}

function scrollParent(el) {
  let node = el?.parentElement;
  const doc = el?.ownerDocument;
  while (node && node !== doc?.documentElement) {
    const style = doc.defaultView?.getComputedStyle(node);
    if (style && /(auto|scroll)/.test(style.overflowY)) return node;
    node = node.parentElement;
  }
  return doc?.scrollingElement || doc?.body || null;
}

function normalizeHex(value, allowShort) {
  const match = String(value || '').trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!match) return null;
  let hex = match[1].toLowerCase();
  if (hex.length === 3) {
    if (!allowShort) return null;
    hex = hex.split('').map((ch) => ch + ch).join('');
  }
  return `#${hex}`;
}

function nameStyleFrom(showSummoner, showChampion) {
  if (showSummoner && showChampion) return 'both';
  if (showSummoner) return 'summoner';
  return 'champion';
}

function applyNameStyle(style, target = settings) {
  const next = style === 'summoner' || style === 'both' || style === 'champion' ? style : 'champion';
  target.nameStyle = next;
  target.showSummonerNames = next === 'summoner' || next === 'both';
  target.showChampionNames = next === 'champion' || next === 'both';
}
function loadSettings() {
  const next = {
    tallerChat: true,
    showSummonerNames: false,
    showChampionNames: true,
    nameStyle: 'champion',
    showChatIcons: true,
    showTimestamps: false,
    coloredBodies: true,
    strongDim: true,
    autoOpen: true,
    colors: { ...COLOR_DEFAULTS },
  };
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
    if (!saved || typeof saved !== 'object') return next;
    for (const [key] of TOGGLES) {
      if (typeof saved[key] === 'boolean') next[key] = saved[key];
    }
    if (typeof saved.coloredBodies === 'boolean') next.coloredBodies = saved.coloredBodies;
    if (typeof saved.showChatIcons === 'boolean') next.showChatIcons = saved.showChatIcons;
    if (saved.nameStyle === 'summoner' || saved.nameStyle === 'champion' || saved.nameStyle === 'both') {
      applyNameStyle(saved.nameStyle, next);
    } else {
      if (typeof saved.showSummonerNames === 'boolean') next.showSummonerNames = saved.showSummonerNames;
      else if (typeof saved.championNames === 'boolean') next.showSummonerNames = !saved.championNames;
      if (typeof saved.showChampionNames === 'boolean') next.showChampionNames = saved.showChampionNames;
      else if (typeof saved.championNames === 'boolean') next.showChampionNames = saved.championNames;
      if (!next.showSummonerNames && !next.showChampionNames) next.showChampionNames = true;
      applyNameStyle(nameStyleFrom(next.showSummonerNames, next.showChampionNames), next);
    }
    if (saved.colors && typeof saved.colors === 'object') {
      for (const key of Object.keys(COLOR_DEFAULTS)) {
        const hex = normalizeHex(saved.colors[key], true);
        if (hex) next.colors[key] = hex;
      }
    }
  } catch {
    /* ignore broken storage */
  }
  return next;
}

function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* ignore quota / private mode */
  }
}

let saveTimer = 0;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = 0;
    saveSettings();
  }, 200);
}

function applyHostSettings() {
  document.documentElement?.classList.toggle('blc-strong-dim', settings.strongDim);
}

function applyFrameSettings(doc) {
  if (!doc?.documentElement) return;
  doc.documentElement.classList.toggle('blc-tint-bodies', settings.coloredBodies);
  for (const [key, varName] of Object.entries(COLOR_VARS)) {
    doc.documentElement.style.setProperty(varName, settings.colors[key]);
  }
}

function commitSettings() {
  saveSettings();
  applyHostSettings();
  const doc = getFrameDocument(chatRoom || findPostGameRoom());
  if (doc) applyFrameSettings(doc);
  scheduleEnhance();
  ensureOpen();
  if (settings.showTimestamps && inPostGame) {
    refreshMessageLog().catch((err) => console.warn(LOG, err));
  }
}

function hasPaint(cs) {
  if (!cs) return false;
  const bg = cs.backgroundImage;
  const mask = cs.maskImage || cs.webkitMaskImage;
  return (bg && bg !== 'none') || (mask && mask !== 'none');
}

function copyPaint(target, cs) {
  target.textContent = '';
  target.style.width = cs.width;
  target.style.height = cs.height;
  for (const prop of PAINT_PROPS) {
    const value = cs[prop];
    if (!value || value === 'none' || value === 'normal') continue;
    target.style[prop] = value;
  }
  const mask = cs.maskImage || cs.webkitMaskImage;
  if (mask && mask !== 'none' && cs.backgroundColor) target.style.backgroundColor = cs.backgroundColor;
  target.dataset.blcPainted = '1';
}

function paintCog(button) {
  if (!button || button.dataset.blcPainted) return;
  const src = document.querySelector('.app-controls-setting');
  const cs = src ? getComputedStyle(src) : null;
  if (!hasPaint(cs)) {
    button.textContent = '⚙';
    return;
  }
  copyPaint(button, cs);
}

function findResetPaint() {
  const nodes = document.querySelectorAll('[class*="reset" i], [class*="refresh" i], [class*="restore" i]');
  for (const el of nodes) {
    if (el.classList.contains('app-controls-setting')) continue;
    const cs = getComputedStyle(el);
    const w = parseFloat(cs.width);
    const h = parseFloat(cs.height);
    if (w < 8 || h < 8 || w > 32 || h > 32) continue;
    if (!hasPaint(cs)) continue;
    return cs;
  }
  return null;
}

function closeOptions() {
  const panel = document.getElementById('blc-options');
  if (!panel || panel.hidden) return;
  panel.hidden = true;
  const cog = getFrameDocument(chatRoom || findPostGameRoom())?.getElementById('blc-options-cog');
  cog?.setAttribute('aria-expanded', 'false');
}

function toggleOptions() {
  const panel = document.getElementById('blc-options');
  const cog = getFrameDocument(chatRoom || findPostGameRoom())?.getElementById('blc-options-cog');
  if (!panel) return;
  const willOpen = panel.hidden;
  panel.hidden = !willOpen;
  cog?.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
  if (willOpen) placeOptionsPanel();
}

function placeOptionsPanel() {
  const panel = document.getElementById('blc-options');
  if (!panel || panel.hidden) return;
  const room = chatRoom || findPostGameRoom();
  const footer = document.querySelector('.postgame-footer');
  if (!room || !footer) return;
  const roomRect = room.getBoundingClientRect();
  const footerTop = footer.getBoundingClientRect().top;
  if (roomRect.width < 1 || footerTop < 1) return;
  panel.style.left = `${Math.round(roomRect.right)}px`;
  panel.style.right = 'auto';
  panel.style.top = 'auto';
  panel.style.bottom = `${Math.round(window.innerHeight - footerTop)}px`;
  panel.style.height = '';
  panel.style.maxHeight = `${Math.round(footerTop)}px`;
}

function hookOptionsDismiss(doc) {
  if (doc.documentElement.dataset.blcOptionsHooked) return;
  doc.documentElement.dataset.blcOptionsHooked = '1';
  doc.addEventListener('pointerdown', (event) => {
    const panel = document.getElementById('blc-options');
    const cog = doc.getElementById('blc-options-cog');
    if (!panel || panel.hidden) return;
    const target = event.target;
    if (cog?.contains(target)) return;
    closeOptions();
  });
  armFrameEscape(doc);
}

function appendHeading(body, doc, text) {
  const heading = doc.createElement('div');
  heading.className = 'blc-options-heading';
  heading.textContent = text;
  body.appendChild(heading);
}

function appendToggle(body, doc, key, text) {
  const row = doc.createElement('label');
  row.className = 'blc-switch';
  const span = doc.createElement('span');
  span.textContent = text;
  const input = doc.createElement('input');
  input.type = 'checkbox';
  input.checked = !!settings[key];
  input.addEventListener('change', () => {
    settings[key] = input.checked;
    if (key === 'coloredBodies') syncMessageColorLock();
    commitSettings();
  });
  const ui = doc.createElement('span');
  ui.className = 'blc-switch-ui';
  ui.setAttribute('aria-hidden', 'true');
  row.append(input, ui, span);
  body.appendChild(row);
}

function appendNameChoices(body, doc) {
  for (const [value, text] of NAME_CHOICES) {
    const row = doc.createElement('label');
    row.className = 'blc-choice';
    const input = doc.createElement('input');
    input.type = 'radio';
    input.name = 'blc-name-style';
    input.value = value;
    input.checked = settings.nameStyle === value;
    input.addEventListener('change', () => {
      if (!input.checked) return;
      applyNameStyle(value);
      commitSettings();
    });
    const span = doc.createElement('span');
    span.textContent = text;
    const mark = doc.createElement('span');
    mark.className = 'blc-choice-ui';
    mark.setAttribute('aria-hidden', 'true');
    row.append(input, mark, span);
    body.appendChild(row);
  }
}

function syncMessageColorLock() {
  const locked = !settings.coloredBodies;
  document.querySelectorAll('.blc-color-row[data-blc-group="Messages"]').forEach((row) => {
    row.classList.toggle('blc-color-disabled', locked);
    row.querySelectorAll('input, button').forEach((el) => {
      el.disabled = locked;
    });
  });
}

function buildColorRow(doc, field, resetPaint) {
  const row = doc.createElement('div');
  row.className = 'blc-color-row';
  row.dataset.blcGroup = field.group;

  const label = doc.createElement('span');
  label.textContent = field.label;

  const picker = doc.createElement('input');
  picker.type = 'color';
  picker.value = settings.colors[field.key];
  picker.setAttribute('aria-label', `${field.group} ${field.label} color`);

  const text = doc.createElement('input');
  text.type = 'text';
  text.spellcheck = false;
  text.maxLength = 7;
  text.value = settings.colors[field.key];
  text.setAttribute('aria-label', `${field.group} ${field.label} hex`);
  text.autocapitalize = 'off';

  const reset = doc.createElement('button');
  reset.type = 'button';
  reset.className = 'blc-color-reset';
  reset.setAttribute('aria-label', field.reset);
  reset.textContent = '↺';
  if (resetPaint) copyPaint(reset, resetPaint);

  const applyHex = (hex, immediate) => {
    picker.value = hex;
    text.value = hex;
    if (settings.colors[field.key] === hex) return;
    settings.colors[field.key] = hex;
    const frame = getFrameDocument(chatRoom || findPostGameRoom());
    if (frame) applyFrameSettings(frame);
    if (immediate) saveSettings();
    else scheduleSave();
  };

  picker.addEventListener('input', () => {
    const hex = normalizeHex(picker.value, false);
    if (hex) applyHex(hex, false);
  });
  // #RGB is valid, but so is the first four characters of a six-digit code. Expand short form on blur.
  text.addEventListener('input', () => {
    const hex = normalizeHex(text.value, false);
    if (hex) applyHex(hex, true);
  });
  text.addEventListener('blur', () => {
    const hex = normalizeHex(text.value, true);
    if (hex) applyHex(hex, true);
    else text.value = settings.colors[field.key];
  });
  reset.addEventListener('click', () => applyHex(COLOR_DEFAULTS[field.key], true));

  row.append(label, picker, text, reset);
  return row;
}

function buildCreditChrome(doc, el) {
  el.replaceChildren();

  const label = doc.createElement('span');
  label.className = 'blc-credit-label';
  label.textContent = CREDIT_TEXT;

  const cog = doc.createElement('button');
  cog.type = 'button';
  cog.id = 'blc-options-cog';
  cog.className = 'blc-options-cog';
  cog.setAttribute('aria-label', 'Options');
  cog.setAttribute('aria-expanded', 'false');
  cog.setAttribute('aria-controls', 'blc-options');
  cog.addEventListener('pointerdown', (event) => {
    event.preventDefault();
  });
  cog.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    toggleOptions();
  });

  el.append(label, cog);
  paintCog(cog);
  hookOptionsDismiss(doc);
  ensureOptionsPanel();
}

function ensureOptionsPanel() {
  const existing = document.getElementById('blc-options');
  if (existing?.dataset.blcChrome === chromeToken) return;
  existing?.remove();

  const panel = document.createElement('div');
  panel.id = 'blc-options';
  panel.className = 'blc-options';
  panel.hidden = true;
  panel.dataset.blcChrome = chromeToken;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'better-lol-chat options');

  const body = document.createElement('div');
  body.className = 'blc-options-body';

  appendHeading(body, document, 'General');
  for (const [key, text] of TOGGLES) appendToggle(body, document, key, text);

  appendHeading(body, document, 'Name style');
  appendNameChoices(body, document);
  appendToggle(body, document, 'showChatIcons', 'Champion icons');
  const resetPaint = findResetPaint();
  for (const field of COLOR_FIELDS) {
    if (field.group !== 'Names') continue;
    body.appendChild(buildColorRow(document, field, resetPaint));
  }

  appendHeading(body, document, 'Message style');
  appendToggle(body, document, 'coloredBodies', 'Colored message bodies');
  for (const field of COLOR_FIELDS) {
    if (field.group !== 'Messages') continue;
    body.appendChild(buildColorRow(document, field, resetPaint));
  }
  syncMessageColorLock();

  const disclaimer = document.createElement('p');
  disclaimer.className = 'blc-options-disclaimer';
  disclaimer.textContent = DISCLAIMER;

  panel.append(body, disclaimer);
  mountUpdateStatus(disclaimer, VERSION);
  panel.addEventListener('pointerdown', (event) => {
    const field = event.target?.closest?.('input[type="text"], input[type="color"], textarea');
    if (field) return;
    event.preventDefault();
  });
  (document.body || document.documentElement).appendChild(panel);
}

function retargetScrollSelector(selector) {
  if (!/scrollbar/i.test(selector)) return null;
  if (/\.messages\b/.test(selector)) return selector.replace(/\.messages\b/g, '.blc-options-body');
  if (/^(html|body|\*)?::-webkit-scrollbar/i.test(selector)) {
    return selector.replace(/^(html|body|\*)?/, '.blc-options-body');
  }
  return null;
}

function collectScrollRules(rules, out) {
  for (const rule of rules) {
    if (rule.cssRules) {
      collectScrollRules(rule.cssRules, out);
      continue;
    }
    if (!rule.selectorText || !rule.style) continue;
    const parts = [];
    let fromMessages = false;
    for (const part of rule.selectorText.split(',')) {
      const trimmed = part.trim();
      const next = retargetScrollSelector(trimmed);
      if (!next) continue;
      if (/\.messages\b/.test(trimmed)) fromMessages = true;
      parts.push(next);
    }
    if (!parts.length || !rule.style.cssText) continue;
    out.push({ text: `${parts.join(', ')} { ${rule.style.cssText} }`, fromMessages });
  }
}

function syncChatScrollbar(frameDoc) {
  const messages = frameDoc.querySelector?.('.messages');
  const body = document.querySelector('#blc-options .blc-options-body');
  if (messages && body) {
    const cs = frameDoc.defaultView?.getComputedStyle(messages);
    if (cs?.scrollbarColor && cs.scrollbarColor !== 'auto') body.style.scrollbarColor = cs.scrollbarColor;
    if (cs?.scrollbarWidth && cs.scrollbarWidth !== 'auto') body.style.scrollbarWidth = cs.scrollbarWidth;
  }

  const found = [];
  for (const sheet of frameDoc.styleSheets || []) {
    try {
      if (sheet.cssRules) collectScrollRules(sheet.cssRules, found);
    } catch {
      /* unreadable stylesheet */
    }
  }
  const fromMessages = found.filter((rule) => rule.fromMessages);
  const rules = fromMessages.length ? fromMessages : found;
  if (!rules.length) return;
  const css = rules.map((rule) => rule.text).join('\n');
  let style = document.getElementById('blc-options-scrollbar');
  if (!style) {
    style = document.createElement('style');
    style.id = 'blc-options-scrollbar';
    (document.head || document.documentElement).appendChild(style);
  }
  if (style.textContent !== css) style.textContent = css;
}

function insertCredit(doc) {
  const host = doc.documentElement || doc.body;
  if (!host) return;
  let el = doc.getElementById('blc-credit');
  if (!el) {
    el = doc.createElement('div');
    el.id = 'blc-credit';
    el.className = 'blc-credit';
  }
  if (el.dataset.blcChrome !== chromeToken) {
    buildCreditChrome(doc, el);
    el.dataset.blcChrome = chromeToken;
  } else paintCog(el.querySelector('.blc-options-cog'));
  if (el.parentElement !== host) host.appendChild(el);
  applyCreditFont(doc, el);
  applyFrameSettings(doc);
  syncChatScrollbar(doc);
  syncCredit(chatRoom);

  const box = doc.querySelector('.message-box');
  const scroller = scrollParent(box || el);
  if (!scroller || scroller === el) return;
  const barH = el.offsetHeight || 22;
  if (!scroller.dataset.blcCreditPad) {
    const base = parseFloat(doc.defaultView?.getComputedStyle(scroller).paddingTop) || 0;
    scroller.dataset.blcCreditPad = String(base);
  }
  const pad = `${(parseFloat(scroller.dataset.blcCreditPad) || 0) + barH}px`;
  if (scroller.style.paddingTop !== pad) scroller.style.paddingTop = pad;
}

function applyCreditFont(doc, el) {
  const sample = doc.querySelector('.chat-message .message, .chat-message, .system-message, .message-name');
  const cs = sample ? doc.defaultView?.getComputedStyle(sample) : null;
  const label = el.querySelector('.blc-credit-label');
  if (label && cs) {
    label.style.fontFamily = cs.fontFamily;
    label.style.fontSize = cs.fontSize;
    label.style.fontStyle = cs.fontStyle;
    label.style.letterSpacing = cs.letterSpacing;
    label.style.lineHeight = cs.lineHeight;
  }
  const panel = document.getElementById('blc-options');
  if (panel && cs) {
    panel.style.fontFamily = cs.fontFamily;
    panel.style.fontStyle = cs.fontStyle;
    panel.style.letterSpacing = cs.letterSpacing;
  }
}

function syncCredit(room = chatRoom) {
  const doc = room ? getFrameDocument(room) : null;
  const el = doc?.getElementById('blc-credit');
  if (!el) return;
  const hidden = !room || windowCollapsed || !isChatOpen(room);
  el.classList.toggle('blc-credit-hidden', hidden);
  if (hidden) closeOptions();
}

function injectFrameStyles(doc) {
  applyFrameSettings(doc);
  let style = doc.getElementById('blc-frame-style');
  if (!style) {
    style = doc.createElement('style');
    style.id = 'blc-frame-style';
    (doc.head || doc.documentElement).appendChild(style);
  }
  if (style.textContent !== frameCss) style.textContent = frameCss;
}

function summonerLabel(originalText) {
  return stripBidi(originalText).replace(/\s+/g, ' ').trim();
}

function significantChildren(el) {
  return [...el.childNodes].filter((node) => !(node.nodeType === 1 && node.classList.contains('blc-time')));
}

function partsMatch(el, parts) {
  const nodes = significantChildren(el);
  if (nodes.length !== parts.length) return false;
  for (let i = 0; i < parts.length; i++) {
    const node = nodes[i];
    const part = parts[i];
    if (part.icon) {
      if (node.nodeType !== 1 || !node.classList.contains('blc-champ-icon')) return false;
      if (node.dataset.blcSrc !== part.icon) return false;
      continue;
    }
    if (part.className) {
      if (node.nodeType !== 1 || !node.classList.contains(part.className)) return false;
      if (node.textContent !== part.text) return false;
      continue;
    }
    if (node.nodeType !== 3 || node.textContent !== part.text) return false;
  }
  return true;
}

function renderParts(doc, parts) {
  return parts.map((part) => {
    if (part.icon) {
      const img = doc.createElement('img');
      img.className = 'blc-champ-icon';
      img.alt = '';
      img.draggable = false;
      img.dataset.blcSrc = part.icon;
      img.src = part.icon;
      return img;
    }
    if (part.className) {
      const span = doc.createElement('span');
      span.className = part.className;
      span.textContent = part.text;
      return span;
    }
    return doc.createTextNode(part.text);
  });
}

function paintParts(el, parts) {
  if (partsMatch(el, parts)) return;
  const time = el.querySelector(':scope > .blc-time');
  el.replaceChildren(...(time ? [time] : []), ...renderParts(el.ownerDocument, parts));
}

function iconPart(player) {
  return settings.showChatIcons && player?.iconPath ? { icon: player.iconPath } : null;
}

function paintChatName(el, original, player) {
  const parts = [];
  const icon = iconPart(player);
  if (icon) parts.push(icon);
  if (!settings.showChampionNames || !player?.championName) {
    parts.push({ text: original });
  } else if (!settings.showSummonerNames) {
    parts.push({ text: championLabel(player, roster) });
  } else {
    parts.push({ text: summonerLabel(original) });
    parts.push({ className: 'blc-secondary-name', text: `(${player.championName})` });
  }
  paintParts(el, parts);
}

function rewriteNames(root) {
  const nameNodes = root.querySelectorAll?.('.message-box .message-name') || [];
  for (const el of nameNodes) {
    if (el.closest?.('.system-message')) continue;
    let original = el.dataset.blcOriginal;
    let player = null;
    if (original != null) {
      player = resolvePlayer(stripBidi(original).trim());
    } else if (nameIndex.length) {
      const match = matchAlias(stripBidi(el.textContent || '').trim());
      if (!match) continue;
      original = el.textContent;
      el.dataset.blcOriginal = original;
      player = match.player;
    } else {
      continue;
    }
    paintChatName(el, original, player);
  }
}

const LEAVE_TEXT = /^(.*?)\s+(left(?:\s+the)?\s+(?:room|lobby))\s*$/i;

function fixTeamClasses(root) {
  if (!roster.length && !nameIndex.length) return;

  const boxes = root.querySelectorAll?.('.message-box') || [];
  for (const box of boxes) {
    if (box.classList.contains('mine')) continue;
    if (box.querySelector?.('.celebration')) continue;

    const player = speakerForBox(box);
    if (!player) continue;

    const want = player.ally ? 'my-team' : 'other-team';
    const drop = player.ally ? 'other-team' : 'my-team';
    if (box.classList.contains(want) && !box.classList.contains(drop)) continue;
    box.classList.remove(drop);
    box.classList.add(want);
  }
}

function speakerForBox(box) {
  const nameEl = box.querySelector?.('.chat-message .message-name');
  if (nameEl) {
    const source = nameEl.dataset.blcOriginal ?? nameEl.textContent;
    return resolvePlayer(stripBidi(source || '').trim());
  }

  const span = box.querySelector?.('.system-message span');
  if (!span) return null;

  if (span.dataset?.blcOriginal) {
    const stored = stripBidi(span.dataset.blcOriginal).replace(/\s+/g, ' ').trim();
    const storedLeave = stored.match(LEAVE_TEXT);
    if (storedLeave) return resolvePlayer(storedLeave[1].trim());
    const storedJoin = stored.match(/^(.*?)\s+joined(?:\s+the)?\s+(?:room|lobby)\s*$/i);
    if (storedJoin) return resolvePlayer(storedJoin[1].trim());
  }

  const champEl = span.querySelector?.('.blc-system-name');
  if (champEl) {
    const fromChamp = resolvePlayer(stripBidi(champEl.textContent || '').trim());
    if (fromChamp) return fromChamp;
  }

  const text = stripBidi(span.textContent || '').replace(/\s+/g, ' ').trim();
  const leave = text.match(LEAVE_TEXT);
  if (leave) return resolvePlayer(leave[1].trim());

  const join = text.match(/^(.*?)\s+joined(?:\s+the)?\s+(?:room|lobby)\s*$/i);
  if (join) return resolvePlayer(join[1].trim());

  return null;
}

function resolvePlayer(text) {
  const trimmed = stripBidi(text).trim();
  if (!trimmed) return null;

  const byAlias = matchAlias(trimmed);
  if (byAlias) return byAlias.player;

  const lower = trimmed.toLowerCase();
  let hit = null;
  for (const player of roster) {
    if (!player.championName || player.championName.toLowerCase() !== lower) continue;
    if (hit && hit !== player) return null;
    hit = player;
  }
  return hit;
}

function paintLeaveName(span, original, player, verb, summonerName) {
  const parts = [];
  const icon = iconPart(player);
  if (icon) parts.push(icon);
  if (!settings.showChampionNames || !player?.championName) {
    parts.push({ text: original });
    paintParts(span, parts);
    return;
  }
  if (!settings.showSummonerNames) {
    parts.push({ className: 'blc-system-name', text: championLabel(player, roster) });
  } else {
    parts.push({ className: 'blc-system-name', text: summonerLabel(summonerName) });
    parts.push({ className: 'blc-secondary-name', text: `(${player.championName})` });
  }
  parts.push({ text: ` ${verb}` });
  paintParts(span, parts);
}

function rewriteLobbyMessages(root) {
  const spans = root.querySelectorAll?.('.system-message span') || [];
  for (const span of spans) {
    if (
      span.classList.contains('blc-system-name') ||
      span.classList.contains('blc-secondary-name') ||
      span.classList.contains('blc-summoner-name')
    ) {
      continue;
    }
    const box = span.closest('.message-box');
    const text = stripBidi(span.textContent || '').replace(/\s+/g, ' ').trim();
    if (JOIN_TEXT.test(text)) {
      box?.classList.add('blc-hide-join');
      continue;
    }

    let original = span.dataset.blcOriginal;
    let player = null;
    let verb = '';
    let summonerName = '';
    if (original != null) {
      const stored = stripBidi(original).replace(/\s+/g, ' ').trim();
      const storedLeave = stored.match(LEAVE_TEXT);
      if (!storedLeave) continue;
      verb = storedLeave[2];
      summonerName = storedLeave[1].trim();
      player = resolvePlayer(summonerName);
    } else {
      const leave = text.match(LEAVE_TEXT);
      if (!leave) continue;
      player = resolvePlayer(leave[1].trim());
      if (!player) continue;
      original = span.textContent;
      span.dataset.blcOriginal = original;
      verb = leave[2];
      summonerName = leave[1].trim();
    }
    box?.classList.remove('blc-hide-join');
    paintLeaveName(span, original, player, verb, summonerName);
  }
}

function chatBodyText(box) {
  const nodes = box.querySelectorAll('.chat-message > span.message');
  if (nodes.length >= 2) return nodes[nodes.length - 1].textContent ?? '';
  if (nodes.length === 1 && stripBidi(nodes[0].textContent).trim() !== ':') return nodes[0].textContent ?? '';
  return '';
}

function paintTime(el, time) {
  const existing = [...el.children].find((node) => node.classList.contains('blc-time'));
  if (!settings.showTimestamps || !time) {
    existing?.remove();
    return;
  }
  if (existing?.textContent === time) {
    if (el.firstChild !== existing) el.insertBefore(existing, el.firstChild);
    return;
  }
  const span = existing || el.ownerDocument.createElement('span');
  span.className = 'blc-time';
  span.textContent = time;
  if (el.firstChild !== span) el.insertBefore(span, el.firstChild);
}

function applyTimestamps(doc) {
  const boxes = doc.querySelectorAll?.('.message-box') || [];
  const used = new Set();
  for (const box of boxes) {
    if (box.classList.contains('blc-sample')) continue;
    const chat = box.querySelector('.chat-message');
    if (chat && !box.querySelector('.system-message')) {
      const nameEl = chat.querySelector('.message-name');
      const source = nameEl?.dataset.blcOriginal ?? nameEl?.textContent;
      const player = resolvePlayer(stripBidi(source || '').trim());
      const time = settings.showTimestamps
        ? takeChatStamp(messageLog, used, chatBodyText(box), player?.puuid)
        : '';
      paintTime(chat, time);
      continue;
    }
    const span = box.querySelector('.system-message > span');
    if (!span || span.classList.contains('celebration')) continue;
    const stored = stripBidi(span.dataset.blcOriginal || span.textContent || '').replace(/\s+/g, ' ').trim();
    const isLeave = LEAVE_TEXT.test(stored) || !!span.querySelector('.blc-system-name');
    if (!isLeave) {
      paintTime(span, '');
      continue;
    }
    const time = settings.showTimestamps ? takeLeaveStamp(messageLog, used, speakerForBox(box)) : '';
    paintTime(span, time);
  }
}

function stripBidi(s) {
  return String(s || '').replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '');
}

function matchAlias(text) {
  const trimmed = stripBidi(text).trim();
  for (const entry of nameIndex) {
    if (trimmed === entry.name) return entry;
    if (trimmed.toLowerCase() === entry.name.toLowerCase()) return entry;
    const beforeHash = trimmed.split('#')[0].trim();
    const entryBeforeHash = entry.name.split('#')[0].trim();
    if (beforeHash && beforeHash.toLowerCase() === entryBeforeHash.toLowerCase()) {
      return entry;
    }
    if (
      trimmed.startsWith(entry.name) &&
      /[:：]/.test(trimmed.slice(entry.name.length, entry.name.length + 2))
    ) {
      return entry;
    }
    if (trimmed.startsWith(entry.name + ' ') && JOIN_TEXT.test(trimmed)) return null;
  }
  return null;
}
