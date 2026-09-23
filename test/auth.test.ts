import{describe,it,expect}from"vitest";import{ResumeTokens}from"../src/core/resume.js";describe("resume token",()=>{it("round trips and rejects tampering",()=>{const r=new ResumeTokens("a secure test secret that is long enough");const t=r.issue("episode-1");expect(r.verify(t)).toBe("episode-1");expect(r.verify(t+"x")).toBeNull()})});

import { staticTenantId, isUuid as _isUuid } from "../src/storage/postgres.js";
describe("static-key tenants", () => {
  it("map to a stable, valid UUID per tenant name", () => {
    const a = staticTenantId("production");
    expect(_isUuid(a)).toBe(true); expect(staticTenantId("production")).toBe(a); expect(staticTenantId("staging")).not.toBe(a);
  });
});
