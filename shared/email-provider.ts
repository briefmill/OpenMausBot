export type EmailProvider = "gmail" | "outlook" | "email";

/** Identifies a connected mail provider from server metadata, with public-address fallbacks. */
export function emailProvider(address: string, hosts: readonly string[] = []): EmailProvider {
 const servers=hosts.map(host=>host.toLowerCase().replace(/\.$/,""));
 if(servers.some(host=>["imap.gmail.com","smtp.gmail.com","imap.googlemail.com","smtp.googlemail.com"].includes(host)))return "gmail";
 if(servers.some(host=>["outlook.office365.com","smtp.office365.com","outlook.office.com","imap-mail.outlook.com","smtp-mail.outlook.com"].includes(host)))return "outlook";
 if(servers.length)return "email";
 const domain=address.toLowerCase().split("@")[1];
 if(domain==="gmail.com"||domain==="googlemail.com")return "gmail";
 if(domain&&["outlook.com","hotmail.com","live.com","msn.com"].includes(domain))return "outlook";
 return "email";
}
