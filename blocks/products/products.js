import { createOptimizedPicture } from '../../scripts/aem.js';
import {
  filterProducts, getCurrentFilters, normalizeProduct, onFiltersChanged,
} from '../filter/filter.js';
import { getCurrentSort, onSortChanged, sortProductList } from '../sort/sort.js';
import { pdpUrl, rowSku } from '../../scripts/pdp.js';
import { createTryOnButton, readTryOnLink } from '../try-on-info/try-on-info.js';

/*
* Products block: one block, two modes (chosen in DA.live)
*   PLP:  filter + sort + toolbar + "Show me more"
*   PDP (collection): fixed list of cards (no filter/sort/toolbar)
*
* Both modes now share the exact same card HTML structure & CSS classes.
*/

const PAGE_SIZE = 6;
const DEFAULT_LIMIT = 4;

/* ---------- shared helpers ---------- */

function readConfig(block) {
  const keyed = {};
  [...block.children].forEach((row) => {
    const [keyCell, valueCell] = row.children;
    if (keyCell && valueCell) {
      keyed[keyCell.textContent.trim().toLowerCase().replace(/[^a-z]/g, '')] = valueCell;
    }
  });
  const pick = (...names) => names.map((name) => keyed[name]).find(Boolean);
  const text = (cell) => (cell ? cell.textContent.trim() : '');

  const sourceCell = pick('source', 'path', 'data', 'jsonurl', 'json', 'url');
  const link = (sourceCell || block).querySelector('a[href]');
  let source = null;
  if (link) {
    source = link.getAttribute('href');
  } else if (sourceCell) {
    source = text(sourceCell) || null;
  } else if (!Object.keys(keyed).length) {
    const cells = block.querySelectorAll(':scope > div > div');
    source = (cells.length ? cells[cells.length - 1] : block).textContent.trim() || null;
  }

  return {
    source,
    limit: parseInt(text(pick('limit', 'count')), 10) || DEFAULT_LIMIT,
    filter: text(pick('filter')),
  };
}

async function fetchProducts(path) {
  try {
    const resp = await fetch(path);
    if (!resp.ok) return [];
    const json = await resp.json();
    if (Array.isArray(json.data)) return json.data;
    const firstSheet = Object.values(json).find((v) => v && Array.isArray(v.data));
    return firstSheet ? firstSheet.data : [];
  } catch (e) {
    return [];
  }
}

function findTryOnLink(block) {
  const source = block.closest('.section')?.querySelector('.try-on-info.button')
    || document.querySelector('.try-on-info.button');
  return readTryOnLink(source);
}

function toProduct(row) {
  const clean = {};
  Object.entries(row).forEach(([key, value]) => {
    clean[key.trim().toLowerCase()] = typeof value === 'string' ? value.trim() : value;
  });
  const product = normalizeProduct(clean);
  const sheetUrl = product.url && product.url !== '#' ? product.url : '';
  product.sku = rowSku(row);
  product.url = pdpUrl(product.sku) || sheetUrl;
  return product;
}

function money(value) {
  return Number.isFinite(value) ? `$${value.toFixed(2)}` : '';
}

function moneyShort(value) {
  if (!Number.isFinite(value)) return '';
  return Number.isInteger(value) ? `$${value}` : money(value);
}

function discountPercent(product) {
  const { price, salePrice } = product;
  if (!Number.isFinite(salePrice) || !Number.isFinite(price) || price <= 0 || salePrice >= price) return 0;
  return Math.round(((price - salePrice) / price) * 100);
}

/* ---------- card builder (used by both PDP & PLP) ---------- */

function buildImage(image) {
  const wrap = document.createElement('div');
  wrap.className = 'products-card-image';
  if (!image) {
    wrap.classList.add('is-empty');
    return wrap;
  }

  let node;
  try {
    node = createOptimizedPicture(image, '', false, [{ width: '750' }]);
  } catch (e) {
    node = document.createElement('img');
    node.src = image;
    node.alt = '';
    node.loading = 'lazy';
  }
  const img = node.tagName === 'IMG' ? node : node.querySelector('img');
  if (img) {
    img.addEventListener('error', () => {
      node.remove();
      wrap.classList.add('is-empty');
    });
  }
  wrap.append(node);
  return wrap;
}

