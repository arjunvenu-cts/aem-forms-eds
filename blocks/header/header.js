import { getMetadata } from '../../scripts/aem.js';
import { loadFragment } from '../fragment/fragment.js';

/*
 * Header block
 *
 * Class naming: BEM, block = `header` (the class EDS puts on the block element).
 *   header__wrapper, header__nav, header__nav--open, header__brand, header__brand-link,
 *   header__logo, header__hamburger, header__toggle, header__toggle-icon,
 *   header__sections, header__menu, header__menu--extras, header__item, header__link,
 *   header__tools, header__tools-list, header__tool, header__tool--<search|wishlist|account|cart>,
 *   header__tool-link, header__avatar, header__avatar-fallback, header__chevron,
 *   header__cart, header__badge, header__brand-text, header__sr-only
 *
 * Authoring (first section of /nav = brand). Any ONE of these works for the logo:
 *   1. an image inserted/uploaded in DA                       (picture > img)
 *   2. a site path as text or link:  /assets/images/logo.png
 *   3. an absolute URL as text or link:  https://example.com/logo.svg
 *   4. a DA URL as text or link:  https://da.live/media#/{org}/{repo}/assets/logo.png
 * Link the logo by linking it in DA, or (for a pasted URL) by editing the link target;
 * with no link it goes to "/".
 * Missing or broken logos degrade to a text wordmark, never a broken-image icon.
 * Other images in the lists (flame accent, tool icons, avatar) accept the same
 * inserted-image or pasted path/URL forms; a failed one is dropped (flame) or replaced
 * by a built-in glyph (tool icons, avatar).
 *
 * Tool list (third /nav section), by POSITION, because an image has no name:
 *   1 search   2 wishlist   3 bag   4 account (avatar image)
 *   5 (optional) an image-only item right after the avatar = its dropdown chevron
 *     (a ":chevron-down:" icon in the avatar item works too; no image = built-in SVG)
 * An authored :search: / :heart: / :bag: / :user: icon still wins over position.
 * Every image's destination is authorable: link the image in DA (edit the link target,
 * "#" included) and that exact URL is used, for the logo, the flame item, the tools and the
 * avatar alike. A tool image with no authored link falls back to "#" (same page).
 *
 * Public hooks (replace the old try-on:* names):
 *   - CustomEvent `header:cart-count`  (detail: { count })
 *   - window.hlx.header.setCartCount(n)
 */

const DEFAULT_NAV_PATH = '/nav';
const NAV_ID = 'header-nav';
const SECTIONS_ID = 'header-sections';

// extensions accepted when an image is authored as a path/URL (text or link)
const IMAGE_EXT = /\.(?:avif|gif|jpe?g|png|svg|webp)$/i;
// {ref}--{repo}--{org}.aem.page|live  ->  [, repo, org]
const AEM_HOST = /^[\w-]+?--([\w-]+?)--([\w-]+)\.aem\.(?:page|live)$/i;
// the design underlines the first link (Men) until the visitor is on another section.
// Visual only (no aria-current, which would claim the page is "Men"). Set false to disable.
const DEFAULT_ACTIVE_FIRST = true;

const svg = (inner, box = 24, stroke = 1.75) => `<svg viewBox="0 0 ${box} ${box}" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" focusable="false" aria-hidden="true">${inner}</svg>`;
// inline glyphs: used when an authored tool image fails to load, and for the chevron,
// so neither needs a network request or the /icons folder
const GLYPHS = {
  search: svg('<circle cx="11" cy="11" r="7"/><path d="m16.5 16.5 4.5 4.5"/>'),
  wishlist: svg('<path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20z"/>'),
  cart: svg('<path d="M5.5 8.5h13l-1 11.5h-11z"/><path d="M9 8.5V7a3 3 0 0 1 6 0v1.5"/>'),
  account: svg('<circle cx="12" cy="8" r="4"/><path d="M4.5 21c0-4 3.4-6.5 7.5-6.5s7.5 2.5 7.5 6.5"/>'),
};
const CHEVRON = svg('<path d="M1.5 3.75 6 8.25l4.5-4.5"/>', 12, 1.75);

// must match the CSS breakpoint in header.css
const isDesktop = window.matchMedia('(min-width: 900px)');

