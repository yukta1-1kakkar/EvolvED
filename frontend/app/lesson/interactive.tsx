"use client"

import React, { useEffect, useRef, useState } from "react"

type LessonStep = {
  step?: number
  activity?: string
  content?: string
  description?: string
  vectors?: Array<[number, number]>
}

type Blueprint = {
  lesson_id: string
  lesson_structure?: LessonStep[]
  estimated_lesson_duration?: number
  generated_content?: {
    lesson_assets?: Array<{ id: string; type: string; content?: string }>
  }
}

declare global {
  interface Window {
    MathJax?: {
      typesetPromise?: () => Promise<void>
    }
  }
}

type Matrix2 = [number, number, number, number]
type Vector2 = [number, number]

async function loadMathJax() {
  if (typeof window === "undefined" || window.MathJax) return

  await new Promise((resolve, reject) => {
    const script = document.createElement("script")
    script.src = "https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js"
    script.async = true
    script.onload = resolve
    script.onerror = reject
    document.head.appendChild(script)
  })
}

function transformVector(matrix: Matrix2, vector: Vector2): Vector2 {
  return [
    matrix[0] * vector[0] + matrix[1] * vector[1],
    matrix[2] * vector[0] + matrix[3] * vector[1],
  ]
}

function eigenvalues(matrix: Matrix2) {
  const [a, b, c, d] = matrix
  const trace = a + d
  const determinant = a * d - b * c
  const discriminant = trace * trace - 4 * determinant

  if (discriminant >= 0) {
    const root = Math.sqrt(discriminant)
    return [
      { real: (trace + root) / 2, imaginary: 0 },
      { real: (trace - root) / 2, imaginary: 0 },
    ]
  }

  const imaginary = Math.sqrt(-discriminant) / 2
  return [
    { real: trace / 2, imaginary },
    { real: trace / 2, imaginary: -imaginary },
  ]
}

function parseVectorsAndMatrix(text: string) {
  const cleaned = text.replace(/\\\(|\\\)|\\\[|\\\]|\$/g, " ")
  const matrixMatch = cleaned.match(/\[\s*\[\s*([-+0-9.,\s]+)\s*\]\s*,\s*\[\s*([-+0-9.,\s]+)\s*\]\s*\]/)

  if (matrixMatch) {
    const row1 = matrixMatch[1].split(/[,\s]+/).map(Number).filter(Number.isFinite)
    const row2 = matrixMatch[2].split(/[,\s]+/).map(Number).filter(Number.isFinite)
    if (row1.length >= 2 && row2.length >= 2) {
      return { matrix: [row1[0], row1[1], row2[0], row2[1]] as Matrix2 }
    }
  }

  const vectorMatches = Array.from(cleaned.matchAll(/\[\s*([-+0-9.]+)\s*,\s*([-+0-9.]+)\s*\]/g))
  if (vectorMatches.length > 0) {
    return {
      vectors: vectorMatches.map((match) => [Number(match[1]), Number(match[2])] as Vector2),
    }
  }

  return {}
}

