/*
 * HERO CAROUSEL BLOCK
 * ===================
 * What it shows: the big banner at the top of the home page. It has a background image, a
 * small label line (the "eyebrow"), a large heading, a short description and a button.
 * Under the text there is a row of small preview pictures (thumbnails) and a row of
 * left / right arrows with dots.
 *
 * How it is written in the document (one table row per slide):
 *   column 1 - the image (1st image = desktop, optional 2nd image = mobile)
 *   column 2 - the text: label line, heading (a Heading style or all-bold lines), description
 *   column 3 - (optional) the thumbnail image; the slide image is used when left empty
 *
 * The button is NOT written inside this block. Add a separate "Try On Info (button)" block
 * on the page: its link text becomes the button label and its link the button destination.
 *
 * Option (written in brackets after the block name, e.g. "Hero Carousel (no-redirect)"):
 *   no-redirect - the button is clickable but never leaves the page, even with a real link
 *
 * Current state: the carousel part (arrows, dots, thumbnail clicks, swipe and autoplay) is
 * switched OFF. The arrows, dots and thumbnails are still shown as in the design, but they
 * do nothing when clicked. The code for it is kept, commented out, in the places marked
 * "CAROUSEL FUNCTIONALITY - SWITCHED OFF" so it can be turned back on later.
 *
 * Events this block sends (for analytics or future features):
 *   hero-carousel:banner-click - someone clicked on a slide
 *   hero-carousel:cta-click    - someone clicked the button
 */
import { loadCSS } from '../../scripts/aem.js';

/* ----------------------------------------------------------------- settings */

/*
 * CAROUSEL FUNCTIONALITY - SWITCHED OFF (kept for later, do not delete).
 * To turn the carousel back on, uncomment the three settings in the block below and the other
 * blocks marked "CAROUSEL FUNCTIONALITY - SWITCHED OFF" further down.
 *   AUTOPLAY_INTERVAL - how long each slide stays before auto-advancing (milliseconds)
 *   CONTROLS_ENABLED  - true = arrows, dots and thumbnails work; false = shown only
 *   PAUSE_ON_HOVER    - true = autoplay pauses while the mouse is over the banner
 */
/*
const AUTOPLAY_INTERVAL = 5000;
const CONTROLS_ENABLED = false;
const PAUSE_ON_HOVER = false;
*/

/* The heading shrinks to fit the banner, but never below this size (in pixels). */
const TITLE_MIN_FONT = 28;

