import { StoreCheckout } from "@/components/StoreCheckout";

export default function StorePage() {
  return (
    <>
      <div className="eyebrow">Kettle &amp; Kesar · a fictional tea store</div>
      <h1>Teas, kettles and chai cases</h1>
      <p className="lede" style={{ marginBottom: 24 }}>
        The store&apos;s checkout uses PayPal&apos;s buttons. Every payment shows up in the audit, matched to its order.
      </p>
      <StoreCheckout />
    </>
  );
}
