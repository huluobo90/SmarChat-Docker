import { parsePhoneNumberFromString } from "libphonenumber-js/max";

/** Only confirmed phone identities are numbers; WhatsApp LIDs are opaque IDs. */
export function phoneCountry(jids: string[]): string {
  const countries = new Set<string>();
  for (const jid of jids) {
    const match = /^(\d{7,15})(?::\d+)?@s\.whatsapp\.net$/.exec(jid || "");
    if (!match) continue;
    const phone = parsePhoneNumberFromString("+" + match[1]);
    if (phone?.isValid() && phone.country) countries.add(phone.country);
  }
  return countries.size === 1 ? [...countries][0] : "";
}
export async function phoneCountries(db: any, rows: any[]) {
  if (!rows.length) return rows;
  const identities = (
    await db.query(
      "SELECT conversation_id,jid FROM identities WHERE conversation_id=ANY($1::uuid[])",
      [rows.map((c) => c.id)],
    )
  ).rows;
  return rows.map((c) => ({
    ...c,
    country: phoneCountry([
      c.jid,
      ...identities.filter((i) => i.conversation_id === c.id).map((i) => i.jid),
    ]),
  }));
}
