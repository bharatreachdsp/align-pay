/**
 * A cloudflared quick tunnel to the local app (no account needed). Its trycloudflare.com URL changes every run.
 *   tsx scripts/tunnel.ts            # prints the URL and keeps the tunnel open
 */
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export function hasCloudflared(): boolean {
  return spawnSync("cloudflared", ["--version"], { stdio: "ignore" }).status === 0;
}

export function startTunnel(port: number, timeoutMs = 45_000): Promise<{ url: string; child: ChildProcess }> {
  return new Promise((resolve, reject) => {
    const child = spawn("cloudflared", ["tunnel", "--no-autoupdate", "--url", `http://127.0.0.1:${port}`], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("cloudflared did not print a tunnel URL in time"));
    }, timeoutMs);
    const onData = (b: Buffer) => {
      const m = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(b.toString());
      if (m) {
        clearTimeout(timer);
        resolve({ url: m[0], child });
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`cloudflared exited (${code})`));
    });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 3000);
  const { url } = await startTunnel(port);
  console.log(url);
}
