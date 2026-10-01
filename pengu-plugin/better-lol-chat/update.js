const RELEASES_URL = 'https://api.github.com/repos/rdavis0/better-lol-chat/releases/latest';
const INSTALL_URL = 'https://github.com/rdavis0/better-lol-chat/releases/latest/download/install.bat';
const STYLE_ID = 'blc-update-style';

const STYLE = `
.blc-update {
  flex: 0 0 auto;
  margin: 0;
  padding: 8px;
  border-top: 1px solid #3a2a08;
  font-size: 11px;
  font-weight: 400;
  line-height: 1.35;
  letter-spacing: 0;
  color: #d5d0c4;
  text-align: left;
}
.blc-update-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.blc-update-ver {
  color: var(--blc-credit, #ffd700);
  font-weight: 700;
}
.blc-update-check,
.blc-update-link {
  appearance: none;
  border: 0;
  margin: 0;
  padding: 0;
  background: transparent;
  color: var(--blc-name-ally, #16cae5);
  font: inherit;
  font-weight: 700;
  cursor: pointer;
  text-decoration: underline;
}
.blc-update-check:disabled {
  cursor: default;
  opacity: 0.6;
}
.blc-update-status {
  margin: 2px 0 0;
}
.blc-update-link {
  display: inline-block;
  margin-top: 2px;
}
.blc-update-link[hidden] {
  display: none;
}
`;

let cached = null;
let pending = null;

function compareVersions(a, b) {
  const pa = numericParts(a);
  const pb = numericParts(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

export function mountUpdateStatus(disclaimer, version) {
  const doc = disclaimer?.ownerDocument;
  if (!doc || !disclaimer.parentNode || doc.getElementById('blc-update')) return;
  ensureStyle(doc);
  const current = normalizeVersion(version) || String(version || '').trim();
  const row = createUpdateRow(doc, current);
  disclaimer.parentNode.insertBefore(row, disclaimer);
  armFirstCheck(row);
}

function createUpdateRow(doc, version) {
  const root = doc.createElement('div');
  root.id = 'blc-update';
  root.className = 'blc-update';

  const row = doc.createElement('div');
  row.className = 'blc-update-row';

  const ver = doc.createElement('span');
  ver.className = 'blc-update-ver';
  ver.textContent = version ? `v${version.replace(/^v/i, '')}` : 'better-lol-chat';

  const check = doc.createElement('button');
  check.type = 'button';
  check.className = 'blc-update-check';
  check.textContent = 'Check';

  const status = doc.createElement('p');
  status.className = 'blc-update-status';
  status.setAttribute('aria-live', 'polite');

  const link = doc.createElement('a');
  link.className = 'blc-update-link';
  link.hidden = true;
  link.target = '_blank';
  link.rel = 'noreferrer';
  link.textContent = 'Download';

  row.append(ver, check);
  root.append(row, status, link);

  const paint = (next) => {
    status.textContent = next.status;
    check.disabled = next.pending;
    if (next.url) {
      link.hidden = false;
      link.href = next.url;
    } else {
      link.hidden = true;
      link.removeAttribute('href');
    }
  };

  let checkGen = 0;
  const run = (force) => {
    const gen = ++checkGen;
    const started = Date.now();
    paint({ status: 'Checking…', pending: true, url: '' });
    const finish = (next) => {
      const wait = Math.max(0, 1000 - (Date.now() - started));
      setTimeout(() => {
        if (gen !== checkGen || !root.isConnected) return;
        paint(next);
      }, wait);
    };
    checkForUpdate(version, { force })
      .then((next) => {
        finish({ status: next.status, pending: false, url: next.url });
      })
      .catch(() => {
        finish({ status: "Couldn't check for updates", pending: false, url: '' });
      });
  };

  check.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    run(true);
  });

  link.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!link.href) return;
    if (!openDownload()) status.textContent = INSTALL_URL;
  });

  if (cached) {
    paint({ status: cached.status, pending: false, url: cached.url });
    return root;
  }
  root._blcRunCheck = () => run(false);

  return root;
}

function armFirstCheck(row) {
  if (!row._blcRunCheck) return;
  const panel = row.closest('#blc-options');
  const start = () => {
    row._blcRunCheck?.();
    delete row._blcRunCheck;
  };
  if (!panel || !panel.hidden) {
    start();
    return;
  }
  const observer = new MutationObserver(() => {
    if (panel.hidden) return;
    observer.disconnect();
    start();
  });
  observer.observe(panel, { attributes: true, attributeFilter: ['hidden'] });
}

