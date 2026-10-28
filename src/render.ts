import * as echarts from "echarts/core";
import { LineChart } from "echarts/charts";
import {
  GridComponent,
  MarkLineComponent,
  MarkPointComponent,
  TooltipComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type {
  CardBill,
  MonthRow,
  OneOffItem,
  Projection,
  RecurringItem,
  Settings,
} from "./engine/types";
import type { DetailColumn } from "./detail";
import { effectiveEndMonth } from "./engine/project";
import { formatMonthLong, formatMonthShort, formatMoney } from "./format";
import { escapeHtml } from "./html";

echarts.use([
  LineChart,
  GridComponent,
  TooltipComponent,
  MarkLineComponent,
  MarkPointComponent,
  CanvasRenderer,
]);

let chart: ReturnType<typeof echarts.init> | null = null;

export function initChart(element: HTMLElement): void {
  chart = echarts.init(element);
  window.addEventListener("resize", () => chart?.resize());
}

export function renderKpis(
  container: HTMLElement,
  projection: Projection,
  settings: Settings,
): void {
  const metrics = projection.metrics;
  const cards = [
    {
      label: "期初现金",
      value: formatMoney(settings.openingCash),
      sub: `${formatMonthLong(settings.startMonth)} 月初`,
      tone: "",
    },
    {
      label: "月均净流",
      value: formatMoney(metrics.avgNet, { signed: true }),
      sub: metrics.avgNet >= 0 ? "窗口内平均每月结余" : "窗口内平均每月缺口",
      tone: metrics.avgNet < 0 ? "warning" : "good",
    },
    {
      label: "首次低于安全线",
      value: metrics.firstBelowFloor
        ? formatMonthLong(metrics.firstBelowFloor)
        : "不会",
      sub: metrics.firstBelowFloor ? "需要提前安排" : "推演窗口内安全",
      tone: metrics.firstBelowFloor ? "warning" : "good",
    },
    {
      label: "最低余额",
      value: formatMoney(metrics.minBalance),
      sub: metrics.minBalanceMonth
        ? formatMonthLong(metrics.minBalanceMonth)
        : "—",
      tone:
        metrics.minBalance < 0
          ? "danger"
          : metrics.minBalance < settings.safetyFloor
            ? "warning"
            : "good",
    },
    {
      label: "最大缺口",
      value: metrics.maxGap > 0 ? formatMoney(metrics.maxGap) : "无",
      sub: "相对安全线",
      tone: metrics.maxGap > 0 ? "warning" : "good",
    },
    {
      label: "无收入可支撑",
      value:
        metrics.runwayMonths === null
          ? "—"
          : `${metrics.runwayMonths.toFixed(1)} 个月`,
      sub: "期初现金 / 月均支出",
      tone: "",
    },
  ];

  container.innerHTML = cards
    .map(
      (card) => `
        <article class="kpi ${card.tone}">
          <div class="kpi-label">${card.label}</div>
          <div class="kpi-value">${card.value}</div>
          <div class="kpi-sub">${card.sub}</div>
        </article>
      `,
    )
    .join("");
}

export function renderChart(
  projection: Projection,
  settings: Settings,
): void {
  if (!chart) return;

  const months = projection.rows.map((row) => row.month);
  const balances = projection.rows.map((row) => row.balance / 100);
  const floor = settings.safetyFloor / 100;
  const minRow =
    projection.rows.length > 0
      ? projection.rows.reduce(
          (min, row) => (row.balance < min.balance ? row : min),
          projection.rows[0],
        )
      : undefined;

  chart.setOption(
    {
      animationDuration: 320,
      grid: { left: 8, right: 16, top: 28, bottom: 8, containLabel: true },
      tooltip: {
        trigger: "axis",
        backgroundColor: "rgba(23, 32, 28, .94)",
        borderWidth: 0,
        padding: [10, 12],
        textStyle: { color: "#fff", fontSize: 12 },
        formatter: (params: any) => {
          const index = params?.[0]?.dataIndex ?? 0;
          const row = projection.rows[index];
          if (!row) return "";
          return [
            `<strong>${formatMonthLong(row.month)}</strong>`,
            `期末现金：${formatMoney(row.balance)}`,
            `净现金流：${formatMoney(row.net, { signed: true })}`,
            `固定还款：${formatMoney(-row.fixed)}`,
          ].join("<br/>");
        },
      },
      xAxis: {
        type: "category",
        data: months.map(formatMonthShort),
        boundaryGap: false,
        axisLine: { lineStyle: { color: "#dfe5df" } },
        axisTick: { show: false },
        axisLabel: { color: "#7b857f", fontSize: 11, interval: "auto" },
      },
      yAxis: {
        type: "value",
        axisLabel: {
          color: "#7b857f",
          fontSize: 11,
          formatter: (value: number) => formatAxis(value),
        },
        splitLine: { lineStyle: { color: "#eef1ed" } },
      },
      series: [
        {
          name: "期末现金",
          type: "line",
          data: balances,
          smooth: 0.25,
          showSymbol: false,
          symbol: "circle",
          symbolSize: 7,
          lineStyle: { width: 3, color: "#0f766e" },
          itemStyle: { color: "#0f766e" },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: "rgba(15, 118, 110, .22)" },
              { offset: 1, color: "rgba(15, 118, 110, .01)" },
            ]),
          },
          markLine: {
            silent: true,
            symbol: "none",
            label: { fontSize: 10, color: "#9a6a1a" },
            data: [
              {
                yAxis: floor,
                label: { formatter: "安全线", position: "insideEndTop" },
                lineStyle: { color: "#d99a2b", type: "dashed", width: 1.5 },
              },
              {
                yAxis: 0,
                label: { formatter: "0", position: "insideEndBottom" },
                lineStyle: { color: "#d25b5b", type: "dashed", width: 1.5 },
              },
            ],
          },
          markPoint: {
            symbol: "circle",
            symbolSize: 9,
            itemStyle: { color: "#b91c1c" },
            label: {
              show: true,
              formatter: "最低",
              position: "top",
              color: "#b91c1c",
              fontSize: 10,
            },
            data: minRow
              ? [
                  {
                    coord: [
                      formatMonthShort(minRow.month),
                      minRow.balance / 100,
                    ],
                  },
                ]
              : [],
          },
        },
      ],
    },
    true,
  );
}

