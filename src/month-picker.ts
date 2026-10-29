import { currentMonth, formatMonth, isMonth } from "./engine/months";
import { formatMonthLong } from "./format";
import { escapeHtml } from "./html";

const CALENDAR_ICON = `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><rect x="2.2" y="3.4" width="11.6" height="10.6" rx="2"/><path d="M2.2 6.6h11.6M5.2 2.1v2.8M10.8 2.1v2.8"/></svg>`;

let activePicker: MonthPickerElement | null = null;
let pickerId = 0;

/**
 * 轻量月份选择器。内部保留一个 hidden input（name 可配置），
 * 因此现有的 FormData 读取逻辑无需改动；选择后派发冒泡的 change 事件。
 */
export class MonthPickerElement extends HTMLElement {
  private trigger: HTMLButtonElement | null = null;
  private hiddenInput: HTMLInputElement | null = null;
  private popoverElement: HTMLElement | null = null;
  private valueLabel: HTMLElement | null = null;
  private yearLabel: HTMLElement | null = null;
  private grid: HTMLElement | null = null;

  private pickedValue = "";
  private displayYear = new Date().getFullYear();
  private clearable = false;
  private built = false;
  private dialog: HTMLDialogElement | null = null;

  static get observedAttributes(): string[] {
    return ["value"];
  }

  connectedCallback(): void {
    if (!this.built) this.build();

    const attributeValue = this.getAttribute("value");
    if (isMonth(attributeValue)) this.pickedValue = attributeValue;
    this.sync();
  }

  disconnectedCallback(): void {
    this.close(false);
  }

  attributeChangedCallback(
    name: string,
    _oldValue: string | null,
    nextValue: string | null,
  ): void {
    if (name !== "value" || !this.built) return;
    this.pickedValue = isMonth(nextValue) ? nextValue : "";
    this.sync();
  }

  get value(): string {
    return this.pickedValue;
  }

  set value(nextValue: string) {
    this.pickedValue = isMonth(nextValue) ? nextValue : "";
    this.sync();
  }

  private build(): void {
    this.built = true;
    this.clearable = this.hasAttribute("clearable");

    const name = this.getAttribute("name") ?? "";
    const label = this.getAttribute("aria-label") ?? "选择月份";
    const popoverId = `mp-popover-${++pickerId}`;

    this.innerHTML = `
      <button
        type="button"
        class="mp-trigger"
        aria-haspopup="dialog"
        aria-expanded="false"
        aria-controls="${popoverId}"
        aria-label="${escapeHtml(label)}"
      >
        <span class="mp-value"></span>
        <span class="mp-icon">${CALENDAR_ICON}</span>
      </button>
      <input type="hidden"${name ? ` name="${escapeHtml(name)}"` : ""} />
      <div id="${popoverId}" class="mp-popover" role="dialog" aria-label="${escapeHtml(label)}" hidden>
        <div class="mp-head">
          <button type="button" class="mp-nav" data-nav="-1" aria-label="上一年">‹</button>
          <span class="mp-year"></span>
          <button type="button" class="mp-nav" data-nav="1" aria-label="下一年">›</button>
        </div>
        <div class="mp-grid"></div>
        <div class="mp-foot">
          <button type="button" data-action="current">本月</button>
          ${this.clearable ? '<button type="button" class="mp-clear" data-action="clear">清空</button>' : ""}
        </div>
      </div>
    `;

    this.trigger = this.querySelector<HTMLButtonElement>(".mp-trigger");
    this.hiddenInput = this.querySelector<HTMLInputElement>('input[type="hidden"]');
    this.popoverElement = this.querySelector<HTMLElement>(".mp-popover");
    this.valueLabel = this.querySelector<HTMLElement>(".mp-value");
    this.yearLabel = this.querySelector<HTMLElement>(".mp-year");
    this.grid = this.querySelector<HTMLElement>(".mp-grid");

    this.trigger?.addEventListener("click", () => this.toggle());
    this.popoverElement?.addEventListener("click", (event) =>
      this.onPopoverClick(event),
    );
  }

  private sync(): void {
    if (!this.hiddenInput || !this.trigger || !this.valueLabel) return;

    this.hiddenInput.value = this.pickedValue;
    this.valueLabel.textContent = this.pickedValue
      ? formatMonthLong(this.pickedValue)
      : "选择月份";
    this.trigger.classList.toggle("is-empty", !this.pickedValue);

    if (this.popoverElement && !this.popoverElement.hidden) {
      this.displayYear = this.yearOf(this.pickedValue);
      this.renderGrid();
    }
  }

  private yearOf(value: string): number {
    if (isMonth(value)) return Number(value.slice(0, 4));
    return new Date().getFullYear();
  }

  private toggle(): void {
    if (this.popoverElement && !this.popoverElement.hidden) {
      this.close(true);
    } else {
      this.open();
    }
  }

