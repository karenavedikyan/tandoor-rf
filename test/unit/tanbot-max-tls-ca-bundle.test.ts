import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createHash, X509Certificate } from "node:crypto";
import { describe, it } from "node:test";
import { readMaxTlsCaBundle } from "../../src/tanbot-max/tls-fetch";

const CERT_REL = "certs/max/Russian_Trusted_CA.pem";
const EXPECTED_SHA256 = "6d1b66e7c1aa2512ad3abb50d6a6f144c9ee9d80fd7fbe1c9255a39f8e790944";

describe("MAX TLS CA bundle (offline)", () => {
  const certPath = path.join(process.cwd(), CERT_REL);

  it("vendors official public PEM with recorded SHA-256", () => {
    assert.ok(fs.existsSync(certPath), `${CERT_REL} must exist in repo`);
    const pem = fs.readFileSync(certPath, "utf8");
    assert.doesNotMatch(pem, /BEGIN (RSA |EC )?PRIVATE KEY/);
    const sha = createHash("sha256").update(fs.readFileSync(certPath)).digest("hex");
    assert.equal(sha, EXPECTED_SHA256);
  });

  it("contains only valid CA certificate blocks (current, CA:TRUE)", () => {
    const pem = fs.readFileSync(certPath, "utf8");
    const blocks = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g);
    assert.ok(blocks && blocks.length >= 1, "at least one certificate block");
    const now = Date.now();
    for (const block of blocks) {
      const cert = new X509Certificate(block);
      assert.ok(new Date(cert.validTo).getTime() > now, `expired: ${cert.subject}`);
      const text = execSync("openssl x509 -noout -text", { input: block, encoding: "utf8" });
      assert.match(text, /CA:\s*TRUE/i, cert.subject);
    }
  });

  it("readMaxTlsCaBundle loads vendored path like production env", () => {
    const buf = readMaxTlsCaBundle({ TANBOT_MAX_TLS_CA_BUNDLE: certPath });
    assert.ok(buf && buf.length > 0);
  });

  it("production Dockerfile copies certs/max into runtime image", () => {
    const dockerfile = fs.readFileSync(path.join(process.cwd(), "Dockerfile"), "utf8");
    assert.match(dockerfile, /COPY certs\/max \.\/certs\/max/);
  });
});
