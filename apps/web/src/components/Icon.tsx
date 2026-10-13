// A small authored icon set drawn in the plate's own hand: 1.5px ink strokes
// on a 20px grid, round caps, no fills except where a star is meant.

const paths = {
  atlas: (
    <>
      <rect x="2.75" y="2.75" width="14.5" height="14.5" rx="1" />
      <circle cx="8" cy="8.5" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="13" cy="6" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="12.5" cy="13" r="1.2" fill="currentColor" stroke="none" />
      <path d="M8 8.5 12.5 13M8 8.5 13 6" strokeWidth="0.9" />
    </>
  ),
  accession: (
    <>
      <path d="M3 5.5h14v11H3z" />
      <path d="M3 5.5 10 11l7-5.5" />
      <path d="M6.5 3.5h7" />
    </>
  ),
  session: (
    <>
      <rect x="3" y="5" width="13" height="10" rx="1" />
      <path d="M5.5 3h12v9.5" />
      <path d="M3 8h13" stroke="var(--saffron-deep)" />
      <path d="M5.5 11h6" />
    </>
  ),
  gaps: (
    <>
      <path d="M10 3.2c4 0 7 2.8 6.8 6.6-.2 3.9-3.4 6.7-7.2 6.5C5.8 16 3 13.2 3.2 9.7 3.4 6 6.4 3.4 10.6 3.6" stroke="var(--vermilion)" />
      <circle cx="10" cy="10" r="1.3" />
    </>
  ),
  ask: (
    <>
      <circle cx="8.5" cy="8.5" r="5" />
      <path d="m12.2 12.2 4.6 4.6" strokeWidth="2" />
      <circle cx="8.5" cy="8.5" r="1.2" fill="currentColor" stroke="none" />
    </>
  ),
  sources: (
    <>
      <path d="M3 4.5h14v4H3zM3 8.5h14v7H3z" />
      <path d="M8 6.5h4M8 11.5h4" />
    </>
  ),
  log: (
    <>
      <path d="M4 3h12v14H4z" />
      <path d="M7 7h6M7 10h6M7 13h3.5" />
    </>
  ),
  search: (
    <>
      <circle cx="8.5" cy="8.5" r="5" />
      <path d="m12.2 12.2 4 4" />
    </>
  ),
  close: <path d="m5 5 10 10M15 5 5 15" />,
  arrow: <path d="M4 10h11m-4-4 4 4-4 4" />,
  route: (
    <>
      <circle cx="5" cy="15" r="1.6" />
      <circle cx="15" cy="5" r="1.6" />
      <path d="M6.5 14c3-1 2-6 4-7.5s3-.5 3.4-.8" strokeDasharray="2 2" />
    </>
  ),
  spark: (
    <>
      <path d="M10 3v4M10 13v4M3 10h4M13 10h4" />
      <circle cx="10" cy="10" r="1.4" fill="currentColor" stroke="none" />
    </>
  ),
  upload: (
    <>
      <path d="M10 13V3.5m-4 4 4-4 4 4" />
      <path d="M3.5 12.5v4h13v-4" />
    </>
  ),
  trash: (
    <>
      <path d="M4 6h12M8 6V4h4v2M5.5 6l.8 10.5h7.4L14.5 6" />
    </>
  ),
  retry: <path d="M15.5 8A6 6 0 1 0 16 12m-.5-4V4m0 4h-4" />,
  pencil: <path d="M4 16l1-4 8.5-8.5 3 3L8 15zM12 5l3 3" />,
  sun: (
    <>
      <circle cx="10" cy="10" r="3.4" />
      <path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4" />
    </>
  ),
  moon: <path d="M15.5 12.6A6.5 6.5 0 0 1 7.4 4.5a6.5 6.5 0 1 0 8.1 8.1Z" />,
} as const;

export type IconName = keyof typeof paths;

export function Icon({ name, size = 20, label }: { name: IconName; size?: number; label?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={label ? undefined : true}
      role={label ? 'img' : undefined}
      aria-label={label}
    >
      {paths[name]}
    </svg>
  );
}

/** The mark: a hemispherical observing bowl in section, its gnomon, and one star. */
export function PlateMark({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 34 34" aria-hidden="true">
      <circle cx="17" cy="17" r="16" fill="var(--saffron)" />
      <path d="M5.5 15.5h23a11.5 11.5 0 0 1-23 0Z" fill="var(--ink)" />
      <path d="M8.5 18.5h17M10.5 22h13M17 15.5v11" stroke="var(--saffron)" strokeWidth="0.9" opacity="0.55" />
      <path d="M17 15.5 22.5 6.5" stroke="var(--ink)" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="11" cy="9.5" r="2.1" fill="var(--ink)" />
    </svg>
  );
}
