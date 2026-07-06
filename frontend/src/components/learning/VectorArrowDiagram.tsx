type VectorArrowDiagramProps = {
  title?: string;
  description?: string;
  data?: unknown;
};

export function VectorArrowDiagram({ title, description, data }: VectorArrowDiagramProps) {
  const values = [title, description, data];
  const arrows = vectorArrowsFromText(values);
  const point = arrows.length ? null : vectorPointFromText(values);
  if (!arrows.length && !point) return null;
  const singleVectorLabel = vectorLabelFromText(values);
  const vectors = arrows.length ? arrows : [{ label: singleVectorLabel, start: { x: 0, y: 0 }, end: point! }];
  const allPoints = vectors.flatMap((vector) => [vector.start, vector.end, { x: 0, y: 0 }]);
  const bounds = Math.max(5, Math.ceil(Math.max(...allPoints.flatMap((item) => [Math.abs(item.x), Math.abs(item.y)])) + 1));
  const singleOriginVector = vectors.length === 1 && vectors[0].start.x === 0 && vectors[0].start.y === 0;
  const width = 920;
  const height = 520;
  const left = 92;
  const right = 830;
  const top = 52;
  const bottom = 440;
  const plotWidth = right - left;
  const plotHeight = bottom - top;
  const px = (value: number) => left + ((value + bounds) / (bounds * 2)) * plotWidth;
  const py = (value: number) => bottom - ((value + bounds) / (bounds * 2)) * plotHeight;
  const originX = px(0);
  const originY = py(0);
  const gridValues = Array.from({ length: bounds * 2 + 1 }, (_, index) => index - bounds);
  const colors = ["#7c3aed", "#0f766e", "#c2410c", "#2563eb"];

  return (
    <div className="mt-4 rounded-2xl border border-border bg-background p-4">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title || "Vector component diagram"} className="h-auto w-full">
        <defs>
          {colors.map((color, index) => (
            <marker key={color} id={`vector-arrow-${index}`} markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto" markerUnits="userSpaceOnUse">
              <path d="M1 1.5 L8 4.5 L1 7.5 Z" fill={color} />
            </marker>
          ))}
          <marker id="axis-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto" markerUnits="userSpaceOnUse">
            <path d="M1 1.5 L6 3.5 L1 5.5 Z" fill="#65566f" />
          </marker>
        </defs>
        <rect x="0" y="0" width={width} height={height} rx="22" fill="#fbf9ff" />
        {gridValues.map((value) => (
          <g key={`grid-${value}`}>
            <line x1={px(value)} y1={top} x2={px(value)} y2={bottom} stroke="#e5ddf3" strokeWidth="1" />
            <line x1={left} y1={py(value)} x2={right} y2={py(value)} stroke="#e5ddf3" strokeWidth="1" />
          </g>
        ))}
        <line x1={left} y1={originY} x2={right + 18} y2={originY} stroke="#65566f" strokeWidth="2.5" markerEnd="url(#axis-arrow)" />
        <line x1={originX} y1={bottom} x2={originX} y2={top - 18} stroke="#65566f" strokeWidth="2.5" markerEnd="url(#axis-arrow)" />
        {singleOriginVector && (() => {
          const vector = vectors[0];
          const endX = px(vector.end.x);
          const endY = py(vector.end.y);
          const xEndY = py(0);
          return (
            <>
              <line x1={originX} y1={originY} x2={endX} y2={xEndY} stroke="#14b8a6" strokeWidth="3.5" markerEnd="url(#vector-arrow-1)" />
              <line x1={endX} y1={xEndY} x2={endX} y2={endY} stroke="#f97316" strokeWidth="3.5" markerEnd="url(#vector-arrow-2)" />
              <line x1={endX} y1={originY} x2={endX} y2={endY} stroke="#7c3aed" strokeWidth="2" strokeDasharray="7 7" opacity="0.55" />
              <line x1={originX} y1={endY} x2={endX} y2={endY} stroke="#7c3aed" strokeWidth="2" strokeDasharray="7 7" opacity="0.55" />
              <text x={(originX + endX) / 2 - 42} y={originY + 34} fontSize="18" fontWeight="700" fill="#0f766e">x = {formatNumber(vector.end.x)}</text>
              <text x={endX + 12} y={(originY + endY) / 2} fontSize="18" fontWeight="700" fill="#c2410c">y = {formatNumber(vector.end.y)}</text>
            </>
          );
        })()}
        {vectors.map((vector, index) => {
          const colorIndex = index % colors.length;
          const startX = px(vector.start.x);
          const startY = py(vector.start.y);
          const endX = px(vector.end.x);
          const endY = py(vector.end.y);
          const labelX = (startX + endX) / 2 + 12;
          const labelY = (startY + endY) / 2 - 12;
          return (
            <g key={`${vector.label}-${index}`}>
              <line x1={startX} y1={startY} x2={endX} y2={endY} stroke={colors[colorIndex]} strokeWidth="4.25" markerEnd={`url(#vector-arrow-${colorIndex})`} />
              <circle cx={startX} cy={startY} r="5" fill="#30263b" />
              <circle cx={endX} cy={endY} r="3.5" fill={colors[colorIndex]} />
              <text x={endX + 12} y={endY - 12} fontSize="18" fontWeight="800" fill={colors[colorIndex]}>
                ({formatNumber(vector.end.x)},{formatNumber(vector.end.y)})
              </text>
              <text x={labelX} y={labelY} fontSize="20" fontWeight="800" fill={colors[colorIndex]}>
                {arrows.length ? "Arrow" : "vector"} {vector.label}
              </text>
              {(vector.start.x || vector.start.y) ? (
                <text x={startX + 10} y={startY + 26} fontSize="16" fontWeight="700" fill="#30263b">
                  ({formatNumber(vector.start.x)},{formatNumber(vector.start.y)})
                </text>
              ) : null}
            </g>
          );
        })}
        <circle cx={originX} cy={originY} r="6" fill="#30263b" />
        <text x={right + 34} y={originY + 6} fontSize="18" fontWeight="700" fill="#65566f">x</text>
        <text x={originX - 6} y={top - 26} fontSize="18" fontWeight="700" fill="#65566f">y</text>
        <text x={originX + 10} y={originY + 28} fontSize="17" fontWeight="700" fill="#30263b">(0,0)</text>
      </svg>
    </div>
  );
}

