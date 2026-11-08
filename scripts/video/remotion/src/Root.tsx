import { Composition } from "remotion";
import { AlignPayVideo, type Plan } from "./Video";

const EMPTY: Plan = { fps: 30, width: 1920, height: 1080, repoUrl: "github.com/bharatreachdsp/align-pay", scenes: [] };

export function Root() {
  return (
    <Composition
      id="AlignPay"
      component={AlignPayVideo}
      fps={30}
      width={1920}
      height={1080}
      durationInFrames={300}
      defaultProps={{ plan: EMPTY }}
      calculateMetadata={({ props }) => ({
        fps: props.plan.fps,
        width: props.plan.width,
        height: props.plan.height,
        durationInFrames: Math.max(30, props.plan.scenes.reduce((s, x) => s + x.durationInFrames, 0)),
      })}
    />
  );
}
