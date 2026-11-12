import { getMetadata, createOptimizedPicture } from '../../scripts/aem.js';
import { loadFragment } from '../fragment/fragment.js';

/**
 * Footer block (brand footer).
 *
 * Content-driven: the author-editable parts (logo, headline, subtext, disclaimer,
 * social links, link columns, copyright, legal links) come from the footer
 * fragment (page metadata `footer`, default `/footer`). The fixed design chrome
 * (newsletter form) is built here. Every field falls back to DEFAULTS, so the
 * footer renders fully even if the fragment — or any part of it — is missing.
 *
 * Authoring is forgiving: a list can be a real bulleted list OR consecutive
 * lines typed with a leading "-" / "•" (links optional). Items without a real
 * URL render as plain text instead of dead "#" links.
 *
 * Logo (all authored in the footer fragment, no code change needed):
 *   1. an image inserted with the DA image picker / drag-and-drop  → <picture>
 *   2. a path or URL typed as text, or a link to an image, e.g.
 *        /assets/images/dripcheck-logo.png
 *        https://da.live/media#/{org}/{repo}/assets/images/dripcheck-logo.png
 *        https://main--{repo}--{org}.aem.page/assets/images/dripcheck-logo.png
 *   3. nothing / a broken path → the text wordmark (DEFAULTS.logo)
 *
 * CSS contract: BEM, scoped to `.footer` (see footer.css).
 *
 * Integration hook: a valid newsletter submit dispatches a bubbling
 * `footer:subscribe` CustomEvent ({ detail: { email } }) on the block.
 */

