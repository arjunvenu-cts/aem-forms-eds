import { getMetadata, createOptimizedPicture } from '../../scripts/aem.js';
import { loadFragment } from '../fragment/fragment.js';

/**
 * Footer block (brand footer).
 *
 * Content-driven: every piece of text, every link and the logo come from the
 * footer fragment (page metadata `footer`, default `/footer`) authored in DA Live.
 * Nothing is defaulted in code: a field that is not authored renders nothing.
 * The only strings in this file are the two hidden accessible names of the
 * newsletter control and the nav landmarks (see UI below).
 *
 * Social icons are authored images: a headingless list where every item is an icon,
 * either an image inserted in DA or a typed image path, each linked to the profile URL.
 * The link's accessible name is the image alt text, else derived from the URL host.
 *
 * Newsletter text is authored as two labelled lines in the first section:
 *   Email placeholder: you@email.com
 *   Button label: Subscribe
 *
 * Authoring is forgiving: a list can be a real bulleted list OR consecutive
 * lines typed with a leading "-" / "•" (links optional). Items without a real
 * URL render as plain text instead of dead "#" links.
 *
 * Logo (authored in the footer fragment, no code change needed):
 *   1. an image inserted with the DA image picker / drag-and-drop  → <picture>
 *   2. a path or URL typed as text, or a link to an image, e.g.
 *        /assets/images/dripcheck-logo.png
 *        https://da.live/media#/{org}/{repo}/assets/images/dripcheck-logo.png
 *   3. a short plain-text line before the headline → text wordmark
 *   A broken image falls back to the authored wordmark, or to nothing.
 *
 * Markup is built exclusively with DOM APIs (no innerHTML), so authored text can
 * never be interpreted as HTML.
 *
 * The newsletter control is visual only: it is not a <form>, has no handlers and
 * performs no validation, submission or navigation.
 *
 * CSS contract: BEM, scoped to `.footer` (see footer.css).
 */

// Accessible names of the fixed newsletter control (not visible on screen).
// The visible placeholder and button text are authored in the footer fragment.
const UI = {
  newsletterLabel: 'Newsletter signup',
  emailLabel: 'Email address',
};

// a line typed as a list item: "- Item", "• Item", "* Item"
const BULLET = /^\s*[-–—•*]\s*\S/;

// authored newsletter labels, e.g. "Button label: Subscribe"
const FIELD = /^(email placeholder|button label)\s*:\s*(.+)$/i;

// image file types accepted for an authored logo path
const IMAGE_EXT = /\.(png|jpe?g|gif|svg|webp|avif)$/i;

let instanceCount = 0;

/* ------------------------------------------------------------------ */
/* URL helpers                                                         */
/* ------------------------------------------------------------------ */

/**
 * Allows only http(s), mailto, tel, hash and relative URLs (blocks javascript:, data:).
 * @param {string} href Authored URL
 * @returns {string} A safe URL, or '' when there is none / it is unsafe
 */
function safeHref(href) {
  const value = String(href || '').trim();
  if (!value) return '';
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) {
    return /^(https?|mailto|tel):/i.test(value) ? value : '';
  }
  return value;
}

/** True for absolute http(s) links that leave the current origin. */
function isExternal(href) {
  try {
    const url = new URL(href, window.location.href);
    return /^https?:$/.test(url.protocol) && url.origin !== window.location.origin;
  } catch {
    return false;
  }
}

/**
 * Turns an authored logo reference into a safe, loadable URL.
 * Accepts: site-relative paths ("/assets/x.png", "assets/x.png", "./x.png"),
 * absolute https URLs, and DA browser links (da.live/media#/{org}/{repo}/{path},
 * content.da.live/{org}/{repo}/{path}) which are mapped to the site-relative
 * path ("/{path}") because the published site serves the asset from its root.
 * Anything else (javascript:, data:, no image extension, protocol-relative) is rejected.
 * @param {string} raw Authored value (an optional trailing note after a space is ignored)
 * @returns {string} A usable URL, or '' when invalid
 */
