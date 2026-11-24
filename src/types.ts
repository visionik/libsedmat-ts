/**
 * SEDMAT v3.6 (Sed-Expression-Driven Mark(up|down) Annotation & Transformation)
 * Target-agnostic AST, addressing, formatting, reference, and backend types.
 *
 * Designed as a zero-dependency standalone TypeScript library ready for
 * extraction to `github.com/visionik/libsedmat-ts` alongside `visionik/libsedmat-go`.
 *
 * Spec: https://github.com/visionik/sedmat (v3.6)
 */

// ---------------------------------------------------------------------------
// Paragraph / Element Addressing (SEDMAT v3.6)
// ---------------------------------------------------------------------------

/** Top-level addressable element kinds in document order (1-based). */
export type AddressElementKind = "paragraph" | "table" | "toc";

/** One numbered top-level document element for addressing & introspection. */
export interface AddressElement {
  /** 1-based ordinal index in document order (1..N) */
  number: number;
  kind: AddressElementKind;
  text: string;
  /** Optional backend-specific block/element identifier */
  id?: string;
  /** Optional style/heading descriptor (e.g. "Heading1", "Normal", "Title") */
  style?: string;
  /** Optional extra metadata tag (e.g. list marker, row/col counts) */
  meta?: string;
}

export type SedmatAddressPoint =
  | { kind: "line"; index: number } // 1-based element index
  | { kind: "last" } // $
  | { kind: "regex"; pattern: string; ignoreCase?: boolean };

export interface SedmatAddress {
  start: SedmatAddressPoint;
  end?: SedmatAddressPoint;
  negate?: boolean;
}

// ---------------------------------------------------------------------------
// Generic Container Scopes (`@` — SEDMAT v3.7)
// ---------------------------------------------------------------------------

/** Optional explicit container type assertion (`@slide=2:`, `@sheet=Budget:`, `@tab=Summary:`). */
export type ContainerType = "slide" | "sheet" | "tab" | "page" | "section";

export type ContainerTarget =
  | { kind: "all" } // @*
  | { kind: "address"; address: SedmatAddress } // @2, @2,5, @$, @2,$
  | { kind: "name"; name: string } // @"Summary", @Budget
  | { kind: "regionOnly" }; // @header:, @footer:, @notes: (implicit active container)

export interface SedmatContainerScope {
  containerType?: ContainerType;
  target: ContainerTarget;
  /** Optional named sub-region: "title", "sub", "body", "notes", "header", "footer", "shape=2", etc. */
  region?: string;
}

// ---------------------------------------------------------------------------
// Table, Image, Break, Spacing, Chip, and Structural Specs (SEDMAT v3.1–v3.6)
// ---------------------------------------------------------------------------

export type HeadingStyle =
  | "Normal"
  | "Title"
  | "Subtitle"
  | "Heading1"
  | "Heading2"
  | "Heading3"
  | "Heading4"
  | "Heading5"
  | "Heading6";

export type TextAlignment = "left" | "center" | "right" | "justify";

export type BreakKind = "hr" | "page" | "column" | "section";

export type CheckboxState = "unchecked" | "checked";

export interface ParagraphSpacing {
  beforePt: number;
  afterPt: number;
}

export interface TocSpec {
  /** Optional max heading depth (e.g. `{toc=2}` => H1–H2 only) */
  maxDepth?: number;
}

/** 1-based cell coordinate (0 or "*" represented via `wildcard: true`). */
export interface TableCellCoord {
  /** 1-based row index, or "*" for all rows */
  row: number | "*";
  /** 1-based column index, or "*" for all columns */
  col: number | "*";
}

export type TableTargetIndex = number | "*"; // positive 1-based, negative from end (-1), or "*"

export type TableSpec =
  | {
      kind: "create";
      rows: number;
      cols: number;
      header: boolean;
    }
  | {
      kind: "ref";
      table: TableTargetIndex;
    }
  | {
      kind: "cell";
      table: TableTargetIndex;
      cell: TableCellCoord;
    }
  | {
      kind: "range";
      table: TableTargetIndex;
      from: { row: number; col: number };
      to: { row: number; col: number };
    }
  | {
      kind: "allCells";
      table: TableTargetIndex;
    }
  | {
      kind: "rowOp";
      table: TableTargetIndex;
      op: "insertBefore" | "append" | "delete";
      /** 1-based row index for insertBefore/delete (negative allowed for delete) */
      index?: number;
    }
  | {
      kind: "colOp";
      table: TableTargetIndex;
      op: "insertBefore" | "append" | "delete";
      /** 1-based col index for insertBefore/delete (negative allowed for delete) */
      index?: number;
    };

