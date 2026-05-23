import InteractiveLesson from './interactive'

export default function LessonPage() {
  return (
    <div className="p-8">
      <h2 className="text-2xl font-semibold">Adaptive Lesson</h2>
      <p className="mt-2">Interactive lesson interface with MathJax, Three.js, and audio controls.</p>
      <div className="mt-6">
        <InteractiveLesson />
      </div>
    </div>
  )
}
