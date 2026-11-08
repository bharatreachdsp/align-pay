import { SupportDesk } from "@/components/SupportDesk";

export default function SupportPage() {
  return (
    <>
      <div className="eyebrow">Kettle &amp; Kesar · fictional tea store</div>
      <h1>Support desk</h1>
      <p className="lede" style={{ marginBottom: 24 }}>
        You are the customer. The AI support agent answers; every refund or invoice it attempts is checked by ALIGN Pay and
        shows up as a receipt card.
      </p>
      <SupportDesk />
    </>
  );
}
