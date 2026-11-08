import { AuditView } from "@/components/AuditView";

export default function AuditPage() {
  return (
    <>
      <div className="eyebrow">Kettle &amp; Kesar · audit</div>
      <h1>Audit</h1>
      <p className="lede" style={{ marginBottom: 20 }}>
        Every transaction in the PayPal account, newest first. Each refund and invoice must trace to a decision through
        the action that made it; anything else is flagged <strong>untraced</strong>. Incoming payments are matched to their
        store orders.
      </p>
      <AuditView />
    </>
  );
}
