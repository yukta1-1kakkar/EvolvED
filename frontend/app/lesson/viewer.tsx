'use client'
import React from 'react'

export default function LessonViewer({ blueprint }: { blueprint: any }) {
  if (!blueprint) return <div>No lesson to display.</div>

  return (
    <div className="p-6">
      <h2 className="text-2xl font-semibold">Lesson: {blueprint.lesson_id}</h2>
      <p className="mt-3">Estimated duration: {blueprint.estimated_lesson_duration} minutes</p>
      <div className="mt-4">
        <h3 className="font-bold">Structure</h3>
        <ul className="list-disc pl-6 mt-2">
          {blueprint.lesson_structure?.map((s: any, i: number) => (
            <li key={i} className="mt-1">{JSON.stringify(s)}</li>
          ))}
        </ul>
      </div>
    </div>
  )
}
