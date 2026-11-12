/*
 * Banner block: promotional / category banner.
 * Supports the two authored looks from design (new + old): the coloured background and
 * models live inside the authored image; the block only fills a background colour behind
 * the image when authored (to blend the gradient), sets the display font, the font colour
 * (black / white variant) and makes the whole banner a configurable link.
 *
 * Authoring (each a two-cell row, key in the first cell):
 *   desktop    | <image>           wide image (>= 900px)
 *   mobile     | <image>           narrow image (< 900px); falls back to desktop
 *   link       | <url or link>     whole banner links here; empty -> "#"
 *   background | <css colour>      colour filled behind the image; empty -> transparent
 *   font       | <name>            display font for the title (anton / inter / ...)
 * Any remaining text cell is the content: first paragraph = eyebrow, heading(s) = title,
 * following paragraphs = body text.
 *
 * Coupon: author a separate Coupon block anywhere on the page; this block hoists it in under
 * the title (same approach the hero-carousel uses for its try-on button).
 */

import { loadCSS } from '../../scripts/aem.js';
import { buildTicket } from '../coupon/coupon.js';

const DESKTOP_MEDIA = '(width >= 900px)'; /* same breakpoint as the PLP layout */
const IMAGE_EXT = /\.(avif|gif|jpe?g|png|svg|webp)(\?.*)?$/i;
const KEYS = ['mobile', 'desktop', 'link', 'background', 'font'];

/* Authored display-font name -> CSS font-family stack. Unknown names pass through,
   so an author can type any family that the site actually loads. */
const FONTS = {
  anton: "anton, 'Druk Condensed', 'Druk Cond', impact, haettenschweiler, var(--heading-font-family)",
  inter: "'inter', var(--body-font-family)",
  roboto: 'var(--body-font-family)',
  'roboto-condensed': 'var(--heading-font-family)',
};

