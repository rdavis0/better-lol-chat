const RELEASES_URL = 'https://api.github.com/repos/rdavis0/better-lol-chat/releases/latest';
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
  link.textContent = 'View release';

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
    const opened = window.open(link.href, '_blank', 'noopener');
    if (!opened) status.textContent = link.href;
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
  const url = safeReleaseUrl(release.html_url);
  if (!latest) {
    return { status: "Couldn't check for updates", url: '' };
  }
  const current = normalizeVersion(version);
  const order = current ? compareVersions(latest, current) : 1;
  if (order > 0) {
    return { status: `Update available: v${latest}`, url };
  }
  if (order < 0) {
    return { status: `Ahead of the latest release (v${latest})`, url: '' };
  }
  return { status: 'Up to date', url: '' };
}

function safeReleaseUrl(value) {
  try {
    const parsed = new URL(String(value || ''));
    if (parsed.protocol !== 'https:') return '';
    if (parsed.hostname !== 'github.com') return '';
    if (!parsed.pathname.startsWith('/rdavis0/better-lol-chat/')) return '';
    return parsed.href;
  } catch {
    return '';
  }
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
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = STYLE;
  (doc.head || doc.documentElement).appendChild(style);
}