// inline brand glyphs (24×24), drawn with currentColor so hover restyles them
const ICONS = {
  facebook:
    '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>',
  instagram:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" focusable="false"><rect x="2" y="2" width="20" height="20" rx="5.5"/><circle cx="12" cy="12" r="4.6"/><circle cx="17.7" cy="6.3" r="1.2" fill="currentColor" stroke="none"/></svg>',
  tiktok:
    '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z"/></svg>',
  youtube:
    '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2C0 8.1 0 12 0 12s0 3.9.5 5.8a3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1c.5-1.9.5-5.8.5-5.8s0-3.9-.5-5.8zM9.6 15.6V8.4l6.2 3.6-6.2 3.6z"/></svg>',
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

// image file types accepted for an authored logo path
const IMAGE_EXT = /\.(png|jpe?g|gif|svg|webp|avif)$/i;

// design defaults — every field is overridable from the footer fragment
const DEFAULTS = {
  logo: 'Dripcheck', // text wordmark, also the fallback when the image is missing/broken
  logoAlt: 'Dripcheck',
  heading: ['Join The Drip Sync', 'And Get 25% Off'],
  subtext: 'First dibs on fresh drops, members-only deals, and a little extra style, straight to your inbox.',
  disclaimer: 'By signing up, you agree to receive marketing emails from Dripcheck. Unsubscribe anytime.',
  social: [
    { name: 'Facebook', href: '', icon: 'facebook' },
    { name: 'Instagram', href: '', icon: 'instagram' },
    { name: 'TikTok', href: '', icon: 'tiktok' },
    { name: 'YouTube', href: '', icon: 'youtube' },
  ],
  columns: [
    {
      title: 'Shop',
      links: [
        ['New Drops', ''], ['Men', ''], ['Women', ''], ['Kids', ''],
        ['Virtual Try On', ''], ['Sale', ''], ['Gift Cards', ''],
      ],
    },
    {
      title: 'Brand name',
      links: [
        ['Our Story', ''], ['Our Community', ''], ['Store Locator', ''],
        ['Investor Relations', ''], ['Careers', ''], ['Sustainability', ''],
      ],
    },
    {
      title: 'Order support',
      links: [
        ['Contact Us', ''], ['Returns & Exchanges', ''], ['Track My Order', ''],
        ['Shipping & Delivery', ''], ['Size Guide', ''], ['FAQ', ''],
      ],
    },
  ],
  copyright: `© ${new Date().getFullYear()} Dripcheck. All rights reserved`,
  legal: [['Terms of service', ''], ['Privacy policy', '']],
  // fixed chrome (not authored)
  newsletterLabel: 'Newsletter signup',
  emailLabel: 'Email address',
  emailPlaceholder: 'you@email.com',
  subscribeLabel: 'Subscribe',
  subscribeSuccess: 'Thanks for subscribing!',
};

let instanceCount = 0;

/** Escapes text for safe interpolation into markup strings. */
function esc(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

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

/** Adds rel for absolute links that leave the current origin. */
function relAttr(href) {
  try {
    const url = new URL(href, window.location.href);
    return /^https?:$/.test(url.protocol) && url.origin !== window.location.origin
      ? ' rel="noopener noreferrer"'
      : '';
  } catch {
    return '';
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
 * it finds; the rest default.
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

/** A real link when a URL exists ("#" counts), otherwise plain text. */
function linkMarkup(cls, href, label) {
  const url = safeHref(href);
  if (!url) return `<span class="${cls}">${esc(label)}</span>`;
  return `<a class="${cls}" href="${esc(url)}"${relAttr(url)}>${esc(label)}</a>`;
}

/** Builds one link column. */
function columnMarkup({ title, links }) {
  const items = links.map(([label, href]) => `<li>${linkMarkup('footer__link', href, label)}</li>`).join('');
  return `<div class="footer__column"><h3 class="footer__column-title">${esc(title)}</h3><ul class="footer__column-list">${items}</ul></div>`;
}

/** Builds the social icon row. */
function socialMarkup(social) {
  return social
    .map(({ name, href, icon }) => {
      const url = safeHref(href);
      const glyph = ICONS[icon] || esc(name);
      if (!url) {
        return `<li><span class="footer__social-link" role="img" aria-label="${esc(name)}">${glyph}</span></li>`;
      }
      return `<li><a class="footer__social-link" href="${esc(url)}"${relAttr(url)} aria-label="${esc(name)}">${glyph}</a></li>`;
    })
    .join('');
}

/** Builds the legal link list (rendered in authored order). */
function legalMarkup(legal) {
  return legal.map(([label, href]) => `<li>${linkMarkup('footer__legal-link', href, label)}</li>`).join('');
}

/**
 * Loads and decorates the footer.
 * @param {Element} block The footer block element
 */
export default async function decorate(block) {
  instanceCount += 1;
  const uid = `footer-${instanceCount}`;
  const data = { ...DEFAULTS };

  // page-level override, else the shared /footer document
  const meta = getMetadata('footer');
  const path = meta ? new URL(meta, window.location).pathname : '/footer';
  try {
    const fragment = await loadFragment(path);
    if (fragment) Object.assign(data, parseFragment(fragment));
  } catch {
    // fragment missing or unreadable — defaults carry the full design
  }

  const headingLines = Array.isArray(data.heading) ? data.heading : splitHeading(data.heading);
  const headingHTML = headingLines
    .map((line) => `<span class="footer__heading-line">${esc(line)}</span>`)
    .join(' ');
  const legal = Array.isArray(data.legal) && data.legal.length ? data.legal : DEFAULTS.legal;
  const columns = Array.isArray(data.columns) && data.columns.length ? data.columns : DEFAULTS.columns;
  const social = Array.isArray(data.social) && data.social.length ? data.social : DEFAULTS.social;

  block.innerHTML = `
    <div class="footer__inner">
      <div class="footer__top">
        <div class="footer__intro">
          <p class="footer__logo">${esc(data.logo)}</p>
          <h2 class="footer__heading">${headingHTML}</h2>
          <p class="footer__subtext">${esc(data.subtext)}</p>
          <form class="footer__form" aria-label="${esc(data.newsletterLabel)}">
            <label class="footer__visually-hidden" for="${uid}-email">${esc(data.emailLabel)}</label>
            <input class="footer__input" id="${uid}-email" type="email" name="email"
              autocomplete="email" required placeholder="${esc(data.emailPlaceholder)}"
              aria-describedby="${uid}-disclaimer" />
            <button class="footer__button" type="submit">${esc(data.subscribeLabel)}</button>
          </form>
          <p class="footer__status" role="status" aria-live="polite"></p>
          <p class="footer__disclaimer" id="${uid}-disclaimer">${esc(data.disclaimer)}</p>
          <ul class="footer__social">${socialMarkup(social)}</ul>
        </div>
        <nav class="footer__nav" aria-label="Footer">
          ${columns.map(columnMarkup).join('')}
        </nav>
      </div>
      <div class="footer__bottom">
        <nav aria-label="Legal">
          <ul class="footer__legal">${legalMarkup(legal)}</ul>
        </nav>
        <p class="footer__copyright">${esc(data.copyright)}</p>
      </div>
    </div>`;

  // authored logo: an uploaded <picture>, else a typed/linked image path.
  // A missing or broken image falls back to the text wordmark.
  const logoEl = block.querySelector('.footer__logo');
  const logoMedia = data.logoImg
    || (data.logoSrc ? buildLogoImage(data.logoSrc, data.logoAlt) : null);
  if (logoMedia) {
    const img = logoMedia.matches('img') ? logoMedia : logoMedia.querySelector('img');
    const showWordmark = () => {
      logoEl.classList.remove('footer__logo--image');
      logoEl.textContent = data.logo;
    };
    if (img) {
      if (!img.getAttribute('alt')) img.alt = data.logoAlt;
      img.addEventListener('error', showWordmark, { once: true });
    }
    logoEl.textContent = '';
    logoEl.classList.add('footer__logo--image');
    logoEl.append(logoMedia);
  }

  // The headline is authorable, so it must never overflow: keep each line on one
  // row and scale the size down only when the active display font runs wider
  // than the column (fallback fonts, long copy, narrow phones).
  const heading = block.querySelector('.footer__heading');
  const fitHeading = () => {
    heading.style.removeProperty('--footer-heading-fit');
    const available = heading.clientWidth;
    const needed = Math.max(0, ...[...heading.children].map((line) => line.scrollWidth));
    if (available && needed > available) {
      heading.style.setProperty('--footer-heading-fit', (Math.floor((available / needed) * 1000) / 1000).toString());
    }
  };
  fitHeading();
  if ('ResizeObserver' in window) new ResizeObserver(fitHeading).observe(heading);
  if (document.fonts) {
    document.fonts.ready.then(fitHeading);
    document.fonts.addEventListener('loadingdone', fitHeading);
  }

  // No newsletter backend is wired yet. The browser validates the email
  // (required + type=email); a valid submit is announced via the aria-live
  // status region and published as `footer:subscribe` for a future integration.
  const form = block.querySelector('.footer__form');
  const input = block.querySelector('.footer__input');
  const status = block.querySelector('.footer__status');

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const email = input.value.trim();
    block.dispatchEvent(new CustomEvent('footer:subscribe', { bubbles: true, detail: { email } }));
    status.textContent = data.subscribeSuccess;
    form.reset();
  });

  // clear a stale confirmation as soon as the user starts a new entry
  input.addEventListener('input', () => {
    if (status.textContent) status.textContent = '';
  });
}