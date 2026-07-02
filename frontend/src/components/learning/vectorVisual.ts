export function isVectorVisualText(value: unknown) {
  const text = flattenVisualText(value).toLowerCase();
  return (
    /\bvector\b/.test(text) &&
    (/\((-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\)/.test(text) ||
      /\b(component|magnitude|origin|direction|endpoint|tail|head)\b/.test(text))
  );
}

function flattenVisualText(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(flattenVisualText).join(" ");
  if (value && typeof value === "object") return Object.values(value).map(flattenVisualText).join(" ");
  return "";
}
