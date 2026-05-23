import './globals.css'

export const metadata = {
  title: 'EvolvED',
  description: 'Adaptive Educational Intelligence',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
