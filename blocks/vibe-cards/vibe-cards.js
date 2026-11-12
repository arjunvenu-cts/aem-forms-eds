/*
 * Vibe Cards block ("Pick Your Vibe")
 * Category banners: photo on top, title, text and a round arrow on black.
 * Each banner is its own link ("#" = clickable placeholder, no redirect).
 * Desktop: 3 banners in a row (max 1441px).
 * Mobile: swipeable row, middle banner centred, side banners tucked behind it, dots below.
 *
 * Authoring (one row per banner):
 *   | Vibe Cards                     |                     |                         |   |
 *   | /assets/vibes/dial-up-drip.jpg | Dial-Up ⇧↵ Drip     | Throwbacks for today... | # |
 * Columns: image (URL/path or pasted image) | title (Shift+Enter = line break)
 *          | description | link
 */

const MOBILE = window.matchMedia('(width < 900px)');
const IMAGE_URL = /\.(jpe?g|png|webp|gif|avif)(\?.*)?$/i;

/**
 * Creates an element with an optional class and text.
 * @param {string} tag Tag name
 * @param {string} [className] CSS class
 * @param {string} [text] Text content
 * @returns {HTMLElement}
 */
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

/**
 * Allows relative paths and http(s) URLs only (blocks javascript: etc.).
 * @param {string} url Authored URL
 * @returns {string} Safe URL, or '' if not allowed
 */
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

/**
 * Reads text and keeps every <br> (Shift+Enter) as a line break.
 * @param {Element} node Element to read
 * @returns {string} Text with "\n" between lines
 */
function textWithBreaks(node) {
  const copy = node.cloneNode(true);
  copy.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
  return copy.textContent.split('\n').map((line) => line.trim()).filter(Boolean).join('\n');
}

/**
 * Gets the banner image: a pasted picture, or an image URL/path authored in the first cell.
 * @param {Element} row Authored row
 * @returns {Element|null} <picture> or <img>
 */
function readImage(row) {
  const pasted = row.querySelector('picture') || row.querySelector('img');
  if (pasted) return pasted;
  const first = row.children[0];
  const url = (first?.querySelector('a[href]')?.getAttribute('href') || first?.textContent || '').trim();
  if (!IMAGE_URL.test(url) || !safeUrl(url)) return null;
  first.textContent = ''; // so the URL is not read as the title or the link
  return Object.assign(document.createElement('img'), { src: safeUrl(url), alt: '' });
}

/**
 * Splits an authored row into image, title, description and link.
 * First text cell = title, next cells = description, a "#"/path/link cell = link.
 * @param {Element} row Authored row
 * @returns {{picture: Element|null, title: string, description: string, href: string}}
 */
function readRow(row) {
  const picture = readImage(row);
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

/**
 * Finds the banner closest to the centre of the scrolling row.
 * @param {Element} list Scrolling list
 * @returns {number} Index of the centred banner
 */
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

/**
 * Scrolls the row so one banner sits in the centre (no animation).
 * @param {Element} list Scrolling list
 * @param {number} index Banner to centre
 */
function centreCard(list, index) {
  const item = list.children[index];
  if (!item) return;
  list.scrollLeft = item.offsetLeft - (list.clientWidth - item.offsetWidth) / 2;
}

/**
 * Builds the mobile dots and keeps them, and the banner states
 * (is-active / is-prev / is-next), in sync with the scroll position.
 * @param {Element} list Scrolling list
 * @returns {{dots: HTMLElement, update: Function}} Dots element and a refresh function
 */
function createScrollDots(list) {
  const dots = el('div', 'vibe-cards-dots');
  dots.setAttribute('aria-hidden', 'true'); // decorative, banners are reachable with Tab
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

/**
 * Builds one clickable banner. Link "#" is clickable but does not redirect.
 * @param {{picture: Element|null, title: string, description: string, href: string}} data
 * @returns {HTMLLIElement}
 */
function buildCard({
  picture, title, description, href,
}) {
  const li = el('li', 'vibe-cards-item');
  const card = el(href ? 'a' : 'div', 'vibe-cards-card');
  if (href) card.href = href;
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
    const arrow = el('span', 'vibe-cards-arrow'); // decorative, the whole banner is the link
    arrow.setAttribute('aria-hidden', 'true');
    arrow.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M5 12h14M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    footer.append(arrow);
  }
  body.append(footer);

  card.append(media, body);
  li.append(card);
  return li;
}

/**
 * Block entry: builds the banners, adds the mobile dots and centres the middle banner.
 * @param {Element} block The Vibe Cards block
 */
export default function decorate(block) {
  const list = el('ul', 'vibe-cards-list');
  [...block.children].forEach((row) => {
    if (!row.textContent.trim() && !row.querySelector('picture, img')) return;
    list.append(buildCard(readRow(row)));
  });
  const { dots, update } = createScrollDots(list);
  block.replaceChildren(list, dots);

  const middle = Math.floor((list.children.length - 1) / 2);
  const start = () => {
    if (MOBILE.matches) centreCard(list, middle);
    update();
  };
  requestAnimationFrame(start);
  MOBILE.addEventListener('change', start);
}