export default function InteractiveLesson({ initial }: { initial?: Blueprint }) {
  const [blueprint, setBlueprint] = useState<Blueprint | null>(initial || null)
  const [current, setCurrent] = useState(0)
  const [loading, setLoading] = useState(false)
  const [mode, setMode] = useState<"vector" | "matrix">("matrix")
  const [matrix, setMatrix] = useState<Matrix2>([1, 0, 0, 1])
  const [vectors, setVectors] = useState<Vector2[]>([[1, 0], [0, 1], [1, 1], [2, 1]])
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  const steps = blueprint?.lesson_structure || []
  const step = steps[current] || {}
  const determinant = matrix[0] * matrix[3] - matrix[1] * matrix[2]
  const eigs = eigenvalues(matrix)

  useEffect(() => {
    loadMathJax().catch(() => undefined)
  }, [])

  useEffect(() => {
    window.MathJax?.typesetPromise?.().catch(() => undefined)
  }, [blueprint, current])

  useEffect(() => {
    if (!step) return
    const parsed = parseVectorsAndMatrix(String(step.content || step.description || step.activity || ""))
    if (parsed.matrix) setMatrix(parsed.matrix)
    if (parsed.vectors) setVectors(parsed.vectors)
  }, [current, step])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const context = canvas.getContext("2d")
    if (!context) return
    const ctx = context

    const width = canvas.clientWidth
    const height = canvas.clientHeight
    const ratio = window.devicePixelRatio || 1
    canvas.width = width * ratio
    canvas.height = height * ratio
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    ctx.clearRect(0, 0, width, height)
    ctx.fillStyle = "#f8fafc"
    ctx.fillRect(0, 0, width, height)

    const scale = 42
    const origin = { x: width / 2, y: height / 2 }
    const point = ([x, y]: Vector2) => ({ x: origin.x + x * scale, y: origin.y - y * scale })

    ctx.strokeStyle = "#d7dde7"
    ctx.lineWidth = 1
    for (let x = origin.x % scale; x < width; x += scale) {
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, height)
      ctx.stroke()
    }
    for (let y = origin.y % scale; y < height; y += scale) {
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(width, y)
      ctx.stroke()
    }

    ctx.strokeStyle = "#64748b"
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(0, origin.y)
    ctx.lineTo(width, origin.y)
    ctx.moveTo(origin.x, 0)
    ctx.lineTo(origin.x, height)
    ctx.stroke()

    function drawArrow(vector: Vector2, color: string, label: string) {
      const end = point(vector)
      const angle = Math.atan2(origin.y - end.y, end.x - origin.x)
      ctx.strokeStyle = color
      ctx.fillStyle = color
      ctx.lineWidth = 2.5
      ctx.beginPath()
      ctx.moveTo(origin.x, origin.y)
      ctx.lineTo(end.x, end.y)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(end.x, end.y)
      ctx.lineTo(end.x - 10 * Math.cos(angle - Math.PI / 7), end.y + 10 * Math.sin(angle - Math.PI / 7))
      ctx.lineTo(end.x - 10 * Math.cos(angle + Math.PI / 7), end.y + 10 * Math.sin(angle + Math.PI / 7))
      ctx.closePath()
      ctx.fill()
      ctx.font = "12px system-ui"
      ctx.fillText(label, end.x + 8, end.y - 8)
    }

    vectors.forEach((vector, index) => drawArrow(vector, "#334155", `v${index + 1}`))
    vectors.forEach((vector, index) => drawArrow(transformVector(matrix, vector), "#2563eb", `Av${index + 1}`))
  }, [matrix, vectors])

  useEffect(() => {
    const timeout = setTimeout(() => {
      if (!blueprint) return
      const next = structuredClone(blueprint)
      next.lesson_structure = next.lesson_structure || []
      next.lesson_structure[current] = {
        ...(next.lesson_structure[current] || {}),
        vectors,
      }
      localStorage.setItem(`lesson_save_${next.lesson_id || "unsaved"}`, JSON.stringify(next))
      setBlueprint(next)
      setSavedAt(Date.now())
    }, 300)

    return () => clearTimeout(timeout)
  }, [vectors, current])

  async function generate(topic = "vectors") {
    setLoading(true)
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"}/generate-lesson`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ learner_id: "demo_learner", topic }),
      })
      setBlueprint(await response.json())
      setCurrent(0)
    } finally {
      setLoading(false)
    }
  }

  async function saveEdits(remote = false) {
    if (!blueprint) return
    localStorage.setItem(`lesson_save_${blueprint.lesson_id || "unsaved"}`, JSON.stringify(blueprint))
    setSavedAt(Date.now())

    if (remote) {
      await fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"}/save-lesson`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          learner_id: "demo_learner",
          lesson_id: blueprint.lesson_id,
          updated_structure: blueprint.lesson_structure || [],
        }),
      })
    }
  }

  async function playAudio(text: string) {
    const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"}/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    })
    const blob = await response.blob()
    const url = URL.createObjectURL(blob)
    await new Audio(url).play()
  }

  if (!blueprint) {
    return (
      <section className="border border-slate-200 p-6">
        <h3 className="text-xl font-semibold">Interactive Lesson</h3>
        <p className="mt-2 text-slate-600">No lesson loaded. Generate a demo lesson to begin.</p>
        <button className="mt-4 bg-emerald-600 px-3 py-2 text-white" onClick={() => generate()} disabled={loading}>
          {loading ? "Generating..." : "Generate Demo Lesson"}
        </button>
      </section>
    )
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
      <section>
        <h3 className="text-xl font-semibold">Lesson: {blueprint.lesson_id}</h3>
        <p className="mt-2 text-sm text-slate-600">Estimated: {blueprint.estimated_lesson_duration || 0} minutes</p>

        <div className="mt-4 border border-slate-200 bg-white p-4">
          <h4 className="font-semibold">Step {current + 1}: {step.activity || "Lesson activity"}</h4>
          <div className="mt-3 text-slate-700" dangerouslySetInnerHTML={{ __html: step.content || step.description || step.activity || "" }} />
          <div className="mt-4 flex flex-wrap gap-2">
            <button className="border border-slate-300 px-3 py-2" onClick={() => playAudio(step.content || step.activity || "")}>
              Play Audio
            </button>
            <button className="border border-slate-300 px-3 py-2" onClick={() => setCurrent(Math.max(0, current - 1))}>
              Prev
            </button>
            <button className="bg-blue-600 px-3 py-2 text-white" onClick={() => setCurrent(Math.min(steps.length - 1, current + 1))}>
              Next
            </button>
            <button className="border border-slate-300 px-3 py-2" onClick={() => saveEdits(false)}>
              Save Edits
            </button>
            <button className="border border-slate-300 px-3 py-2" onClick={() => saveEdits(true)}>
              Save & Sync
            </button>
          </div>
        </div>
      </section>

      <aside>
        <canvas ref={canvasRef} className="h-[300px] w-full border border-slate-200" />

        <div className="mt-4 border border-slate-200 p-4">
          <h4 className="font-semibold">Visualization Controls</h4>
          <label className="mt-3 block text-sm text-slate-600" htmlFor="mode">Mode</label>
          <select id="mode" value={mode} onChange={(event) => setMode(event.target.value as "vector" | "matrix")} className="mt-1 w-full border border-slate-300 p-2">
            <option value="vector">Vector</option>
            <option value="matrix">Matrix</option>
          </select>

          {mode === "matrix" && (
            <>
              <div className="mt-4 grid grid-cols-2 gap-2">
                {matrix.map((value, index) => (
                  <input
                    key={index}
                    type="number"
                    step="0.1"
                    value={value}
                    onChange={(event) => {
                      const next = [...matrix] as Matrix2
                      next[index] = Number(event.target.value)
                      setMatrix(next)
                    }}
                    className="border border-slate-300 p-2"
                  />
                ))}
              </div>
              <p className="mt-3 text-sm text-slate-700">Determinant: {determinant.toFixed(3)}</p>
              <div className="mt-2 text-sm text-slate-700">
                Eigenvalues:
                {eigs.map((eig, index) => (
                  <div key={index}>
                    lambda {index + 1}: {eig.real.toFixed(3)}
                    {eig.imaginary ? ` ${eig.imaginary > 0 ? "+" : "-"} ${Math.abs(eig.imaginary).toFixed(3)}i` : ""}
                  </div>
                ))}
              </div>
            </>
          )}

          <p className="mt-3 text-sm text-slate-600">Saved: {savedAt ? new Date(savedAt).toLocaleTimeString() : "Not saved"}</p>
        </div>
      </aside>
    </div>
  )
}