  private open(): void {
    if (!this.popoverElement || !this.trigger || !this.grid) return;

    if (activePicker && activePicker !== this) activePicker.close(false);
    activePicker = this;

    this.displayYear = this.yearOf(this.pickedValue);
    this.renderGrid();

    this.popoverElement.hidden = false;
    this.trigger.setAttribute("aria-expanded", "true");
    this.position();

    document.addEventListener("pointerdown", this.onPointerDown, true);
    document.addEventListener("keydown", this.onKeyDown, true);
    window.addEventListener("resize", this.onResize);

    const dialog = this.closest("dialog");
    if (dialog) {
      this.dialog = dialog;
      dialog.addEventListener("cancel", this.onDialogCancel);
    }

    const focusTarget =
      this.grid.querySelector<HTMLButtonElement>(".is-selected") ??
      this.grid.querySelector<HTMLButtonElement>(".is-current") ??
      this.grid.querySelector<HTMLButtonElement>("button");
    focusTarget?.focus({ preventScroll: true });
  }

  private close(returnFocus: boolean): void {
    const wasOpen = Boolean(
      this.popoverElement && !this.popoverElement.hidden,
    );

    if (this.popoverElement) this.popoverElement.hidden = true;
    this.trigger?.setAttribute("aria-expanded", "false");
    this.removeListeners();

    if (activePicker === this) activePicker = null;
    if (wasOpen && returnFocus) this.trigger?.focus({ preventScroll: true });
  }

  private removeListeners(): void {
    document.removeEventListener("pointerdown", this.onPointerDown, true);
    document.removeEventListener("keydown", this.onKeyDown, true);
    window.removeEventListener("resize", this.onResize);

    if (this.dialog) {
      this.dialog.removeEventListener("cancel", this.onDialogCancel);
      this.dialog = null;
    }
  }

  private position(): void {
    if (!this.popoverElement || !this.trigger) return;

    this.popoverElement.style.visibility = "hidden";
    const anchor = this.trigger.getBoundingClientRect();
    const width = this.popoverElement.offsetWidth;
    const height = this.popoverElement.offsetHeight;

    let left = anchor.left;
    let top = anchor.bottom + 6;

    if (left + width > window.innerWidth - 12) {
      left = window.innerWidth - width - 12;
    }
    if (left < 12) left = 12;
    if (top + height > window.innerHeight - 12) {
      top = anchor.top - height - 6;
    }
    if (top < 12) top = 12;

    this.popoverElement.style.left = `${left}px`;
    this.popoverElement.style.top = `${top}px`;
    this.popoverElement.style.visibility = "";
  }

  private renderGrid(): void {
    if (!this.grid || !this.yearLabel) return;

    this.yearLabel.textContent = `${this.displayYear}年`;
    const now = currentMonth();
    const buttons: string[] = [];

    for (let month = 1; month <= 12; month += 1) {
      const value = formatMonth(this.displayYear, month);
      const selected = value === this.pickedValue;
      const current = value === now;

      buttons.push(`
        <button
          type="button"
          class="mp-month${selected ? " is-selected" : ""}${current ? " is-current" : ""}"
          data-month="${value}"
          aria-pressed="${selected}"
        >
          ${month}月${current ? '<span class="mp-today-dot"></span>' : ""}
        </button>
      `);
    }

    this.grid.innerHTML = buttons.join("");
  }

  private onPopoverClick(event: MouseEvent): void {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const nav = target.closest<HTMLButtonElement>("button[data-nav]");
    if (nav) {
      this.displayYear += Number(nav.dataset.nav ?? 0);
      this.renderGrid();
      return;
    }

    const action = target.closest<HTMLButtonElement>("button[data-action]");
    if (action) {
      if (action.dataset.action === "current") this.commit(currentMonth());
      if (action.dataset.action === "clear") this.commit("");
      return;
    }

    const monthButton = target.closest<HTMLButtonElement>("button[data-month]");
    if (monthButton?.dataset.month) {
      this.commit(monthButton.dataset.month);
    }
  }

  private commit(value: string): void {
    this.value = value;
    this.dispatchEvent(new Event("change", { bubbles: true }));
    this.close(true);
  }

  private onPointerDown = (event: PointerEvent): void => {
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (!this.contains(target)) this.close(false);
  };

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    this.close(true);
  };

  private onDialogCancel = (event: Event): void => {
    event.preventDefault();
    this.close(true);
  };

  private onResize = (): void => {
    if (this.popoverElement && !this.popoverElement.hidden) this.position();
  };
}

export function registerMonthPicker(): void {
  if (
    typeof customElements !== "undefined" &&
    !customElements.get("month-picker")
  ) {
    customElements.define("month-picker", MonthPickerElement);
  }
}

registerMonthPicker();
