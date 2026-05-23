"use client"
import { useEffect, useState } from "react"

type Item = {
  id: string
  topic: string
  concept: string
  content: string
}

export default function CurriculumPage() {
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<Item | null>(null)
  const [blueprint, setBlueprint] = useState<any | null>(null)

  useEffect(() => {
    fetch((process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000") + "/curriculum")
      .then((r) => r.json())
      .then((d) => setItems(d.items || []))
  }, [])

  async function generate(item: Item) {
    setLoading(true)
    setSelected(item)
    try {
      const resp = await fetch((process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000") + "/generate-lesson", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ learner_id: "demo_learner", topic: item.concept }),
      })
      const data = await resp.json()
      setBlueprint(data)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold">Curriculum</h1>
      <p className="mt-2">Browse concepts and generate personalized lessons.</p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
        {items.map((it) => (
          <div key={it.id} className="border rounded p-4 shadow-sm">
            <h3 className="font-semibold">{it.topic} — {it.concept}</h3>
            <p className="text-sm mt-2 line-clamp-3">{it.content}</p>
            <div className="mt-4 flex gap-2">
              <button className="px-3 py-1 bg-blue-600 text-white rounded" onClick={() => generate(it)} disabled={loading}>
                {loading && selected?.id === it.id ? 'Generating...' : 'Generate Lesson'}
              </button>
              <button className="px-3 py-1 border rounded" onClick={() => setSelected(it)}>View</button>
            </div>
          </div>
        ))}
      </div>

      {selected && (
        <aside className="fixed right-4 bottom-4 w-96 bg-white border rounded shadow-lg p-4">
          <h4 className="font-bold">{selected.topic} — {selected.concept}</h4>
          <p className="mt-2 text-sm">{selected.content}</p>
          <div className="mt-3">
            <strong>Generated Lesson:</strong>
            <pre className="mt-2 max-h-64 overflow-auto text-xs bg-gray-50 p-2">{blueprint ? JSON.stringify(blueprint, null, 2) : 'No lesson generated yet.'}</pre>
          </div>
          <div className="mt-3 text-right">
            <button className="px-2 py-1 border rounded" onClick={() => { setSelected(null); setBlueprint(null); }}>Close</button>
          </div>
        </aside>
      )}
    </div>
  )
}
