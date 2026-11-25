// HelioNest mark: a sun rising beside a rooftop (rooftop solar). Same drawing as public/favicon.svg.
export default function Logo({ size = 32, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} aria-hidden="true">
      <rect width="64" height="64" rx="16" fill="#111110" />
      <circle cx="41" cy="23" r="9" fill="#FFC21A" />
      <path d="M11 49 27 33 43 49" fill="none" stroke="#FFFFFF" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M47 49h6" stroke="#FFFFFF" strokeWidth="6" strokeLinecap="round" />
    </svg>
  )
}

// Bare mark (no tile) for coloured surfaces, e.g. the yellow avatar on the call screen.
export function Mark({ size = 48, color = '#111110' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <circle cx="42" cy="21" r="9" stroke={color} strokeWidth="5.5" fill="none" />
      <path d="M9 51 27 33 45 51" fill="none" stroke={color} strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M49 51h6" stroke={color} strokeWidth="6" strokeLinecap="round" />
    </svg>
  )
}