const DETAIL_LABELS: Record<DetailColumn, string> = {
  income: "收入",
  fixed: "固定还款",
  bills: "信用卡账单",
  living: "生活估算",
  oneoff: "一次性事件",
};

function detailClass(enabled: boolean): string {
  return enabled ? " detail-cell" : "";
}

function detailAttrs(
  row: MonthRow,
  column: DetailColumn,
  enabled: boolean,
): string {
  if (!enabled) return "";
  return ` data-detail data-month="${row.month}" data-column="${column}" tabindex="0" role="button" aria-label="查看 ${formatMonthLong(row.month)} ${DETAIL_LABELS[column]}明细"`;
}

function detailBadge(count: number): string {
  return count > 1 ? `<span class="detail-count">${count}笔</span>` : "";
}

export function renderTable(
  tbody: HTMLElement,
  projection: Projection,
): void {
  const firstWarning = projection.metrics.firstBelowFloor;

  tbody.innerHTML = projection.rows
    .map((row) => {
      const statusText =
        row.status === "danger"
          ? "破线"
          : row.status === "warning"
            ? "预警"
            : "正常";
      const rowClass =
        row.status === "danger"
          ? "is-danger"
          : row.status === "warning"
            ? "is-warning"
            : "";
      const firstFlag =
        row.month === firstWarning
          ? ' <span class="first-flag">首次</span>'
          : "";

      const incomeInteractive = row.incomeCount > 0;
      const fixedInteractive = row.fixedCount > 0;
      const billsInteractive = row.billCount > 0;
      const livingInteractive =
        row.livingSource === "budget" && row.living > 0;
      const oneOffInteractive = row.oneOffCount > 0;

      return `
        <tr class="${rowClass}">
          <td class="month-cell">${formatMonthLong(row.month)}${firstFlag}</td>
          <td class="num amount-pos${detailClass(incomeInteractive)}"${detailAttrs(row, "income", incomeInteractive)}>
            ${formatMoney(row.income, { zeroDash: true })}${detailBadge(row.incomeCount)}
          </td>
          <td class="num amount-neg${detailClass(fixedInteractive)}"${detailAttrs(row, "fixed", fixedInteractive)}>
            ${formatMoney(-row.fixed, { zeroDash: true })}${detailBadge(row.fixedCount)}
          </td>
          <td class="num ${row.livingSource === "actual" ? "amount-neg" : "muted-cell"}${detailClass(billsInteractive)}"${detailAttrs(row, "bills", billsInteractive)}>
            ${row.livingSource === "actual" ? formatMoney(-row.living) : "—"}${detailBadge(row.billCount)}
          </td>
          <td class="num ${row.livingSource === "budget" ? "amount-neg" : "muted-cell"}${detailClass(livingInteractive)}"${detailAttrs(row, "living", livingInteractive)}>
            ${row.livingSource === "budget" ? formatMoney(-row.living) : "—"}
          </td>
          <td class="num ${row.oneOff < 0 ? "amount-neg" : row.oneOff > 0 ? "amount-pos" : "muted-cell"}${detailClass(oneOffInteractive)}"${detailAttrs(row, "oneoff", oneOffInteractive)}>
            ${row.oneOff === 0 ? "—" : formatMoney(row.oneOff, { signed: true })}${detailBadge(row.oneOffCount)}
          </td>
          <td class="num amount-strong ${row.net < 0 ? "amount-neg" : row.net > 0 ? "amount-pos" : ""}">
            ${formatMoney(row.net, { signed: true, zeroDash: true })}
          </td>
          <td class="num amount-strong ${row.balance < 0 ? "amount-neg" : ""}">
            ${formatMoney(row.balance)}
          </td>
          <td><span class="status ${row.status}">${statusText}</span></td>
        </tr>
      `;
    })
    .join("");
}

