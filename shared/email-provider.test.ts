import { expect, it } from "vitest";
import { emailProvider } from "./email-provider";
it("recognizes custom-domain accounts using connected provider servers",()=>{
 expect(emailProvider("team@company.com",["imap.gmail.com"])).toBe("gmail");
 expect(emailProvider("team@company.com",["outlook.office365.com"])).toBe("outlook");
 expect(emailProvider("me@gmail.com",["mail.unrelated.example"])).toBe("email");
 expect(emailProvider("me@company.com")).toBe("email");
 expect(emailProvider("me@gmail.com")).toBe("gmail");
 expect(emailProvider("me@hotmail.com")).toBe("outlook");
 expect(emailProvider("me@company.com",["imap.gmail.com.attacker.example"])).toBe("email");
});
