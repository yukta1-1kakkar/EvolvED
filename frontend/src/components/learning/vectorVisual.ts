export function isVectorVisualText(value: unknown) {
  return /\b(vector|component|magnitude|hypotenuse|origin|coordinate|direction)\b/i.test(flattenVisualText(value));
}

function flattenVisualText(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(flattenVisualText).join(" ");
  if (value && typeof value === "object") return Object.values(value).map(flattenVisualText).join(" ");
  return "";
}