// The four tools in authored order. `icons` are :icon-name: aliases that override position.
const TOOL_SLOTS = [
  { key: 'search', label: 'Search', icons: ['search'] },
  { key: 'wishlist', label: 'Wishlist', icons: ['heart', 'wishlist'] },
  { key: 'cart', label: 'Bag', icons: ['bag', 'cart'] },
  { key: 'account', label: 'Account', icons: ['user', 'account'] },
];

// secondary tools that leave the bar on mobile and move into the opened menu
const MOBILE_MENU_EXTRAS = [
  ['search', 'Search'],
  ['wishlist', 'Wishlist'],
  ['account', 'Account'],
];

/**
 * @param {Element} icon a span.icon element
 * @returns {string|undefined} the icon name, e.g. "search"
 */
function getIconName(icon) {
  return [...icon.classList].find((c) => c.startsWith('icon-'))?.substring(5);
}

/**
 * Removes EDS auto-button styling from authored links, so nav links are never
 * rendered as buttons (carry-over of the previous brand-link clean-up).
 * @param {Element} root container to clean
 */
function stripButtonStyles(root) {
  root.querySelectorAll('.button').forEach((el) => el.classList.remove('button'));
  root.querySelectorAll('.button-container').forEach((el) => el.classList.remove('button-container'));
}

/**
 * Reads a DA location out of a DA URL. DA's editor/media URLs keep the content
 * path in the hash, so they are web pages, not images, and cannot be used as an
 * <img src>. Recognised: da.live/{edit|media|...}#/org/repo/path,
 * content.da.live/org/repo/path and admin.da.live/source/org/repo/path.
 * @param {URL} url
 * @returns {{org: string, repo: string, path: string}|null}
 */
function parseDaLocation(url) {
  let location;
  if (url.hostname === 'da.live') location = url.hash.slice(1);
  else if (url.hostname === 'content.da.live') location = url.pathname;
  else if (url.hostname === 'admin.da.live') location = url.pathname.replace(/^\/source(?=\/)/, '');
  else return null;
  const [, org, repo, ...rest] = location.split('/');
  return org && repo && rest.length ? { org, repo, path: `/${rest.join('/')}` } : null;
}

/**
 * Turns an authored value into a loadable image URL, or null when it is not a
 * usable image reference. Safe to call with arbitrary author text.
 *  - "/assets/logo.png", "assets/logo.png", "./logo.png": read from the SITE ROOT
 *    (never relative to the current page, which would break on nested pages)
 *  - "https://host/logo.svg": used as is (http/https only)
 *  - DA URLs: mapped to the published site path. Same site -> same-origin path
 *    (also correct on localhost and custom domains); a different org/repo on an
 *    *.aem.page|live host -> that repo's aem.live URL.
 * @param {string} value authored text or href
 * @returns {string|null} absolute URL, or null
 */
function resolveImageUrl(value) {
  const raw = (value || '').trim();
  if (!raw) return null;

  let url;
  try {
    const isAbsolute = /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(raw);
    const input = isAbsolute ? raw : `/${raw.replace(/^(?:\.{0,2}\/)+/, '')}`;
    url = new URL(input, window.location.origin);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(url.protocol)) return null; // blocks javascript:, data:, file:...

  const da = parseDaLocation(url);
  if (da) {
    const host = window.location.hostname.match(AEM_HOST);
    const sameSite = !host
      || (host[1].toLowerCase() === da.repo.toLowerCase()
        && host[2].toLowerCase() === da.org.toLowerCase());
    try {
      url = new URL(da.path, sameSite ? window.location.origin : `https://main--${da.repo}--${da.org}.aem.live`);
    } catch {
      return null;
    }
  }
  return IMAGE_EXT.test(url.pathname) ? url.href : null;
}

/**
 * The same URL on the other AEM origin (.aem.page <-> .aem.live), or null. A relative
 * path such as /assets/images/x.png resolves against the page's own origin, and an asset
 * that is published (.live) but not previewed (.page), or the reverse, only loads
 * from one of them.
 * @param {string} src absolute image URL
 * @returns {string|null}
 */
