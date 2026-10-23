import { resolve } from "node:path";
import type { ExecutionManifestV2 } from "./manifest-types";
import { computePrivateCaptureBindingHash } from "./manifest-hash";
import { resolveCaptureApprovedPrivateRoot } from "./capture-path-policy";

export function validatePrivateCaptureManifestForRun(input: {
  manifest: ExecutionManifestV2;
  approvedCaptureHash?: string;
}): { ok: true } | { ok: false; code: string; message: string } {
  const capture = input.manifest.privateBackupCapture;
  if (!capture || capture.status !== "APPROVED") {
    return { ok: false, code: "CAPTURE_NOT_APPROVED", message: "Private capture is not approved." };
  }
  if (!capture.destinationPath?.trim()) {
    return { ok: false, code: "CAPTURE_DESTINATION_MISSING", message: "Capture destination path required." };
  }
  if (!capture.humanCaptureRef?.trim()) {
    return { ok: false, code: "CAPTURE_APPROVAL_INVALID", message: "Capture humanCaptureRef required." };
  }
  if (!capture.validUntil?.trim()) {
    return { ok: false, code: "CAPTURE_APPROVAL_INVALID", message: "Capture validUntil required." };
  }
  const expires = Date.parse(capture.validUntil);
  if (Number.isNaN(expires) || Date.now() > expires) {
    return { ok: false, code: "CAPTURE_APPROVAL_EXPIRED", message: "Capture approval expired." };
  }
  if (!capture.approvedCaptureHash?.trim()) {
    return { ok: false, code: "CAPTURE_HASH_MISSING", message: "Capture approvedCaptureHash missing." };
  }
  const binding = computePrivateCaptureBindingHash(input.manifest);
  if (capture.approvedCaptureHash.toLowerCase() !== binding.toLowerCase()) {
    return {
      ok: false,
      code: "CAPTURE_HASH_MISMATCH",
      message: "Capture hash does not bind destination and plan target.",
    };
  }
  if (!input.approvedCaptureHash) {
    return {
      ok: false,
      code: "CAPTURE_HASH_MISSING",
      message: "CLI --approved-capture-hash is required.",
    };
  }
  if (input.approvedCaptureHash.toLowerCase() !== binding.toLowerCase()) {
    return {
      ok: false,
      code: "CAPTURE_HASH_MISMATCH",
      message: "CLI capture hash does not bind manifest capture body.",
    };
  }
  if (!input.manifest.plan || !input.manifest.planHash) {
    return { ok: false, code: "MANIFEST_PLAN_MISSING", message: "Capture requires embedded approved plan." };
  }
  const approvedRoot = resolveCaptureApprovedPrivateRoot(input.manifest);
  if (!approvedRoot) {
    return { ok: false, code: "CAPTURE_ROOT_MISSING", message: "Approved private capture root is required." };
  }
  const dest = resolve(capture.destinationPath);
  if (dest !== approvedRoot && !dest.startsWith(`${approvedRoot}/`)) {
    return {
      ok: false,
      code: "CAPTURE_DESTINATION_OUTSIDE_ROOT",
      message: "Capture destination must stay inside approved private root.",
    };
  }
  return { ok: true };
}
