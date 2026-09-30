/**
 * Inject a 30-message post-game chat sample into the messages iframe.
 *
 * Paste into the League client DevTools console while post-game chat is open.
 * Re-running replaces the previous sample. Clear with:
 *   window.__blcClearSampleMessages()
 *
 * Shape matches docs/fixtures/messages.html (2026-09-23). Names are hardcoded
 * champions. Team classes still drive the colors. A space text node sits between
 * the name, the colon, and the body, same as the client template.
 */
(function blcInjectSampleMessages() {
  const SAMPLE = 'blc-sample';

  const CHAMPIONS = {
    mine: ['Cassiopeia'],
    'my-team': ['Lee Sin', 'Nautilus', "Kai'Sa", 'Orianna'],
    'other-team': ['Yasuo', 'Jinx', 'Elise', 'Darius', 'Thresh'],
  };

  /** @type {Array<['mine' | 'my-team' | 'other-team', number, string]>} */
  const LINES = [
    ['mine', 0, 'gg'],
    ['other-team', 0, 'gg'],
    ['my-team', 0, 'that baron fight was clean'],
    ['other-team', 1, 'we threw at elder'],
    ['my-team', 1, 'wards won that'],
    ['mine', 0, 'wp bot'],
    ['my-team', 2, 'ty for the ganks'],
    ['other-team', 2, 'jungle diff honestly'],
    ['my-team', 3, 'you were everywhere'],
    ['other-team', 3, 'top was unplayable'],
    ['mine', 0, 'close game though'],
    ['other-team', 4, 'supp gap too'],
    ['my-team', 1, 'roams were free'],
    ['other-team', 0, 'mid was even until 20'],
    ['my-team', 0, 'you scaled well'],
    ['mine', 0, 'nexus was spicy'],
    ['other-team', 1, 'one more auto and we win'],
    ['my-team', 2, 'flash was down'],
    ['other-team', 2, 'should have smited'],
    ['my-team', 3, 'next time we start drag earlier'],
    ['mine', 0, 'yeah that timing was late'],
    ['other-team', 3, 'gg go next'],
    ['my-team', 0, 'fun game'],
    ['other-team', 4, 'wp everyone'],
    ['my-team', 1, 'see you in queue'],
    ['mine', 0, 'gl next'],
    ['other-team', 0, 'you too'],
    ['my-team', 2, 'that fight at red was nuts'],
    ['other-team', 1, 'still thinking about the steal'],
    ['my-team', 3, 'gg wp'],
  ];

  const room = document.querySelector('lol-social-chat-room[type="postGame"]');
  if (!room) {
    console.warn('[BLC SAMPLE] no postGame chat room — open the post-game screen first');
    return;
  }

  const iframe = room.querySelector('iframe#embedded-messages-frame, iframe');
  const doc = iframe?.contentDocument || iframe?.contentWindow?.document;
  if (!doc?.body) {
    console.warn('[BLC SAMPLE] cannot read the messages iframe — open chat first');
    return;
  }

  // Font, padding, and one-row-per-line live on .messages.
  // An expired session still has .messages.disconnected and the frame stylesheet.
  // body is a wrapping flex row, so appending there runs messages together.
  const parent = doc.querySelector('.messages') || ensureMessages(doc);

  doc.querySelectorAll(`.${SAMPLE}`).forEach((el) => el.remove());

  const inserted = [];
  for (const [team, speaker, body] of LINES) {
    const names = CHAMPIONS[team];
    const name = names[speaker % names.length];
    const row = makeChat(doc, team, name, body);
    parent.appendChild(row);
    inserted.push(row);
  }

  const scroller = scrollParent(parent);
  if (scroller) scroller.scrollTop = scroller.scrollHeight;

  window.__blcClearSampleMessages = () => {
    const frame = document.querySelector(
      'lol-social-chat-room[type="postGame"] iframe#embedded-messages-frame, lol-social-chat-room[type="postGame"] iframe',
    );
    const live = frame?.contentDocument || frame?.contentWindow?.document;
    live?.querySelectorAll(`.${SAMPLE}`).forEach((el) => el.remove());
    console.log('[BLC SAMPLE] cleared');
  };

  const counts = inserted.reduce((acc, row) => {
    const team = row.classList.contains('mine')
      ? 'mine'
      : row.classList.contains('other-team')
        ? 'other-team'
        : 'my-team';
    acc[team] = (acc[team] || 0) + 1;
    return acc;
  }, {});

  console.log(
    '%c[BLC SAMPLE] inserted 30 messages',
    'font-weight:bold;color:#c89b3c',
    counts,
    { you: CHAMPIONS.mine, allies: CHAMPIONS['my-team'], enemies: CHAMPIONS['other-team'] },
  );
  console.log('[BLC SAMPLE] clear with: window.__blcClearSampleMessages()');
  return inserted;

  function ensureMessages(root) {
    const list = root.createElement('div');
    list.className = 'messages';
    list.setAttribute('lang', 'en-US');
    root.body.appendChild(list);
    return list;
  }

  function makeChat(root, teamClass, champion, body) {
    const box = root.createElement('div');
    box.className = `message-box ${teamClass} ${SAMPLE}`;

    const chat = root.createElement('div');
    chat.className = 'chat-message';

    const name = root.createElement('div');
    name.className = 'message-name';
    name.textContent = champion;

    const colon = root.createElement('span');
    colon.className = 'message';
    colon.textContent = ':';

    const message = root.createElement('span');
    message.className = 'message';
    message.textContent = body;

    chat.append(name, root.createTextNode(' '), colon, root.createTextNode(' '), message);
    box.appendChild(chat);
    return box;
  }

  function scrollParent(el) {
    let node = el;
    const view = el.ownerDocument?.defaultView;
    while (node && node !== el.ownerDocument.documentElement) {
      const style = view?.getComputedStyle(node);
      if (style && /(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight) {
        return node;
      }
      node = node.parentElement;
    }
    return el.ownerDocument.scrollingElement || el.ownerDocument.body;
  }
})();
