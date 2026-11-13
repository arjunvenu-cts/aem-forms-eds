const LABEL = 'USE CODE :';

/* Builds the ticket with an inner content wrapper matching 271x44px dimensions */
export function buildTicket(code) {
  const ticket = document.createElement('div');
  ticket.className = 'coupon-ticket';

  const content = document.createElement('div');
  content.className = 'coupon-content';

  const label = document.createElement('span');
  label.className = 'coupon-label';
  label.textContent = LABEL;

  const codeEl = document.createElement('span');
  codeEl.className = 'coupon-code';
  codeEl.textContent = code;

  content.append(label, codeEl);
  ticket.append(content);
  return ticket;
}

export default function decorate(block) {
  /* Defensive: authors may add extra cells / wrap the code in a link; take the plain text. */
  const code = block.textContent.trim();
  block.replaceChildren(buildTicket(code));
  if (!code) block.classList.add('coupon-empty');
}