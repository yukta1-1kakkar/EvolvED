import type { ElementType } from "react";

type MathTextProps = {
  text: string;
  className?: string;
  as?: ElementType;
};

export function MathText({ text, className = "", as: Component = "p" }: MathTextProps) {
  const parts = splitMathText(text);
  return (
    <Component className={className}>
      {parts.map((part, index) => part.math ? (
        <span
          key={`${part.text}-${index}`}
          title={`Formal notation: ${part.text}`}
          className="mx-1 inline-flex items-center rounded-lg border border-border bg-background px-2 py-0.5 text-sm font-medium text-foreground"
        >
          {readableMath(part.text)}
        </span>
      ) : (
        <span key={`${part.text}-${index}`}>{readableInlineText(part.text)}</span>
      ))}
    </Component>
  );
}

function splitMathText(text: string) {
  const parts: Array<{ text: string; math: boolean }> = [];
  const pattern = /(\$\$[^$]+\$\$|\$[^$]+\$|\\\([^)]*\\\)|\\\[[\s\S]*?\\\]|\\(?:sqrt|vec|hat|frac|lVert|rVert|geq|leq|neq|lambda|nabla|times|cdot)(?:\{[^}]*\})?(?:\{[^}]*\})?)/g;
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > cursor) parts.push({ text: text.slice(cursor, match.index), math: false });
    parts.push({ text: match[0].replace(/^(\$\$|\$|\\\(|\\\[)|(\$\$|\$|\\\)|\\\])$/g, ""), math: true });
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), math: false });
  return parts.length ? parts : [{ text, math: false }];
}

function readableInlineText(value: string) {
  return value.replace(/\$([^$]+)\$/g, (_, notation: string) => readableMath(notation));
}

function readableMath(value: string) {
  const normalized = value
    .replace(/^\$+|\$+$/g, "")
    .replace(/\\sqrt\{([^}]+)\}/g, "sqrt($1)")
    .replace(/\bsqrt\s*([a-zA-Z][\w^+\-\s]*)/g, "sqrt($1)")
    .replace(/^\|\\vec\{([^}]+)\}\|$/g, "magnitude of vector $1")
    .replace(/\|\\vec\{([^}]+)\}\|/g, "magnitude of vector $1")
    .replace(/\\vec\{([^}]+)\}/g, "vector $1")
    .replace(/\\hat\{i\}/g, "unit x direction")
    .replace(/\\hat\{j\}/g, "unit y direction")
    .replace(/\\hat\{k\}/g, "unit z direction")
    .replace(/\\\|([^|]+)\\\|/g, "magnitude of $1")
    .replace(/\\lVert\s*([^]+?)\s*\\rVert/g, "magnitude of $1")
    .replace(/\\geq/g, ">=")
    .replace(/\\leq/g, "<=")
    .replace(/\\neq/g, "!=")
    .replace(/\\times/g, "x")
    .replace(/\\cdot/g, ".")
    .replace(/\\lambda/g, "lambda")
    .replace(/\\nabla/g, "gradient")
    .replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, "($1) / ($2)")
    .replace(/\^\{([^}]+)\}/g, "^$1")
    .replace(/_\{([^}]+)\}/g, "_$1")
    .replace(/[{}]/g, "")
    .replace(/\\/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return prettifyMathSymbols(normalized);
}

function prettifyMathSymbols(value: string) {
  const subscriptDigits = ["\u2080", "\u2081", "\u2082", "\u2083", "\u2084", "\u2085", "\u2086", "\u2087", "\u2088", "\u2089"];
  return value
    .replace(/\bsqrt\s*\(([^)]+)\)/g, "\u221a($1)")
    .replace(/\bsqrt([a-zA-Z])/g, "\u221a($1")
    .replace(/\^2\b/g, "\u00b2")
    .replace(/\^3\b/g, "\u00b3")
    .replace(/\^0\b/g, "\u2070")
    .replace(/\^1\b/g, "\u00b9")
    .replace(/_x\b/g, "\u2093")
    .replace(/_y\b/g, "\u1d67")
    .replace(/_z\b/g, "\u2099")
    .replace(/_\{?([0-9])\}?/g, (_, digit: string) => subscriptDigits[Number(digit)] ?? digit);
}
