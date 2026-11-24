/**
 * SEDMAT v3.6 standard named color palette (18 canonical names + grey alias)
 * plus 3-char and 6-char hex color normalization.
 */

export const SEDMAT_NAMED_COLORS: Readonly<Record<string, string>> = {
  // SEDMAT v3.6 / v3.7 canonical 18-color palette (+ grey alias) per sedmat.org
  black: "000000",
  white: "FFFFFF",
  red: "FF0000",
  green: "00FF00",
  blue: "0000FF",
  yellow: "FFFF00",
  cyan: "00FFFF",
  magenta: "FF00FF",
  orange: "FF8C00",
  purple: "800080",
  pink: "FF69B4",
  brown: "8B4513",
  gray: "808080",
  grey: "808080",
  lightgray: "D3D3D3",
  darkgray: "404040",
  navy: "000080",
  teal: "008080",
  // Helpful extended aliases
  slate: "334155",
  gold: "FFD700",
  crimson: "DC143C",
  emerald: "059669",
  indigo: "4B0082",
};

/**
 * Resolve a SEDMAT named color or hex string (`#RGB`, `#RRGGBB`, `RRGGBB`)
 * to a normalized 6-character uppercase hex string without `#`.
 */
export function resolveSedmatColor(raw: string): string {
  const trimmed = raw.trim();
  const lower = trimmed.toLowerCase();
  if (SEDMAT_NAMED_COLORS[lower]) return SEDMAT_NAMED_COLORS[lower]!;
  const hex = trimmed.replace(/^#/, "").toUpperCase();
  if (/^[0-9A-F]{3}$/.test(hex)) {
    return hex
      .split("")
      .map((c) => c + c)
      .join("");
  }
  if (/^[0-9A-F]{6}$/.test(hex)) return hex;
  return trimmed;
}
