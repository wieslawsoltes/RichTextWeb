import type { PageSettings } from "./pagination.js";

/** Align explicit physical page breaks to the first column of the next paper page.
 * Spacers are view-only, have no model IDs/text and are discarded before reconciliation.
 * Native column breaks remain ordinary CSS fragmentation boundaries.
 */
export function alignPhysicalPageBreaks(surface: HTMLElement, settings: PageSettings): void {
  if (settings.ColumnCount === 1) return;
  const bounds = surface.getBoundingClientRect();
  const scale = bounds.width / settings.ContentWidth;
  const stride = (settings.TextColumnWidth + settings.ColumnGap) * scale;
  const rtl = surface.ownerDocument.defaultView?.getComputedStyle(surface).direction === "rtl";
  if (!Number.isFinite(stride) || stride <= 0) return;
  for (const target of surface.querySelectorAll<HTMLElement>("[data-rt-physical-break]")) {
    const box = target.getClientRects()[0];
    if (!box) continue;
    const column = Math.max(0, Math.round((rtl ? bounds.right - box.right : box.left - bounds.left) / stride));
    const blanks = (settings.ColumnCount - column % settings.ColumnCount) % settings.ColumnCount;
    for (let i = 0; i < blanks; i++) {
      const spacer = surface.ownerDocument.createElement("div");
      spacer.setAttribute("data-rt-page-spacer", "");
      spacer.setAttribute("aria-hidden", "true");
      spacer.contentEditable = "false";
      spacer.style.cssText = `height:${settings.ContentHeight}px;break-before:column;pointer-events:none;margin:0;padding:0;border:0`;
      target.before(spacer);
    }
  }
}
