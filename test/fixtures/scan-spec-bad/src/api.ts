export interface Campaign {
  id: string;
  title: string;
  startsAt: string;
  budget: number;
  active: boolean;
  legacyCode: string;
}

export function campaignLabel(c: Campaign): string {
  return `${c.title} (${c.id})`;
}
