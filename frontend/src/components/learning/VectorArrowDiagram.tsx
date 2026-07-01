import { MathText } from "@/components/learning/MathText";

type VectorArrowDiagramProps = {
  title?: string;
  description?: string;
  data?: unknown;
};

export function VectorArrowDiagram({ title, description, data }: VectorArrowDiagramProps) {
  const { x, y } = vectorPointFromText([title, description, data]);
  const magnitude = Math.sqrt(x * x + y * y);
  const bounds = Math.max(5, Math.ceil(Math.max(Math.abs(x), Math.abs(y)) + 1));
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
  const endX = px(x);
  const endY = py(y);
  const xEndY = py(0);
  const gridValues = Array.from({ length: bounds * 2 + 1 }, (_, index) => index - bounds);

  return (
    <div className="mt-4 rounded-2xl border border-border bg-background p-4">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title || "Vector component diagram"} className="h-auto w-full">
        <defs>
          <marker id="vector-arrow" markerWidth="11" markerHeight="11" refX="10" refY="5.5" orient="auto" markerUnits="userSpaceOnUse">
            <path d="M1 1.5 L10 5.5 L1 9.5 Z" fill="#7c3aed" />
          </marker>
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
        <line x1={originX} y1={originY} x2={endX} y2={xEndY} stroke="#14b8a6" strokeWidth="3.5" markerEnd="url(#vector-arrow)" />
        <line x1={endX} y1={xEndY} x2={endX} y2={endY} stroke="#f97316" strokeWidth="3.5" markerEnd="url(#vector-arrow)" />
        <line x1={originX} y1={originY} x2={endX} y2={endY} stroke="#7c3aed" strokeWidth="4.25" markerEnd="url(#vector-arrow)" />
        <line x1={endX} y1={originY} x2={endX} y2={endY} stroke="#7c3aed" strokeWidth="2" strokeDasharray="7 7" opacity="0.55" />
        <line x1={originX} y1={endY} x2={endX} y2={endY} stroke="#7c3aed" strokeWidth="2" strokeDasharray="7 7" opacity="0.55" />
        <circle cx={originX} cy={originY} r="6" fill="#30263b" />
        <circle cx={endX} cy={endY} r="3.5" fill="#7c3aed" />
        <text x={right + 34} y={originY + 6} fontSize="18" fontWeight="700" fill="#65566f">x</text>
        <text x={originX - 6} y={top - 26} fontSize="18" fontWeight="700" fill="#65566f">y</text>
        <text x={originX + 10} y={originY + 28} fontSize="17" fontWeight="700" fill="#30263b">(0,0)</text>
        <text x={(originX + endX) / 2 - 42} y={originY + 34} fontSize="18" fontWeight="700" fill="#0f766e">x = {formatNumber(x)}</text>
        <text x={endX + 12} y={(originY + endY) / 2} fontSize="18" fontWeight="700" fill="#c2410c">y = {formatNumber(y)}</text>
        <text x={endX + 12} y={endY - 12} fontSize="19" fontWeight="800" fill="#7c3aed">({formatNumber(x)},{formatNumber(y)})</text>
        <text x={(originX + endX) / 2 + 14} y={(originY + endY) / 2 - 18} fontSize="20" fontWeight="800" fill="#5b21b6">vector v</text>
        <text x="98" y="486" fontSize="18" fontWeight="700" fill="#30263b">
          |v| = {formatNumber(magnitude)} from {`\u221a(${formatNumber(x)}\u00b2 + ${formatNumber(y)}\u00b2)`}
        </text>
      </svg>
      {(title || description) && (
        <div className="mt-3 text-sm leading-relaxed text-muted-foreground">
          <MathText as="span" className="font-medium text-foreground" text={title ?? ""} />
          {title && description ? " - " : ""}
          <MathText as="span" text={description ?? ""} />
        </div>
      )}
    </div>
  );
}

function vectorPointFromText(values: unknown[]) {
  const text = values.map(flattenVisualText).join(" ");
  const pairs = [...text.matchAll(/\((-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\)/g)]
    .map((match) => ({ x: Number(match[1]), y: Number(match[2]) }))
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  const point = [...pairs, ...structuredPoints(values)].sort((a, b) => (b.x * b.x + b.y * b.y) - (a.x * a.x + a.y * a.y))[0];
  return point && (point.x || point.y) ? point : { x: 3, y: 4 };
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
