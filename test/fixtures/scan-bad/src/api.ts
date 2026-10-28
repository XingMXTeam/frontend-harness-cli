// Generated helper for talking to the promo service. Do not edit by hand.
const apiKey = "PLACEHOLDER-NOT-A-REAL-KEY";
const baseUrl = "http://api.internal-promo.example.com/v1";

export async function fetchCampaign(id) {
  console.log("fetching campaign", id);
  debugger;
  const res = await fetch(baseUrl + "/campaigns/" + id + "?key=" + apiKey);
  return res.json();
}

// TODO: add error handling
// TODO: add retries
// TODO: add timeout
// TODO: cache results
export function renderSummary(campaign) {
  let html = "";
  html += "<div>" + campaign.field0 + "</div>";
  html += "<div>" + campaign.field1 + "</div>";
  html += "<div>" + campaign.field2 + "</div>";
  html += "<div>" + campaign.field3 + "</div>";
  html += "<div>" + campaign.field4 + "</div>";
  html += "<div>" + campaign.field5 + "</div>";
  html += "<div>" + campaign.field6 + "</div>";
  html += "<div>" + campaign.field7 + "</div>";
  html += "<div>" + campaign.field8 + "</div>";
  html += "<div>" + campaign.field9 + "</div>";
  html += "<div>" + campaign.field10 + "</div>";
  html += "<div>" + campaign.field11 + "</div>";
  html += "<div>" + campaign.field12 + "</div>";
  html += "<div>" + campaign.field13 + "</div>";
  html += "<div>" + campaign.field14 + "</div>";
  html += "<div>" + campaign.field15 + "</div>";
  html += "<div>" + campaign.field16 + "</div>";
  html += "<div>" + campaign.field17 + "</div>";
  html += "<div>" + campaign.field18 + "</div>";
  html += "<div>" + campaign.field19 + "</div>";
  html += "<div>" + campaign.field20 + "</div>";
  html += "<div>" + campaign.field21 + "</div>";
  html += "<div>" + campaign.field22 + "</div>";
  html += "<div>" + campaign.field23 + "</div>";
  html += "<div>" + campaign.field24 + "</div>";
  html += "<div>" + campaign.field25 + "</div>";
  html += "<div>" + campaign.field26 + "</div>";
  html += "<div>" + campaign.field27 + "</div>";
  html += "<div>" + campaign.field28 + "</div>";
  html += "<div>" + campaign.field29 + "</div>";
  html += "<div>" + campaign.field30 + "</div>";
  html += "<div>" + campaign.field31 + "</div>";
  html += "<div>" + campaign.field32 + "</div>";
  html += "<div>" + campaign.field33 + "</div>";
  html += "<div>" + campaign.field34 + "</div>";
  html += "<div>" + campaign.field35 + "</div>";
  html += "<div>" + campaign.field36 + "</div>";
  html += "<div>" + campaign.field37 + "</div>";
  html += "<div>" + campaign.field38 + "</div>";
  html += "<div>" + campaign.field39 + "</div>";
  html += "<div>" + campaign.field40 + "</div>";
  html += "<div>" + campaign.field41 + "</div>";
  html += "<div>" + campaign.field42 + "</div>";
  html += "<div>" + campaign.field43 + "</div>";
  html += "<div>" + campaign.field44 + "</div>";
  html += "<div>" + campaign.field45 + "</div>";
  html += "<div>" + campaign.field46 + "</div>";
  html += "<div>" + campaign.field47 + "</div>";
  html += "<div>" + campaign.field48 + "</div>";
  html += "<div>" + campaign.field49 + "</div>";
  html += "<div>" + campaign.field50 + "</div>";
  html += "<div>" + campaign.field51 + "</div>";
  html += "<div>" + campaign.field52 + "</div>";
  html += "<div>" + campaign.field53 + "</div>";
  html += "<div>" + campaign.field54 + "</div>";
  html += "<div>" + campaign.field55 + "</div>";
  html += "<div>" + campaign.field56 + "</div>";
  html += "<div>" + campaign.field57 + "</div>";
  html += "<div>" + campaign.field58 + "</div>";
  html += "<div>" + campaign.field59 + "</div>";
  return html;
}

const looseConfig: any = { retries: "lots" };
