import Link from 'next/link'

export default function Page() {
  return (
    <main className="p-8">
      <h1 className="text-3xl font-bold">EvolvED</h1>
      <p className="mt-4">Adaptive Educational Intelligence Platform (scaffold)</p>
      <div className="mt-6">
        <div className="flex gap-4">
          <Link href="/curriculum" className="text-blue-600">Browse Curriculum</Link>
          <Link href="/lesson" className="text-blue-600">Start Lesson</Link>
        </div>
      </div>
    </main>
  )
}
