// FP-1: fetch campaign and render a summary
const baseUrl = process.env.PROMO_API_BASE ?? "https://api.example.com/v1";

export async function fetchCampaign(id: string) {
  const res = await fetch(`${baseUrl}/campaigns/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`campaign request failed: ${res.status}`);
  return res.json();
}

export function renderSummary(campaign: { fields: string[] }) {
  return campaign.fields.map((f) => `<div>${f}</div>`).join("");
}
