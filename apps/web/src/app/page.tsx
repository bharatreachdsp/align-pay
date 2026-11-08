import Link from "next/link";
import { StartDemo } from "@/components/StartDemo";

export default function Home() {
  return (
    <>
      <section style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.4fr) minmax(280px, 1fr)", gap: 36, alignItems: "start" }} className="hero">
        <div>
          <div className="eyebrow">ALIGN Pay · built on ALIGN · PayPal sandbox</div>
          <h1>Every refund and invoice your AI agent makes in PayPal traces back to a human decision.</h1>
          <p className="lede">
            ALIGN Pay sits between an AI agent and PayPal. Each money-moving tool call is checked against the owner&apos;s
            decisions in ALIGN, with the exact quote as its receipt, using PayPal&apos;s own records. Anything without a
            decision behind it is held or flagged.
          </p>
          <p className="principle">The model proposes, a person confirms, plain code enforces.</p>
          <div className="grid three" style={{ marginTop: 24 }}>
            <div className="panel">
              <h3>1 · A person decides</h3>
              <p className="small muted">
                The store owner&apos;s four rules live in ALIGN as confirmed decisions, each with the quote it came from.
              </p>
            </div>
            <div className="panel">
              <h3>2 · Gemini drafts limits</h3>
              <p className="small muted">
                Gemini reads each decision and drafts structured limits. Only limits a person confirmed are ever enforced.
              </p>
            </div>
            <div className="panel">
              <h3>3 · Code enforces</h3>
              <p className="small muted">
                Refunds and invoices are allowed, held for the owner, or blocked by deterministic rules on PayPal&apos;s facts.
              </p>
            </div>
          </div>
        </div>
        <div className="grid">
          <StartDemo />
          <div className="panel">
            <h3>Then try it</h3>
            <ol className="small" style={{ paddingLeft: 18, margin: 0 }}>
              <li>
                <Link href="/support">Support</Link>: Asha asks for $180 back. Held under D1.
              </li>
              <li>
                <Link href="/owner">Owner</Link>: approve it; PayPal refunds it.
              </li>
              <li>Ben asks for a second refund. Blocked under D2.</li>
              <li>Chen asks for a 20% off, net 30 invoice. Blocked under D4.</li>
              <li>
                <Link href="/audit">Audit</Link>: every PayPal transaction, traced or flagged.
              </li>
            </ol>
          </div>
        </div>
      </section>
    </>
  );
}
