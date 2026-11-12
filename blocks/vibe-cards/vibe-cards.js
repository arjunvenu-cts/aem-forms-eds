
const MOBILE = window.matchMedia('(width < 900px)');

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

/** allows relative paths and http(s) urls only */
function safeUrl(url) {
  const trimmed = (url || '').trim();
  if (!trimmed || trimmed === '#') return '';
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) return trimmed;
  try {
    const parsed = new URL(trimmed, window.location.href);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : '';
  } catch (e) {
    return '';
  }
}

function textWithBreaks(node) {
  const copy = node.cloneNode(true);
  copy.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
  return copy.textContent.split('\n').map((line) => line.trim()).filter(Boolean).join('\n');
}

/**
 * Splits a row into picture, title, description and link.
 * Each text cell is read on its own: the first is the title (its lines / paragraphs
 * become line breaks), the next ones form the description. A cell holding only "#",
 * a path or a link is the card link.
 */
function readRow(row) {
  const picture = row.querySelector('picture') || row.querySelector('img');
  const anchor = row.querySelector('a[href]');
  let href = anchor ? anchor.getAttribute('href') : '';

  const cells = [];
  [...row.children].forEach((cell) => {
    if (cell.querySelector('picture, img')) return;
    const parts = [...cell.querySelectorAll('h1, h2, h3, h4, h5, h6, p')];
    const lines = (parts.length ? parts : [cell])
      .filter((part) => {
        const text = part.textContent.trim();
        if (!text) return false;
        const link = part.querySelector('a[href]');
        if (link && link.textContent.trim() === text) return false;
        if (!href && (text === '#' || /^\/[^\s]*$/.test(text))) {
          href = text;
          return false;
        }
        return true;
      })
      .map(textWithBreaks);
    if (lines.length) cells.push(lines);
  });

  const [titleLines = [], ...rest] = cells;
  return {
    picture,
    title: titleLines.join('\n'),
    description: rest.flat().join(' ').replace(/\n/g, ' '),
    href: href.trim() === '#' ? '#' : safeUrl(href),
  };
}

function centredIndex(list) {
  const centre = list.scrollLeft + list.clientWidth / 2;
  let best = 0;
  let bestDistance = Infinity;
  [...list.children].forEach((item, i) => {
    const distance = Math.abs(item.offsetLeft + item.offsetWidth / 2 - centre);
    if (distance < bestDistance) {
      best = i;
      bestDistance = distance;
    }
  });
  return best;
}

function centreCard(list, index) {
  const item = list.children[index];
  if (!item) return;
  list.scrollLeft = item.offsetLeft - (list.clientWidth - item.offsetWidth) / 2;
}

/**
 * Mobile scroll tracking: one dot per card (active = the centred card), and the cards get
 * is-active / is-prev / is-next so CSS can show the centred one full size with the others
 * tucked behind it. The dots are decorative: the cards themselves are reachable with Tab.
 */
function createScrollDots(list) {
  const dots = el('div', 'vibe-cards-dots');
  dots.setAttribute('aria-hidden', 'true');
  dots.append(...[...list.children].map(() => el('span', 'vibe-cards-dot')));
  const update = () => {
    const active = centredIndex(list);
    [...dots.children].forEach((dot, i) => dot.classList.toggle('active', i === active));
    [...list.children].forEach((item, i) => {
      item.classList.toggle('is-active', i === active);
      item.classList.toggle('is-prev', i < active);
      item.classList.toggle('is-next', i > active);
    });
  };
  list.addEventListener('scroll', update, { passive: true });
  new ResizeObserver(update).observe(list);
  return { dots, update };
}

function buildCard({
  picture, title, description, href,
}) {
  const li = el('li', 'vibe-cards-item');
  const card = el(href ? 'a' : 'div', 'vibe-cards-card');
  if (href) card.href = href;
  // "#" = clickable placeholder for now: no redirect, no jump to the top of the page
  if (href === '#') card.addEventListener('click', (e) => e.preventDefault());

  const media = el('div', 'vibe-cards-image');
  if (picture) {
    const img = picture.tagName === 'IMG' ? picture : picture.querySelector('img');
    if (img) {
      img.loading = 'lazy';
      if (!img.alt) img.alt = title.replace(/\n/g, ' ');
    }
    media.append(picture);
  }

  const body = el('div', 'vibe-cards-body');
  if (title) body.append(el('h3', 'vibe-cards-title', title));

  const footer = el('div', 'vibe-cards-footer');
  footer.append(el('p', 'vibe-cards-description', description));
  if (href) {
    const arrow = el('span', 'vibe-cards-arrow');
    arrow.setAttribute('aria-hidden', 'true');
    arrow.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M5 12h14M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    footer.append(arrow);
  }
  body.append(footer);

  card.append(media, body);
  li.append(card);
  return li;
}

export default function decorate(block) {
  const list = el('ul', 'vibe-cards-list');
  [...block.children].forEach((row) => {
    if (!row.textContent.trim() && !row.querySelector('picture, img')) return;
    list.append(buildCard(readRow(row)));
  });
  const { dots, update } = createScrollDots(list);
  block.replaceChildren(list, dots);

  // mobile: start with the middle card (Dial-Up Drip) centred, as in Figma
  const middle = Math.floor((list.children.length - 1) / 2);
  const start = () => {
    if (MOBILE.matches) centreCard(list, middle);
    update();
  };
  requestAnimationFrame(start);
  MOBILE.addEventListener('change', start);
}