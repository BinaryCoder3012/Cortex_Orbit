// A graduated scale: ten saffron segments filled up to the recall level.
// Ghost-level recall turns vermilion so it reads without the number.

export function StepWedge({ value, large = false, label }: { value: number; large?: boolean; label?: string }) {
  const steps = 10;
  const filled = Math.round(Math.max(0, Math.min(1, value)) * steps);
  return (
    <span
      className={`wedge${large ? ' lg' : ''}${value < 0.4 ? ' ghost' : ''}`}
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value * 100)}
      aria-label={label ?? 'Recall'}
    >
      {Array.from({ length: steps }, (_, i) => (
        <i key={i} className={i < filled ? undefined : 'off'} style={i < filled ? { opacity: 0.35 + (0.65 * (i + 1)) / steps } : undefined} />
      ))}
    </span>
  );
}
