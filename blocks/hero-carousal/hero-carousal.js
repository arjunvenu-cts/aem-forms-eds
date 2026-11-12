import { createOptimizedPicture } from '../../scripts/aem.js';

const AUTOPLAY_INTERVAL = 5000; // ms, used when the block has the `autoplay` variant
const PAUSE_ON_HOVER = false; // set to true to pause autoplay while the mouse is over the banner
const TITLE_MIN_FONT = 28; // px, the heading never shrinks below this
const DEFAULT_CTA_LABEL = 'Shop now'; // used only if the CTA is authored as a bare URL / "#"

const IMAGE_BREAKPOINTS = [{ media: '(min-width: 900px)', width: '2000' }, { width: '900' }];
const THUMB_BREAKPOINTS = [{ width: '400' }];

const ICON_PREV = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false"><path d="M19 12H5M11 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON_NEXT = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false"><path d="M5 12h14M13 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
// same sparkle icon as the try-on-info block
const ICON_SPARKLE = '<svg class="hero-carousel-sparkle" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false"><path fill="currentColor" d="M10 2l1.9 5.6L17.5 9.5l-5.6 1.9L10 17l-1.9-5.6L2.5 9.5l5.6-1.9zM18.5 13l.9 2.6 2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9zM18 2l.7 1.8 1.8.7-1.8.7L18 7l-.7-1.8-1.8-.7 1.8-.7z"></path></svg>';