function buildPrices(product) {
  const row = document.createElement('div');
  row.className = 'products-card-prices';

  const regular = moneyShort(product.price);
  const onSale = Number.isFinite(product.salePrice);

  if (onSale && regular) {
    const sale = document.createElement('span');
    sale.className = 'products-card-price';
    sale.innerHTML = '<span class="products-sr-only">Sale price </span>';
    sale.append(money(product.salePrice));

    const was = document.createElement('s');
    was.className = 'products-card-was';
    was.innerHTML = '<span class="products-sr-only">Regular price </span>';
    was.append(regular);

    row.append(sale, was);

    const percent = discountPercent(product);
    if (percent > 0) {
      const badge = document.createElement('span');
      badge.className = 'products-card-discount';
      badge.innerHTML = '<span class="products-sr-only">Discount </span>';
      badge.append(`-${percent}%`);
      row.append(badge);
    }
    return row;
  }

  const main = money(product.salePrice) || money(product.price);
  if (main) {
    const mainEl = document.createElement('span');
    mainEl.className = 'products-card-price';
    mainEl.textContent = main;
    row.append(mainEl);
  }
  return row;
}

function buildReviewsButton(product) {
  const count = product.reviews;
  const word = count === 1 ? 'review' : 'reviews';
  const label = `${count} ${word}`;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'products-card-reviews';
  const wordEl = document.createElement('span');
  wordEl.className = 'products-card-reviews-word';
  wordEl.textContent = ` ${word}`;
  btn.append(String(count), wordEl);
  if (product.title) btn.setAttribute('aria-label', `${label} for ${product.title}`);
  btn.addEventListener('click', () => {
    btn.dispatchEvent(new CustomEvent('product-reviews-click', {
      bubbles: true,
      detail: { id: product.id, title: product.title, reviews: count },
    }));
  });
  return btn;
}

function buildRating(product) {
  const rating = Math.min(5, Math.max(0, product.ratings));
  const hasReviews = product.reviews > 0;
  if (!rating && !hasReviews) return null;

  const row = document.createElement('div');
  row.className = 'products-card-rating';

  if (rating) {
    const stars = document.createElement('span');
    stars.className = 'products-card-stars';
    stars.setAttribute('role', 'img');
    stars.setAttribute('aria-label', `Rated ${rating} out of 5`);
    stars.style.setProperty('--rating', rating);
    stars.textContent = '★★★★★';
    row.append(stars);
  }

  if (hasReviews) row.append(buildReviewsButton(product));
  return row;
}

function buildCard(product, tryOnLink) {
  const titleText = product.title;
  const href = product.url || '#';

  const li = document.createElement('li');
  li.className = 'products-card';

  const media = document.createElement('div');
  media.className = 'products-card-media';
  const imageLink = document.createElement('a');
  imageLink.className = 'products-card-image-link';
  imageLink.href = href;
  if (titleText) imageLink.setAttribute('aria-label', titleText);
  imageLink.append(buildImage(product.image));
  media.append(imageLink);

  const body = document.createElement('div');
  body.className = 'products-card-body';

  const title = document.createElement('p');
  title.className = 'products-card-title';
  const link = document.createElement('a');
  link.className = 'products-card-link';
  link.href = href;
  link.textContent = titleText;
  title.append(link);

  body.append(title, buildPrices(product));
  const rating = buildRating(product);
  if (rating) body.append(rating);

  li.append(media, body);

  if (product.tryOn && tryOnLink) {
    li.append(createTryOnButton(tryOnLink, 'products-card-tryon', product));
  }
  return li;
}

/* ---------- PDP collection mode ---------- */