function resolveLogoSrc(raw) {
  let value = String(raw || '').trim().split(/\s+/)[0];
  if (!value) return '';

  const da = value.match(/^https?:\/\/da\.live\/media#\/[^/]+\/[^/]+\/(.+)$/i)
    || value.match(/^https?:\/\/content\.da\.live\/[^/]+\/[^/]+\/(.+)$/i);
  if (da) value = `/${da[1]}`;

  if (value.startsWith('//')) return '';
  const safe = safeHref(value);
  if (!safe) return '';
  if (!/^[a-z][a-z0-9+.-]*:/i.test(safe) && !safe.startsWith('/')) {
    return resolveLogoSrc(`/${safe.replace(/^\.\//, '')}`); // "assets/x.png" → "/assets/x.png"
  }
  if (/^(mailto|tel):/i.test(safe)) return '';
  const pathOnly = safe.split(/[?#]/)[0];
  return IMAGE_EXT.test(pathOnly) ? safe : '';
}

/**
 * Reads a one-line paragraph as a logo reference (text path or link to an image).
 * @param {{text: string, href: string}} line
 * @returns {{src: string, alt: string}|null}
 */
function logoRefOf({ text, href }) {
  const fromHref = resolveLogoSrc(href);
  const fromText = text.split(/\s+/).length <= 3 ? resolveLogoSrc(text) : '';
  const src = fromHref || fromText;
  if (!src) return null;
  // link text is the alt, unless the text is just the path itself
  return { src, alt: fromHref && !fromText ? text : '' };
}

// rendition widths for createOptimizedPicture
const LOGO_BREAKPOINTS = [{ media: '(min-width: 600px)', width: '600' }, { width: '400' }];
const ICON_BREAKPOINTS = [{ width: '96' }];

/**
 * Builds a <picture>/<img> for an authored image path. Same-origin raster images
 * go through createOptimizedPicture (webp + sized variants); SVG/GIF/external stay plain.
 */
function buildImage(src, alt, breakpoints = LOGO_BREAKPOINTS) {
  const url = new URL(src, window.location.href);
  const optimizable = url.origin === window.location.origin && /\.(png|jpe?g|webp|avif)$/i.test(url.pathname);
  if (optimizable) {
    return createOptimizedPicture(url.pathname + url.search, alt, false, breakpoints);
  }
  const img = document.createElement('img');
  img.src = url.href;
  img.alt = alt;
  img.loading = 'lazy';
  img.decoding = 'async';
  return img;
}

/* ------------------------------------------------------------------ */
/* Fragment parsing (reads the DA Live authoring structure)            */
/* ------------------------------------------------------------------ */

/** Removes a leading list marker typed by the author. */
function stripBullet(text) {
  return text.replace(/^\s*[-–—•*]\s*/, '').trim();
}

/**
 * Splits an element into visual lines (separated by <br>), keeping the first
 * link found on each line.
 * @param {Element} el
 * @returns {{text: string, href: string}[]}
 */
function linesOf(el) {
  const lines = [];
  let text = '';
  let href = '';
  const flush = () => {
    const clean = text.replace(/\s+/g, ' ').trim();
    if (clean) lines.push({ text: clean, href });
    text = '';
    href = '';
  };
  const walk = (node) => {
    node.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        text += child.textContent;
      } else if (child.nodeName === 'BR') {
        flush();
      } else {
        if (child.nodeName === 'A' && !href) href = child.getAttribute('href') || '';
        walk(child);
      }
    });
  };
  walk(el);
  flush();
  return lines;
}

/**
 * Builds a [label, href, media?] list item. `media` is present when the item is an icon:
 *   - an image inserted in DA (picture/img, optionally linked), or
 *   - a typed image path ("/assets/icons/x.svg"), optionally hyperlinked to the destination.
 * @param {string} label Item text (may be empty for an image-only item)
 * @param {string} href Authored link (the destination, or the image itself)
 * @param {Element} [pic] An authored <picture>/<img>
 */
function withMedia(label, href, pic) {
  if (pic) {
    const img = pic.matches('img') ? pic : pic.querySelector('img');
    return [label || (img && img.getAttribute('alt')) || '', href, { el: pic }];
  }
  const src = label.split(/\s+/).length === 1 ? resolveLogoSrc(label) : '';
  if (src) {
    // a link that points at the image itself is not a destination
    return ['', resolveLogoSrc(href) ? '' : href, { src }];
  }
  return [label, href];
}

/** Returns [label, href, media?] items for every <li> of a real <ul>. */
function listItems(ul) {
  return [...ul.querySelectorAll('li')]
    .map((li) => {
      const a = li.querySelector('a');
      return withMedia(
        stripBullet(li.textContent.replace(/\s+/g, ' ')),
        a ? a.getAttribute('href') || '' : '',
        li.querySelector('picture, img'),
      );
    })
    .filter(([label, , media]) => label || media);
}

/**
 * Flattens the fragment into an ordered list of headings, text lines and lists.
 * Consecutive "- item" paragraphs (within one section) become one list.
 */
