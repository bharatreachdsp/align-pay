import { loadFont as loadDmSans } from "@remotion/google-fonts/DMSans";
import { loadFont as loadFraunces } from "@remotion/google-fonts/Fraunces";
import { loadFont as loadMono } from "@remotion/google-fonts/JetBrainsMono";
import { AbsoluteFill, Audio, interpolate, OffthreadVideo, Sequence, Series, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";

const fraunces = loadFraunces().fontFamily;
const dmSans = loadDmSans().fontFamily;
const mono = loadMono().fontFamily;

const C = {
  paper: "#f6efe3",
  paper2: "#fffaf1",
  ink: "#1f1a16",
  ink2: "#4a4038",
  muted: "#7b6e62",
  terracotta: "#b4532f",
  tint: "#f3dccd",
};

export interface Caption {
  from: number;
  to: number;
  text: string;
}
export interface Callout {
  from: number;
  to: number;
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
}
export interface PlanScene {
  id: string;
  kind: "title" | "segment" | "end";
  durationInFrames: number;
  video?: string;
  audio?: string;
  audioDelayFrames?: number;
  captions: Caption[];
  callouts: Callout[];
}
export interface Plan {
  fps: number;
  width: number;
  height: number;
  repoUrl: string;
  scenes: PlanScene[];
}

function Mark({ size, progress }: { size: number; progress: number }) {
  const len = 40;
  const off = len * (1 - progress);
  const common = { stroke: C.terracotta, strokeWidth: 2.6, strokeLinecap: "round" as const, fill: "none", strokeDasharray: len, strokeDashoffset: off };
  return (
    <svg width={size} height={size} viewBox="0 0 32 32">
      <path d="M3 5 C 11 5, 12 12.5, 19 12.5 L 29 12.5" {...common} />
      <path d="M3 16 L 29 16" {...common} />
      <path d="M3 27 C 11 27, 12 19.5, 19 19.5 L 29 19.5" {...common} />
    </svg>
  );
}

function Strip() {
  return (
    <div style={{ position: "absolute", top: 0, left: 0, right: 0, background: C.ink, color: "#f3e9da", fontFamily: dmSans, fontSize: 26, textAlign: "center", padding: "12px 0", letterSpacing: 1 }}>
      Fictional store · PayPal sandbox · no real money
    </div>
  );
}

function Title() {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = interpolate(f, [0, 1.2 * fps], [0, 1], { extrapolateRight: "clamp" });
  const up = spring({ frame: f - 8, fps, config: { damping: 200 } });
  return (
    <AbsoluteFill style={{ background: C.paper, alignItems: "center", justifyContent: "center" }}>
      <Strip />
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 36, transform: `translateY(${(1 - up) * 30}px)`, opacity: up }}>
        <div style={{ display: "flex", alignItems: "center", gap: 36 }}>
          <Mark size={170} progress={p} />
          <div style={{ fontFamily: fraunces, fontWeight: 700, fontSize: 150, color: C.ink, letterSpacing: 10 }}>
            ALIGN<span style={{ color: C.terracotta, letterSpacing: 0, marginLeft: 22, fontWeight: 600 }}>Pay</span>
          </div>
        </div>
        <div style={{ fontFamily: dmSans, fontSize: 46, color: C.ink2, textAlign: "center", maxWidth: 1300, lineHeight: 1.3 }}>
          Every refund and invoice your AI agent makes in PayPal, traced to a human decision.
        </div>
      </div>
    </AbsoluteFill>
  );
}

