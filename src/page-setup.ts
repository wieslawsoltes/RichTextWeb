/** Shared, strict page-setup command contract. Legacy imports may still use pageSettings' tolerant rendering. */
export interface PageMargins {
  Left: number;
  Top: number;
  Right: number;
  Bottom: number;
}
export interface PageSetupOptions {
  PageWidth?: number;
  PageHeight?: number;
  PagePadding?: number | PageMargins;
  ColumnCount?: number;
  ColumnGap?: number;
  HeaderDistance?: number;
  FooterDistance?: number;
  PageNumberStart?: number;
  DifferentFirstPage?: boolean;
  DifferentOddAndEvenPages?: boolean;
}
const dimension = (
  value: unknown,
  name: string,
  min: number,
  max: number,
): number => {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  )
    throw new RangeError(`${name} must be a number between ${min} and ${max}.`);
  return value;
};
/** Padding is .NET left/top/right/bottom; inputs are copied, never retained by reference. */
export function pageMargins(value: unknown = 72): PageMargins {
  if (typeof value === "number") {
    const n = dimension(value, "PagePadding", 0, 20000);
    return { Left: n, Top: n, Right: n, Bottom: n };
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError(
      "PagePadding must be a number or Left/Top/Right/Bottom margins.",
    );
  const result = {} as PageMargins;
  for (const key of ["Left", "Top", "Right", "Bottom"] as const)
    result[key] = dimension(
      (value as PageMargins)[key],
      `PagePadding.${key}`,
      0,
      20000,
    );
  return result;
}
/** Merge supplied properties without resetting unrelated paper, stories or metadata. Validate before mutation. */
export function validatePageSetup(
  current: Record<string, unknown>,
  options: PageSetupOptions,
): PageSetupOptions {
  if (!options || typeof options !== "object" || Array.isArray(options))
    throw new TypeError("Page setup options must be an object.");
  const known = new Set([
    "PageWidth",
    "PageHeight",
    "PagePadding",
    "ColumnCount",
    "ColumnGap",
    "HeaderDistance",
    "FooterDistance",
    "PageNumberStart",
    "DifferentFirstPage",
    "DifferentOddAndEvenPages",
  ]);
  for (const key of Object.keys(options)) {
    if (!known.has(key))
      throw new TypeError(`Unknown page setup property: ${key}`);
    if ((options as Record<string, unknown>)[key] === undefined)
      throw new TypeError(`Page setup property ${key} must have a value.`);
  }
  const next: PageSetupOptions = {
    PageWidth: 794,
    PageHeight: 1123,
    PagePadding: 72,
    ColumnCount: 1,
    ColumnGap: 32,
    HeaderDistance: 8,
    FooterDistance: 8,
    PageNumberStart: 1,
  };
  for (const key of known) {
    if (current[key] !== undefined)
      (next as Record<string, unknown>)[key] = current[key];
    if (Object.hasOwn(options, key))
      (next as Record<string, unknown>)[key] = (
        options as Record<string, unknown>
      )[key];
  }
  const width = dimension(next.PageWidth, "PageWidth", 96, 20000);
  const height = dimension(next.PageHeight, "PageHeight", 96, 20000);
  const margins = pageMargins(next.PagePadding);
  const columns = dimension(next.ColumnCount, "ColumnCount", 1, 12);
  if (!Number.isInteger(columns))
    throw new RangeError("ColumnCount must be an integer.");
  const gap = dimension(next.ColumnGap, "ColumnGap", 0, 20000);
  // Keep model and browser geometry identical: pageSettings permits up to one third per margin.
  if (
    margins.Left > width / 3 ||
    margins.Right > width / 3 ||
    margins.Top > height / 3 ||
    margins.Bottom > height / 3
  )
    throw new RangeError(
      "Each margin must be no greater than one third of its paper dimension.",
    );
  if (width - margins.Left - margins.Right - (columns - 1) * gap < columns * 24)
    throw new RangeError(
      "Page margins and column gaps must leave at least 24 pixels per text column.",
    );
  if (height - margins.Top - margins.Bottom < 24)
    throw new RangeError(
      "Page margins must leave at least 24 pixels of body height.",
    );
  dimension(next.HeaderDistance, "HeaderDistance", 0, margins.Top);
  dimension(next.FooterDistance, "FooterDistance", 0, margins.Bottom);
  if (
    !Number.isSafeInteger(next.PageNumberStart) ||
    next.PageNumberStart! < 1 ||
    next.PageNumberStart! > 1000000
  )
    throw new RangeError(
      "PageNumberStart must be an integer between 1 and 1000000.",
    );
  for (const key of ["DifferentFirstPage", "DifferentOddAndEvenPages"] as const)
    if (next[key] !== undefined && typeof next[key] !== "boolean")
      throw new TypeError(`${key} must be boolean.`);
  const result = structuredClone(options);
  if (Object.hasOwn(result, "PagePadding")) result.PagePadding = margins;
  return result;
}
/** Missing flags preserve the legacy presence-based variant policy; explicit false disables a retained story. */
export function pageStoryKey(
  props: Record<string, unknown>,
  kind: "Header" | "Footer",
  physicalPage: number,
): string {
  if (!Number.isSafeInteger(physicalPage) || physicalPage < 1)
    throw new RangeError("Invalid physical page number.");
  const first =
    props.DifferentFirstPage ?? Array.isArray(props[`FirstPage${kind}`]);
  const even =
    props.DifferentOddAndEvenPages ?? Array.isArray(props[`EvenPage${kind}`]);
  if (physicalPage === 1 && first) return `FirstPage${kind}`;
  if (physicalPage % 2 === 0 && even) return `EvenPage${kind}`;
  return `${kind}s`;
}
export function documentPageNumber(
  props: Record<string, unknown>,
  physicalPage: number,
): number {
  const start = props.PageNumberStart;
  return (
    physicalPage +
    (typeof start === "number" && Number.isSafeInteger(start) && start > 0
      ? start - 1
      : 0)
  );
}

/** Native switches apply to both stories; legacy browser behavior stays per-story without explicit flags. */
export function pageStoryVariantEnabled(
  props: Record<string, unknown>,
  variant: "FirstPage" | "EvenPage",
): boolean {
  const explicit =
    props[
      variant === "FirstPage"
        ? "DifferentFirstPage"
        : "DifferentOddAndEvenPages"
    ];
  return typeof explicit === "boolean"
    ? explicit
    : Array.isArray(props[`${variant}Header`]) ||
        Array.isArray(props[`${variant}Footer`]);
}