function toNodes(root) {
  const nodes = [];
  let run = null;
  let runParent = null;
  const closeRun = () => {
    if (run) nodes.push({ type: 'list', items: run });
    run = null;
    runParent = null;
  };

  root.querySelectorAll('h1,h2,h3,h4,h5,h6,p,ul').forEach((el) => {
    const tag = el.tagName.toLowerCase();
    if (el.parentElement.closest('ul')) return; // nested content is read by listItems

    if (tag === 'p') {
      if (el.querySelector('picture, img')) { // logo wrapper
        closeRun();
        return;
      }
      const lines = linesOf(el);
      if (!lines.length) return;
      const logoRef = lines.length === 1 && logoRefOf(lines[0]);
      if (logoRef) { // a typed/linked image path is the logo, never visible text
        closeRun();
        nodes.push({ type: 'logo', ...logoRef });
        return;
      }
      if (lines.every((l) => BULLET.test(l.text))) {
        if (run && runParent !== el.parentElement) closeRun(); // new section = new list
        run = run || [];
        runParent = el.parentElement;
        lines.forEach((l) => run.push(withMedia(stripBullet(l.text), l.href)));
        return;
      }
      closeRun();
      nodes.push({ type: 'text', text: lines.map((l) => l.text).join(' ') });
      return;
    }

    closeRun();
    if (tag === 'ul') nodes.push({ type: 'list', items: listItems(el) });
    else nodes.push({ type: 'heading', lines: linesOf(el).map((l) => l.text) });
  });
  closeRun();
  return nodes;
}

/**
 * Reads the author-editable fields out of the footer fragment.
 * Classification is by element type (not position). Returns only the fields
 * that were authored; everything else stays undefined and renders nothing.
 * @param {Element} root The loaded fragment
 * @returns {object} A partial of the content model
 */
function parseFragment(root) {
  const out = {};
  const columns = [];
  const paragraphs = [];
  const looseLists = [];
  let headline;

  // first picture/img outside a list is the logo (images inside lists are icons)
  const logoImg = [...root.querySelectorAll('picture, img')].find((el) => !el.closest('li'));
  if (logoImg) out.logoImg = logoImg;

  const nodes = toNodes(root);
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i];
    if (node.type === 'heading') {
      if (!node.lines.length) continue; // eslint-disable-line no-continue
      const next = nodes[i + 1];
      if (next && next.type === 'list') {
        columns.push({ title: node.lines.join(' '), links: next.items });
        i += 1; // consume the paired list
      } else if (!headline) {
        headline = node.lines.length > 1 ? node.lines : node.lines[0];
      }
    } else if (node.type === 'list') {
      if (node.items.length) looseLists.push(node.items);
    } else if (node.type === 'logo') {
      if (!out.logoSrc) {
        out.logoSrc = node.src;
        if (node.alt) out.logoAlt = node.alt;
      }
    } else if (FIELD.test(node.text)) {
      // labelled newsletter text; checked before the wordmark rule (it is also ≤3 words)
      const [, key, value] = node.text.match(FIELD);
      if (key.toLowerCase() === 'email placeholder') out.emailPlaceholder = value.trim();
      else out.subscribeLabel = value.trim();
    } else if (!out.logoImg && !out.logo && !headline && !columns.length
      && node.text.split(/\s+/).length <= 3) {
      // a short text line before any heading/column is the logo wordmark
      out.logo = node.text;
    } else {
      paragraphs.push(node.text);
    }
  }

  // headingless lists: a list made only of icons is the social row, any other is the legal row
  const social = [];
  let legal;
  looseLists.forEach((items) => {
    if (items.every(([, , media]) => media)) {
      social.push(...items.map(([label, href, media]) => ({ label, href, media })));
    } else if (!legal) {
      legal = items;
    }
  });
  if (social.length) out.social = social;
  if (legal) out.legal = legal;

  // paragraphs: the © line is the copyright; the rest are subtext/disclaimer
  const copy = paragraphs.find((p) => /©|copyright|all rights reserved/i.test(p));
  if (copy) out.copyright = copy;
  const rest = paragraphs.filter((p) => p !== copy);
  if (rest[0]) out.subtext = rest[0];
  if (rest[1]) out.disclaimer = rest[1];

  if (headline) out.heading = headline;
  if (columns.length) out.columns = columns;
  return out;
}

/**
 * Splits a single-string headline into two balanced lines at a word boundary
 * (so "JOIN THE DRIP SYNC / AND GET 25% OFF" breaks the same way at any width).
 * An author can force their own breaks with Shift+Enter.
 */