const CONTAINER_TAGS = new Set(['P', 'DIV', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6']);
const IMAGE_URL = /\.(png|jpe?g|webp|gif|avif|svg)(\?.*)?$/i;
const URL_LIKE = /^(#|\/|https?:\/\/)\S*$/i;

/* ------------------------------------------------------------------ images */

/**
 * Returns a <picture> for an image cell. Supports:
 *  1. a real image inserted in the document (preferred, gets optimized by EDS)
 *  2. a plain-text path or link such as /assets/images/banner-img-1.png
 */
function buildPicture(cell, breakpoints, eager, alt = '') {
  if (!cell) return null;
  const img = cell.querySelector('img');
  if (img) return createOptimizedPicture(img.src, alt, eager, breakpoints);

  const link = cell.querySelector('a[href]');
  const src = (link ? link.href : cell.textContent).trim();
  if (!IMAGE_URL.test(src)) return null;

  const picture = document.createElement('picture');
  const plain = document.createElement('img');
  plain.src = src;
  plain.alt = alt;
  plain.loading = eager ? 'eager' : 'lazy';
  picture.append(plain);
  return picture;
}

/* ----------------------------------------------------------------- content */

/**
 * Flattens the content cell into "lines". A new line starts at every block element
 * (p, h1-h6, li ...) and at every line break (<br> / Shift+Enter).
 */
function collectLines(root) {
  const lines = [];

  const pushLine = (nodes, isHeadingTag) => {
    const holder = document.createElement('div');
    nodes.forEach((n) => holder.append(n.cloneNode(true)));
    const text = holder.textContent.trim();
    if (!text) return;
    const link = holder.querySelector('a[href]');
    const boldText = [...holder.querySelectorAll('strong, b')].map((s) => s.textContent).join('').replace(/\s/g, '');
    const bold = boldText.length > 0 && boldText === text.replace(/\s/g, '');
    lines.push({ text, link, heading: isHeadingTag || bold });
  };

  const walk = (el, isHeadingTag) => {
    let buffer = [];
    const flush = () => {
      pushLine(buffer, isHeadingTag);
      buffer = [];
    };
    [...el.childNodes].forEach((node) => {
      if (node.nodeType === Node.ELEMENT_NODE && node.tagName === 'BR') {
        flush();
      } else if (node.nodeType === Node.ELEMENT_NODE && CONTAINER_TAGS.has(node.tagName)) {
        flush();
        walk(node, isHeadingTag || /^H[1-6]$/.test(node.tagName));
      } else {
        buffer.push(node);
      }
    });
    flush();
  };

  walk(root, false);
  return lines;
}

function buildCta(label, href, redirect) {
  let cta;
  if (redirect) {
    cta = document.createElement('a');
    cta.href = href;
  } else {
    cta = document.createElement('button');
    cta.type = 'button';
    cta.dataset.href = href;
  }
  cta.className = 'hero-carousel-cta';
  cta.innerHTML = ICON_SPARKLE;
  const text = document.createElement('span');
  text.textContent = label;
  cta.append(text);
  return cta;
}

/** Heading lines: stacked on desktop, run together on one line on mobile (see CSS). */
function titleLines(lines) {
  const frag = document.createDocumentFragment();
  lines.forEach((line, i) => {
    if (i > 0) frag.append(' ');
    const span = document.createElement('span');
    span.className = 'hero-carousel-title-line';
    span.textContent = line.text;
    frag.append(span);
  });
  return frag;
}

function textWithBreaks(lines) {
  const frag = document.createDocumentFragment();
  lines.forEach((line, i) => {
    if (i > 0) frag.append(document.createElement('br'));
    frag.append(line.text);
  });
  return frag;
}

/**
 * How the code tells the parts apart (no commas needed, it's based on the formatting):
 *  - Heading     : a Heading style (H1-H6) OR lines that are fully bold
 *  - Eyebrow     : plain text line(s) BEFORE the heading
 *  - Description : plain text line(s) AFTER the heading
 *  - CTA         : a hyperlink (link text = button label). A bare "#" or URL also works.
 */
function buildContent(cell, redirect) {
  const content = document.createElement('div');
  content.className = 'hero-carousel-content';
  if (!cell) return content;

  const eyebrow = [];
  const title = [];
  const description = [];
  let cta = null;

  collectLines(cell).forEach((line) => {
    if (!cta && line.link) {
      cta = { label: line.link.textContent.trim() || DEFAULT_CTA_LABEL, href: line.link.href };
    } else if (!cta && URL_LIKE.test(line.text)) {
      cta = { label: DEFAULT_CTA_LABEL, href: line.text };
    } else if (line.heading) {
      title.push(line);
    } else if (title.length === 0) {
      eyebrow.push(line);
    } else {
      description.push(line);
    }
  });

  // no heading authored: nothing to call an eyebrow, treat it all as description
  if (title.length === 0) description.unshift(...eyebrow.splice(0));

  if (eyebrow.length) {
    const p = document.createElement('p');
    p.className = 'hero-carousel-eyebrow';
    p.append(textWithBreaks(eyebrow));
    content.append(p);
  }
  if (title.length) {
    const h = document.createElement('h2');
    h.className = 'hero-carousel-title';
    h.append(titleLines(title));
    content.append(h);
  }
  description.forEach((line) => {
    const p = document.createElement('p');
    p.className = 'hero-carousel-description';
    p.textContent = line.text;
    content.append(p);
  });
  if (cta) content.append(buildCta(cta.label, cta.href, redirect));

  return content;
}

/* ------------------------------------------------------- background colour */

/**
 * Picks the dominant colour along the bottom edge of an image, so the area below the
 * image (mobile) blends into it. Returns null if the pixels can't be read.
 */
function getEdgeColor(img) {
  try {
    const size = 48;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, size, size);
    const { data } = ctx.getImageData(0, size - 4, size, 4); // bottom 4 rows
    const buckets = new Map();
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] >= 200) {
        const key = `${data[i] >> 4},${data[i + 1] >> 4},${data[i + 2] >> 4}`; // eslint-disable-line no-bitwise
        const b = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0 };
        b.n += 1;
        b.r += data[i];
        b.g += data[i + 1];
        b.b += data[i + 2];
        buckets.set(key, b);
      }
    }
    let best = null;
    buckets.forEach((b) => { if (!best || b.n > best.n) best = b; });
    return best
      ? `rgb(${Math.round(best.r / best.n)}, ${Math.round(best.g / best.n)}, ${Math.round(best.b / best.n)})`
      : null;
  } catch (e) {
    return null; // e.g. image from another origin without CORS: keep the default colour
  }
}

/* ------------------------------------------------------------- title fit */

/**
 * Shrinks a slide's heading until every authored line fits on one line (no extra
 * wrapping) and the text still fits inside the banner. Starts from the CSS font size,
 * so a short heading keeps the full size and only longer ones get smaller.
 */
