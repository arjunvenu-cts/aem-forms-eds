/*
 * Coupon block: a reusable "USE CODE : <code>" ticket.
 * Only the coupon code is authored (e.g. "DRIP50"); the label and styling come from code.
 *
 * Reusable like the try-on button: author it as its own block, and a host block (e.g. the
 * banner) can import `buildTicket` and place the ticket inside itself. Used on its own, the
 * default decorate renders the ticket in place.
 *
 * Authoring (single cell):
 *   | Coupon  |
 *   | DRIP50  |
 */

const LABEL = 'USE CODE :';

/* Builds the ticket (label + code) element; shared by the banner and the standalone block. */
export function buildTicket(code) {
  const ticket = document.createElement('div');
  ticket.className = 'coupon-ticket';

  const label = document.createElement('span');
  label.className = 'coupon-label';
  label.textContent = LABEL;

  const codeEl = document.createElement('span');
  codeEl.className = 'coupon-code';
  codeEl.textContent = code;

  ticket.append(label, codeEl);
  return ticket;
}

export default function decorate(block) {
  /* Defensive: authors may add extra cells / wrap the code in a link; take the plain text. */
  const code = block.textContent.trim();
  block.replaceChildren(buildTicket(code));
  if (!code) block.classList.add('coupon-empty');
}