function splitHeading(text) {
  const clean = String(text).trim().replace(/\s+/g, ' ');
  const words = clean.split(' ');
  if (words.length < 4) return [clean];
  const half = clean.length / 2;
  let best = 1;
  let bestDiff = Infinity;
  let length = 0;
  for (let i = 0; i < words.length - 1; i += 1) {
    length += words[i].length + (i ? 1 : 0);
    const diff = Math.abs(length - half);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = i + 1;
    }
  }
  return [words.slice(0, best).join(' '), words.slice(best).join(' ')];
}

/* ------------------------------------------------------------------ */
/* DOM builders (no innerHTML)                                         */
/* ------------------------------------------------------------------ */

/**
 * Creates an element with an optional class and text content.
 * @param {string} tag Tag name
 * @param {string} [className] A single class name
 * @param {string} [text] Text content (always set as text, never parsed as HTML)
 * @returns {HTMLElement}
 */
function create(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.classList.add(className);
  if (text) node.textContent = text;
  return node;
}

/** A real link when a safe URL exists ("#" counts), otherwise plain text. */
function buildLink(className, href, label) {
  const url = safeHref(href);
  if (!url) return create('span', className, label);
  const link = create('a', className, label);
  link.setAttribute('href', url);
  if (isExternal(url)) link.setAttribute('rel', 'noopener noreferrer');
  return link;
}

/** Wraps a node in a <li>. */
function listItem(child) {
  const li = document.createElement('li');
  li.append(child);
  return li;
}

/**
 * Builds the logo: authored image, else authored wordmark. Returns null when
 * neither was authored. A broken image falls back to the wordmark, or is removed.
 */
function buildLogo(data) {
  const media = data.logoImg
    || (data.logoSrc ? buildImage(data.logoSrc, data.logoAlt || '') : null);
  if (!media && !data.logo) return null;

  const logo = create('p', 'footer__logo');
  if (!media) {
    logo.textContent = data.logo;
    return logo;
  }

  const img = media.matches('img') ? media : media.querySelector('img');
  if (img) {
    img.addEventListener('error', () => {
      logo.classList.remove('footer__logo--image');
      logo.textContent = data.logo || '';
      if (!data.logo) logo.remove();
    }, { once: true });
  }
  logo.classList.add('footer__logo--image');
  logo.append(media);
  return logo;
}

/** Builds the headline, one span per visual line. */
function buildHeading(heading) {
  const lines = Array.isArray(heading) ? heading : splitHeading(heading);
  const h2 = create('h2', 'footer__heading');
  lines.forEach((line, i) => {
    h2.append(create('span', 'footer__heading-line', line));
    if (i < lines.length - 1) h2.append(' '); // keeps the text readable as one sentence
  });
  return h2;
}

/**
 * Builds the newsletter control. Purely visual: it is intentionally NOT a <form>
 * and the button is type="button", so nothing is validated, submitted or navigated.
 */
function buildNewsletter(uid, data, describedBy) {
  const group = create('div', 'footer__form');
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', UI.newsletterLabel);

  const label = create('label', 'footer__visually-hidden', UI.emailLabel);
  label.setAttribute('for', `${uid}-email`);

  const input = create('input', 'footer__input');
  input.id = `${uid}-email`;
  input.setAttribute('type', 'email');
  input.setAttribute('name', 'email');
  input.setAttribute('autocomplete', 'email');
  if (data.emailPlaceholder) input.setAttribute('placeholder', data.emailPlaceholder);
  if (describedBy) input.setAttribute('aria-describedby', describedBy);

  group.append(label, input);

  // an unlabelled button would have no accessible name, so it renders only when authored
  if (data.subscribeLabel) {
    const button = create('button', 'footer__button', data.subscribeLabel);
    button.setAttribute('type', 'button');
    group.append(button);
  }
  return group;
}

/** Accessible name from an external URL when none was authored ("facebook.com" → "Facebook"). */
function nameFromUrl(url) {
  if (!isExternal(url)) return '';
  const base = new URL(url, window.location.href).hostname.replace(/^www\./, '').split('.')[0];
  return base.charAt(0).toUpperCase() + base.slice(1);
}

