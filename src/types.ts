/**
 * SEDMAT v3.6 / v3.7 AST, document projection, mutation plan, and backend types.
 */

export type Command = "s" | "d" | "a" | "i" | "y" | "brace";

export interface Address {
  /** 1-based start index, or -1 for `$` (last element). */
  start: number;
  /** 1-based end index, -1 for `$`, or 0 when single address. */
  end: number;
  hasRange: boolean;
}

export type ContainerType = "slide" | "sheet" | "tab" | "page" | "section";

export interface ContainerScope {
  /** Optional explicit container type (`slide`, `sheet`, `tab`, `page`, `section`). */
  containerType?: ContainerType;
  /** Numeric address (`@2`, `@2,5`, `@$`) when targeting by index. */
  address?: Address;
  /** Wildcard (`@*`) targeting all containers. */
  all?: boolean;
  /** Named container (`@Summary`, `@"Q4 Budget"`). */
  name?: string;
  /** Optional named sub-region (`title`, `sub`, `subtitle`, `body`, `notes`, `header`, `footer`, `shape=N`). */
  region?: string;
  /** True when the expression operates on the container itself (`@3d`, `@$a/.../`, `@3{move=1}`). */
  containerOp: boolean;
}

export interface InlineSpan {
  flag: string;
  text: string;
}

export interface BraceExpression {
  // Boolean inline flags
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  code?: boolean;
  sup?: boolean;
  sub?: boolean;
  smallCaps?: boolean;

  // Value flags
  text?: string;
  color?: string;
  bg?: string;
  font?: string;
  size?: number;
  url?: string;
  heading?: string;
  leading?: number;
  align?: string;
  opacity?: number;
  indent?: number;
  kerning?: number;
  width?: number;
  height?: number;
  spacingSet?: boolean;
  spacingAbove?: number;
  spacingBelow?: number;
  effect?: string;
  cols?: number;

  // Special flags
  reset?: boolean;
  noReset?: boolean;
  hasBreak?: boolean;
  breakKind?: string;
  comment?: string;
  bookmark?: string;
  check?: boolean;
  hasToc?: boolean;
  toc?: number;
  imgRef?: string;
  tableRef?: string;

  // v3.7 Slide & Shape container brace flags
  layout?: string;
  zone?: string;
  shape?: string;
  fill?: string;
  stroke?: string;
  notes?: string;
  transition?: string;
  move?: number;
  dup?: boolean;
  hide?: boolean;

  inlineSpans?: InlineSpan[];
}

export interface BraceSpan {
  start: number;
  end: number;
  isGlobal: boolean;
  expr: BraceExpression;
  raw?: string;
}

export interface CellReference {
  tableIndex: number;
  row: number;
  column: number;
  subpattern?: string;
  rowOperation?: string;
  columnOperation?: string;
  operationTarget?: number;
  endRow?: number;
  endColumn?: number;
}

export interface TableReference {
  tableIndex: number;
  isCreate?: boolean;
  createRows?: number;
  createCols?: number;
  hasHeader?: boolean;
  row?: number;
  col?: number;
  hasRange?: boolean;
  endRow?: number;
  endCol?: number;
  isAllCells?: boolean;
  rowWild?: boolean;
  colWild?: boolean;
  rowOp?: string;
  colOp?: string;
}

export interface ImageReference {
  byPosition?: boolean;
  position?: number;
  allImages?: boolean;
  byAlt?: boolean;
  pattern?: string;
}

export interface ImageSpec {
  url: string;
  alt?: string;
  width?: number;
  height?: number;
}

export interface TableCreateSpec {
  rows: number;
  columns: number;
  header?: boolean;
  cells?: string[][];
}

export interface Expression {
  command: Command;
  pattern: string;
  replacement: string;
  global: boolean;
  nthMatch: number;
  flags: string;
  address?: Address;
  container?: ContainerScope;

  // Enriched semantic fields
  cell?: CellReference;
  table?: TableReference;
  image?: ImageReference;
  brace?: BraceExpression;
  braceSpans?: BraceSpan[];
  tableCreate?: TableCreateSpec;
  enriched?: boolean;
}

export interface Program {
  expressions: Expression[];
}

