import { motion } from "framer-motion";

const nodes = [
  { id: "core", x: 50, y: 50, r: 8, label: "You", primary: true },
  { id: "n1", x: 22, y: 28, r: 5, label: "Calculus" },
  { id: "n2", x: 78, y: 26, r: 4, label: "Vectors" },
  { id: "n3", x: 84, y: 60, r: 5, label: "Linear Alg" },
  { id: "n4", x: 70, y: 84, r: 4, label: "Series" },
  { id: "n5", x: 28, y: 80, r: 5, label: "Limits" },
  { id: "n6", x: 12, y: 56, r: 4, label: "Functions" },
  { id: "n7", x: 50, y: 14, r: 3, label: "Topology" },
  { id: "n8", x: 50, y: 90, r: 3, label: "Proofs" },
];

const links: [string, string][] = [
  ["core","n1"],["core","n2"],["core","n3"],["core","n4"],
  ["core","n5"],["core","n6"],["n1","n5"],["n1","n6"],
  ["n2","n3"],["n3","n4"],["n5","n8"],["n2","n7"],["core","n7"],["core","n8"],
];

export function KnowledgeGraph() {
  const find = (id: string) => nodes.find((n) => n.id === id)!;
  return (
    <div className="relative w-full h-full">
      <div className="absolute inset-0 rounded-3xl glass shadow-[var(--shadow-soft)]" />
      <div className="absolute inset-0 grain pointer-events-none rounded-3xl overflow-hidden text-foreground" />
      <svg viewBox="0 0 100 100" className="absolute inset-0 w-full h-full p-6">
        <defs>
          <linearGradient id="edge" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="oklch(0.45 0.18 300)" stopOpacity="0.6" />
            <stop offset="1" stopColor="oklch(0.82 0.15 80)" stopOpacity="0.5" />
          </linearGradient>
          <radialGradient id="nodeg" cx="0.3" cy="0.3">
            <stop offset="0" stopColor="oklch(0.85 0.12 305)" />
            <stop offset="1" stopColor="oklch(0.45 0.18 300)" />
          </radialGradient>
          <radialGradient id="core" cx="0.3" cy="0.3">
            <stop offset="0" stopColor="oklch(0.92 0.12 80)" />
            <stop offset="1" stopColor="oklch(0.74 0.22 330)" />
          </radialGradient>
        </defs>

        {links.map(([a, b], i) => {
          const A = find(a); const B = find(b);
          return (
            <motion.line
              key={i}
              x1={A.x} y1={A.y} x2={B.x} y2={B.y}
              stroke="url(#edge)" strokeWidth={0.3}
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: 1 }}
              transition={{ duration: 1.2, delay: 0.4 + i * 0.05, ease: "easeOut" }}
            />
          );
        })}

        {nodes.map((n, i) => (
          <g key={n.id}>
            <motion.circle
              cx={n.x} cy={n.y} r={n.r}
              fill={n.primary ? "url(#core)" : "url(#nodeg)"}
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.6, delay: 0.8 + i * 0.06, type: "spring", stiffness: 140 }}
              style={{ transformOrigin: `${n.x}px ${n.y}px` }}
            />
            {n.primary && (
              <motion.circle
                cx={n.x} cy={n.y} r={n.r}
                fill="none" stroke="oklch(0.74 0.22 330)" strokeWidth={0.4}
                initial={{ scale: 1, opacity: 0.8 }}
                animate={{ scale: 2.4, opacity: 0 }}
                transition={{ duration: 2.4, repeat: Infinity, ease: "easeOut" }}
                style={{ transformOrigin: `${n.x}px ${n.y}px` }}
              />
            )}
          </g>
        ))}
      </svg>

      <div className="absolute bottom-5 left-5 right-5 flex items-center justify-between text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
        <span>Learner model · live</span>
        <span className="flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-gold" />
          mastery updating
        </span>
      </div>
    </div>
  );
}
