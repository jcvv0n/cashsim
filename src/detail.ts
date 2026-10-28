import { formatMoney } from "./format";
import { escapeHtml } from "./html";

export type DetailColumn = "income" | "fixed" | "bills" | "living" | "oneoff";

export interface DetailItem {
  name: string;
  meta?: string;
  amount: number; // signed cents
}

export interface DetailData {
  title: string;
  subtitle: string;
  items: DetailItem[];
  total: number;
}

let popover: HTMLElement | null = null;
let lastAnchor: HTMLElement | null = null;

export function initDetailPopover(): void {
  popover = document.getElementById("detail-popover");
  if (!popover) return;

  popover
    .querySelector<HTMLButtonElement>(".detail-close")
    ?.addEventListener("click", closeDetailPopover);

  document.addEventListener("click", (event) => {
    if (!popover || popover.hidden) return;

    const target = event.target;
    if (!(target instanceof Node)) return;
    if (popover.contains(target)) return;
    if (target instanceof Element && target.closest("[data-detail]")) return;

    closeDetailPopover();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && popover && !popover.hidden) {
      closeDetailPopover();
    }
  });

  window.addEventListener("resize", closeDetailPopover);

  window.addEventListener(
    "scroll",
    (event) => {
      if (!popover || popover.hidden) return;
      if (event.target instanceof Node && popover.contains(event.target)) {
        return;
      }
      closeDetailPopover();
    },
    true,
  );
}

export function openDetailPopover(
  anchor: HTMLElement,
  data: DetailData,
): void {
  if (!popover) return;

  lastAnchor = anchor;

  const title = popover.querySelector<HTMLElement>(".detail-title");
  const subtitle = popover.querySelector<HTMLElement>(".detail-sub");
  const list = popover.querySelector<HTMLElement>(".detail-list");
  const total = popover.querySelector<HTMLElement>(".detail-total strong");

  if (title) title.textContent = data.title;
  if (subtitle) subtitle.textContent = data.subtitle;

  if (list) {
    list.innerHTML = data.items
      .map(
        (item) => `
          <div class="detail-item">
            <div class="detail-item-main">
              <div class="detail-item-name">${escapeHtml(item.name)}</div>
              ${item.meta ? `<div class="detail-item-meta">${escapeHtml(item.meta)}</div>` : ""}
            </div>
            <div class="detail-item-amount ${item.amount < 0 ? "amount-neg" : "amount-pos"}">
              ${formatMoney(item.amount, { signed: true })}
            </div>
          </div>
        `,
      )
      .join("");
  }

  if (total) {
    total.textContent = formatMoney(data.total, { signed: true });
    total.classList.toggle("amount-neg", data.total < 0);
    total.classList.toggle("amount-pos", data.total > 0);
  }

  popover.hidden = false;
  popover.classList.remove("is-sheet");
  popover.style.left = "";
  popover.style.top = "";
  popover.style.right = "";
  popover.style.bottom = "";
  popover.style.width = "";

  if (window.innerWidth <= 720) {
    popover.classList.add("is-sheet");
  } else {
    const anchorRect = anchor.getBoundingClientRect();
    const popoverRect = popover.getBoundingClientRect();
    let left = anchorRect.left + anchorRect.width / 2 - popoverRect.width / 2;
    let top = anchorRect.bottom + 8;

    if (top + popoverRect.height > window.innerHeight - 12) {
      top = anchorRect.top - popoverRect.height - 8;
    }
    if (top < 12) top = 12;
    left = Math.max(
      12,
      Math.min(left, window.innerWidth - popoverRect.width - 12),
    );

    popover.style.left = `${left}px`;
    popover.style.top = `${top}px`;
  }

  popover
    .querySelector<HTMLButtonElement>(".detail-close")
    ?.focus({ preventScroll: true });
}

export function closeDetailPopover(): void {
  if (!popover || popover.hidden) return;

  popover.hidden = true;
  popover.classList.remove("is-sheet");

  const anchor = lastAnchor;
  lastAnchor = null;
  anchor?.focus({ preventScroll: true });
}
