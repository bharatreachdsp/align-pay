import { OwnerHolds } from "@/components/OwnerHolds";
import { Policies } from "@/components/Policies";

export default function OwnerPage() {
  return (
    <>
      <div className="eyebrow">Kettle &amp; Kesar · owner</div>
      <h1>Owner</h1>
      <p className="lede" style={{ marginBottom: 28 }}>
        What the support agent could not do on its own, and the rules it works under.
      </p>
      <OwnerHolds />
      <div style={{ height: 40 }} />
      <Policies />
    </>
  );
}
