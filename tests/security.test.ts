import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  seal,
  unseal,
  hashPassword,
  verifyPassword,
  newTotpSecret,
  totp,
  verifyTotp,
} from "../packages/security/crypto";
import { publicAddress, riskText, verifiedAnalysis } from "../apps/worker/ai";
test("AES-GCM detects tampering and rejects wrong keys", () => {
  const key = randomBytes(32),
    sealed = seal("customer data", key);
  assert.equal(unseal(sealed, key).toString(), "customer data");
  assert.throws(() => unseal(sealed, randomBytes(32)));
  sealed[sealed.length - 1] ^= 1;
  assert.throws(() => unseal(sealed, key));
});
test("password hashes are salted and verify safely", async () => {
  const a = await hashPassword("test-password-strong");
  const b = await hashPassword("test-password-strong");
  assert.notEqual(a, b);
  assert.equal(await verifyPassword("test-password-strong", a), true);
  assert.equal(await verifyPassword("wrong", a), false);
});
test("TOTP verifies once per counter and rejects malformed input", () => {
  const s = newTotpSecret(),
    step = Math.floor(Date.now() / 30000),
    code = totp(s, step);
  assert.equal(verifyTotp(s, code), step);
  assert.equal(verifyTotp(s, code, step), null);
  assert.equal(verifyTotp(s, "123"), null);
});
test("AI connector blocks localhost/private/link-local destinations", () => {
  for (const ip of [
    "127.0.0.1",
    "10.0.0.1",
    "172.16.0.1",
    "192.168.1.2",
    "169.254.169.254",
    "100.64.0.2",
    "::1",
    "::ffff:127.0.0.1",
    "fd00::1",
  ])
    assert.equal(publicAddress(ip), false, ip);
  assert.equal(publicAddress("8.8.8.8"), true);
  assert.equal(publicAddress("2606:4700:4700::1111"), true);
});
test("unsubstantiated model evidence cannot produce purchase scores", () => {
  const source = [
    {
      id: "m1",
      direction: "in",
      kind: "text",
      text: "Hello",
      sent_at: new Date().toISOString(),
    },
  ];
  const a = verifiedAnalysis(
    {
      summary: "打招呼",
      needs: [],
      nextSteps: [],
      facts: {
        quantity: {
          value: "100",
          evidence: { messageId: "m1", quote: "100 units" },
        },
      },
      signals: [
        { messageId: "m1", quote: "place order", kind: "order_intent" },
      ],
    },
    source,
    1,
  );
  assert.equal(Object.keys(a.facts).length, 0);
  assert.equal(a.intent, null);
  assert.equal(a.fit, null);
  assert.equal(a.scores.grade, "观察中");
});
test("automatic boundaries detect human requests and commercial commitments", () => {
  for (const t of [
    "Please quote a price",
    "Payment details?",
    "转人工",
    "我要投诉",
    "unsubscribe",
  ])
    assert.equal(riskText(t), true);
  assert.equal(riskText("Hello, do you have a catalog?"), false);
});
