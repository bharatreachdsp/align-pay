import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "@/server/runtime";

export const dynamic = "force-dynamic";

function architectureSvg(): string {
  try {
    return readFileSync(/*turbopackIgnore: true*/ join(REPO_ROOT, "docs", "architecture.svg"), "utf8");
  } catch {
    return "";
  }
}

export default function HowItWorks() {
  const svg = architectureSvg();
  return (
    <>
      <div className="eyebrow">How it works</div>
      <h1>A guard between an AI agent and PayPal</h1>
      <p className="principle">The model proposes, a person confirms, plain code enforces. The model never decides whether money moves.</p>
      <div className="panel svgwrap" data-testid="architecture" dangerouslySetInnerHTML={{ __html: svg }} />
      <div className="grid two" style={{ marginTop: 28 }}>
        <div>
          <h2>The three-line integration</h2>
          <pre className="code">
            <span className="c">{"// Agent Toolkit tools, guarded by the owner's confirmed decisions"}</span>
            {"\nconst toolkit = new PayPalAgentToolkit({ clientId, clientSecret, configuration: { actions } });\nconst guard = createGuard({ ledger, store, paypal });\nconst tools = withAlignGuard(toolkit.getTools(), guard);"}
          </pre>
          <p className="small muted">
            Read tools pass through to PayPal. Refunds and invoice create, send and cancel go through the guard. Tools that move
            money but are not guarded are removed; a tool the guard does not know is held.
          </p>
        </div>
        <div>
          <h2>What happens on a refund</h2>
          <ol className="small">
            <li>The agent calls <code>refund_order</code>. ALIGN Pay turns it into an action with its own id.</li>
            <li>The guard reads the facts from PayPal: the capture, refunds so far, open disputes, the customer&apos;s refunds in the last 30 days.</li>
            <li>It evaluates the confirmed limits: block beats hold beats allow. Missing facts hold.</li>
            <li>Allowed: ALIGN Pay refunds through its own PayPal client with <code>PayPal-Request-Id</code> = the action id and the decision key in <code>note_to_payer</code>.</li>
            <li>Held: the owner approves or declines on the owner page; approval re-checks PayPal first.</li>
            <li>PayPal&apos;s webhook confirms the refund; the audit traces it to the decision.</li>
          </ol>
        </div>
      </div>
      <div className="grid three" style={{ marginTop: 20 }}>
        <div className="panel">
          <h3>PayPal</h3>
          <p className="small muted">Orders v2, Payments v2 (refunds), Invoicing v2, Disputes v1, Transaction Search, Webhooks, the JavaScript SDK, and the Agent Toolkit.</p>
        </div>
        <div className="panel">
          <h3>Gemini</h3>
          <p className="small muted">Pro runs the support conversation and drafts limits from each decision. Flash writes one-line reasons. Neither decides whether money moves.</p>
        </div>
        <div className="panel">
          <h3>ALIGN</h3>
          <p className="small muted">
            The decision ledger: decisions with exact-quote receipts, read through ALIGN&apos;s MCP server. <a href="https://github.com/bharatreachdsp/align-cli">align-cli</a>
          </p>
        </div>
      </div>
    </>
  );
}
