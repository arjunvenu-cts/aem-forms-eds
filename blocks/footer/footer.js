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

const SVG_NS = 'http://www.w3.org/2000/svg';

// Accessible names of the fixed newsletter control (not visible on screen).
// The visible placeholder and button text are authored in the footer fragment.
const UI = {
  newsletterLabel: 'Newsletter signup',
  emailLabel: 'Email address',
};

// brand glyphs (24×24) described as data and built with createElementNS;
// drawn with currentColor so hover restyles them
const ICONS = {
  facebook: {
    attrs: { viewBox: '0 0 24 24', fill: 'currentColor' },
    shapes: [['path', { d: 'M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z' }]],
  },
  instagram: {
    attrs: {
      viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2',
    },
    shapes: [
      ['rect', {
        x: '2', y: '2', width: '20', height: '20', rx: '5.5',
      }],
      ['circle', { cx: '12', cy: '12', r: '4.6' }],
      ['circle', {
        cx: '17.7', cy: '6.3', r: '1.2', fill: 'currentColor', stroke: 'none',
      }],
    ],
  },
  tiktok: {
    attrs: { viewBox: '0 0 24 24', fill: 'currentColor' },
    shapes: [['path', { d: 'M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z' }]],
  },
  youtube: {
    attrs: { viewBox: '0 0 24 24', fill: 'currentColor' },
    shapes: [['path', { d: 'M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2C0 8.1 0 12 0 12s0 3.9.5 5.8a3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1c.5-1.9.5-5.8.5-5.8s0-3.9-.5-5.8zM9.6 15.6V8.4l6.2 3.6-6.2 3.6z' }]],
  },
};

// keywords used to recognise a social platform from an authored link
const SOCIAL_MATCH = [
  ['facebook', 'facebook'],
  ['instagram', 'instagram'],
  ['tiktok', 'tiktok'],
  ['youtube', 'youtube'],
];

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

/**
 * Builds the logo <picture>/<img> for an authored path. Same-origin raster images
 * go through createOptimizedPicture (webp + sized variants); SVG/GIF/external stay plain.
 */
function buildLogoImage(src, alt) {
  const url = new URL(src, window.location.href);
  const optimizable = url.origin === window.location.origin && /\.(png|jpe?g|webp|avif)$/i.test(url.pathname);
  if (optimizable) {
    return createOptimizedPicture(url.pathname + url.search, alt, false, [
      { media: '(min-width: 600px)', width: '600' },
      { width: '400' },
    ]);
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

/** Returns [label, href] pairs for every item of a real <ul>. */
function listItems(ul) {
  return [...ul.querySelectorAll('li')]
    .map((li) => {
      const a = li.querySelector('a');
      return [stripBullet(li.textContent.replace(/\s+/g, ' ')), a ? a.getAttribute('href') || '' : ''];
    })
    .filter(([label]) => label);
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
        lines.forEach((l) => run.push([stripBullet(l.text), l.href]));
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

  // first picture/img anywhere is the logo
  const logoImg = root.querySelector('picture') || root.querySelector('img');
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

  // headingless lists are either social links or the legal row
  const social = [];
  let legal;
  looseLists.forEach((items) => {
    const matched = items.map(([label, href]) => {
      const hit = SOCIAL_MATCH.find(([key]) => `${label} ${href}`.toLowerCase().includes(key));
      return hit ? { name: label || hit[1], href, icon: hit[1] } : null;
    });
    if (matched.every(Boolean)) social.push(...matched);
    else if (!legal) legal = items;
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

/** Builds a brand glyph as an inline SVG, or null when the platform is unknown. */
function buildIcon(name) {
  const def = ICONS[name];
  if (!def) return null;
  const svg = document.createElementNS(SVG_NS, 'svg');
  Object.entries(def.attrs).forEach(([key, value]) => svg.setAttribute(key, value));
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  def.shapes.forEach(([tag, attrs]) => {
    const shape = document.createElementNS(SVG_NS, tag);
    Object.entries(attrs).forEach(([key, value]) => shape.setAttribute(key, value));
    svg.append(shape);
  });
  return svg;
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
    || (data.logoSrc ? buildLogoImage(data.logoSrc, data.logoAlt || '') : null);
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

/** Builds the social icon row, or null when none were authored. */
function buildSocial(social = []) {
  if (!social.length) return null;
  const list = create('ul', 'footer__social');
  social.forEach(({ name, href, icon }) => {
    const url = safeHref(href);
    let item;
    if (url) {
      item = create('a', 'footer__social-link');
      item.setAttribute('href', url);
      item.setAttribute('aria-label', name);
      if (isExternal(url)) item.setAttribute('rel', 'noopener noreferrer');
    } else {
      item = create('span', 'footer__social-link');
      item.setAttribute('role', 'img');
      item.setAttribute('aria-label', name);
    }
    const glyph = buildIcon(icon);
    if (glyph) item.append(glyph);
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