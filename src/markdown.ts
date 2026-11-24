export interface MarkdownReplacement {
  text: string;
  formats: string[];
}

export function parseMarkdownReplacement(replacement: string): MarkdownReplacement {
  const formats: string[] = [];
  let text = replacement;

  // Horizontal rule
  if (text.trim() === "---" || text.trim() === "***") {
    return { text: "", formats: ["hrule"] };
  }

  // Footnote [^text]
  const fnMatch = /^\[\^([^\]]+)\]$/.exec(text);
  if (fnMatch) {
    return { text: fnMatch[1]!, formats: ["footnote"] };
  }

  // Headings (# .. ######)
  const headMatch = /^(#{1,6})\s+(.*)$/.exec(text);
  if (headMatch) {
    formats.push(`heading${headMatch[1]!.length}`);
    text = headMatch[2]!;
  }

  // Checkbox / Bullet / Numbered list / Blockquote
  if (/^-\s+\[[xX ]\]\s+/.test(text)) {
    formats.push("checkbox");
    text = text.replace(/^-\s+\[[xX ]\]\s+/, "");
  } else if (/^-\s+/.test(text)) {
    formats.push("bullet");
    text = text.replace(/^-\s+/, "");
  } else if (/^\d+\.\s+/.test(text)) {
    formats.push("numbered");
    text = text.replace(/^\d+\.\s+/, "");
  } else if (/^>\s+/.test(text)) {
    formats.push("blockquote");
    text = text.replace(/^>\s+/, "");
  }

  // Inline markdown wrappers
  if (text.startsWith("***") && text.endsWith("***") && text.length > 6) {
    formats.push("bold", "italic");
    text = text.slice(3, -3);
  } else if (text.startsWith("**") && text.endsWith("**") && text.length > 4) {
    formats.push("bold");
    text = text.slice(2, -2);
  } else if (text.startsWith("__") && text.endsWith("__") && text.length > 4) {
    formats.push("underline");
    text = text.slice(2, -2);
  } else if (text.startsWith("~~") && text.endsWith("~~") && text.length > 4) {
    formats.push("strikethrough");
    text = text.slice(2, -2);
  } else if (text.startsWith("`") && text.endsWith("`") && text.length > 2) {
    formats.push("code");
    text = text.slice(1, -1);
  } else if (text.startsWith("*") && text.endsWith("*") && text.length > 2) {
    formats.push("italic");
    text = text.slice(1, -1);
  }

  return { text, formats };
}
