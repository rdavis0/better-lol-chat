import './update-dialog.css';
import dialogHtml from './update-dialog.html?raw';

const DIALOG_ID = 'blc-update-dialog';
const EMPTY_NOTES = 'No release notes were published for this version.';

// Above #blc-options (10) and .blc-bug-tip (11). Live check outside post-game: stacking was not the
// problem (the dialog was already topmost). A dialog created hidden and un-hidden through the
// stylesheet was not painted until its style attribute was touched, so the value is set inline on
// a freshly inserted element each time.
const DIALOG_Z = '12';

let active = null;

function buildDialog() {
  const template = document.createElement('template');
  template.innerHTML = dialogHtml.trim();
  const root = template.content.firstElementChild;
  root.addEventListener('click', onDialogClick);
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
  return !!document.getElementById(DIALOG_ID);
}

export function closeUpdateDialog() {
  document.getElementById(DIALOG_ID)?.remove();
  active = null;
}

/**
 * options: { version, notes, downloadUrl, releaseUrl, onSkip }
 * An empty downloadUrl is a preview: Download Now still advances to the install step.
 */
export function showUpdateDialog(options) {
  closeUpdateDialog();
  const root = buildDialog();
  active = options;
  const version = String(options.version || '').replace(/^v/i, '');
  setText(root, 'subtitle', version ? `better-lol-chat v${version} is ready to install.` : 'An update is ready to install.');
  setText(root, 'notes', String(options.notes || '').trim() || EMPTY_NOTES);
  setView(root, 'notes');
  root.style.zIndex = DIALOG_Z;
  (document.body || document.documentElement).appendChild(root);
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