/* Small pictures (SVG) drawn inside the round left / right arrow buttons. */
const ICON_PREV = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false"><path d="M19 12H5M11 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON_NEXT = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false"><path d="M5 12h14M13 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/* HTML tags that start a new line of text when the text cell is read (see collectLines). */
const CONTAINER_TAGS = new Set(['P', 'DIV', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6']);
/* Matches text that is just a link or "#" (such text is not shown as description). */
const URL_LIKE = /^(#|\/|https?:\/\/)\S*$/i;

/* ------------------------------------------------------------------ images */

/* Screen width where the layout switches from mobile to desktop (same as the CSS). */
const DESKTOP_MEDIA = '(width >= 900px)'; /* same breakpoint as the CSS */
/* File endings that count as a picture. */
const IMAGE_EXT = /\.(avif|gif|jpe?g|png|svg|webp)(\?.*)?$/i;

/*
 * WHAT IT DOES: turns a typed picture path into a clean web address (fixes slashes, adds a
 * leading "/"). Returns nothing if the text is not a picture file name.
 */
/** "assets\img\x.png" -> "/assets/img/x.png"; full URLs are kept as they are. */
function toImageUrl(text) {
  const clean = (text || '').trim().replace(/\\/g, '/');
  if (!clean || !IMAGE_EXT.test(clean)) return null;
  if (/^(https?:)?\/\//i.test(clean) || clean.startsWith('/')) return clean;
  return `/${clean.replace(/^\.?\//, '')}`;
}

/*
 * WHAT IT DOES: finds the pictures in a table cell, in the order they were written. Works for
 * uploaded pictures, picture links and typed paths like /assets/images/banner.png.
 */
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

/*
 * WHAT IT DOES: asks the server for a smaller copy of an uploaded picture (faster loading).
 * Pictures stored in /assets/ are used as they are.
 */
/** Uploaded (media bus) images can be resized by URL; files in /assets/ are served as-is. */
function sized(src, width) {
  if (!src || !src.includes('media_')) return src;
  const url = new URL(src, window.location.href);
  url.searchParams.set('width', width);
  url.searchParams.set('format', 'webply');
  url.searchParams.set('optimize', 'medium');
  return url.pathname + url.search;
}

/*
 * WHAT IT DOES: builds the picture shown behind a slide. It uses the desktop image on wide
 * screens and the mobile image (or the same one) on small screens. Only the first slide loads
 * straight away; the others load later to keep the page fast.
 */
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

/*
 * WHAT IT DOES: reads the text cell and splits it into separate lines (a new paragraph, a
 * heading or a line break starts a new line). For every line it notes whether it is a heading
 * (Heading style or fully bold) and whether it contains a link.
 */
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

/*
 * WHAT IT DOES: decides if the button link is a real destination. A "#" or empty link, or a
 * link to the same page, is not real, so the button stays on the page.
 */
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

/*
 * WHAT IT DOES: creates the "Shop" button using the shared button from the try-on-info block
 * (same look everywhere on the site). A real link opens that page; otherwise the button is
 * clickable but goes nowhere.
 */
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
  wrap.className = 'try-on-info hero-carousel-cta-wrap'; /* `.try-on-info` scopes the shared styles */
  const cta = tryOn.createTryOnButton(
    { label, href: redirect ? href : '#' },
    'try-on-info-button hero-carousel-cta',
  );
  cta.dataset.href = href;
  wrap.append(cta);
  return wrap;
}

/*
 * WHAT IT DOES: puts each heading line in its own piece. On desktop the lines are stacked;
 * on mobile they run together on one line (controlled by the CSS).
 */
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

/* WHAT IT DOES: joins text lines together with a line break between them. */
function textWithBreaks(lines) {
  const frag = document.createDocumentFragment();
  lines.forEach((line, i) => {
    if (i > 0) frag.append(document.createElement('br'));
    frag.append(line.text);
  });
  return frag;
}

/*
 * WHAT IT DOES: builds the text side of a slide: label line, heading, description and button.
 * It decides which line is which from how the text is formatted (see the rules below).
 */
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
      /*
       * links / bare URLs written in this block are ignored: the CTA is authored
       * separately as a "Try On Info (button)" block
       */
    } else if (line.heading) {
      title.push(line);
    } else if (title.length === 0) {
      eyebrow.push(line);
    } else {
      description.push(line);
    }
  });

  /* no heading authored: nothing to call an eyebrow, treat it all as description */
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
  /* CTA only exists when a "Try On Info (button)" block has been authored on the page */
  if (ctaLink && tryOn) {
    const redirect = !noRedirect && isRealLink(ctaLink.href, ctaLink.href);
    const ctaEl = buildCta(ctaLink.label, ctaLink.href, redirect, tryOn);
    if (ctaEl) content.append(ctaEl);
  }

  return content;
}

/* ------------------------------------------------------- background colour */

/*
 * WHAT IT DOES: looks at the bottom edge of a picture and returns its most common colour.
 * That colour is used as the banner background so the picture blends into the area below it
 * on mobile. If the browser does not allow reading the picture, nothing is returned and the
 * default purple is kept.
 */
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
    const { data } = ctx.getImageData(0, size - 4, size, 4); /* bottom 4 rows */
    const buckets = new Map();
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] >= 200) {
        const key = `${data[i] >> 4},${data[i + 1] >> 4},${data[i + 2] >> 4}`; /* eslint-disable-line no-bitwise */
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
    return null; /* e.g. image from another origin without CORS: keep the default colour */
  }
}

/* ------------------------------------------------------------- title fit */

/*
 * WHAT IT DOES: makes sure the heading never runs out of the banner. It starts at the normal
 * size and makes it a little smaller, step by step, until every line fits and the whole text
 * block fits inside the banner. Short headings keep the full size.
 */
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
    if (!size || !slide.clientWidth) return; /* not laid out yet */

    let maxHeight = Infinity; /* on mobile the banner simply grows with the text */
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

/*
 * WHAT IT DOES: this is the main function. The site calls it once for every hero block on the
 * page. It reads the authored table and replaces it with the finished banner.
 */