function checkForUpdate(version, { force = false } = {}) {
  if (!force && cached) return Promise.resolve(cached);
  if (pending) return pending;
  pending = fetchRelease()
    .then((release) => {
      cached = describeRelease(version, release);
      return cached;
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}

async function fetchRelease() {
  const signal = typeof AbortSignal !== 'undefined' && AbortSignal.timeout
    ? AbortSignal.timeout(8000)
    : undefined;
  const res = await fetch(RELEASES_URL, {
    headers: { Accept: 'application/vnd.github+json' },
    signal,
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`release check failed (${res.status})`);
  return res.json();
}

function describeRelease(version, release) {
  if (!release) {
    return { status: 'No release published yet', url: '' };
  }
  const latest = normalizeVersion(release.tag_name);
  if (!latest) {
    return { status: "Couldn't check for updates", url: '' };
  }
  const current = normalizeVersion(version);
  const order = current ? compareVersions(latest, current) : 1;
  if (order > 0) {
    return { status: `Update available: v${latest}`, url: INSTALL_URL, latest };
  }
  if (order < 0) {
    return { status: `Ahead of the latest release (v${latest})`, url: '' };
  }
  return { status: 'Up to date', url: '' };
}

function openDownload() {
  const opened = window.open(INSTALL_URL, '_blank', 'noopener');
  return Boolean(opened);
}

let noticeDoc = null;
let noticeStarted = false;

export function mountUpdateNotice(doc, version) {
  noticeDoc = doc;
  if (cached) {
    paintNotice();
    return;
  }
  if (noticeStarted) return;
  noticeStarted = true;
  checkForUpdate(version)
    .then(() => paintNotice())
    .catch(() => {
      noticeStarted = false;
    });
}

function paintNotice() {
  const doc = noticeDoc;
  if (!doc?.querySelector) return;
  if (cached?.url) placeNotice(doc, cached);
  else if (cached) removeNotice(doc);
}

function removeNotice(doc) {
  doc.querySelectorAll('.blc-update-note').forEach((el) => el.remove());
}

function placeNotice(doc, info) {
  const list = doc.querySelector('.messages');
  if (!list) return;
  let note = null;
  for (const child of list.children) {
    if (child.classList?.contains('blc-update-note')) {
      note = child;
      break;
    }
  }
  if (!note) note = buildNotice(doc, info);
  else fillNotice(note, info);
  if (list.firstElementChild === note) return;
  const scroller = messageScroller(list);
  const prevTop = scroller ? scroller.scrollTop : 0;
  const prevHeight = scroller ? scroller.scrollHeight : 0;
  list.insertBefore(note, list.firstElementChild);
  if (!scroller || prevTop <= 0) return;
  const grown = scroller.scrollHeight - prevHeight;
  if (grown > 0) scroller.scrollTop = prevTop + grown;
}

function buildNotice(doc, info) {
  const box = doc.createElement('div');
  box.className = 'message-box blc-update-note';
  box.setAttribute('role', 'link');

  const chat = doc.createElement('div');
  chat.className = 'chat-message';

  const name = doc.createElement('div');
  name.className = 'message-name';
  name.textContent = 'better-lol-chat';

  const colon = doc.createElement('span');
  colon.className = 'message';
  colon.textContent = ':';

  const body = doc.createElement('span');
  body.className = 'message blc-update-body';

  chat.append(name, doc.createTextNode(' '), colon, doc.createTextNode(' '), body);
  box.appendChild(chat);
  box.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!openDownload()) body.textContent = INSTALL_URL;
  });
  fillNotice(box, info);
  return box;
}

function fillNotice(box, info) {
  const latest = String(info.latest || '').replace(/^v/i, '');
  const label = latest
    ? `v${latest} is available. Click to download.`
    : 'An update is available. Click to download.';
  const body = box.querySelector('.blc-update-body');
  if (!body || body.textContent === INSTALL_URL || body.textContent === label) return;
  body.textContent = label;
}

function messageScroller(list) {
  const doc = list.ownerDocument;
  let node = list;
  while (node && node !== doc.documentElement) {
    const style = doc.defaultView?.getComputedStyle(node);
    if (style && /(auto|scroll)/.test(style.overflowY)) return node;
    node = node.parentElement;
  }
  return doc.scrollingElement || null;
}

function normalizeVersion(value) {
  const raw = String(value || '').trim().replace(/^v/i, '');
  const match = raw.match(/^(\d+(?:\.\d+){0,3})/);
  return match ? match[1] : '';
}

function numericParts(value) {
  return normalizeVersion(value).split('.').filter(Boolean).map((part) => parseInt(part, 10) || 0);
}

function ensureStyle(doc) {
  const parent = doc.head || doc.documentElement;
  if (!parent || doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = STYLE;
  parent.appendChild(style);
}