const toKey = (text) => (text || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function column(row, ...names) {
  const key = Object.keys(row).find((k) => names.includes(toKey(k)));
  return key ? `${row[key] ?? ''}`.trim() : '';
}

function matchesFilter(row, filter) {
  if (!filter || !filter.includes('=')) return true;
  const [name, value] = filter.split('=').map((s) => s.trim().toLowerCase());
  return column(row, toKey(name)).toLowerCase().split(',').map((v) => v.trim()).includes(value);
}

async function decorateCollection(block, { source, limit, filter }) {
  const list = document.createElement('ul');
  list.className = 'products-grid';
  list.setAttribute('aria-busy', 'true');

  for (let i = 0; i < limit; i += 1) {
    const skeleton = document.createElement('li');
    skeleton.className = 'products-card products-skeleton';
    const media = document.createElement('div');
    media.className = 'products-card-media';
    media.append(document.createElement('div'));
    skeleton.append(media);
    list.append(skeleton);
  }
  block.replaceChildren(list);

  try {
    if (!source) throw new Error('Source missing');
    const rows = await fetchProducts(source);
    const tryOnLink = findTryOnLink(block);
    const products = rows
      .filter((row) => matchesFilter(row, filter))
      .map(toProduct)
      .filter((p) => p.title)
      .slice(0, limit);

    list.replaceChildren(...products.map((p) => buildCard(p, tryOnLink)));
    if (!products.length) block.classList.add('products-empty');
  } catch (error) {
    console.error('products (collection):', error);
    list.replaceChildren();
    block.classList.add('products-empty');
  } finally {
    list.removeAttribute('aria-busy');
  }
}

/* ---------- PLP mode ---------- */

async function decorateListing(block, { source: path }) {
  block.textContent = '';

  let products = [];
  let filtered = [];
  let filters = getCurrentFilters();
  let sortBy = getCurrentSort();
  let shown = PAGE_SIZE;
  let loaded = false;
  let tryOnLink = null;

  const toolbar = document.createElement('div');
  toolbar.className = 'products-toolbar';

  const resultCount = document.createElement('p');
  resultCount.className = 'products-result-count';
  resultCount.setAttribute('aria-live', 'polite');
  resultCount.textContent = 'Loading products…';

  toolbar.append(resultCount);

  const grid = document.createElement('ul');
  grid.className = 'products-grid';

  const more = document.createElement('div');
  more.className = 'products-more';

  const moreBtn = document.createElement('button');
  moreBtn.type = 'button';
  moreBtn.className = 'products-more-btn';
  moreBtn.disabled = true;
  moreBtn.setAttribute('aria-disabled', 'true');

  const chevronIcon = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"></polyline></svg>';

  moreBtn.innerHTML = `<span>SHOW ME MORE</span>${chevronIcon}`;
  more.append(moreBtn);

  function updateToolbar() {
    const total = filtered.length;
    if (total) {
      const isMobile = window.matchMedia('(max-width: 899px)').matches;
      const countText = `Showing 1-${Math.min(shown, total)}`;
      const totalText = `of ${total} products`;

      resultCount.innerHTML = isMobile
        ? `${countText}<br>${totalText}`
        : `${countText} ${totalText}`;
    } else {
      resultCount.textContent = 'No products found';
    }
    more.hidden = total === 0 || shown >= total;
  }
  window.addEventListener('resize', updateToolbar);

  function render() {
    const total = filtered.length;
    if (total) {
      grid.replaceChildren(...filtered.slice(0, shown).map((product) => buildCard(product, tryOnLink)));
    } else {
      const empty = document.createElement('li');
      empty.className = 'products-empty';
      empty.textContent = 'No products match these filters. Try removing a filter.';
      grid.replaceChildren(empty);
    }
    updateToolbar();
  }

  function renderMore() {
    const already = grid.querySelectorAll('.products-card').length;
    grid.append(...filtered.slice(already, shown).map((product) => buildCard(product, tryOnLink)));
    updateToolbar();
  }

  moreBtn.addEventListener('click', () => {
    shown = Math.min(shown + PAGE_SIZE, filtered.length);
    renderMore();
  });

  function applyFilters() {
    filtered = sortProductList(filterProducts(products, filters), sortBy);
    shown = PAGE_SIZE;
    render();
  }

  block.append(toolbar, grid, more);

  onFiltersChanged((next) => {
    filters = next;
    if (loaded) applyFilters();
  });

  onSortChanged((next) => {
    sortBy = next;
    if (loaded) applyFilters();
  });

  const rows = path ? await fetchProducts(path) : [];
  tryOnLink = findTryOnLink(block);
  products = rows.map(toProduct);
  loaded = true;
  applyFilters();
}

/* ---------- entry ---------- */

export default async function decorate(block) {
  const config = readConfig(block);
  if (block.classList.contains('collection')) {
    await decorateCollection(block, config);
  } else {
    await decorateListing(block, config);
  }
}