// The Campaign contract lives in data-spec.json; this declaration must
// match it field for field, type for type.
export interface Campaign {
  id: string;
  title: string;
  startsAt: Date;
  budget: number;
  tags: string[];
  active: boolean;
}

export function campaignLabel(c: Campaign): string {
  return `${c.title} (${c.id})`;
}
