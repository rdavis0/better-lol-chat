import './update-dialog.css';
import dialogHtml from './update-dialog.html?raw';

const DIALOG_ID = 'blc-update-dialog';
const EMPTY_NOTES = 'No release notes were published for this version.';

let active = null;

function ensureDialog() {
  const existing = document.getElementById(DIALOG_ID);
  if (existing) return existing;
  const template = document.createElement('template');
  template.innerHTML = dialogHtml.trim();
  const root = template.content.firstElementChild;
  root.addEventListener('click', onDialogClick);
  (document.body || document.documentElement).appendChild(root);
  return root;
}

function setText(root, key, text) {
  const el = root.querySelector(`[data-blc-text="${key}"]`);
  if (el) el.textContent = text;
}

function setView(root, view) {
  for (const el of root.querySelectorAll('[data-blc-view]')) {
    el.hidden = el.dataset.blcView !== view;
  }
}

export function updateDialogIsOpen() {
  const root = document.getElementById(DIALOG_ID);
  return !!root && !root.hidden;
}

export function closeUpdateDialog() {
  const root = document.getElementById(DIALOG_ID);
  if (root) root.hidden = true;
  active = null;
}

/**
 * options: { version, notes, downloadUrl, releaseUrl, onSkip }
 * An empty downloadUrl is a preview: Download Now still advances to the install step.
 */
export function showUpdateDialog(options) {
  const root = ensureDialog();
  active = options;
  const version = String(options.version || '').replace(/^v/i, '');
  setText(root, 'subtitle', version ? `better-lol-chat v${version} is ready to install.` : 'An update is ready to install.');
  setText(root, 'notes', String(options.notes || '').trim() || EMPTY_NOTES);
  setView(root, 'notes');
  root.hidden = false;
  const scroller = root.querySelector('.blc-dialog-notes');
  if (scroller) scroller.scrollTop = 0;
}

function openExternal(url) {
  if (url) window.open(url, '_blank', 'noopener');
}

function onDialogClick(event) {
  const root = event.currentTarget;
  const action = event.target?.closest?.('[data-blc-action]')?.dataset.blcAction;
  if (!action) {
    if (clickedCloseButton(event, root)) closeUpdateDialog();
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  const current = active;
  if (!current) return;
  if (action === 'download') {
    openExternal(current.downloadUrl);
    setView(root, 'done');
  } else if (action === 'release') {
    openExternal(current.releaseUrl);
  } else if (action === 'skip') {
    closeUpdateDialog();
    current.onSkip?.();
  }
}

// The frame's close-button markup is not captured yet, so match by class name.
function clickedCloseButton(event, root) {
  for (const node of event.composedPath()) {
    if (node === root) return false;
    const cls = node?.className;
    const name = typeof cls === 'string' ? cls : cls?.baseVal || '';
    if (/close/i.test(name)) return true;
  }
  return false;
}
