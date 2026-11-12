import { loadCSS } from '../../scripts/aem.js';

const AUTOPLAY_INTERVAL = 5000; // ms, used when the block has the `autoplay` variant
const CONTROLS_ENABLED = false; // false: arrows, dots (pills) and thumbnails are shown but non-functional
const PAUSE_ON_HOVER = false; // set to true to pause autoplay while the mouse is over the banner
const TITLE_MIN_FONT = 28; // px, the heading never shrinks below this

const ICON_PREV = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false"><path d="M19 12H5M11 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON_NEXT = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false"><path d="M5 12h14M13 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const CONTAINER_TAGS = new Set(['P', 'DIV', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6']);
const URL_LIKE = /^(#|\/|https?:\/\/)\S*$/i;

/* ------------------------------------------------------------------ images */

const DESKTOP_MEDIA = '(width >= 900px)'; // same breakpoint as the CSS
const IMAGE_EXT = /\.(avif|gif|jpe?g|png|svg|webp)(\?.*)?$/i;

/** "assets\img\x.png" -> "/assets/img/x.png"; full URLs are kept as they are. */
function toImageUrl(text) {
  const clean = (text || '').trim().replace(/\\/g, '/');
  if (!clean || !IMAGE_EXT.test(clean)) return null;
  if (/^(https?:)?\/\//i.test(clean) || clean.startsWith('/')) return clean;
  return `/${clean.replace(/^\.?\//, '')}`;
}

/** Images in a cell, in authored order: uploaded <img>, image links, or typed paths. */
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

/** Uploaded (media bus) images can be resized by URL; files in /assets/ are served as-is. */
function sized(src, width) {
  if (!src || !src.includes('media_')) return src;
  const url = new URL(src, window.location.href);
  url.searchParams.set('width', width);
  url.searchParams.set('format', 'webply');
  url.searchParams.set('optimize', 'medium');
  return url.pathname + url.search;
}

/** <picture> that swaps between the desktop and mobile image at the 900px breakpoint. */
function buildPicture(desktop, mobile, eager) {
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
  img.loading = eager ? 'eager' : 'lazy';
  img.fetchPriority = eager ? 'high' : 'auto';
  img.decoding = 'async';
  img.draggable = false;
  picture.append(img);
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

/**
 * A CTA authored with a real link navigates to it. A placeholder ("#" or empty) or the
 * `no-redirect` variant gives a button that is clickable but goes nowhere.
 */
function isRealLink(raw, href) {
  if (!raw || raw.trim() === '' || raw.trim().startsWith('#')) return false;
  try {
    const url = new URL(href, window.location.href);
    const samePage = url.href.split('#')[0] === window.location.href.split('#')[0];
    return !(samePage && (url.hash === '' || url.hash === '#'));
  } catch (e) {
    return false;
  }
}

/**
 * The CTA is the shared button of the try-on-info block (same look, sparkle and hover).
 * - real link          -> normal <a> to that URL
 * - placeholder / `no-redirect` -> clickable <button> that goes nowhere
 * The shared button fires `try-on-info:open` for "#" links; that is stopped at the block
 * (see decorate) so the hero never opens the try-on flow.
 */
function buildCta(label, href, redirect, tryOn) {
  if (!tryOn) return null;
  const wrap = document.createElement('div');
  wrap.className = 'try-on-info hero-carousel-cta-wrap'; // `.try-on-info` scopes the shared styles
  const cta = tryOn.createTryOnButton(
    { label, href: redirect ? href : '#' },
    'try-on-info-button hero-carousel-cta',
  );
  cta.dataset.href = href;
  wrap.append(cta);
  return wrap;
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
function buildContent(cell, noRedirect, tryOn, ctaLink) {
  const content = document.createElement('div');
  content.className = 'hero-carousel-content';
  if (!cell) return content;

  const eyebrow = [];
  const title = [];
  const description = [];

  collectLines(cell).forEach((line) => {
    if (line.link || URL_LIKE.test(line.text)) {
      // links / bare URLs written in this block are ignored: the CTA is authored
      // separately as a "Try On Info (button)" block
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
  // CTA only exists when a "Try On Info (button)" block has been authored on the page
  if (ctaLink && tryOn) {
    const redirect = !noRedirect && isRealLink(ctaLink.href, ctaLink.href);
    const ctaEl = buildCta(ctaLink.label, ctaLink.href, redirect, tryOn);
    if (ctaEl) content.append(ctaEl);
  }

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

export default async function decorate(block) {
  // shared CTA button (JS + CSS live in the try-on-info block). Only loaded when a
  // "Try On Info (button)" block is authored on the page; without it there is no CTA.
  let tryOn = null;
  let ctaLink = null;
  const ctaSource = document.querySelector('.try-on-info.button');
  if (ctaSource) {
    try {
      const [mod] = await Promise.all([
        import('../try-on-info/try-on-info.js'),
        loadCSS(`${window.hlx.codeBasePath}/blocks/try-on-info/try-on-info.css`),
      ]);
      tryOn = mod;
      ctaLink = mod.readTryOnLink(ctaSource);
      // the hero must never open the try-on flow: swallow the shared button's event here
      block.addEventListener(mod.TRY_ON_EVENT, (e) => e.stopPropagation());
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('hero-carousel: could not load the shared CTA button', e);
    }
  }

  // makes the CSS independent of how the block is spelled in the document
  block.classList.add('hero-carousel');
  if (block.parentElement) block.parentElement.classList.add('hero-carousel-wrapper');

  const noRedirect = block.classList.contains('no-redirect');
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
    // column 1: first image = desktop, optional second image = mobile
    const [desktopImage, mobileImage] = readImages(imageCell);
    if (desktopImage) imageWrap.append(buildPicture(desktopImage, mobileImage, i === 0));
    slide.classList.toggle('has-mobile-image', Boolean(mobileImage));
    slide.append(imageWrap, buildContent(contentCell, noRedirect, tryOn, ctaLink));

    const thumb = document.createElement('button');
    thumb.type = 'button';
    thumb.className = 'hero-carousel-thumb';
    thumb.setAttribute('aria-label', `Go to slide ${i + 1}`);
    const thumbImage = readImages(thumbCell)[0] || desktopImage;
    if (thumbImage) {
      const thumbImg = document.createElement('img');
      thumbImg.src = sized(thumbImage.src, '400');
      thumbImg.alt = '';
      thumbImg.loading = 'lazy';
      thumbImg.decoding = 'async';
      thumbImg.draggable = false;
      thumb.append(thumbImg);
    }
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
    if (CONTROLS_ENABLED) {
      thumbs.forEach((t, i) => t.addEventListener('click', () => go(i)));
      prev.addEventListener('click', () => go(current - 1));
      next.addEventListener('click', () => go(current + 1));
      dots.forEach((d, i) => d.addEventListener('click', () => go(i)));
      block.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowLeft') go(current - 1);
        if (e.key === 'ArrowRight') go(current + 1);
      });
    } else {
      // shown as per design, but not interactive
      [prev, next, ...dots, ...thumbs].forEach((btn) => {
        btn.setAttribute('aria-disabled', 'true');
        btn.tabIndex = -1;
      });
    }

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

    // AC2: CTA is clickable. Navigates when authored with a real link (see isRealLink).
    const cta = slide.querySelector('.hero-carousel-cta');
    if (cta) {
      cta.addEventListener('click', (e) => {
        e.stopPropagation();
        block.dispatchEvent(new CustomEvent('hero-carousel:cta-click', {
          bubbles: true,
          detail: {
            index: i,
            href: cta.dataset.href || cta.getAttribute('href'),
            redirect: cta.tagName === 'A',
          },
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