// --- Document Projection ---

export type DocumentBlockKind = "paragraph" | "table" | "table_of_contents" | "section_break";

export interface DocumentBlock {
  kind: DocumentBlockKind;
  startIndex: number;
  endIndex: number;
  itemIndex: number;
}

export interface DocumentTextRun {
  text: string;
  startIndex: number;
  endIndex: number;
}

export interface DocumentParagraph {
  text: string;
  startIndex: number;
  endIndex: number;
  namedStyle?: string;
  bulletListId?: string;
  bulletNestingLevel?: number;
  leadingTab?: boolean;
}

export interface DocumentTableCell {
  text: string;
  startIndex: number;
  endIndex: number;
  textStartIndex: number;
  textEndIndex: number;
  rowSpan?: number;
  columnSpan?: number;
}

export interface DocumentTableRow {
  startIndex: number;
  endIndex: number;
  cells: DocumentTableCell[];
}

export interface DocumentTable {
  startIndex: number;
  endIndex: number;
  declaredRows: number;
  declaredColumns: number;
  rows: DocumentTableRow[];
}

export interface DocumentImage {
  objectId: string;
  index: number;
  alt?: string;
  isPositioned?: boolean;
}

export interface DocumentSegment {
  tabId: string;
  title: string;
  bodyStartIndex: number;
  bodyEndIndex: number;
  blocks: DocumentBlock[];
  textRuns: DocumentTextRun[];
  paragraphs: DocumentParagraph[];
  tables: DocumentTable[];
  images: DocumentImage[];
}

export interface DocumentProjection {
  documentId: string;
  revisionId: string;
  legacy?: DocumentSegment;
  tabs: DocumentSegment[];
}

// --- Planning & Mutations ---

export type AddressElementKind = "paragraph" | "table" | "toc";

export interface AddressElement {
  number: number;
  kind: AddressElementKind;
  text: string;
  startIndex: number;
  endIndex: number;
}

export interface AddressMutation {
  startIndex: number;
  endIndex: number;
  insertText?: string;
}

export interface ImageMutation {
  startIndex: number;
  endIndex: number;
  image: ImageSpec;
}

export interface FootnoteMutation {
  startIndex: number;
  endIndex: number;
  text: string;
}

export interface TextEdit {
  startIndex: number;
  endIndex: number;
  insertText: string;
  horizontalRule?: boolean;
}

export interface FormatIntent {
  startIndex: number;
  endIndex: number;
  structuralStartIndex: number;
  structuralEndIndex: number;
  formats: string[];
  leadingTab?: boolean;
  brace?: BraceExpression;
  braceSpans?: BraceSpan[];
}

export interface TextPlan {
  matchCount: number;
  images: ImageMutation[];
  footnotes: FootnoteMutation[];
  textEdits: TextEdit[];
  formatting: FormatIntent[];
}

export interface TableCreateMutation {
  startIndex: number;
  endIndex: number;
  rows: number;
  columns: number;
}

// --- Backend & Execution ---

export interface DocumentIntrospector {
  project(): Promise<DocumentProjection> | DocumentProjection;
}

export interface Backend extends DocumentIntrospector {
  applyTextPlan(tabId: string, plan: TextPlan): Promise<void> | void;
  applyAddressMutations(tabId: string, mutations: AddressMutation[]): Promise<void> | void;
  applyTableCreate(tabId: string, mutation: TableCreateMutation, spec: TableCreateSpec): Promise<void> | void;
  applyTransliterate(
    tabId: string,
    source: string,
    dest: string,
    targets: AddressElement[],
  ): Promise<number> | number;
  applyContainerOp?(scope: ContainerScope, expr: Expression): Promise<number> | number;
}

export interface ExecuteOptions {
  dryRun?: boolean;
  tabId?: string;
}

export interface ExpressionReport {
  index: number;
  command: Command;
  matchCount: number;
  textPlan?: TextPlan;
  addressMutations?: AddressMutation[];
  tableCreate?: TableCreateMutation;
  dryRun: boolean;
}

export interface ExecutionReport {
  dryRun: boolean;
  tabId: string;
  totalMatches: number;
  expressions: ExpressionReport[];
}