export default async function decorate(block) {
  /*
   * ---- Step 1: load the shared "Shop" button (only if the page has one) ------------------
   * The button's code and styles live in the try-on-info block. They are loaded only when a
   * "Try On Info (button)" block is on the page; without it the banner has no button.
   */
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
      /*
       * The shared button announces "open try-on" for "#" links. The banner must never open
       * that, so the announcement is stopped here.
       */
      block.addEventListener(mod.TRY_ON_EVENT, (e) => e.stopPropagation());
    } catch (e) {
      /* eslint-disable-next-line no-console */
      console.error('hero-carousel: could not load the shared CTA button', e);
    }
  }

  /*
   * ---- Step 2: prepare the block ---------------------------------------------------------
   * Add the class the styles are written for, whatever way the block name was spelled.
   */
  block.classList.add('hero-carousel');
  if (block.parentElement) block.parentElement.classList.add('hero-carousel-wrapper');

  const noRedirect = block.classList.contains('no-redirect'); /* the "(no-redirect)" option */
  const rows = [...block.children]; /* one authored row = one slide */
  const total = rows.length;

  /* Containers that will hold the slides, the thumbnails and the dots. */
  const slidesEl = document.createElement('ul');
  slidesEl.className = 'hero-carousel-slides';

  const thumbsEl = document.createElement('div');
  thumbsEl.className = 'hero-carousel-thumbs';

  const dotsEl = document.createElement('div');
  dotsEl.className = 'hero-carousel-dots';

  /* ---- Step 3: build every slide, its thumbnail and its dot ------------------------------ */
  rows.forEach((row, i) => {
    /* Table columns: 1 = image, 2 = text, 3 = (optional) thumbnail image */
    const [imageCell, contentCell, thumbCell] = [...row.children];

    const slide = document.createElement('li');
    slide.className = 'hero-carousel-slide';
    slide.setAttribute('role', 'group');
    slide.setAttribute('aria-roledescription', 'slide');
    slide.setAttribute('aria-label', `${i + 1} of ${total}`);

    /* The slide picture (first image = desktop, optional second image = mobile). */
    const imageWrap = document.createElement('div');
    imageWrap.className = 'hero-carousel-image';
    const [desktopImage, mobileImage] = readImages(imageCell);
    if (desktopImage) imageWrap.append(buildPicture(desktopImage, mobileImage, i === 0));
    /* Remember if a separate mobile image was authored (the styles then skip the mobile zoom). */
    slide.classList.toggle('has-mobile-image', Boolean(mobileImage));
    slide.append(imageWrap, buildContent(contentCell, noRedirect, tryOn, ctaLink));

    /* The small preview picture for this slide (third column, or the slide image). */
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

    /* The dot (pill) for this slide. */
    const dot = document.createElement('button');
    dot.type = 'button';
    dot.className = 'hero-carousel-dot';
    dot.setAttribute('aria-label', `Go to slide ${i + 1}`);
    dotsEl.append(dot);

    slidesEl.append(slide);
  });

  /* ---- Step 4: build the left / right arrow buttons and the row that holds them ---------- */
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

  /*
   * CAROUSEL FUNCTIONALITY - SWITCHED OFF (autoplay setting, kept for later).
   * Autoplay only ran with the "(autoplay)" option, with more than one slide, and for people
   * who have not asked their device to reduce motion.
   */
  /*
  const autoplay = block.classList.contains('autoplay')
    && total > 1
    && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  slidesEl.setAttribute('aria-live', autoplay ? 'off' : 'polite');
  */
  /* Screen readers announce a slide change politely (no automatic changes are happening now). */
  slidesEl.setAttribute('aria-live', 'polite');

  /* ---- Step 5: replace the authored table with the finished banner ----------------------- */
  block.textContent = '';
  block.setAttribute('role', 'region');
  block.setAttribute('aria-roledescription', 'carousel');
  block.setAttribute('aria-label', 'Hero banner');
  block.append(slidesEl);

  const slides = [...slidesEl.children];
  const thumbs = [...thumbsEl.children];
  const dots = [...dotsEl.children];

  let current = 0; /* number of the slide that is showing (0 = first) */
  /*
   * CAROUSEL FUNCTIONALITY - SWITCHED OFF (autoplay timer, kept for later).
   * The timer is the clock that moves to the next slide.
   */
  /*
  let timer = null;
  */

  /*
   * ---- Step 6: background colour taken from each slide's picture -------------------------
   * The colour under the picture (mobile) follows the active slide's picture, so the two blend.
   */
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
    /* Read the colour as soon as the picture has loaded. */
    if (img.complete && img.naturalWidth) sample();
    else img.addEventListener('load', sample, { once: true });
  });

  /*
   * ---- Step 7: show one slide ------------------------------------------------------------
   * WHAT IT DOES: makes the chosen slide visible and hides the others. It also highlights the
   * matching thumbnail and dot and updates the background colour. It is used once at the start
   * to show the first slide (and by the switched-off carousel code to move between slides).
   */
  function goTo(index) {
    current = (index + total) % total; /* wraps around: after the last slide comes the first */
    slides.forEach((slide, i) => {
      const active = i === current;
      slide.classList.toggle('active', active);
      slide.setAttribute('aria-hidden', String(!active));
      slide.inert = !active; /* keeps hidden slides' button out of the keyboard Tab order */
    });
    thumbs.forEach((t, i) => t.classList.toggle('active', i === current));
    applyColor();
    dots.forEach((d, i) => {
      d.classList.toggle('active', i === current);
      if (i === current) d.setAttribute('aria-current', 'true');
      else d.removeAttribute('aria-current');
    });
  }

  /* ---- Step 8: arrows, dots and thumbnails (shown, but not working) ---------------------- */
  if (total > 1) {
    /* Show the thumbnails and the arrow / dot row (only when there is more than one slide). */
    block.append(thumbsEl, nav);

    /*
     * They look as in the design but are switched off: they are marked as disabled for screen
     * readers and skipped by the Tab key. Clicking them does nothing.
     */
    [prev, next, ...dots, ...thumbs].forEach((btn) => {
      btn.setAttribute('aria-disabled', 'true');
      btn.tabIndex = -1;
    });
  }

  /*
   * =====================================================================================
   * CAROUSEL FUNCTIONALITY - SWITCHED OFF (kept for later, do not delete)
   * Everything below up to the closing marker is the code that moves between slides: autoplay,
   * the arrow / dot / thumbnail clicks, the keyboard arrow keys and swipe on touch screens.
   * What the disabled code does, in order:
   *   - autoplay: a clock that moves to the next slide, and a way to stop and start it
   *   - any manual move (arrow, dot, thumbnail, key, swipe) restarts the countdown
   *   - clicking a thumbnail, arrow or dot moves to that slide
   *   - the left / right keyboard keys also move between slides
   *   - swipe left / right on a touch screen
   *   - autoplay pauses while the keyboard is used inside the banner and while the tab is hidden
   * To turn it back on:
   *   1. uncomment the settings at the top of this file, the "autoplay setting" and "autoplay
   *      timer" lines above, and this whole section;
   *   2. delete the "disabled" loop in Step 8 (the one that sets aria-disabled);
   *   3. remove the matching "[aria-disabled]" rules in hero-carousel.css.
   * =====================================================================================
   */
  /*
  const stop = () => {
    clearInterval(timer);
    timer = null;
  };
  const start = () => {
    if (!autoplay || timer || document.hidden) return;
    timer = setInterval(() => goTo(current + 1), AUTOPLAY_INTERVAL);
  };
  const go = (index) => {
    goTo(index);
    if (autoplay) {
      stop();
      start();
    }
  };
  if (total > 1) {
    if (CONTROLS_ENABLED) {
      thumbs.forEach((t, i) => t.addEventListener('click', () => go(i)));
      prev.addEventListener('click', () => go(current - 1));
      next.addEventListener('click', () => go(current + 1));
      dots.forEach((d, i) => d.addEventListener('click', () => go(i)));
      block.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowLeft') go(current - 1);
        if (e.key === 'ArrowRight') go(current + 1);
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
  */
  /*
   * END OF CAROUSEL FUNCTIONALITY - SWITCHED OFF
   */

  /*
   * ---- Step 9: clicks on the banner and on the button -------------------------------------
   * Clicking the banner does not open anything. It only sends a "banner-click" event so that
   * analytics or a future feature can react to it.
   */
  slides.forEach((slide, i) => {
    slide.addEventListener('click', () => {
      block.dispatchEvent(new CustomEvent('hero-carousel:banner-click', { bubbles: true, detail: { index: i } }));
    });

    /*
     * The button is clickable. It opens a page only when it was authored with a real link
     * (see isRealLink). Either way a "cta-click" event is sent.
     */
    const cta = slide.querySelector('.hero-carousel-cta');
    if (cta) {
      cta.addEventListener('click', (e) => {
        e.stopPropagation(); /* so the click is not also counted as a banner click */
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

  /* Show the first slide. */
  goTo(0);
  /*
   * CAROUSEL FUNCTIONALITY - SWITCHED OFF: starts the autoplay clock.
   */
  /*
  start();
  */

  /*
   * ---- Step 10: keep the heading inside the banner ----------------------------------------
   * The heading is re-fitted when the banner first appears, when the window is resized and
   * when the web fonts finish loading (fonts change the text width).
   */
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