function End({ repoUrl }: { repoUrl: string }) {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const up = spring({ frame: f, fps, config: { damping: 200 } });
  return (
    <AbsoluteFill style={{ background: C.paper, alignItems: "center", justifyContent: "center" }}>
      <Strip />
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 34, opacity: up }}>
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <Mark size={96} progress={1} />
          <div style={{ fontFamily: fraunces, fontWeight: 700, fontSize: 84, color: C.ink, letterSpacing: 6 }}>
            ALIGN<span style={{ color: C.terracotta, letterSpacing: 0, marginLeft: 14, fontWeight: 600 }}>Pay</span>
          </div>
        </div>
        <div style={{ fontFamily: fraunces, fontStyle: "italic", fontSize: 54, color: C.ink, borderLeft: `6px solid ${C.terracotta}`, paddingLeft: 28 }}>
          The model proposes, a person confirms, plain code enforces.
        </div>
        <div style={{ fontFamily: mono, fontSize: 40, color: C.ink, background: C.paper2, border: `2px solid #e1d4bf`, borderRadius: 14, padding: "16px 30px" }}>{repoUrl}</div>
        <div style={{ fontFamily: dmSans, fontSize: 32, color: C.muted }}>Open source (MIT) · built on ALIGN · Sakuraj Technologies, Jaipur</div>
      </div>
    </AbsoluteFill>
  );
}

function Captions({ captions }: { captions: Caption[] }) {
  const f = useCurrentFrame();
  const c = captions.find((x) => f >= x.from && f < x.to);
  if (!c) return null;
  return (
    <div style={{ position: "absolute", left: 0, right: 0, bottom: 54, display: "flex", justifyContent: "center" }}>
      <div style={{ maxWidth: 1500, background: "rgba(31,26,22,0.86)", color: "#fff7ec", fontFamily: dmSans, fontSize: 40, lineHeight: 1.3, padding: "14px 28px", borderRadius: 12, textAlign: "center" }}>{c.text}</div>
    </div>
  );
}

function Callouts({ callouts }: { callouts: Callout[] }) {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <>
      {callouts
        .filter((c) => f >= c.from && f < c.to)
        .map((c, i) => {
          const a = spring({ frame: f - c.from, fps, config: { damping: 18, stiffness: 160 } });
          const pad = 12;
          return (
            <div key={i} style={{ position: "absolute", left: c.x - pad, top: c.y - pad, width: c.w + pad * 2, height: c.h + pad * 2, border: `5px solid ${C.terracotta}`, borderRadius: 14, boxShadow: "0 0 0 9999px rgba(31,26,22,0.18)", transform: `scale(${0.92 + 0.08 * a})`, opacity: a }}>
              <div style={{ position: "absolute", top: -54, left: 0, background: C.terracotta, color: "#fff", fontFamily: dmSans, fontWeight: 600, fontSize: 28, padding: "6px 16px", borderRadius: 8, whiteSpace: "nowrap" }}>{c.label}</div>
            </div>
          );
        })}
    </>
  );
}

function Segment({ s }: { s: PlanScene }) {
  const f = useCurrentFrame();
  const fadeIn = interpolate(f, [0, 8], [0, 1], { extrapolateRight: "clamp" });
  const fadeOut = interpolate(f, [s.durationInFrames - 8, s.durationInFrames], [1, 0], { extrapolateLeft: "clamp" });
  return (
    <AbsoluteFill style={{ background: C.paper, opacity: Math.min(fadeIn, fadeOut) }}>
      {s.video ? <OffthreadVideo src={staticFile(s.video)} muted style={{ width: "100%", height: "100%" }} /> : null}
      <Callouts callouts={s.callouts} />
      <Captions captions={s.captions} />
    </AbsoluteFill>
  );
}

export function AlignPayVideo({ plan }: { plan: Plan }) {
  return (
    <AbsoluteFill style={{ background: C.paper }}>
      <Series>
        {plan.scenes.map((s) => (
          <Series.Sequence key={s.id} durationInFrames={s.durationInFrames}>
            {s.kind === "title" ? <Title /> : s.kind === "end" ? <End repoUrl={plan.repoUrl} /> : <Segment s={s} />}
            {s.kind !== "segment" ? <Captions captions={s.captions} /> : null}
            {s.audio ? (
              <Sequence from={s.audioDelayFrames ?? 0}>
                <Audio src={staticFile(s.audio)} />
              </Sequence>
            ) : null}
          </Series.Sequence>
        ))}
      </Series>
    </AbsoluteFill>
  );
}