/* "assets\img\x.png" -> "/assets/img/x.png"; full URLs are kept as they are. */
function toImageUrl(text) {
  const clean = (text || '').trim().replace(/\\/g, '/');
  if (!clean || !IMAGE_EXT.test(clean)) return null;
  if (/^(https?:)?\/\//i.test(clean) || clean.startsWith('/')) return clean;
  return `/${clean.replace(/^\.?\//, '')}`;
}

/* Images in a cell, in authored order: uploaded <img>, image links, or typed paths. */
function readImages(cell) {
  if (!cell) return [];
  const found = [];
  cell.querySelectorAll('img').forEach((img) => {
    found.push({ src: img.getAttribute('src'), alt: img.getAttribute('alt') || '' });
  });
  cell.querySelectorAll('a[href]').forEach((a) => {
    const src = toImageUrl(a.getAttribute('href'));
    if (src && !a.querySelector('img')) found.push({ src, alt: '' });
  });
  if (!found.length) {
    const parts = cell.querySelectorAll('p, li');
    const texts = parts.length ? [...parts].map((p) => p.textContent) : [cell.textContent];
    texts.flatMap((t) => t.split(/\s+/)).map(toImageUrl).filter(Boolean)
      .forEach((src) => found.push({ src, alt: '' }));
  }
  return found;
}

/* The banner link: an authored <a> href, or a typed URL, from the "link" cell. */
function readLink(cell) {
  if (!cell) return '';
  const anchor = cell.querySelector('a[href]');
  if (anchor) return anchor.getAttribute('href');
  const text = cell.textContent.trim();
  return text || '';
}

/* Uploaded (media bus) images can be resized by URL; files in /assets/ are served as-is. */
function sized(src, width) {
  if (!src || !src.includes('media_')) return src;
  const url = new URL(src, window.location.href);
  url.searchParams.set('width', width);
  url.searchParams.set('format', 'webply');
  url.searchParams.set('optimize', 'medium');
  return url.pathname + url.search;
}

/* <picture> that swaps between the desktop and mobile image at the 900px breakpoint. */
function buildPicture(desktop, mobile) {
  const wide = desktop || mobile;
  const small = mobile || desktop;
  const picture = document.createElement('picture');

  const source = document.createElement('source');
  source.media = DESKTOP_MEDIA;
  source.srcset = sized(wide.src, '2000');
  picture.append(source);

  const img = document.createElement('img');
  img.src = sized(small.src, '750');
  img.alt = wide.alt;
  img.loading = 'eager';
  img.fetchPriority = 'high';
  img.decoding = 'async';
  img.draggable = false;
  img.addEventListener('error', () => picture.closest('.banner')?.classList.add('no-image'));
  picture.append(img);
  return picture;
}

/* Strip inner links / button styling so the banner has no nested anchors inside its own link. */
function unwrapLinks(root) {
  root.querySelectorAll('a').forEach((a) => a.replaceWith(...a.childNodes));
  root.querySelectorAll('.button-container')
    .forEach((p) => p.classList.remove('button-container'));
  root.querySelectorAll('.button').forEach((el) => el.classList.remove('button', 'primary', 'secondary'));
}

/* Authors type the whole content in one cell, so the lines usually arrive as a single
   paragraph separated by <br>. Expand each such paragraph into one <p> per line, keeping
   the inline markup (e.g. <strong>, <a>) of each line. */
function splitLines(content) {
  const out = [];
  [...content.children].forEach((el) => {
    const segments = [[]];
    [...el.childNodes].forEach((node) => {
      if (node.nodeName === 'BR') segments.push([]);
      else segments[segments.length - 1].push(node);
    });
    if (segments.length <= 1) {
      out.push(el);
      return;
    }
    segments.forEach((nodes) => {
      const line = document.createElement(/^H[1-6]$/.test(el.tagName) ? el.tagName : 'p');
      nodes.forEach((n) => line.append(n));
      if (line.textContent.trim()) out.push(line);
    });
  });
  content.replaceChildren(...out);
}

/* A line whose whole text is bold (authored title), e.g. "<strong>LAYER UP.</strong>". */
function isBold(el) {
  const strong = el.querySelector('strong, b');
  return !!strong && strong.textContent.trim() === el.textContent.trim();
}

/* Tag the content lines in authored order (eyebrow, title, body) and return the banner
   link: the first hyperlink in the content. A line that is only that link sets the link
   but is not shown as text (the whole banner is already clickable). */
function decorateContent(content) {
  splitLines(content);

  let link = '';
  const anchor = content.querySelector('a[href]');
  if (anchor) {
    link = anchor.getAttribute('href');
    const line = anchor.closest('p, h1, h2, h3, h4, h5, h6');
    if (line && line.textContent.trim() === anchor.textContent.trim()) line.remove();
  }
  unwrapLinks(content);

  let eyebrowSet = false;
  let titleSeen = false;
  [...content.children].forEach((el) => {
    if (!el.textContent.trim()) {
      el.remove();
      return;
    }
    if (el.matches('h1, h2, h3, h4, h5, h6') || isBold(el)) {
      el.classList.add('banner-title');
      titleSeen = true;
    } else if (!eyebrowSet && !titleSeen) {
      el.classList.add('banner-eyebrow');
      eyebrowSet = true;
    } else {
      el.classList.add('banner-text');
    }
  });

  return link;
}

/* Fill the background with the image's flat colour (sampled from its top-left corner),
   so the side not covered by the image blends in. Skipped if the author set a colour, or
   if the pixels can't be read (e.g. a cross-origin image). */
function fillFromImage(block, img) {
  const sample = () => {
    try {
      const w = Math.max(1, Math.round(img.naturalWidth * 0.05));
      const h = Math.max(1, Math.round(img.naturalHeight * 0.05));
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, w, h, 0, 0, 1, 1);
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
      if (a) block.style.setProperty('--banner-bg', `rgb(${r} ${g} ${b})`);
    } catch (e) {
      /* image not readable (cross-origin / decode): leave the background transparent */
    }
  };
  if (img.complete && img.naturalWidth) sample();
  else img.addEventListener('load', sample, { once: true });
}