function fitTitles(slides) {
  const desktop = window.matchMedia('(min-width: 900px)').matches;
  slides.forEach((slide) => {
    const title = slide.querySelector('.hero-carousel-title');
    const content = slide.querySelector('.hero-carousel-content');
    if (!title || !content) return;

    title.style.fontSize = '';
    let size = parseFloat(window.getComputedStyle(title).fontSize);
    if (!size || !slide.clientWidth) return; // not laid out yet

    let maxHeight = Infinity; // on mobile the banner simply grows with the text
    if (desktop) {
      const cs = window.getComputedStyle(slide);
      const bannerHeight = Math.max((slide.clientWidth * 547) / 949, 480);
      maxHeight = bannerHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    }

    const overflows = () => title.scrollWidth > title.clientWidth + 1
      || content.offsetHeight > maxHeight + 1;

    for (let i = 0; i < 60 && overflows() && size > TITLE_MIN_FONT; i += 1) {
      size = Math.max(TITLE_MIN_FONT, size * 0.95);
      title.style.fontSize = `${size}px`;
    }
  });
}

/* ------------------------------------------------------------------- block */

export default function decorate(block) {
  // makes the CSS independent of how the block is spelled in the document
  block.classList.add('hero-carousel');
  if (block.parentElement) block.parentElement.classList.add('hero-carousel-wrapper');

  const redirect = block.classList.contains('cta-redirect');
  const rows = [...block.children];
  const total = rows.length;

  const slidesEl = document.createElement('ul');
  slidesEl.className = 'hero-carousel-slides';

  const thumbsEl = document.createElement('div');
  thumbsEl.className = 'hero-carousel-thumbs';

  const dotsEl = document.createElement('div');
  dotsEl.className = 'hero-carousel-dots';

  rows.forEach((row, i) => {
    // Authoring columns: 1 = image, 2 = content, 3 = (optional) thumbnail image
    const [imageCell, contentCell, thumbCell] = [...row.children];

    const slide = document.createElement('li');
    slide.className = 'hero-carousel-slide';
    slide.setAttribute('role', 'group');
    slide.setAttribute('aria-roledescription', 'slide');
    slide.setAttribute('aria-label', `${i + 1} of ${total}`);

    const imageWrap = document.createElement('div');
    imageWrap.className = 'hero-carousel-image';
    const picture = buildPicture(imageCell, IMAGE_BREAKPOINTS, i === 0);
    if (picture) imageWrap.append(picture);
    slide.append(imageWrap, buildContent(contentCell, redirect));

    const thumb = document.createElement('button');
    thumb.type = 'button';
    thumb.className = 'hero-carousel-thumb';
    thumb.setAttribute('aria-label', `Go to slide ${i + 1}`);
    const thumbPicture = buildPicture(thumbCell, THUMB_BREAKPOINTS, false)
      || buildPicture(imageCell, THUMB_BREAKPOINTS, false);
    if (thumbPicture) thumb.append(thumbPicture);
    thumbsEl.append(thumb);

    const dot = document.createElement('button');
    dot.type = 'button';
    dot.className = 'hero-carousel-dot';
    dot.setAttribute('aria-label', `Go to slide ${i + 1}`);
    dotsEl.append(dot);

    slidesEl.append(slide);
  });

  const prev = document.createElement('button');
  prev.type = 'button';
  prev.className = 'hero-carousel-arrow hero-carousel-prev';
  prev.setAttribute('aria-label', 'Previous slide');
  prev.innerHTML = ICON_PREV;

  const next = document.createElement('button');
  next.type = 'button';
  next.className = 'hero-carousel-arrow hero-carousel-next';
  next.setAttribute('aria-label', 'Next slide');
  next.innerHTML = ICON_NEXT;

  const nav = document.createElement('div');
  nav.className = 'hero-carousel-nav';
  nav.append(prev, next, dotsEl);

  const autoplay = block.classList.contains('autoplay')
    && total > 1
    && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  slidesEl.setAttribute('aria-live', autoplay ? 'off' : 'polite');

  block.textContent = '';
  block.setAttribute('role', 'region');
  block.setAttribute('aria-roledescription', 'carousel');
  block.setAttribute('aria-label', 'Hero banner');
  block.append(slidesEl);

  const slides = [...slidesEl.children];
  const thumbs = [...thumbsEl.children];
  const dots = [...dotsEl.children];

  let current = 0;
  let timer = null;

  // each slide's background colour, sampled from its image (shown below the image on mobile)
  const colors = [];
  const applyColor = () => {
    if (colors[current]) block.style.setProperty('--hero-bg', colors[current]);
    else block.style.removeProperty('--hero-bg');
  };
  slides.forEach((slide, i) => {
    const img = slide.querySelector('.hero-carousel-image img');
    if (!img) return;
    const sample = () => {
      colors[i] = getEdgeColor(img);
      if (i === current) applyColor();
    };
    if (img.complete && img.naturalWidth) sample();
    else img.addEventListener('load', sample, { once: true });
  });

  function goTo(index) {
    current = (index + total) % total;
    slides.forEach((slide, i) => {
      const active = i === current;
      slide.classList.toggle('active', active);
      slide.setAttribute('aria-hidden', String(!active));
      slide.inert = !active; // keeps hidden slides' CTA out of the tab order
    });
    thumbs.forEach((t, i) => t.classList.toggle('active', i === current));
    applyColor();
    dots.forEach((d, i) => {
      d.classList.toggle('active', i === current);
      if (i === current) d.setAttribute('aria-current', 'true');
      else d.removeAttribute('aria-current');
    });
  }

  /* autoplay: runs only with the `autoplay` variant */
  const stop = () => {
    clearInterval(timer);
    timer = null;
  };
  const start = () => {
    if (!autoplay || timer || document.hidden) return;
    timer = setInterval(() => goTo(current + 1), AUTOPLAY_INTERVAL);
  };
  // any user navigation (arrows, dots, thumbnails, keys, swipe) restarts the countdown
  const go = (index) => {
    goTo(index);
    if (autoplay) {
      stop();
      start();
    }
  };

  if (total > 1) {
    block.append(thumbsEl, nav);
    prev.addEventListener('click', () => go(current - 1));
    next.addEventListener('click', () => go(current + 1));
    thumbs.forEach((t, i) => t.addEventListener('click', () => go(i)));
    dots.forEach((d, i) => d.addEventListener('click', () => go(i)));

    block.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') go(current - 1);
      if (e.key === 'ArrowRight') go(current + 1);
    });

    let startX = null;
    slidesEl.addEventListener('touchstart', (e) => { startX = e.touches[0].clientX; }, { passive: true });
    slidesEl.addEventListener('touchend', (e) => {
      if (startX === null) return;
      const dx = e.changedTouches[0].clientX - startX;
      startX = null;
      if (Math.abs(dx) > 50) go(dx < 0 ? current + 1 : current - 1);
    });

    if (autoplay) {
      // pause only for keyboard focus (a mouse click on an arrow must not pause it)
      block.addEventListener('focusin', (e) => {
        if (e.target.matches(':focus-visible')) stop();
      });
      block.addEventListener('focusout', (e) => {
        if (!block.contains(e.relatedTarget)) start();
      });
      if (PAUSE_ON_HOVER) {
        block.addEventListener('mouseenter', stop);
        block.addEventListener('mouseleave', start);
      }
      document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
    }
  }

  // AC1 + AC3: the banner is clickable but does not navigate anywhere.
  // Only an event is emitted, so analytics / future behaviour can hook in.
  slides.forEach((slide, i) => {
    slide.addEventListener('click', () => {
      block.dispatchEvent(new CustomEvent('hero-carousel:banner-click', { bubbles: true, detail: { index: i } }));
    });

    // AC2: CTA is clickable. It navigates only with the `cta-redirect` variant.
    const cta = slide.querySelector('.hero-carousel-cta');
    if (cta) {
      cta.addEventListener('click', (e) => {
        e.stopPropagation();
        block.dispatchEvent(new CustomEvent('hero-carousel:cta-click', {
          bubbles: true,
          detail: { index: i, href: cta.dataset.href || cta.getAttribute('href'), redirect },
        }));
      });
    }
  });

  goTo(0);
  start();

  // keep the heading inside the banner: on first display, on resize and once fonts load
  let fitFrame = 0;
  const scheduleFit = () => {
    cancelAnimationFrame(fitFrame);
    fitFrame = requestAnimationFrame(() => fitTitles(slides));
  };
  let lastWidth = 0;
  new ResizeObserver(() => {
    if (block.clientWidth !== lastWidth) {
      lastWidth = block.clientWidth;
      scheduleFit();
    }
  }).observe(block);
  if (document.fonts) {
    document.fonts.ready.then(scheduleFit);
    document.fonts.addEventListener('loadingdone', scheduleFit);
  }
}