export function recurringListHtml(items: RecurringItem[]): string {
  if (items.length === 0) {
    return '<div class="item-empty">还没有添加</div>';
  }

  return items
    .map((item) => {
      const end = effectiveEndMonth(item);
      const endText = item.remainingMonths
        ? ` · 共 ${item.remainingMonths} 期`
        : end
          ? ` · 至 ${formatMonthLong(end)}`
          : " · 持续";
      const typeLabel = item.type === "income" ? "收入" : "还款";
      const amountClass =
        item.type === "income" ? "amount-pos" : "amount-neg";
      const amountPrefix = item.type === "income" ? "" : "-";

      return `
        <div class="item" data-id="${item.id}">
          <div class="item-main">
            <div class="item-title">${escapeHtml(item.name)} <span class="mini-tag">${typeLabel}</span></div>
            <div class="item-sub">${formatMonthLong(item.startMonth)} 起${endText}</div>
          </div>
          <div class="item-amount ${amountClass}">${amountPrefix}${formatMoney(item.amount)}</div>
          <div class="item-actions">
            <button type="button" data-action="edit" data-kind="${item.type}" data-id="${item.id}">编辑</button>
            <button type="button" data-action="delete" data-kind="${item.type}" data-id="${item.id}" class="danger">删除</button>
          </div>
        </div>
      `;
    })
    .join("");
}

export function billListHtml(bills: CardBill[]): string {
  if (bills.length === 0) {
    return '<div class="item-empty">还没有添加</div>';
  }

  return [...bills]
    .sort(
      (a, b) =>
        a.month.localeCompare(b.month) || a.cardName.localeCompare(b.cardName),
    )
    .map(
      (bill) => `
        <div class="item" data-id="${bill.id}">
          <div class="item-main">
            <div class="item-title">${escapeHtml(bill.cardName)}</div>
            <div class="item-sub">${formatMonthLong(bill.month)} 还款${bill.note ? ` · ${escapeHtml(bill.note)}` : ""}</div>
          </div>
          <div class="item-amount amount-neg">-${formatMoney(bill.amount)}</div>
          <div class="item-actions">
            <button type="button" data-action="edit" data-kind="bill" data-id="${bill.id}">编辑</button>
            <button type="button" data-action="delete" data-kind="bill" data-id="${bill.id}" class="danger">删除</button>
          </div>
        </div>
      `,
    )
    .join("");
}

export function oneOffListHtml(oneOffs: OneOffItem[]): string {
  if (oneOffs.length === 0) {
    return '<div class="item-empty">还没有添加</div>';
  }

  return [...oneOffs]
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((item) => {
      const amountClass =
        item.amount < 0 ? "amount-neg" : item.amount > 0 ? "amount-pos" : "";
      return `
        <div class="item ${item.enabled ? "" : "is-disabled"}" data-id="${item.id}">
          <div class="item-main">
            <div class="item-title">
              <label class="toggle">
                <input type="checkbox" data-action="toggle" data-id="${item.id}" ${item.enabled ? "checked" : ""} />
                ${escapeHtml(item.name)}
              </label>
            </div>
            <div class="item-sub">${formatMonthLong(item.month)}${item.enabled ? "" : " · 未计入"}</div>
          </div>
          <div class="item-amount ${amountClass}">${formatMoney(item.amount, { signed: true })}</div>
          <div class="item-actions">
            <button type="button" data-action="edit" data-kind="oneoff" data-id="${item.id}">编辑</button>
            <button type="button" data-action="delete" data-kind="oneoff" data-id="${item.id}" class="danger">删除</button>
          </div>
        </div>
      `;
    })
    .join("");
}

function formatAxis(value: number): string {
  const absolute = Math.abs(value);
  if (absolute >= 10_000) {
    const wan = value / 10_000;
    return `${Number.isInteger(wan) ? wan : wan.toFixed(1)}万`;
  }
  return String(Math.round(value));
}