/* Pull a standalone Coupon block (authored anywhere on the page) into the banner, under the
   title, and remove its original spot — the same way the hero-carousel hoists its button. */
async function hoistCoupon(text) {
  const source = document.querySelector('.coupon');
  if (!source) return false;

  /* Read the raw code whether or not the standalone coupon has decorated itself yet. */
  const code = (source.querySelector('.coupon-code') || source).textContent.trim();
  await loadCSS(`${window.hlx.codeBasePath}/blocks/coupon/coupon.css`);

  const couponEl = document.createElement('div');
  couponEl.className = 'coupon';
  couponEl.append(buildTicket(code));
  /* The coupon sits inside the banner link, but clicking it should do nothing. */
  couponEl.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
  });

  const titles = text.querySelectorAll('.banner-title');
  if (titles.length) titles[titles.length - 1].after(couponEl);
  else text.append(couponEl);

  /* Remove the original coupon so it no longer shows outside the banner, and drop its
     section if it is now empty. */
  const section = source.closest('.section');
  (source.closest('.coupon-wrapper') || source).remove();
  if (section && !section.querySelector('.block')) section.remove();
  return true;
}

export default async function decorate(block) {
  const rows = [...block.querySelectorAll(':scope > div')];
  const config = {};
  let desktop = null;
  let mobile = null;
  let content = null;

  rows.forEach((row) => {
    const cells = [...row.querySelectorAll(':scope > div')];
    const key = cells.length > 1 ? cells[0].textContent.trim().toLowerCase() : '';

    if (KEYS.includes(key)) {
      if (key === 'mobile' || key === 'desktop') {
        const [image] = readImages(cells[1]);
        if (key === 'mobile') mobile = image || mobile;
        else desktop = image || desktop;
      } else if (key === 'link') {
        config.link = readLink(cells[1]);
      } else {
        config[key] = cells[1].textContent.trim();
      }
      return;
    }

    cells.forEach((cell) => {
      const hasText = cell.textContent.trim().length > 0;
      const images = hasText ? readImages(cell) : [];
      if (images.length) {
        desktop = desktop || images[0];
        mobile = mobile || images[1] || null;
      } else if (!content && hasText) {
        content = cell;
      }
    });
  });

  const text = document.createElement('div');
  text.className = 'banner-content';
  let contentLink = '';
  if (content) {
    contentLink = decorateContent(content);
    text.append(...content.childNodes);
  }

  const media = document.createElement('div');
  media.className = 'banner-media';
  if (desktop || mobile) media.append(buildPicture(desktop, mobile));
  else block.classList.add('no-image');

  /* Whole banner is a single link: explicit "link" row, else a hyperlink in the
     content, else "#". */
  const link = document.createElement('a');
  link.className = 'banner-link';
  link.href = config.link || contentLink || '#';
  const label = text.querySelector('.banner-title')?.textContent.trim();
  if (label) link.setAttribute('aria-label', label);
  link.append(media, text);

  /* Background fill: an authored colour wins; otherwise detect it from the image so the
     side not covered by the image matches. Display font also comes from authoring. */
  if (config.background) {
    block.style.setProperty('--banner-bg', config.background);
  } else {
    const img = media.querySelector('img');
    if (img) fillFromImage(block, img);
  }
  if (config.font) {
    const key = config.font.toLowerCase();
    block.style.setProperty('--banner-font', FONTS[key] || config.font);
  }

  block.replaceChildren(link);

  const hasCoupon = await hoistCoupon(text);
  /* No coupon -> let the title grow a little to fill the freed space. */
  block.classList.toggle('no-coupon', !hasCoupon);
}
