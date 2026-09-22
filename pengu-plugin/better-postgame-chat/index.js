import './style.css';
import frameCss from './frame.css?raw';

const LOG = '[better-postgame-chat]';
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
const frameObservers = new WeakMap();

const byPuuid = new Map();
const bySummonerId = new Map();
let nameIndex = [];

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
}

function onPhase(phase) {
  const next = POSTGAME_PHASES.has(String(phase || ''));
  if (next === inPostGame && next) return;
  inPostGame = next;
  if (!inPostGame) {
    windowCollapsed = false;
    chatRoom = null;
    byPuuid.clear();
    bySummonerId.clear();
    nameIndex = [];
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
  for (const c of champs || []) {
    if (c && c.id != null) champNames.set(Number(c.id), c.name || c.alias);
  }

  const players = collectPlayers(eog, me, champNames);
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

function collectPlayers(eog, me, champNames) {
  if (!eog) return [];
  const myPuuid = me?.puuid;
  const mySummonerId = me?.summonerId;
  const list = [];

  const push = (raw, allyHint, teamId) => {
    if (!raw) return;
    const championName =
      champNames.get(Number(raw.championId)) ||
      raw.championName ||
      (raw.skinName ? String(raw.skinName) : null) ||
      'Unknown';
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
    if (!inPostGame) return;
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
  if (!room) return;
  chatRoom = room;
  watchFocusClass(room);
  ensurePlayerMessagesVisible(room);

  if (windowCollapsed) {
    room.classList.add(COLLAPSED_CLASS);
    updateCollapsePlaceholder(room, true);
    withFrozenScroll(() => clearFocusedClass(room));
    return;
  }

  room.classList.remove(COLLAPSED_CLASS);
  updateCollapsePlaceholder(room, false);
  withFrozenScroll(() => forceFocusedClass(room));
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

function collapseWindow(room = findPostGameRoom()) {
  if (!room) return;
  windowCollapsed = true;
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
  if (!inPostGame || windowCollapsed) return;
  const room = findPostGameRoom();
  if (!room) return;
  if (event.target?.closest?.(TOGGLE_SEL)) return;
  if (room.contains(event.target)) return;
  withFrozenScroll(() => forceFocusedClass(room));
}

function onOutsidePointerUp(event) {
  if (!inPostGame || windowCollapsed) return;
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
  if (!inPostGame || windowCollapsed) return;
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
      rewriteNames(doc);
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
