/**
 * SEDMAT v3.6 Classic `sed` 1-based Paragraph/Element Addressing & Introspection.
 *
 * Implements:
 * - Strict v3.6 address resolution (`N`, `N,M`, `$`, `N,$`, `/re/`, `/a/,/b/`, `!`)
 * - Validation errors matching `openclaw/gogcli` (`$` range start, reversed ranges,
 *   empty document, out-of-range bounds with element count)
 * - Standard introspection views: `formatStructure` (`structure`) and `formatNumbered` (`cat -N`)
 */

import {
  AddressElement,
  SedmatAddress,
  SedmatAddressError,
  SedmatAddressPoint,
} from "./types.js";

export interface ResolveAddressOptions {
  /**
   * When true (default per SEDMAT v3.6), numeric addresses out of range or against
   * an empty document throw `SedmatAddressError`. Set false for permissive matching.
   */
  strict?: boolean;
}

function resolveNumericPoint(
  point: Extract<SedmatAddressPoint, { kind: "line" | "last" }>,
  totalCount: number,
): number {
  return point.kind === "last" ? totalCount : point.index;
}

/**
 * Resolve a SEDMAT address against top-level 1-based `AddressElement` entries
 * (paragraphs, tables, TOCs). Returns matched 0-based indices into `elements`.
 */
export function resolveAddressElements(
  address: SedmatAddress | undefined,
  elements: readonly AddressElement[],
  options: ResolveAddressOptions = {},
): number[] {
  const strict = options.strict !== false;
  const count = elements.length;

  if (!address) {
    return elements.map((_, i) => i);
  }

  // Validate numeric/last address bounds per SEDMAT v3.6
  const startIsNumeric = address.start.kind === "line" || address.start.kind === "last";
  const endIsNumeric = address.end && (address.end.kind === "line" || address.end.kind === "last");

  if (strict && startIsNumeric) {
    if (count === 0) {
      throw new SedmatAddressError("document has no addressable elements");
    }
    if (address.end && address.start.kind === "last") {
      throw new SedmatAddressError("$ cannot be range start (use N,$ instead)");
    }

    const startNum = resolveNumericPoint(
      address.start as Extract<SedmatAddressPoint, { kind: "line" | "last" }>,
      count,
    );
    if (startNum < 1 || startNum > count) {
      throw new SedmatAddressError(
        `address ${startNum} out of range (document has ${count} element${count === 1 ? "" : "s"})`,
      );
    }

    if (address.end && endIsNumeric) {
      const endNum = resolveNumericPoint(
        address.end as Extract<SedmatAddressPoint, { kind: "line" | "last" }>,
        count,
      );
      if (endNum < 1 || endNum > count) {
        throw new SedmatAddressError(
          `address end ${endNum} out of range (document has ${count} element${count === 1 ? "" : "s"})`,
        );
      }
      if (endNum < startNum) {
        throw new SedmatAddressError(`address range ${startNum},${endNum} is reversed`);
      }
    }
  }

  const matchesPoint = (pt: SedmatAddressPoint, idx: number): boolean => {
    if (pt.kind === "line") return idx + 1 === pt.index;
    if (pt.kind === "last") return idx === count - 1;
    const re = new RegExp(pt.pattern, pt.ignoreCase ? "i" : "");
    return re.test(elements[idx]?.text ?? "");
  };

  const matched = new Set<number>();
  if (!address.end) {
    for (let i = 0; i < count; i++) {
      if (matchesPoint(address.start, i)) matched.add(i);
    }
  } else {
    let inRange = false;
    for (let i = 0; i < count; i++) {
      if (!inRange && matchesPoint(address.start, i)) {
        inRange = true;
      }
      if (inRange) {
        matched.add(i);
        if (matchesPoint(address.end, i)) {
          inRange = false;
        }
      }
    }
  }

  if (address.negate) {
    const inverted: number[] = [];
    for (let i = 0; i < count; i++) {
      if (!matched.has(i)) inverted.push(i);
    }
    return inverted;
  }

  return [...matched].sort((a, b) => a - b);
}

/**
 * Convenience helper resolving a SEDMAT address against plain strings.
 * Returns a `Set<number>` of 0-based indices.
 */
export function resolveAddressIndices(
  address: SedmatAddress | undefined,
  elementTexts: readonly string[],
  options: ResolveAddressOptions = {},
): Set<number> {
  const elements: AddressElement[] = elementTexts.map((text, idx) => ({
    number: idx + 1,
    kind: "paragraph",
    text,
  }));
  return new Set(resolveAddressElements(address, elements, options));
}

/**
 * Format elements in `cat -N` style (`[1] text`, `[2] text`, ...), matching
 * SEDMAT v3.6 1-based paragraph addressing 1:1.
 */
export function formatNumbered(
  elements: readonly AddressElement[],
  options: { includeMeta?: boolean } = {},
): string {
  const includeMeta = options.includeMeta === true;
  return elements
    .map((el) => {
      if (includeMeta) {
        const tagParts = [el.kind === "paragraph" ? (el.style ?? "Normal") : el.kind];
        if (el.meta) tagParts.push(el.meta);
        if (el.id) tagParts.push(`id=${el.id}`);
        return `[${el.number}] (${tagParts.join(", ")}): ${el.text}`;
      }
      return `[${el.number}] ${el.text}`;
    })
    .join("\n");
}

/**
 * Format elements in `structure` table style showing 1-based index, element kind,
 * style, and truncated preview — matching `gog docs structure`.
 */
export function formatStructure(
  elements: readonly AddressElement[],
  options: { maxPreviewLen?: number } = {},
): string {
  const maxLen = options.maxPreviewLen ?? 72;
  if (elements.length === 0) return "(empty document)";
  return elements
    .map((el) => {
      const style = el.style ? `:${el.style}` : "";
      const meta = el.meta ? ` [${el.meta}]` : "";
      const clean = el.text.replace(/\s+/g, " ").trim();
      const preview = clean.length > maxLen ? `${clean.slice(0, maxLen - 1)}…` : clean;
      return `${String(el.number).padStart(3, " ")}  ${el.kind}${style}${meta}  ${preview}`;
    })
    .join("\n");
}
