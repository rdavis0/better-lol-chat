import './style.css';
import frameCss from './frame.css?raw';
import { settings, applyFrameSettings } from './settings.js';
import {
  initOptions,
  closeOptions,
  optionsAreOpen,
  placeOptionsPanel,
  attachCreditChrome,
  syncOptionsScrollbar,
} from './options.js';
import { refreshIdentities, clearRoster, players } from './roster.js';
import { rewriteMessages, matchAlias, stripBidi, isJoinNotice } from './messages.js';

const LOG = '[better-lol-chat]';
const VERSION = '0.3';
const CREDIT_TEXT = `better-lol-chat by wryguy`;
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
let focusWatchRoom = null;
let focusWatchBox = null;
let chatBottomViewport = 0;
let onScoreboard = false;
let wasOnScoreboard = false;
const frameObservers = new WeakMap();

initOptions({
  version: VERSION,
  creditText: CREDIT_TEXT,
  getRoom: () => chatRoom || findPostGameRoom(),
  getFrameDocument,
  onCommit() {
    scheduleEnhance();
    ensureOpen();
  },
  armFrameEscape,
});

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
    clearRoster();
    if (focusClassObserver) {
      focusClassObserver.disconnect();
      focusClassObserver = null;
    }
    focusWatchRoom = null;
    focusWatchBox = null;
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

function findPostGameRoom() {
  return document.querySelector(ROOM_SEL);
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
  const box = getChatBox(room);
  if (focusClassObserver && focusWatchRoom === room && focusWatchBox === box) return;
  if (focusClassObserver) focusClassObserver.disconnect();
  focusWatchRoom = room;
  focusWatchBox = box;
  const targets = box && box !== room ? [room, box] : [room];
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

  if (onScoreboard) {
    if (windowCollapsed) {
      clearStretch(room);
      room.classList.add(COLLAPSED_CLASS);
      updateCollapsePlaceholder(room, true);
      withFrozenScroll(() => clearFocusedClass(room));
    } else if (!settings.autoOpen && !isChatOpen(room)) {
      clearStretch(room);
    } else {
      room.classList.remove(COLLAPSED_CLASS);
      updateCollapsePlaceholder(room, false);
      if (settings.autoOpen) withFrozenScroll(() => forceFocusedClass(room));
      if (settings.tallerChat) stretchChat(room);
      else clearStretch(room);
      placeOptionsPanel();
    }
    placeScoreboardIcons();
  } else {
    clearScoreboardIcons();
  }
  syncCredit(room);
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
  return players().find((p) => p.championName && p.championName.toLowerCase() === champ && p.iconPath) || null;
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
  if (!onScoreboard || !players().length) {
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

function topmostVisible(selector) {
  let best = null;
  let bestTop = Infinity;
  for (const el of document.querySelectorAll(selector)) {
    const rect = el.getBoundingClientRect();
    if (rect.height < 1 || rect.width < 1) continue;
    if (rect.top < bestTop) {
      bestTop = rect.top;
      best = el;
    }
  }
  return best;
}

function firstTeamContainer() {
  return topmostVisible('.scoreboard-team-container');
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
  return topmostVisible('.scoreboard-header-component.is-player-team');
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
  if (!content) return;
  // Inline !important beats Riot's fixed 500px header width.
  content.style.setProperty('width', 'max-content', 'important');
  content.style.setProperty('min-width', '0', 'important');
  content.style.setProperty('max-width', 'none', 'important');
  content.style.setProperty('flex', '0 0 auto', 'important');
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
  }
}

function shiftHeadersToChat(room) {
  const headers = visibleScoreboardHeaders();
  const player = headers.find((el) => el.classList.contains('is-player-team'));
  const chatRight = room?.getBoundingClientRect().right || 0;
  if (!player || chatRight < 1) {
    clearHeaderShift();
    return;
  }

  for (const header of headers) releaseHeaderContentWidth(header);
  const gutter = ensureHeaderGutter(player);
  const span = chatRight - gutter.getBoundingClientRect().left;
  if (span < 1) {
    clearHeaderShift();
    return;
  }
  setHeaderGutter(headers, viewportToCss(player, span));
}

function collapseWindow(room = findPostGameRoom()) {
  if (!room) return;
  windowCollapsed = true;
  clearStretch(room);
  room.classList.add(COLLAPSED_CLASS);
  updateCollapsePlaceholder(room, true);
  withFrozenScroll(() => clearFocusedClass(room));
  room.querySelector('textarea.chat-input, textarea')?.blur?.();
  console.log(LOG, 'toggled off â vanilla unfocused chat');
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
      rewriteMessages(doc);
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
    const filtered = arr.filter((s) => !isJoinNotice(String(s)));
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

function insertCredit(doc) {
  applyFrameSettings(doc);
  const host = doc.documentElement || doc.body;
  if (!host) return;
  let el = doc.getElementById('blc-credit');
  if (!el) {
    el = doc.createElement('div');
    el.id = 'blc-credit';
    el.className = 'blc-credit';
  }
  attachCreditChrome(doc, el);
  if (el.parentElement !== host) host.appendChild(el);
  applyCreditFont(doc, el);
  syncOptionsScrollbar(doc);
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
  let style = doc.getElementById('blc-frame-style');
  if (!style) {
    style = doc.createElement('style');
    style.id = 'blc-frame-style';
    (doc.head || doc.documentElement).appendChild(style);
  }
  if (style.textContent !== frameCss) style.textContent = frameCss;
}
