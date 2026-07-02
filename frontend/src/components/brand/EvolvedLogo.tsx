export function EvolvedLogo({ className = "size-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" fill="none" className={className} aria-hidden="true">
      <rect width="48" height="48" rx="14" fill="url(#evolved-logo-bg)" />
      <path d="M14 15.5c4.8-2 8.1-.9 10 1.1 1.9-2 5.2-3.1 10-1.1v17.1c-4.8-1.9-8.1-.9-10 1.1-1.9-2-5.2-3-10-1.1V15.5Z" fill="white" fillOpacity=".92" />
      <path d="M24 16.6v17.1" stroke="#5b21b6" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M16.8 20.2h3.8M16.8 24.4h4.7M27.4 20.2h3.8M26.5 24.4h4.7" stroke="#5b21b6" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="24" cy="11" r="2.6" fill="#f8c35d" />
      <circle cx="11" cy="24" r="2.3" fill="#f8c35d" />
      <circle cx="37" cy="24" r="2.3" fill="#f8c35d" />
      <path d="M21.8 12.3 13.1 22M26.2 12.3 34.9 22" stroke="#f8c35d" strokeWidth="1.5" strokeLinecap="round" />
      <defs>
        <linearGradient id="evolved-logo-bg" x1="6" y1="4" x2="42" y2="44" gradientUnits="userSpaceOnUse">
          <stop stopColor="#5b21b6" />
          <stop offset=".62" stopColor="#9d4edd" />
          <stop offset="1" stopColor="#f8c35d" />
        </linearGradient>
      </defs>
    </svg>
  );
}
