/** The Converge mark: three lines converging into parallel lines. */
export function ConvergeMark({ size = 30, color = "var(--terracotta)" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <path d="M3 5 C 11 5, 12 12.5, 19 12.5 L 29 12.5" stroke={color} strokeWidth="2.6" strokeLinecap="round" />
      <path d="M3 16 L 29 16" stroke={color} strokeWidth="2.6" strokeLinecap="round" />
      <path d="M3 27 C 11 27, 12 19.5, 19 19.5 L 29 19.5" stroke={color} strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}
