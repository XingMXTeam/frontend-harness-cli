function t(key) { return key; }
localStorage.setItem("dismissed", "1");
export function PromoBanner({ campaign }) {
  return (
    <div style={{ background: "#fff", padding: 12, margin: 8, border: "1px solid #ddd", color: "#333", fontSize: 14 }}>
      <img src={campaign.heroImage} />
      <h2 style={{ fontSize: 20, margin: 4, color: "var(--color-brandx)" }}>{t("promo.missing")}</h2>
      <p style={{ color: "#888" }}>{campaign.subtitle}</p>
      <button style={{ background: "red", color: "#fff" }}>Buy now</button>
    </div>
  );
}