export type ImageSpec =
  | { kind: "index"; index: number } // 1, -1, etc.
  | { kind: "all" } // *
  | { kind: "url"; url: string } // https://...
  | { kind: "regex"; pattern: string }; // alt-text regex

export type ChipKind =
  | "person"
  | "date"
  | "file"
  | "place"
  | "dropdown"
  | "chart"
  | "bookmark";

export interface ChipUri {
  kind: ChipKind;
  value: string;
  raw: string;
}

export type UriTarget =
  | { kind: "url"; href: string }
  | { kind: "bookmark"; name: string }
  | { kind: "chip"; chip: ChipUri };

// ---------------------------------------------------------------------------
// Canonical Brace Syntax Flags (SEDMAT v3.6)
// ---------------------------------------------------------------------------

/**
 * Formatting, structural, and object attributes parsed from a `{...}` SEDMAT brace block.
 * `null` on a value flag represents an explicit bare-flag reset back to default (e.g. `{c}`, `{z}`, `{f}`).
 */
export interface SedmatFormatFlags {
  // Run-level boolean flags
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  code?: boolean;
  superscript?: boolean;
  subscript?: boolean;
  smallCaps?: boolean;

  // Run-level value flags (null = bare-flag reset to default)
  color?: string | null; // 6-char uppercase hex without '#'
  bg?: string | null; // background / highlight 6-char uppercase hex without '#'
  fontFamily?: string | null;
  fontSizePt?: number | null;
  url?: string | null; // raw URI string (standard URL, #bookmark, or chip://...)
  uri?: UriTarget | null; // parsed URI / bookmark / chip target
  opacity?: number | null; // 0..100
  kerningPt?: number | null;
  effect?: string | null;

  // Replacement text override (`t=text` or inline `{b=text}`); undefined => implicit `$0`
  text?: string;
  /** True when text came from inline scoping (`{b=text}`, `{^=2}`, `{,=2}`) */
  inlineScoped?: boolean;

  // Image dimensions (`x=` width, `y=` height)
  width?: number | null;
  height?: number | null;

  // Paragraph-level flags
  heading?: HeadingStyle | null;
  align?: TextAlignment | null;
  leadingPt?: number | null;
  indentPt?: number | null;
  spacing?: ParagraphSpacing | null;
  checkbox?: CheckboxState | null;
  list?: "bullet" | "ordered" | "none" | null;
  quote?: boolean;

  // Structural / container / object flags
  /** `{0}` resets all run formatting before applying any co-occurring flags */
  reset?: boolean;
  /** `{!0}` opts out of implicit formatting reset (additive mode) */
  noReset?: boolean;
  /** `{+}` (hr), `{+=p}` (page), `{+=c}` (column), `{+=s}` (section) */
  break?: BreakKind;
  /** `{cols=N}` section column count */
  cols?: number | null;
  /** `{toc}` / `{toc=N}` */
  toc?: TocSpec;
  /** `{"=comment text}` */
  comment?: string;
  /** `{@=bookmarkName}` */
  bookmark?: string;
  /** `{T=...}` table creation / reference / cell / row / col op */
  table?: TableSpec;
  /** `{img=...}` image reference / insertion */
  image?: ImageSpec;

  // Slide / container / shape flags (SEDMAT v3.7)
  layout?: string;
  zone?: "left" | "right" | "top" | "bottom" | "center" | "footer";
  shape?: string;
  fill?: string | null;
  stroke?: string | null;
  notes?: string;
  transition?: "none" | "fade" | "push" | "wipe";
  move?: number;
  dup?: boolean;
  hide?: boolean;
  /** Optional unit-aware geometry expressions (e.g. "1in", "40%", "320px") */
  geomX?: string;
  geomY?: string;
  geomW?: string;
  geomH?: string;
}

