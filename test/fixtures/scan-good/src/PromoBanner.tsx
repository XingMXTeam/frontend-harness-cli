function t(key: string) { return key; }

export function PromoBanner({ campaign }) {
  const heading = t("promo.title");
  localStorage.setItem("promo.banner.dismissed", "1");
  return (
    <div className="promo-banner">
      <img src={campaign.heroImage} alt={campaign.title} />
      <h2 style={{ color: "var(--color-accent)" }}>{heading}</h2>
      <p>{campaign.subtitle}</p>
      <button type="button">Buy now</button>
    </div>
  );
}
