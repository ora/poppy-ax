import type { HomeContent } from "@/lib/home";

type Steps = HomeContent["steps"];

/**
 * A small assistant: a rounded head with an antenna, on a short body. The
 * outer group is the one that animates, so CSS never fights the placement.
 */
function Assistant({ x, className }: { x: number; className?: string }) {
  return (
    <g className={className}>
      <g transform={`translate(${x} 0)`}>
        <line x1="28" y1="200" x2="28" y2="186" className="fig-line" />
        <circle cx="28" cy="181" r="5" className="fig-poppy" />
        <rect x="0" y="200" width="56" height="48" rx="14" className="fig-line fig-paper" />
        <circle cx="18" cy="224" r="4.5" className="fig-ink" />
        <circle cx="38" cy="224" r="4.5" className="fig-ink" />
        <rect x="8" y="254" width="40" height="46" rx="10" className="fig-line fig-paper" />
      </g>
    </g>
  );
}

/** A key: a round bow with a hole, a shaft and two teeth. */
function Key({ transform }: { transform: string }) {
  return (
    <path
      transform={transform}
      className="fig-poppy"
      d="M-28 0a28 28 0 1 1 56 0a28 28 0 1 1 -56 0Z M-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0Z M20 -7H92V7H84V22H75V7H66V17H57V7H20Z"
    />
  );
}

/**
 * The three steps as one picture: an assistant at a door, a labelled key, and
 * an action inside the key's limits. It draws itself once on load, and stays
 * still for anyone who asks for reduced motion (see app/home.css).
 *
 * Labels are 28 units on a 720-unit canvas, so they stay about 13px tall when
 * the picture shrinks to a 375px phone.
 */
export function ThreeStepsPicture({ picture }: { picture: Steps["picture"] }) {
  return (
    <svg
      className="three-steps__picture"
      viewBox="0 0 720 330"
      role="img"
      aria-label={picture.label}
      focusable="false"
    >
      {/* The ground, one line under all three steps */}
      <line x1="8" y1="300.5" x2="712" y2="300.5" className="fig-line fig-ground" />

      {/* Step numbers */}
      {[1, 2, 3].map((n) => (
        <text key={n} x={(n - 1) * 240 + 10} y="62" className="fig-number">
          {n}
        </text>
      ))}

      {/* 1. The door, with its public file on a plate above it */}
      <rect x="126" y="140" width="88" height="160" rx="3" pathLength={1} className="fig-line fig-draw" />
      <rect x="140" y="154" width="60" height="58" rx="2" pathLength={1} className="fig-line fig-thin fig-draw" />
      <circle cx="200" cy="232" r="5" className="fig-ink" />
      <rect x="76" y="84" width="188" height="42" rx="5" className="fig-line fig-thin fig-paper" />
      <text x="170" y="114" className="fig-label fig-label--mono">
        {picture.doorSign}
      </text>
      <Assistant x={26} className="fig-walk" />

      {/* 2. The assistant gets a key with a tag */}
      <Assistant x={256} />
      <g className="fig-key-group">
        <Key transform="translate(370 158)" />
        <line x1="362" y1="184" x2="352" y2="234" className="fig-line fig-thin" />
        <rect x="282" y="234" width="194" height="44" rx="6" className="fig-line fig-thin fig-paper" />
        <circle cx="296" cy="256" r="3.5" className="fig-ink" />
        <text x="386" y="266" className="fig-label">
          {picture.keyTag}
        </text>
      </g>

      {/* 3. Inside the key's limits, one action goes through; one outside does not */}
      <g className="fig-limits">
        <rect x="486" y="96" width="230" height="124" rx="16" className="fig-boundary" />
        <rect x="498" y="84" width="58" height="24" className="fig-paper-only" />
        <Key transform="translate(512 96) scale(0.42)" />
      </g>
      <g className="fig-allowed">
        <circle cx="511" cy="160" r="15" className="fig-line fig-paper" />
        <path d="M503 160l5 6 11-13" pathLength={1} className="fig-line fig-draw-late" />
        <text x="534" y="170" className="fig-label fig-label--start">
          {picture.allowed}
        </text>
      </g>
      <g className="fig-refused">
        <path d="M503 252l16 16M519 252l-16 16" className="fig-line fig-thin fig-muted" />
        <text x="534" y="270" className="fig-label fig-label--start fig-label--muted">
          {picture.refused}
        </text>
      </g>
    </svg>
  );
}

export function ThreeSteps({ steps }: { steps: Steps }) {
  return (
    <figure className="three-steps">
      <ThreeStepsPicture picture={steps.picture} />
      <figcaption>
        <ol className="three-steps__list" role="list">
          {steps.items.map((step) => (
            <li key={step.number} className="three-steps__item">
              <h3 className="three-steps__title">
                <span className="three-steps__number" aria-hidden="true">
                  {step.number}
                </span>
                <span className="visually-hidden">{`${steps.stepPrefix} ${step.number}: `}</span>
                {step.title}
              </h3>
              <p className="three-steps__caption">{step.caption}</p>
            </li>
          ))}
        </ol>
      </figcaption>
    </figure>
  );
}
