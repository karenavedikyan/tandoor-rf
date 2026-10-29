(function () {
  "use strict";

  /** Prototype-only messenger handoff helpers (no real bot/webhook). */
  function demoConfig() {
    const raw = window.__TT_MESSENGER_DEMO__;
    return raw && typeof raw === "object" ? raw : {};
  }

  function channelAvailability() {
    const cfg = demoConfig();
    const maxEnabled = cfg.maxEnabled === true;
    return {
      telegram: {
        available: true,
        reason: "",
        label: "Telegram",
      },
      max: maxEnabled
        ? { available: true, reason: "", label: "MAX" }
        : {
            available: false,
            reason: "Интеграция MAX на сервере не настроена. Выберите Telegram или дождитесь подключения MAX.",
            label: "MAX",
          },
    };
  }

  function mintStartToken() {
    const arr = new Uint8Array(24);
    crypto.getRandomValues(arr);
    return btoa(String.fromCharCode(...arr))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  }

  function tokenMatches(inv, token) {
    if (!inv || !token || typeof token !== "string") return false;
    return inv.startTokenPlain === token;
  }

  function normPhoneDigits(phone) {
    const d = String(phone || "").replace(/\D/g, "");
    if (d.length === 11 && d[0] === "7") return d.slice(1);
    if (d.length >= 10) return d.slice(-10);
    return d;
  }

  async function hmacSha256Hex(key, message) {
    const enc = new TextEncoder();
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      enc.encode(key),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(message));
    return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  function decodeVcfCrLf(vcf) {
    return String(vcf || "").replace(/\r\n/g, "\n");
  }

  function phoneFromVcf(vcf) {
    const m = decodeVcfCrLf(vcf).match(/TEL[^:]*:([+\d\s()-]+)/i);
    if (!m) return "";
    return normPhoneDigits(m[1]);
  }

  function buildSignedMaxVcf(phone, userId, accessToken) {
    const tel = `+7${normPhoneDigits(phone)}`;
    const vcf = `BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Demo\r\nTEL;TYPE=CELL:${tel}\r\nEND:VCARD\r\n`;
    return { vcf, userId, phone: normPhoneDigits(phone) };
  }

  /**
   * @returns {{ ok: true } | { ok: false, error: string }}
   */
  async function verifyContactProof({ channel, pendingPhone, scenario, payload }) {
    const expected = normPhoneDigits(pendingPhone);
    const sc = scenario || "own";

    if (channel === "telegram") {
      if (sc === "channel_unavailable") return { ok: false, error: "Канал недоступен." };
      if (sc === "forwarded") return { ok: false, error: "Пересланный контакт не принимается." };
      if (sc === "wrong_chat") return { ok: false, error: "Контакт из другого чата не принимается." };
      if (sc === "missing_user") return { ok: false, error: "В контакте нет user_id — подтверждение отклонено." };
      if (sc === "user_mismatch") return { ok: false, error: "user_id контакта не совпадает с отправителем сообщения." };
      const fromId = payload?.fromUserId ?? payload?.contactUserId;
      const contactUserId = payload?.contactUserId;
      if (sc !== "own" && sc !== "wrong_phone") {
        if (!contactUserId) return { ok: false, error: "В контакте нет user_id — подтверждение отклонено." };
        if (!fromId || fromId !== contactUserId)
          return { ok: false, error: "user_id контакта не совпадает с отправителем сообщения." };
      }
      const got = normPhoneDigits(payload?.phone || "");
      if (sc === "wrong_phone" || !got || got !== expected) {
        return { ok: false, error: "Номер не совпадает с приглашением. Подтверждён другой номер." };
      }
      if (sc === "own" || sc === "wrong_phone") {
        if (!contactUserId || !fromId || fromId !== contactUserId) {
          return { ok: false, error: "user_id контакта не совпадает с отправителем сообщения." };
        }
      }
      return { ok: true };
    }

    if (channel === "max") {
      const avail = channelAvailability().max;
      if (!avail.available) return { ok: false, error: avail.reason || "MAX недоступен." };
      if (sc === "unsigned_vcf") return { ok: false, error: "Контакт без подписи MAX не принимается." };
      if (sc === "bad_hmac") return { ok: false, error: "Подпись контакта MAX не прошла проверку." };
      if (sc === "sender_mismatch")
        return { ok: false, error: "max_info.user_id не совпадает с отправителем сообщения." };
      const accessToken = payload?.accessToken || demoConfig().maxAccessToken || "demo-max-token";
      const vcf = payload?.vcf;
      const hash = payload?.hash;
      const maxUserId = payload?.maxUserId;
      const senderId = payload?.senderId;
      if (!vcf || !hash) return { ok: false, error: "Контакт без подписи MAX не принимается." };
      if (!maxUserId || !senderId || maxUserId !== senderId) {
        return { ok: false, error: "max_info.user_id не совпадает с отправителем сообщения." };
      }
      const normalized = decodeVcfCrLf(vcf);
      const expectedHash = await hmacSha256Hex(accessToken, normalized);
      if (sc === "bad_hmac" || hash !== expectedHash) {
        return { ok: false, error: "Подпись контакта MAX не прошла проверку." };
      }
      const got = phoneFromVcf(normalized);
      if (!got || got !== expected) {
        return { ok: false, error: "Номер из VCF не совпадает с приглашением." };
      }
      return { ok: true };
    }

    return { ok: false, error: "Канал не поддерживается." };
  }

  async function buildMaxOwnContactPayload(pendingPhone) {
    const accessToken = demoConfig().maxAccessToken || "demo-max-token";
    const userId = demoConfig().maxDemoUserId || "max-user-demo-1";
    const { vcf } = buildSignedMaxVcf(pendingPhone, userId, accessToken);
    const hash = await hmacSha256Hex(accessToken, vcf);
    return { vcf, hash, maxUserId: userId, senderId: userId, accessToken };
  }

  function buildTelegramOwnContactPayload(pendingPhone) {
    const uid = demoConfig().telegramDemoUserId || 900001;
    return { phone: pendingPhone, contactUserId: uid, fromUserId: uid };
  }

  window.TanTrackerMessengerDemo = {
    channelAvailability,
    mintStartToken,
    tokenMatches,
    normPhoneDigits,
    verifyContactProof,
    buildMaxOwnContactPayload,
    buildTelegramOwnContactPayload,
    CODE_ISSUE_LIMIT: 5,
    START_TOKEN_TTL_MS: 7 * 24 * 60 * 60 * 1000,
  };
})();
