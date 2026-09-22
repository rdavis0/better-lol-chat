import './style.css';
import frameCss from './frame.css?raw';

const LOG = '[better-postgame-chat]';
const CREDIT_TEXT = 'better-lol-chat by wryguy';
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
    if (inPostGame) ensureOpen();
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
    clearScoreboardIcons();
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
  const [me, eog, champs, conversations] = await Promise.all([
    lcu('/lol-summoner/v1/current-summoner'),
    lcu('/lol-end-of-game/v1/eog-stats-block'),
    lcu('/lol-game-data/assets/v1/champion-summary.json'),
    lcu('/lol-chat/v1/conversations'),
  ]);

  const champNames = new Map();
  const champIcons = new Map();
  for (const c of champs || []) {
    if (!c || c.id == null) continue;
    const id = Number(c.id);
    champNames.set(id, c.name || c.alias);
    if (c.squarePortraitPath) champIcons.set(id, c.squarePortraitPath);
  }

  const players = collectPlayers(eog, me, champNames, champIcons);
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
  const postGameConversationId = postGame?.id || postGame?.pid || null;

  if (postGameConversationId) {
    const messages = await lcu(
      `/lol-chat/v1/conversations/${encodeURIComponent(postGameConversationId)}/messages`,
    );
    applyJoinRoomMapping(messages || []);
  }

  aliases.sort((a, b) => b.name.length - a.name.length);
  nameIndex = aliases;
  console.log(LOG, 'mapped', players.length, 'players', { conversation: postGameConversationId });
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
    return;
  }

  if (windowCollapsed) {
    clearStretch(room);
    room.classList.add(COLLAPSED_CLASS);
    updateCollapsePlaceholder(room, true);
    withFrozenScroll(() => clearFocusedClass(room));
    syncCredit(room);
    placeScoreboardIcons();
    return;
  }

  room.classList.remove(COLLAPSED_CLASS);
  updateCollapsePlaceholder(room, false);
  withFrozenScroll(() => forceFocusedClass(room));
  stretchChat(room);
  syncCredit(room);
  placeScoreboardIcons();
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
  return roster.find((p) => p.championName && p.championName.toLowerCase() === champ && p.iconPath) || null;
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
  const team = firstTeamContainer();
  if (!team) return;

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

  const teamTop = team.getBoundingClientRect().top;
  const height = Math.round(chatBottomViewport - teamTop);
  if (height < 48) return;

  const input = room.querySelector('lol-social-chat-input');
  const inputH = Math.round(input?.getBoundingClientRect().height || 0);
  setVar(room, '--blc-chat-top', `${Math.round(teamTop - parentRect.top)}px`);
  setVar(room, '--blc-chat-h', `${height}px`);
  setVar(room, '--blc-frame-h', `${Math.max(48, height - inputH)}px`);
  if (!room.classList.contains('blc-stretched')) {
    withFrozenScroll(() => room.classList.add('blc-stretched'));
  }
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

function onOutsidePointerDown(event) {
  if (!inPostGame || !onScoreboard || windowCollapsed) return;
  const room = findPostGameRoom();
  if (!room) return;
  if (event.target?.closest?.(TOGGLE_SEL)) return;
  if (room.contains(event.target)) return;
  withFrozenScroll(() => forceFocusedClass(room));
}

function onOutsidePointerUp(event) {
  if (!inPostGame || !onScoreboard || windowCollapsed) return;
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
  withFrozenScroll(() => forceFocusedClass(room));
}

function onKeyDown(event) {
  if (!inPostGame) return;
  if (event.key !== 'Enter') return;
  if (windowCollapsed) {
    expandWindow(findPostGameRoom());
    return;
  }
  scheduleEnsureOpen(0);
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
      rewriteNames(doc);
      rewriteLobbyMessages(doc);
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
    if (!doc || frameObservers.has(doc)) return;
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

function insertCredit(doc) {
  const host = doc.documentElement || doc.body;
  if (!host) return;
  let el = doc.getElementById('blc-credit');
  if (!el) {
    el = doc.createElement('div');
    el.id = 'blc-credit';
    el.className = 'blc-credit';
    el.textContent = CREDIT_TEXT;
  }
  if (el.parentElement !== host) host.appendChild(el);
  applyCreditFont(doc, el);
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
  if (!sample) return;
  const cs = doc.defaultView?.getComputedStyle(sample);
  if (!cs) return;
  el.style.fontFamily = cs.fontFamily;
  el.style.fontSize = cs.fontSize;
  el.style.fontStyle = cs.fontStyle;
  el.style.letterSpacing = cs.letterSpacing;
  el.style.lineHeight = cs.lineHeight;
}

function syncCredit(room = chatRoom) {
  const doc = room ? getFrameDocument(room) : null;
  const el = doc?.getElementById('blc-credit');
  if (!el) return;
  const hidden = !room || windowCollapsed || !isChatOpen(room);
  el.classList.toggle('blc-credit-hidden', hidden);
}

function injectFrameStyles(doc) {
  if (doc.getElementById('blc-frame-style')) return;
  const style = doc.createElement('style');
  style.id = 'blc-frame-style';
  style.textContent = frameCss;
  (doc.head || doc.documentElement).appendChild(style);
}

function rewriteNames(root) {
  if (!nameIndex.length) return;

  const nameNodes = root.querySelectorAll?.('.message-box .message-name') || [];
  for (const el of nameNodes) {
    if (el.closest?.('.system-message')) continue;
    const text = stripBidi(el.textContent || '').trim();
    const match = matchAlias(text);
    if (!match) continue;
    el.textContent = match.player.championName;
  }
}

const LEAVE_TEXT = /^(.*?)\s+(left(?:\s+the)?\s+(?:room|lobby))\s*$/i;

function rewriteLobbyMessages(root) {
  const spans = root.querySelectorAll?.('.system-message span') || [];
  for (const span of spans) {
    const box = span.closest('.message-box');
    const text = stripBidi(span.textContent || '').replace(/\s+/g, ' ').trim();
    if (JOIN_TEXT.test(text)) {
      box?.classList.add('blc-hide-join');
      continue;
    }
    const leave = text.match(LEAVE_TEXT);
    if (!leave) continue;
    box?.classList.remove('blc-hide-join');
    const entry = matchAlias(leave[1].trim());
    if (!entry) continue;
    const champ = entry.player.championName;
    const nameEl = span.querySelector('.blc-system-name');
    if (nameEl?.textContent === champ) continue;
    const doc = span.ownerDocument;
    const name = doc.createElement('span');
    name.className = 'blc-system-name';
    name.textContent = champ;
    span.replaceChildren(name, doc.createTextNode(` ${leave[2]}`));
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