function alternateOrigin(src) {
  try {
    const url = new URL(src);
    const match = url.hostname.match(/^(.+)\.aem\.(page|live)$/i);
    if (!match) return null;
    url.hostname = `${match[1]}.aem.${match[2].toLowerCase() === 'page' ? 'live' : 'page'}`;
    return url.href;
  } catch {
    return null;
  }
}

/**
 * Runs `onFail` once if the image fails to load, after ONE retry on the other AEM
 * origin (see alternateOrigin). Also catches a failure that happened before this
 * listener was attached (an already-broken cached image). SVGs are excluded from the
 * synchronous check because some browsers report naturalWidth 0 for SVGs that carry
 * no intrinsic size. <picture> images are not retried (their srcset is managed by EDS).
 * @param {HTMLImageElement} img
 * @param {Function} onFail
 */
function onImageError(img, onFail) {
  let handled = false;
  let retried = false;
  const run = () => {
    if (handled) return;
    handled = true;
    onFail();
  };
  const fail = () => {
    const alt = !retried && !img.closest('picture') ? alternateOrigin(img.currentSrc || img.src) : null;
    if (alt) {
      retried = true;
      img.src = alt;
      return;
    }
    run();
  };
  img.addEventListener('error', fail);
  if (img.complete && img.currentSrc && !img.naturalWidth && !/\.svg(?:[?#]|$)/i.test(img.currentSrc)) fail();
}

/**
 * Turns image references pasted into the nav lists (flame accent, avatar...) into
 * real <img> elements, so they behave exactly like images inserted through DA.
 * DA auto-links a pasted URL, so the usual shape is <a href="url">url</a>; plain
 * text paths are handled too. Links with their own label (e.g. "Men") are left
 * alone: a link is only converted when its text is itself an image reference.
 * @param {Element} root the nav element
 */
function convertAuthoredImages(root) {
  const makeImg = (url) => {
    const img = document.createElement('img');
    img.src = url;
    img.alt = ''; // decorative: the neighbouring text or aria-label names the control
    return img;
  };

  // DA turns a pasted URL or path into <a href=ref>ref</a>. The image reference is read
  // from the link TEXT first (what the author typed; the pipeline may rewrite an href),
  // then from the href. Anything else inside the link survives: an :icon: (the chevron)
  // and plain words (a label such as "New Drops"). A real label link (e.g. "Men") or a
  // label link that merely points at an image file is left alone.
  const isToken = (word) => /^:[\w-]+:$/.test(word);
  root.querySelectorAll('ul a[href]').forEach((a) => {
    if (a.querySelector('img')) return;
    const words = a.textContent.replace(/[\u200B-\u200D\uFEFF]/g, '').trim().split(/\s+/).filter(Boolean);
    const refs = words.filter((word) => resolveImageUrl(word));
    const rest = words.filter((word) => !resolveImageUrl(word) && !isToken(word));
    const hrefUrl = resolveImageUrl(a.getAttribute('href'));
    if (!refs.length && (!hrefUrl || rest.length)) return;
    const url = refs.length ? resolveImageUrl(refs[0]) : hrefUrl;
    const text = [...words.filter(isToken), ...rest].join(' ');
    // the link's target is the author's destination, unless it is just the image file
    // itself (what DA creates for a pasted path). It must survive the swap to <img>.
    const target = (a.getAttribute('href') || '').trim();
    const img = makeImg(url);
    if (target && !resolveImageUrl(target) && !/^javascript:/i.test(target)) img.dataset.href = target;
    a.replaceWith(img, ...a.querySelectorAll('.icon'), ...(text ? [` ${text}`] : []));
  });

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (node.parentElement.closest('ul') && !node.parentElement.closest('a, button')) textNodes.push(node);
  }
  textNodes.forEach((node) => {
    const parts = node.nodeValue.split(/(\s+)/);
    if (!parts.some((part) => resolveImageUrl(part))) return;
    const frag = document.createDocumentFragment();
    parts.forEach((part) => {
      const url = resolveImageUrl(part);
      frag.append(url ? makeImg(url) : part);
    });
    node.replaceWith(frag);
  });
}

/**
 * Reflects the open/closed state of the mobile menu. aria-expanded lives only on
 * the toggle button (a <nav> landmark does not support aria-expanded); the nav
 * carries a modifier class used purely as a styling hook.
 * @param {Element} nav The nav element
 * @param {Element} button The hamburger button
 * @param {boolean} expanded Whether the menu is expanded
 */
function setExpanded(nav, button, expanded) {
  button.setAttribute('aria-expanded', String(expanded));
  button.setAttribute('aria-label', expanded ? 'Close navigation' : 'Open navigation');
  nav.classList.toggle('header__nav--open', expanded);
  // lock the page behind the overlay menu on mobile only
  document.body.style.overflowY = (expanded && !isDesktop.matches) ? 'hidden' : '';
}

/**
 * Toggles the mobile menu. When opening on mobile, focus moves into the revealed
 * menu so keyboard and screen-reader users land on the nav links.
 * @param {Element} nav The nav element
 * @param {Element} button The hamburger button
 * @param {boolean|null} force Optional forced state
 */
function toggleMenu(nav, button, force = null) {
  const expanded = force !== null ? force : button.getAttribute('aria-expanded') !== 'true';
  setExpanded(nav, button, expanded);
  if (expanded && !isDesktop.matches) {
    nav.querySelector('.header__sections .header__link')?.focus();
  }
}

/**
 * Marks the centre-nav link whose pathname matches the current page as current.
 * Empty, "#", "javascript:" and root ("/") hrefs are ignored: they resolve to the
 * current page and would otherwise light up every placeholder link on load.
 * @param {Element} menu The primary menu list
 */
function markCurrentLink(menu) {
  const current = window.location.pathname.replace(/\/$/, '') || '/';
  menu.querySelectorAll('a[href]').forEach((a) => {
    const raw = (a.getAttribute('href') || '').trim();
    if (!raw || raw.startsWith('#') || raw.toLowerCase().startsWith('javascript:')) return;
    let linkPath;
    try {
      linkPath = new URL(a.href).pathname.replace(/\/$/, '') || '/';
    } catch {
      return;
    }
    if (linkPath === '/') return; // the home page is not a "section"
    if (current === linkPath || current.startsWith(`${linkPath}/`)) {
      a.setAttribute('aria-current', 'page');
    }
  });
}

/**
 * Decorates the centre navigation list:
 *  - adds BEM classes
 *  - unwraps the stray <p> wrappers da.live emits inside list items
 *  - turns plain-text items into real <button>s (an <li role="button"> is invalid
 *    list semantics), so they are focusable and operable with Enter/Space natively
 *  - makes the clicked item the "current" one (aria-current), clearing the rest
 * @param {Element} menu The primary menu <ul>
 */
function decorateMenu(menu) {
  menu.classList.add('header__menu');
  stripButtonStyles(menu);

  const controls = [];
  menu.querySelectorAll(':scope > li').forEach((li) => {
    li.classList.add('header__item');
    li.querySelectorAll(':scope > p').forEach((p) => p.replaceWith(...p.childNodes));

    let control = li.querySelector('a');
    if (!control) {
      // plain text (optionally with an inline image accent): make it a real button
      if (!li.textContent.trim() && !li.querySelector('img')) return;
      const href = li.querySelector('img[data-href]')?.dataset.href;
      control = document.createElement(href ? 'a' : 'button');
      if (href) control.href = href;
      else control.type = 'button';
      control.append(...li.childNodes);
      li.append(control);
    }
    control.classList.add('header__link');
    controls.push(control);

    // inline accent images (e.g. the flame before "New Drops") are decorative:
    // if one fails to load, drop it so no broken-image icon sits next to the label
    li.querySelectorAll('img').forEach((img) => {
      onImageError(img, () => (img.closest('picture') || img).remove());
    });
  });

  controls.forEach((control) => {
    control.addEventListener('click', () => {
      controls.forEach((other) => {
        other.removeAttribute('aria-current');
        other.classList.remove('header__link--default');
      });
      control.setAttribute('aria-current', control.tagName === 'A' ? 'page' : 'true');
    });
  });
}

/**
 * Works out which tool a list item is. An authored :icon-name: wins; otherwise the
 * item's position decides (search, wishlist, bag, account), because an uploaded or
 * pasted image carries no name.
 * @param {Element} li tool list item
 * @param {number} index position in the tool list
 * @returns {object|undefined} entry of TOOL_SLOTS
 */
function identifyTool(li, index) {
  const name = [...li.querySelectorAll('span.icon')]
    .map(getIconName)
    .find((n) => n && n !== 'chevron-down');
  return TOOL_SLOTS.find((slot) => slot.icons.includes(name)) || TOOL_SLOTS[index];
}

/**
 * Appends the dropdown chevron to the account link. Uses the authored image when
 * there is one (its box is larger than the visible glyph, see CSS), otherwise, or if
 * the image fails, a built-in SVG.
 * @param {Element} link the account link
 * @param {Element|null} media authored picture/img/icon, or null for the SVG
 */
function addChevron(link, media = null) {
  const chevron = document.createElement('span');
  chevron.className = 'header__chevron';
  chevron.setAttribute('aria-hidden', 'true');
  const img = media && (media.matches('img') ? media : media.querySelector('img'));
  if (img) {
    img.classList.add('header__chevron-img');
    img.setAttribute('alt', '');
    img.setAttribute('loading', 'eager');
    chevron.append(media);
    onImageError(img, () => { chevron.innerHTML = CHEVRON; });
  } else {
    chevron.innerHTML = CHEVRON;
  }
  link.append(chevron);
}

/**
 * Rebuilds the tools as ONE flat list of [link > image] items, whatever the author
 * produced (images, :icons:, avatar + chevron, linked or not):
 *  - tags each item header__tool--<key> so CSS can show/hide tools per breakpoint
 *  - gives every icon-only control a link and an accessible name
 *  - the account image becomes a round avatar; ":chevron-down:" becomes an inline chevron
 *  - a failed image is replaced by a built-in glyph, never a broken-image icon
 * @param {Element} navTools The tools container
 */
function decorateTools(navTools) {
  stripButtonStyles(navTools);
  const list = document.createElement('ul');
  list.className = 'header__tools-list';

  let accountLink = null;

  [...navTools.querySelectorAll('li')].forEach((li, index) => {
    const tool = identifyTool(li, index);
    const authoredLink = li.querySelector('a[href]');
    const hasChevron = !!li.querySelector('.icon-chevron-down') || /:chevron-down:/.test(li.textContent);
    // the tool's own picture: the first image/icon that is not the chevron
    const media = [...li.querySelectorAll('picture, img, span.icon')]
      .find((el) => !el.closest('.icon-chevron-down'));

    // an extra image-only item straight after the avatar is its dropdown chevron
    if (!tool && accountLink && media && !accountLink.querySelector('.header__chevron')) {
      addChevron(accountLink, media);
      return;
    }

    // destination: ONLY what the author linked in DA (a real <a>, or the target kept on
    // the image). No default URL: an image with no authored link is still rendered, as a
    // plain (non-interactive) image.
    const href = authoredLink?.getAttribute('href') || li.querySelector('[data-href]')?.dataset.href;

    const link = document.createElement(href ? 'a' : 'span');
    link.className = 'header__tool-link';
    const label = authoredLink?.getAttribute('aria-label') || tool?.label;
    if (href) {
      link.href = href;
      if (label) link.setAttribute('aria-label', label);
    } else if (label) {
      link.setAttribute('role', 'img'); // still named for assistive tech
      link.setAttribute('aria-label', label);
    } else {
      link.setAttribute('aria-hidden', 'true');
    }

    if (media) {
      const img = media.matches('img') ? media : media.querySelector('img');
      const isUpload = !media.matches('span.icon');
      link.append(media);
      if (img) {
        img.classList.add('header__tool-img');
        img.setAttribute('alt', '');
        img.setAttribute('loading', 'eager'); // above the fold
        img.setAttribute('decoding', 'async');
        onImageError(img, () => {
          if (!tool) return;
          const fallback = document.createElement('span');
          fallback.className = tool.key === 'account' && isUpload ? 'header__avatar-fallback' : 'header__tool-fallback';
          fallback.setAttribute('aria-hidden', 'true');
          fallback.innerHTML = GLYPHS[tool.key];
          (media.closest('picture') || media).replaceWith(fallback);
        });
      }
      if (tool?.key === 'account' && isUpload) link.classList.add('header__avatar');
    }

    if (hasChevron) addChevron(link);
    if (tool?.key === 'account') accountLink = link;

    const item = document.createElement('li');
    item.className = `header__tool${tool ? ` header__tool--${tool.key}` : ''}`;
    item.append(link);
    list.append(item);
  });

  navTools.textContent = '';
  navTools.append(list);
}

/**
 * Adds a count badge to the bag/cart tool. The count is never hardcoded: it is
 * read from the `data-cart-count` attribute on the block or the `cart-count`
 * page metadata, and updated live via the `header:cart-count` event or
 * `window.hlx.header.setCartCount(n)`. The badge is hidden when the count is 0.
 * The count is exposed to assistive tech through the link's accessible name.
 * @param {Element} navTools The tools container
 * @param {Element} block The block element (source of the authored count)
 */
function decorateCartBadge(navTools, block) {
  const host = navTools.querySelector('.header__tool--cart .header__tool-link');
  if (!host) return;
  host.classList.add('header__cart');

  const badge = document.createElement('span');
  badge.className = 'header__badge';
  badge.setAttribute('aria-hidden', 'true');
  host.append(badge);

  const baseLabel = host.getAttribute('aria-label') || 'Bag';

  const setCount = (value) => {
    const count = Math.max(0, Math.floor(Number(value) || 0));
    badge.textContent = count > 99 ? '99+' : String(count);
    badge.hidden = count === 0;
    host.setAttribute('aria-label', count > 0 ? `${baseLabel}, ${count} item${count === 1 ? '' : 's'}` : baseLabel);
  };

  setCount(block.dataset.cartCount ?? getMetadata('cart-count'));

  window.addEventListener('header:cart-count', (e) => setCount(e.detail?.count));
  window.hlx = window.hlx || {};
  window.hlx.header = { ...(window.hlx.header || {}), setCartCount: setCount };
}

/**
 * The mobile bar shows only [menu, logo, bag]. So no functionality is lost, the
 * search, wishlist and account links are repeated as text links at the bottom of
 * the opened menu (hidden on desktop by CSS). A tool without a link is skipped.
 * @param {Element} navSections The sections container
 * @param {Element} navTools The tools container
 */
function addMobileMenuExtras(navSections, navTools) {
  const entries = MOBILE_MENU_EXTRAS
    .map(([key, text]) => {
      const href = navTools.querySelector(`.header__tool--${key} a[href]`)?.getAttribute('href');
      return href ? { text, href } : null;
    })
    .filter(Boolean);
  if (!entries.length) return;

  const list = document.createElement('ul');
  list.className = 'header__menu header__menu--extras';
  entries.forEach(({ text, href }) => {
    const li = document.createElement('li');
    li.className = 'header__item';
    const a = document.createElement('a');
    a.className = 'header__link';
    a.href = href;
    a.textContent = text;
    li.append(a);
    list.append(li);
  });
  navSections.append(list);
}

/**
 * Finds a logo reference authored as text or as a link (a path, an absolute URL
 * or a DA URL). Tries every link href and link text, then the whole text, then
 * each whitespace-separated word, so a stray word next to the URL is harmless.
 * @param {Element} root the brand section
 * @returns {string|null} a loadable image URL, or null
 */
function findAuthoredLogoUrl(root) {
  const values = [];
  root.querySelectorAll('a[href]').forEach((a) => values.push(a.getAttribute('href'), a.textContent));
  const text = root.textContent.replace(/\s+/g, ' ').trim();
  values.push(text, ...text.split(' '));
  return values.map(resolveImageUrl).find(Boolean) || null;
}

/**
 * The destination an author gave the logo, when the logo was authored as a link
 * (e.g. a pasted image URL whose link target was edited to "/home" or "#").
 * Links that point at the image itself are not a destination. Returns "" when none was
 * authored (no default: the logo is then shown without a link).
 * @param {Element} root the brand section
 * @returns {string}
 */
function findAuthoredLogoHref(root) {
  const hrefs = [...root.querySelectorAll('a[href]')].map((a) => a.getAttribute('href').trim());
  return hrefs.find((href) => href && !resolveImageUrl(href) && !/^javascript:/i.test(href)) || '';
}

/**
 * Builds the brand: an uploaded image, an authored path/URL, or (when there is
 * no usable image) a text wordmark. The result is always a single link to "/"
 * (or a plain element when no destination was authored) so the header never renders
 * empty or with a broken-image icon.
 *   - image present      -> kept (picture/srcset from the EDS pipeline is preserved)
 *   - path/URL authored  -> resolved by resolveImageUrl and rendered as <img>
 *   - nothing / load error -> text wordmark (authored name > og:site_name > "Home")
 * @param {Element} navBrand The brand section
 */
function decorateBrand(navBrand) {
  stripButtonStyles(navBrand);

  const siteName = getMetadata('og:site_name') || '';
  const homeLabel = siteName ? `${siteName} home` : 'Home';
  const text = navBrand.textContent.replace(/\s+/g, ' ').trim();
  // plain authored text (not a path/URL) is a valid brand name
  const wordmark = (text && !/[/\\:]/.test(text) ? text : '') || siteName || 'Home';
  const container = navBrand.querySelector('.default-content-wrapper') || navBrand;

  let img = navBrand.querySelector('img');
  let homeHref = ''; // authored destination only; empty = not linked

  if (img) {
    // an author who pasted a DA URL into the image dialog: point it at the real asset
    const authored = img.getAttribute('src') || '';
    let daUrl = null;
    try { daUrl = parseDaLocation(new URL(authored, window.location.href)); } catch { /* keep src */ }
    const resolved = daUrl ? resolveImageUrl(authored) : null;
    if (resolved) {
      img.closest('picture')?.querySelectorAll('source').forEach((s) => s.remove());
      img.removeAttribute('srcset');
      img.src = resolved;
    }
  } else {
    const url = findAuthoredLogoUrl(navBrand);
    homeHref = findAuthoredLogoHref(navBrand);
    container.textContent = '';
    const p = document.createElement('p');
    container.append(p);
    if (url) {
      img = document.createElement('img');
      img.src = url;
      p.append(img);
    } else {
      // nothing usable authored: wordmark only
      const link = document.createElement(homeHref ? 'a' : 'span');
      if (homeHref) link.href = homeHref;
      link.className = 'header__brand-link';
      const label = document.createElement('span');
      label.className = 'header__brand-text';
      label.textContent = wordmark;
      link.append(label);
      p.append(link);
      return;
    }
  }

  if (!img.getAttribute('alt')) img.setAttribute('alt', homeLabel);

  // above the fold: prioritise the logo. Only the height is reserved (fixed in CSS);
  // the width follows the image's intrinsic ratio so other aspect ratios are not distorted.
  img.setAttribute('loading', 'eager');
  img.setAttribute('fetchpriority', 'high');
  img.setAttribute('decoding', 'async');
  if (!img.getAttribute('height')) img.setAttribute('height', '32');
  img.classList.add('header__logo');

  // keep an authored link. With none, the logo is wrapped in a plain element, never in
  // a made-up link. Wrap the <picture> (not the bare <img>) so the markup stays valid.
  let link = img.closest('a');
  if (!link) {
    const media = img.closest('picture') || img;
    link = document.createElement(homeHref ? 'a' : 'span');
    if (homeHref) link.href = homeHref;
    media.replaceWith(link);
    link.append(media);
  }
  link.classList.add('header__brand-link');

  // broken or unreachable logo -> text wordmark inside the same link
  onImageError(img, () => {
    const label = document.createElement('span');
    label.className = 'header__brand-text';
    label.textContent = wordmark;
    (img.closest('picture') || img).replaceWith(label);
    link.removeAttribute('aria-label');
  });
}

/**
 * Loads and decorates the header from the /nav fragment.
 * @param {Element} block The header block element
 */
export default async function decorate(block) {
  const navMeta = getMetadata('nav');
  const navPath = navMeta ? new URL(navMeta, window.location).pathname : DEFAULT_NAV_PATH;
  const fragment = await loadFragment(navPath);

  block.textContent = '';
  const nav = document.createElement('nav');
  nav.id = NAV_ID;
  nav.className = 'header__nav';
  nav.setAttribute('aria-label', 'Main');
  if (fragment) {
    while (fragment.firstElementChild) nav.append(fragment.firstElementChild);
  }

  // image URLs pasted into the lists become real images BEFORE the lists are
  // classified (a URL's text would otherwise make an icon list look like a menu)
  convertAuthoredImages(nav);
  // diagnostics: an image link that survived conversion would show up as raw text
  nav.querySelectorAll('ul a[href]').forEach((a) => {
    if (resolveImageUrl(a.getAttribute('href')) || resolveImageUrl(a.textContent.trim())) {
      // eslint-disable-next-line no-console
      console.warn('[header] image link was not converted:', a.outerHTML);
    }
  });

  // the first section is always the brand/logo; ensure it exists so the header
  // stays visible even when the fragment is missing or empty
  let navBrand = nav.firstElementChild;
  if (!navBrand) {
    navBrand = document.createElement('div');
    nav.append(navBrand);
  }
  navBrand.classList.add('header__brand');

  // links and icon tools may arrive as separate sections or bundled into one;
  // classify every top-level list by content and route it to the right container
  const navSections = document.createElement('div');
  navSections.className = 'header__sections';
  navSections.id = SECTIONS_ID;
  const navTools = document.createElement('div');
  navTools.className = 'header__tools';

  const isIconList = (ul) => {
    const items = [...ul.children];
    return items.length > 0
      && items.every((li) => li.querySelector('.icon, img') && !li.textContent.replace(/:[\w-]+:/g, '').trim());
  };

  nav.querySelectorAll('ul').forEach((ul) => {
    // leave nested lists with their parent item. Lists found inside the first
    // section are routed too, so a menu authored without a section break after
    // the logo (or a missing logo section) still works.
    if (ul.parentElement.closest('ul')) return;
    (isIconList(ul) ? navTools : navSections).append(ul);
  });

  // drop the now-empty source wrappers, keeping brand and the new containers
  [...nav.children].forEach((child) => {
    if (child !== navBrand) child.remove();
  });
  nav.append(navSections, navTools);

  // after the lists were moved out, so only logo content is left in the brand
  decorateBrand(navBrand);

  const menu = navSections.querySelector('ul');
  if (menu) {
    navSections.querySelectorAll(':scope > ul').forEach(decorateMenu);
    markCurrentLink(navSections);
    if (DEFAULT_ACTIVE_FIRST && !navSections.querySelector('[aria-current]')) {
      navSections.querySelector('.header__link')?.classList.add('header__link--default');
    }
  }
  decorateTools(navTools);
  decorateCartBadge(navTools, block);
  // after decorateMenu so the repeated tool links are not treated as sections
  addMobileMenuExtras(navSections, navTools);

  // hamburger (mobile/tablet) — only when there is a menu to open
  if (navSections.querySelector('a, button')) {
    const hamburger = document.createElement('div');
    hamburger.className = 'header__hamburger';
    hamburger.innerHTML = `<button type="button" class="header__toggle" aria-controls="${SECTIONS_ID}" aria-label="Open navigation" aria-expanded="false">
        <span class="header__toggle-icon" aria-hidden="true"></span>
      </button>`;
    const toggle = hamburger.querySelector('button');
    const isOpen = () => toggle.getAttribute('aria-expanded') === 'true';
    const close = (returnFocus = false) => {
      if (!isOpen()) return;
      toggleMenu(nav, toggle, false);
      if (returnFocus) toggle.focus();
    };

    toggle.addEventListener('click', () => toggleMenu(nav, toggle));
    nav.prepend(hamburger);

    // choosing a destination closes the mobile menu
    navSections.addEventListener('click', (e) => {
      if (!isDesktop.matches && e.target.closest('a, button')) close(true);
    });
    // Escape closes the mobile menu and returns focus to the toggle
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && !isDesktop.matches) close(true);
    });
    // keyboard focus leaving the nav closes it (relatedTarget is null for
    // pointer interaction in Safari, so only act on a real destination)
    nav.addEventListener('focusout', (e) => {
      if (!isDesktop.matches && e.relatedTarget && !nav.contains(e.relatedTarget)) close();
    });
    // tapping outside the nav closes it
    document.addEventListener('click', (e) => {
      if (!isDesktop.matches && !nav.contains(e.target)) close();
    });
    // reset state when crossing the desktop breakpoint
    isDesktop.addEventListener('change', () => close());
  }

  const navWrapper = document.createElement('div');
  navWrapper.className = 'header__wrapper';
  navWrapper.append(nav);
  block.append(navWrapper);
}