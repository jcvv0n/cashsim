export type DialogKind = "income" | "fixed" | "bill" | "oneoff";

export function openEditorDialog(
  dialog: HTMLDialogElement,
  kind: DialogKind,
  initial: Record<string, string>,
  onSubmit: (form: FormData) => string | null,
  hint?: string,
  setup?: (form: HTMLFormElement) => void,
): void {
  if (dialog.open) dialog.close();

  const isEditing = Boolean(initial.id);
  dialog.innerHTML = `
    <form class="dialog-form" novalidate>
      <h3>${isEditing ? "编辑" : "添加"}${titleOf(kind)}</h3>
      ${hint ? `<p class="dialog-hint">${esc(hint)}</p>` : ""}
      ${formBody(kind, initial)}
      <div class="form-error" data-error></div>
      <div class="dialog-actions">
        <button type="button" class="btn" data-close>取消</button>
        <button type="submit" class="btn btn-primary">保存</button>
      </div>
    </form>
  `;

  const form = dialog.querySelector("form");
  if (!form) return;

  setup?.(form);

  const errorElement = dialog.querySelector<HTMLElement>("[data-error]");
  const closeButton = dialog.querySelector<HTMLButtonElement>("[data-close]");

  closeButton?.addEventListener("click", () => dialog.close());

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const error = onSubmit(new FormData(form));
    if (error) {
      if (errorElement) errorElement.textContent = error;
      return;
    }
    dialog.close();
  });

  dialog.showModal();

  const firstInput = form.querySelector<HTMLInputElement>(
    'input[name="name"], input[name="cardName"]',
  );
  firstInput?.focus();
}

export interface NameDialogOptions {
  title: string;
  initialName: string;
  submitLabel?: string;
  showCopy?: boolean;
  copyLabel?: string;
  copyChecked?: boolean;
}

/** 沙盘的新建 / 重命名弹窗。 */
export function openNameDialog(
  dialog: HTMLDialogElement,
  options: NameDialogOptions,
  onSubmit: (name: string, copy: boolean) => string | null,
): void {
  if (dialog.open) dialog.close();

  dialog.innerHTML = `
    <form class="dialog-form" novalidate>
      <h3>${esc(options.title)}</h3>
      <label>沙盘名称
        <input
          name="name"
          required
          maxlength="40"
          autocomplete="off"
          value="${esc(options.initialName)}"
        />
      </label>
      ${
        options.showCopy
          ? `<label class="checkbox">
              <input type="checkbox" name="copy" ${options.copyChecked === false ? "" : "checked"} />
              ${esc(options.copyLabel ?? "以当前沙盘的数据为起点")}
            </label>`
          : ""
      }
      <div class="form-error" data-error></div>
      <div class="dialog-actions">
        <button type="button" class="btn" data-close>取消</button>
        <button type="submit" class="btn btn-primary">${esc(options.submitLabel ?? "保存")}</button>
      </div>
    </form>
  `;

  const form = dialog.querySelector("form");
  if (!form) return;

  const errorElement = dialog.querySelector<HTMLElement>("[data-error]");
  const closeButton = dialog.querySelector<HTMLButtonElement>("[data-close]");

  closeButton?.addEventListener("click", () => dialog.close());

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    const name = String(formData.get("name") ?? "");
    const copy = formData.get("copy") !== null;
    const error = onSubmit(name, copy);
    if (error) {
      if (errorElement) errorElement.textContent = error;
      return;
    }
    dialog.close();
  });

  dialog.showModal();

  const input = form.querySelector<HTMLInputElement>('input[name="name"]');
  input?.focus();
  input?.select();
}

function titleOf(kind: DialogKind): string {
  switch (kind) {
    case "income":
      return "收入";
    case "fixed":
      return "固定还款";
    case "bill":
      return "信用卡账单";
    case "oneoff":
      return "一次性事件";
  }
}

function formBody(kind: DialogKind, initial: Record<string, string>): string {
  if (kind === "bill") {
    return `
      <label>还款月份
        <month-picker name="month" aria-label="还款月份" value="${esc(initial.month ?? "")}"></month-picker>
      </label>
      <label>卡片名称
        <input name="cardName" required value="${esc(initial.cardName ?? "")}" placeholder="招行 / 中信 / 花呗" />
      </label>
      <label>金额（元）
        <input name="amount" type="number" step="1" min="1" required value="${esc(initial.amount ?? "")}" />
      </label>
      <label>备注（可选）
        <input name="note" value="${esc(initial.note ?? "")}" placeholder="例如：含分期" />
      </label>
      <fieldset class="installment-field">
        <legend>已包含在本账单中的分期（可选）</legend>
        <p class="field-hint">勾选后，这些固定还款在该月不再重复计入。</p>
        <div class="installment-list" data-installment-list></div>
      </fieldset>
    `;
  }

  if (kind === "oneoff") {
    return `
      <label>月份
        <month-picker name="month" aria-label="月份" value="${esc(initial.month ?? "")}"></month-picker>
      </label>
      <label>名称
        <input name="name" required value="${esc(initial.name ?? "")}" placeholder="装修 / 年终奖 / 学费" />
      </label>
      <label>金额（元，正 = 收入，负 = 支出）
        <input name="amount" type="number" step="1" required value="${esc(initial.amount ?? "")}" />
      </label>
      <label class="checkbox">
        <input type="checkbox" name="enabled" ${initial.enabled === "1" ? "checked" : ""} />
        计入推演
      </label>
    `;
  }

  const namePlaceholder =
    kind === "income" ? "工资 / 房租 / 副业" : "房贷 / 车贷 / 分期";
  return `
    <label>名称
      <input name="name" required value="${esc(initial.name ?? "")}" placeholder="${namePlaceholder}" />
    </label>
    <label>金额（元）
      <input name="amount" type="number" step="1" min="1" required value="${esc(initial.amount ?? "")}" />
    </label>
    <label>起始月
      <month-picker name="startMonth" aria-label="起始月" value="${esc(initial.startMonth ?? "")}"></month-picker>
    </label>
    <label>结束月（可选，不填 = 一直持续）
      <month-picker name="endMonth" aria-label="结束月" value="${esc(initial.endMonth ?? "")}" clearable></month-picker>
    </label>
    <label>剩余期数（可选，优先于结束月）
      <input name="remainingMonths" type="number" min="1" step="1" value="${esc(initial.remainingMonths ?? "")}" />
    </label>
  `;
}

function esc(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character] ?? character,
  );
}