type Point = { x: number; y: number };
type VectorArrow = { label: string; start: Point; end: Point };

function vectorArrowsFromText(values: unknown[]): VectorArrow[] {
  const text = values.map(flattenVisualText).join(" ");
  const arrowPattern = /\b(?:arrow|vector)\s+([a-z])\b.{0,60}?\bfrom\s*\((-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\)\s*\bto\s*\((-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\)/gi;
  const arrows = [...text.matchAll(arrowPattern)].map((match) => ({
    label: match[1].toUpperCase(),
    start: { x: Number(match[2]), y: Number(match[3]) },
    end: { x: Number(match[4]), y: Number(match[5]) },
  }));
  if (!arrows.length) {
    const startEndPattern = /\bstarts?\s+at\s*\((-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\)\s*(?:,|\band\b)?\s*ends?\s+at\s*\((-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\)/gi;
    arrows.push(...[...text.matchAll(startEndPattern)].map((match, index) => ({
      label: String.fromCharCode(65 + index),
      start: { x: Number(match[1]), y: Number(match[2]) },
      end: { x: Number(match[3]), y: Number(match[4]) },
    })));
  }
  const validArrows = arrows.filter((arrow) => (
    Number.isFinite(arrow.start.x) &&
    Number.isFinite(arrow.start.y) &&
    Number.isFinite(arrow.end.x) &&
    Number.isFinite(arrow.end.y) &&
    (arrow.start.x !== arrow.end.x || arrow.start.y !== arrow.end.y)
  ));
  if (validArrows.length) return validArrows;

  if (!/\bequal vectors?\b/i.test(text)) return [];
  const pairs = [...text.matchAll(/\((-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\)/g)]
    .map((match) => ({ x: Number(match[1]), y: Number(match[2]) }))
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  if (pairs.length < 4) return [];
  return [
    { label: "A", start: pairs[0], end: pairs[1] },
    { label: "B", start: pairs[2], end: pairs[3] },
  ].filter((arrow) => arrow.start.x !== arrow.end.x || arrow.start.y !== arrow.end.y);
}

function vectorPointFromText(values: unknown[]) {
  const text = values.map(flattenVisualText).join(" ");
  const pairs = [...text.matchAll(/\((-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\)/g)]
    .map((match) => ({ x: Number(match[1]), y: Number(match[2]) }))
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  const point = [...pairs, ...structuredPoints(values)].sort((a, b) => (b.x * b.x + b.y * b.y) - (a.x * a.x + a.y * a.y))[0];
  return point && (point.x || point.y) ? point : null;
}

function vectorLabelFromText(values: unknown[]) {
  const text = values.map(flattenVisualText).join(" ");
  const match = text.match(/\bvector\s+([a-z])\s*=/i) ?? text.match(/\b([a-z])\s*=\s*\((-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\)/i);
  return match?.[1]?.toLowerCase() ?? "v";
}

function structuredPoints(values: unknown[]): Array<{ x: number; y: number }> {
  return values.flatMap((value) => {
    if (Array.isArray(value)) return structuredPoints(value);
    if (!value || typeof value !== "object") return [];
    const record = value as Record<string, unknown>;
    const x = Number(record.x);
    const y = Number(record.y);
    return Number.isFinite(x) && Number.isFinite(y) ? [{ x, y }] : structuredPoints(Object.values(record));
  });
}

function flattenVisualText(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(flattenVisualText).join(" ");
  if (value && typeof value === "object") return Object.values(value).map(flattenVisualText).join(" ");
  return "";
}

function formatNumber(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, "");
}