export interface SedmatReplacementSegment {
  kind: "text" | "brace";
  text?: string;
  flags?: SedmatFormatFlags;
}

/**
 * Resolved styled span produced after applying flexible brace placement rules
 * (`{b}hello`, `hello{b}`, `{c=red}warning{b}`, standalone `{b}` => `$0`, `H{,=2}O`).
 */
export interface SedmatStyledSpan {
  /** Text for this span (may contain `$0`, `$1`, `&` before backref expansion). */
  text: string;
  /** True when the span's text came implicitly from `$0` (standalone `{b}` with no explicit text). */
  implicitMatchText?: boolean;
  flags?: SedmatFormatFlags;
}

// ---------------------------------------------------------------------------
// Commands & Program AST
// ---------------------------------------------------------------------------

/** Special document-level positional patterns for `s///`. */
export type PositionalPattern = "emptyDoc" | "startOfDoc" | "endOfDoc";

export interface SedmatSubstituteCmd {
  type: "substitute";
  scope?: SedmatContainerScope;
  address?: SedmatAddress;
  pattern: string;
  replacement: string;
  segments: SedmatReplacementSegment[];
  global: boolean;
  ignoreCase: boolean;
  multiline: boolean;
  /** Optional 1-based Nth occurrence selector (when not global) */
  occurrence?: number;
  /** Populated when pattern is `^$`, `^`, or `$` (and no address prefix) */
  positional?: PositionalPattern;
  /** Populated when pattern targets a table `{T=...}` or legacy `|N|[...]` */
  tableTarget?: TableSpec;
  /** Populated when pattern targets an image `{img=...}` or legacy `!(...)` */
  imageTarget?: ImageSpec;
  /** Populated when replacement creates a table `{T=RxC[:header]}` */
  tableCreate?: Extract<TableSpec, { kind: "create" }>;
}

export interface SedmatDeleteCmd {
  type: "delete";
  scope?: SedmatContainerScope;
  address?: SedmatAddress;
  /** Optional inline regex pattern (`d/pattern/[im]` or `N,Md/pattern/[im]`) */
  pattern?: string;
  ignoreCase?: boolean;
  multiline?: boolean;
}

export interface SedmatInsertCmd {
  type: "append" | "insert" | "change";
  scope?: SedmatContainerScope;
  address?: SedmatAddress;
  /** Optional inline match pattern (`a/pattern/text/[im]` form when unaddressed) */
  pattern?: string;
  ignoreCase?: boolean;
  multiline?: boolean;
  text: string;
  segments: SedmatReplacementSegment[];
}

export interface SedmatTransliterateCmd {
  type: "transliterate";
  scope?: SedmatContainerScope;
  address?: SedmatAddress;
  source: string;
  dest: string;
}

/** Container-level structural or styling command (`@3d`, `@$a/.../`, `@3{move=1}`, `@1:{z=#0F172A}`). */
export interface SedmatContainerCmd {
  type: "container";
  scope: SedmatContainerScope;
  op: "delete" | "append" | "insert" | "style";
  text?: string;
  segments?: SedmatReplacementSegment[];
  flags?: SedmatFormatFlags;
}

export type SedmatCommand =
  | SedmatSubstituteCmd
  | SedmatDeleteCmd
  | SedmatInsertCmd
  | SedmatTransliterateCmd
  | SedmatContainerCmd;

export interface SedmatProgram {
  commands: SedmatCommand[];
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class SedmatParseError extends Error {
  readonly offset: number;
  readonly length: number;
  readonly reason: string;
  readonly hint?: string;
  constructor(reason: string, offset = 0, options?: { length?: number; hint?: string }) {
    super(
      `SEDMAT parse error at offset ${offset}: ${reason}${options?.hint ? ` — ${options.hint}` : ""}`,
    );
    this.name = "SedmatParseError";
    this.offset = offset;
    this.length = Math.max(1, options?.length ?? 1);
    this.reason = reason;
    this.hint = options?.hint;
  }
}

export class SedmatAddressError extends Error {
  constructor(message: string) {
    super(`SEDMAT address error: ${message}`);
    this.name = "SedmatAddressError";
  }
}
