/* Line illustrations for the sign-in stories, drawn in the design system's
   own colours: ink outlines, paper and card fills, one brand-orange accent
   for "what matters next". Decorative: the story text carries the meaning. */

const ART = {
  "next-action": NextActionArt,
  team: TeamArt,
  portfolio: FinishLineArt,
};

export function StoryArt({ kind }) {
  const Art = ART[kind];
  return Art ? <Art /> : null;
}

function Svg({ children }) {
  return (
    <svg className="story-art" viewBox="0 0 400 280" role="presentation" focusable="false">
      {children}
    </svg>
  );
}

function Check({ x, y, size = 6 }) {
  return (
    <path className="ln-paper"
      d={`M${x - size} ${y} l${size * 0.7} ${size * 0.7} l${size * 1.3} -${size * 1.4}`} />
  );
}

/* A funding agreement, and its milestones: two done, the next one lit. */
function NextActionArt() {
  return (
    <Svg>
      <circle className="tint" cx="250" cy="150" r="118" />
      {/* the agreement */}
      <rect className="soft" x="34" y="34" width="104" height="132" rx="10" />
      <rect className="bar" x="52" y="54" width="52" height="8" rx="4" />
      <rect className="bar-soft" x="52" y="74" width="68" height="6" rx="3" />
      <rect className="bar-soft" x="52" y="88" width="60" height="6" rx="3" />
      <rect className="bar-soft" x="52" y="102" width="66" height="6" rx="3" />
      <circle className="accent" cx="112" cy="140" r="10" />
      {/* the path through the milestones */}
      <path className="ln" d="M60 236 C 120 236, 140 178, 200 176" />
      <path className="ln-dash" d="M200 176 C 262 174, 286 104, 346 100" />
      <circle className="ink-fill" cx="60" cy="236" r="13" />
      <Check x={60} y={236} />
      <circle className="ink-fill" cx="200" cy="176" r="13" />
      <Check x={200} y={176} />
      <circle className="accent-halo" cx="346" cy="100" r="26" />
      <circle className="accent" cx="346" cy="100" r="15" />
      {/* "next" callout */}
      <path className="soft" d="M270 26 h110 a10 10 0 0 1 10 10 v26 a10 10 0 0 1 -10 10 h-26 l-8 10 l-8 -10 h-68 a10 10 0 0 1 -10 -10 v-26 a10 10 0 0 1 10 -10 z" />
      <rect className="accent" x="282" y="40" width="40" height="8" rx="4" />
      <rect className="bar-soft" x="282" y="54" width="82" height="6" rx="3" />
    </Svg>
  );
}

/* Three people working one shared checklist. */
function TeamArt() {
  const people = [
    { cx: 70, cy: 86 },
    { cx: 58, cy: 200 },
    { cx: 338, cy: 150 },
  ];
  return (
    <Svg>
      <circle className="tint" cx="200" cy="146" r="116" />
      {/* connections */}
      <path className="ln-dash" d="M92 92 C 120 96, 130 104, 148 110" />
      <path className="ln-dash" d="M80 196 C 112 192, 128 184, 148 178" />
      <path className="ln-dash" d="M316 150 L 266 150" />
      {/* the shared list, with sheets behind it */}
      <rect className="paper-soft" x="166" y="40" width="112" height="176" rx="12" />
      <rect className="paper-soft" x="156" y="50" width="112" height="176" rx="12" />
      <rect className="soft" x="146" y="60" width="120" height="180" rx="12" />
      {[0, 1, 2, 3].map((row) => {
        const y = 92 + row * 38;
        const done = row < 2;
        const next = row === 2;
        return (
          <g key={row}>
            {done && <><rect className="ink-fill" x="164" y={y - 10} width="20" height="20" rx="6" /><Check x={174} y={y} size={5} /></>}
            {next && <rect className="accent" x="164" y={y - 10} width="20" height="20" rx="6" />}
            {!done && !next && <rect className="soft" x="164" y={y - 10} width="20" height="20" rx="6" />}
            <rect className={next ? "bar" : "bar-soft"} x="194" y={y - 4} width={row % 2 ? 46 : 56} height="8" rx="4" />
          </g>
        );
      })}
      {/* the team */}
      {people.map(({ cx, cy }, index) => (
        <g key={index}>
          <circle className={index === 2 ? "accent-soft" : "soft"} cx={cx} cy={cy} r="24" />
          <circle className="ln" cx={cx} cy={cy - 6} r="7" />
          <path className="ln" d={`M${cx - 12} ${cy + 15} a12 10 0 0 1 24 0`} />
        </g>
      ))}
    </Svg>
  );
}

/* An idea, carried milestone by milestone to the finish, with evidence on the way. */
function FinishLineArt() {
  return (
    <Svg>
      <circle className="tint" cx="210" cy="140" r="118" />
      <path className="ln-soft" d="M30 250 H370" />
      {/* the route */}
      <path className="ln" d="M84 208 C 140 206, 150 166, 200 160" />
      <path className="ln" d="M200 160 C 250 154, 262 108, 312 92" />
      <circle className="ink-fill" cx="200" cy="160" r="9" />
      <circle className="ink-fill" cx="262" cy="122" r="9" />
      {/* the idea */}
      <path className="rays" d="M58 152 l-10 -10 M84 140 v-14 M110 152 l10 -10" />
      <circle className="accent-soft" cx="84" cy="182" r="26" />
      <path className="ln" d="M75 186 l4.5 7 l4.5 -7 l4.5 7 l4.5 -7" />
      <rect className="soft" x="74" y="208" width="20" height="14" rx="4" />
      {/* evidence, ticked */}
      <rect className="soft" x="150" y="186" width="58" height="72" rx="8" />
      <rect className="bar-soft" x="162" y="202" width="34" height="6" rx="3" />
      <rect className="bar-soft" x="162" y="214" width="26" height="6" rx="3" />
      <circle className="accent" cx="196" cy="240" r="13" />
      <Check x={196} y={240} size={5} />
      {/* the finish */}
      <path className="ln" d="M330 46 V112" />
      <path className="accent" d="M332 48 h44 l-10 14 l10 14 h-44 z" />
      <circle className="ink-fill" cx="330" cy="114" r="5" />
    </Svg>
  );
}