/** Builds the social icon row from authored images, or null when none were authored. */
function buildSocial(social = []) {
  if (!social.length) return null;
  const list = create('ul', 'footer__social');
  social.forEach(({ label, href, media }) => {
    const url = safeHref(href);
    const name = label || nameFromUrl(url);
    const icon = media.el || buildImage(media.src, '', ICON_BREAKPOINTS);
    const img = icon.matches('img') ? icon : icon.querySelector('img');

    let item;
    if (url) {
      item = create('a', 'footer__social-link');
      item.setAttribute('href', url);
      if (name) item.setAttribute('aria-label', name); // the link carries the name
      if (isExternal(url)) item.setAttribute('rel', 'noopener noreferrer');
      if (img) img.setAttribute('alt', '');
    } else {
      item = create('span', 'footer__social-link');
      if (img) img.setAttribute('alt', name); // no link: the image carries the name
    }
    item.append(icon);
    list.append(listItem(item));
  });
  return list;
}

/** Builds the left-hand intro. Returns the element and the headline (for fitting). */
function buildIntro(data, uid) {
  const intro = create('div', 'footer__intro');

  const logo = buildLogo(data);
  if (logo) intro.append(logo);

  const hasHeading = Array.isArray(data.heading) ? data.heading.length : !!data.heading;
  const heading = hasHeading ? buildHeading(data.heading) : null;
  if (heading) intro.append(heading);

  if (data.subtext) intro.append(create('p', 'footer__subtext', data.subtext));

  const disclaimerId = `${uid}-disclaimer`;
  intro.append(buildNewsletter(uid, data, data.disclaimer ? disclaimerId : ''));

  if (data.disclaimer) {
    const disclaimer = create('p', 'footer__disclaimer', data.disclaimer);
    disclaimer.id = disclaimerId;
    intro.append(disclaimer);
  }

  const social = buildSocial(data.social);
  if (social) intro.append(social);

  return { intro, heading };
}

/** Builds the link columns, or null when none were authored. */
function buildNav(columns = []) {
  if (!columns.length) return null;
  const nav = create('nav', 'footer__nav');
  nav.setAttribute('aria-label', 'Footer');
  columns.forEach(({ title, links }) => {
    const column = create('div', 'footer__column');
    column.append(create('h3', 'footer__column-title', title));
    const list = create('ul', 'footer__column-list');
    links.forEach(([label, href]) => list.append(listItem(buildLink('footer__link', href, label))));
    column.append(list);
    nav.append(column);
  });
  return nav;
}

/** Builds the bottom bar (legal links + copyright), or null when neither was authored. */
function buildBottom({ legal = [], copyright }) {
  if (!legal.length && !copyright) return null;
  const bottom = create('div', 'footer__bottom');

  if (legal.length) {
    const nav = document.createElement('nav');
    nav.setAttribute('aria-label', 'Legal');
    const list = create('ul', 'footer__legal');
    legal.forEach(([label, href]) => list.append(listItem(buildLink('footer__legal-link', href, label))));
    nav.append(list);
    bottom.append(nav);
  }

  if (copyright) bottom.append(create('p', 'footer__copyright', copyright));
  return bottom;
}

/**
 * The headline is authorable, so it must never overflow: keep each line on one
 * row and scale the size down only when the active display font runs wider
 * than the column (fallback fonts, long copy, narrow phones).
 */
function fitHeadingToWidth(heading) {
  const fit = () => {
    heading.style.removeProperty('--footer-heading-fit');
    const available = heading.clientWidth;
    const needed = Math.max(0, ...[...heading.children].map((line) => line.scrollWidth));
    if (available && needed > available) {
      heading.style.setProperty('--footer-heading-fit', (Math.floor((available / needed) * 1000) / 1000).toString());
    }
  };
  fit();
  if ('ResizeObserver' in window) new ResizeObserver(fit).observe(heading);
  if (document.fonts) {
    document.fonts.ready.then(fit);
    document.fonts.addEventListener('loadingdone', fit);
  }
}

/**
 * Loads and decorates the footer.
 * @param {Element} block The footer block element
 */
export default async function decorate(block) {
  instanceCount += 1;
  const uid = `footer-${instanceCount}`;

  // page-level override, else the shared /footer document
  const meta = getMetadata('footer');
  const path = meta ? new URL(meta, window.location).pathname : '/footer';

  let fragment = null;
  try {
    fragment = await loadFragment(path);
  } catch {
    fragment = null;
  }

  block.textContent = '';
  if (!fragment) return; // nothing authored → nothing rendered

  const data = parseFragment(fragment);

  const inner = create('div', 'footer__inner');
  const top = create('div', 'footer__top');

  const { intro, heading } = buildIntro(data, uid);
  top.append(intro);

  const nav = buildNav(data.columns);
  if (nav) top.append(nav);

  inner.append(top);

  const bottom = buildBottom(data);
  if (bottom) inner.append(bottom);

  block.append(inner);

  if (heading) fitHeadingToWidth(heading);
}