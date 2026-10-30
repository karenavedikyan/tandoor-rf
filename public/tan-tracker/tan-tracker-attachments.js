(function () {
  "use strict";

  const MAX_FILES = 10;
  const MAX_FILE_BYTES = 10 * 1024 * 1024;
  const MAX_TOTAL_BYTES = 50 * 1024 * 1024;
  const PREVIEW_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
  const ALLOW_MIME = new Set([
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/heic",
    "image/heif",
    "application/pdf",
    "text/plain",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ]);
  const BLOCK_EXT =
    /\.(html?|svg|js|mjs|cjs|exe|bat|cmd|sh|php|asp|aspx|jar|wasm|vbs|ps1|scr|com|msi)$/i;

  const urlOwners = new Map();

  function E(v) {
    return String(v ?? "").replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }

  function fmtBytes(n) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }

  function extOf(name) {
    const m = String(name).toLowerCase().match(/(\.[a-z0-9]+)$/);
    return m ? m[1] : "";
  }

  function trackUrl(url, owner) {
    if (!url) return;
    urlOwners.set(url, owner);
  }

  function untrackUrl(url) {
    if (!url || String(url).startsWith("data:")) return;
    urlOwners.delete(url);
    try {
      URL.revokeObjectURL(url);
    } catch (_) {}
  }

  function revokeStagingItem(f) {
    const u = f?.url;
    if (!u || String(u).startsWith("data:")) return;
    const owner = urlOwners.get(u);
    if (owner && String(owner).startsWith("order:")) return;
    untrackUrl(u);
  }

  function revokeStaging(staging) {
    (staging || []).forEach(revokeStagingItem);
  }

  function revokeStagingItems(items) {
    revokeStaging(items);
  }

  let rasterDelayMs = 0;
  let rasterProbeTimeoutMs = 20000;
  function setRasterDelayForTests(ms) {
    rasterDelayMs = Math.max(0, Number(ms) || 0);
  }
  function setRasterProbeTimeoutForTests(ms) {
    rasterProbeTimeoutMs = Math.max(1, Number(ms) || rasterProbeTimeoutMs);
  }

  function makeDemoPng(label, hue) {
    const c = document.createElement("canvas");
    c.width = 160;
    c.height = 120;
    const x = c.getContext("2d");
    x.fillStyle = `hsl(${hue}, 42%, 78%)`;
    x.fillRect(0, 0, 160, 120);
    x.strokeStyle = "#172019";
    x.lineWidth = 2;
    x.strokeRect(4, 4, 152, 112);
    x.fillStyle = "#172019";
    x.font = "bold 11px Golos, sans-serif";
    x.fillText("ДЕМО · не фото клиента", 10, 22);
    x.font = "12px Golos, sans-serif";
    const lines = label.match(/.{1,18}/g) || [label];
    lines.slice(0, 3).forEach((ln, i) => x.fillText(ln, 10, 44 + i * 16));
    return c.toDataURL("image/png");
  }

  function demoBlobUrl(mime, body, owner) {
    const blob = new Blob([body], { type: mime });
    const url = URL.createObjectURL(blob);
    trackUrl(url, owner);
    return url;
  }

  function attachRecord({ name, mime, size, url, addedAt, addedBy, demo, id }) {
    return {
      id: id || "att_" + Math.random().toString(36).slice(2, 10),
      name,
      mime,
      size,
      url,
      addedAt: addedAt ?? Date.now(),
      addedBy,
      demo: !!demo,
    };
  }

  function seedDemoAttachments(orders, contactById) {
    const m1 = contactById("emp_m1")?.id || "emp_m1";
    const add = (orderId, list) => {
      const o = orders.find((x) => x.id === orderId);
      if (!o) return;
      o.attachments = list.map((a) => {
        trackUrl(a.url, `order:${orderId}`);
        return a;
      });
    };
    add("TT-2026-001", [
      attachRecord({
        name: "demo-dogovor-foto.png",
        mime: "image/png",
        size: 8000,
        url: makeDemoPng("Договор поставки", 95),
        addedBy: m1,
        demo: true,
      }),
      attachRecord({
        name: "demo-opis.txt",
        mime: "text/plain",
        size: 120,
        url: demoBlobUrl("text/plain", "Демо-опись комплекта документов\nНе содержит данных клиента.", "seed:001"),
        addedBy: m1,
        demo: true,
      }),
    ]);
    add("TT-2026-003", [
      attachRecord({
        name: "demo-obrazcy-liniya.png",
        mime: "image/png",
        size: 9000,
        url: makeDemoPng("Образцы 05/06", 28),
        addedBy: m1,
        demo: true,
      }),
    ]);
    add("TT-2026-004", [
      attachRecord({
        name: "demo-klyuchi.png",
        mime: "image/png",
        size: 7500,
        url: makeDemoPng("Ключи шоурум", 210),
        addedBy: contactById("ext_05")?.id,
        demo: true,
      }),
    ]);
    add("TT-2026-006", [
      attachRecord({
        name: "demo-dop-soglashenie.pdf",
        mime: "application/pdf",
        size: 580,
        url: demoBlobUrl(
          "application/pdf",
          "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF",
          "seed:006"
        ),
        addedBy: m1,
        demo: true,
      }),
    ]);
    orders.forEach((o) => {
      if (!o.attachments) o.attachments = [];
    });
  }

  function totalBytes(list) {
    return (list || []).reduce((s, f) => s + (f.size || 0), 0);
  }

  function validatePick(file, existing, staging) {
    const errors = [];
    const all = [...(existing || []), ...(staging || [])];
    if (all.length >= MAX_FILES) errors.push(`Не более ${MAX_FILES} файлов на передачу.`);
    if (file.size > MAX_FILE_BYTES) errors.push(`${file.name}: больше ${fmtBytes(MAX_FILE_BYTES)}.`);
    if (totalBytes(all) + file.size > MAX_TOTAL_BYTES)
      errors.push(`Общий объём не больше ${fmtBytes(MAX_TOTAL_BYTES)}.`);
    const ext = extOf(file.name);
    if (BLOCK_EXT.test(ext)) errors.push(`${file.name}: тип файла запрещён в демо.`);
    const mime = (file.type || "").toLowerCase();
    if (mime && !ALLOW_MIME.has(mime) && !PREVIEW_MIME.has(mime)) {
      if (!/\.(pdf|doc|docx|xls|xlsx|txt|heic|heif|jpe?g|png|webp)$/i.test(file.name))
        errors.push(`${file.name}: формат не поддерживается в демо.`);
    }
    if (/\.(html?|svg|js)$/i.test(file.name)) errors.push(`${file.name}: активные форматы запрещены.`);
    return errors;
  }

  async function fileToStaging(file, owner) {
    const blobUrl = URL.createObjectURL(file);
    trackUrl(blobUrl, owner);
    let mime = (file.type || "").toLowerCase();
    if (PREVIEW_MIME.has(mime)) {
      try {
        if (rasterDelayMs) await new Promise((r) => setTimeout(r, rasterDelayMs));
        const probed = await rasterProbe(blobUrl);
        if (probed === "timeout") {
          untrackUrl(blobUrl);
          const sec = Math.round(rasterProbeTimeoutMs / 1000);
          return { error: `${file.name}: превышено время проверки изображения (${sec} с).` };
        }
        if (!probed) {
          untrackUrl(blobUrl);
          return { error: `${file.name}: файл не похож на допустимое изображение.` };
        }
      } catch (_) {
        untrackUrl(blobUrl);
        return { error: `${file.name}: не удалось прочитать изображение.` };
      }
    }
    if (!mime) {
      if (/\.pdf$/i.test(file.name)) mime = "application/pdf";
      else if (/\.txt$/i.test(file.name)) mime = "text/plain";
      else if (/\.png$/i.test(file.name)) mime = "image/png";
      else if (/\.jpe?g$/i.test(file.name)) mime = "image/jpeg";
      else if (/\.webp$/i.test(file.name)) mime = "image/webp";
      else if (/\.heic$/i.test(file.name)) mime = "image/heic";
      else if (/\.heif$/i.test(file.name)) mime = "image/heif";
    }
    return {
      item: attachRecord({
        name: file.name,
        mime,
        size: file.size,
        url: blobUrl,
        addedBy: owner,
      }),
    };
  }

  function rasterProbe(url) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timerId);
        img.onload = null;
        img.onerror = null;
        resolve(value);
      };
      const timerId = setTimeout(() => finish("timeout"), rasterProbeTimeoutMs);
      const img = new Image();
      img.onload = () => finish(img.naturalWidth > 0 && img.naturalHeight > 0);
      img.onerror = () => finish(false);
      img.src = url;
    });
  }

  function canPreview(mime) {
    return PREVIEW_MIME.has((mime || "").toLowerCase());
  }

  function heicLike(mime, name) {
    const m = (mime || "").toLowerCase();
    return m.includes("heic") || m.includes("heif") || /\.heic$/i.test(name) || /\.heif$/i.test(name);
  }

  function lkTransferAttachmentBaseUrl(transferId, attId) {
    return (
      "/api/tan-tracker/transfers/" +
      encodeURIComponent(transferId) +
      "/attachments/" +
      encodeURIComponent(attId)
    );
  }

  function isPassthroughClientObjectUrl(url) {
    const s = String(url ?? "").trim();
    return s.startsWith("blob:") || s.startsWith("data:");
  }

  function withAttachmentQuery(baseUrl, key, value) {
    const sep = String(baseUrl).includes("?") ? "&" : "?";
    const v = value === undefined || value === null || value === "" ? "1" : String(value);
    return `${baseUrl}${sep}${encodeURIComponent(key)}=${encodeURIComponent(v)}`;
  }

  function lkAttachmentThumbUrl(transferId, attId) {
    return withAttachmentQuery(lkTransferAttachmentBaseUrl(transferId, attId), "preview", "thumb");
  }

  function lkAttachmentLightboxUrl(transferId, attId) {
    return withAttachmentQuery(lkTransferAttachmentBaseUrl(transferId, attId), "preview", "lightbox");
  }

  function lkAttachmentDownloadUrl(transferId, attId) {
    return withAttachmentQuery(lkTransferAttachmentBaseUrl(transferId, attId), "download");
  }

  /** @deprecated use lkAttachmentThumbUrl */
  function lkAttachmentPreviewUrl(transferId, attId) {
    return lkAttachmentThumbUrl(transferId, attId);
  }

  function attachmentThumbUrl(url) {
    if (!url || isPassthroughClientObjectUrl(url)) return url;
    const s = String(url);
    if (/[?&]preview=(thumb|lightbox|1)(&|$)/i.test(s)) {
      return s.replace(/([?&])preview=(?:lightbox|1|true)(?=&|$)/i, "$1preview=thumb");
    }
    return withAttachmentQuery(url, "preview", "thumb");
  }

  function attachmentLightboxUrl(url) {
    if (!url || isPassthroughClientObjectUrl(url)) return url;
    const s = String(url);
    if (/[?&]preview=lightbox(?=&|$)/i.test(s)) return s;
    if (/[?&]preview=thumb(?=&|$)/i.test(s)) {
      return s.replace(/([?&])preview=thumb(?=&|$)/i, "$1preview=lightbox");
    }
    return withAttachmentQuery(url, "preview", "lightbox");
  }

  function attachmentPreviewUrl(url) {
    return attachmentLightboxUrl(url);
  }

  function attachmentDownloadUrl(url) {
    if (!url || isPassthroughClientObjectUrl(url)) return url;
    if (String(url).includes("download=1")) return url;
    return withAttachmentQuery(url, "download");
  }

  function onThumbLoad(img) {
    const thumb = img && img.closest ? img.closest(".tt-att-thumb") : null;
    if (!thumb) return;
    thumb.classList.remove("tt-att-thumb--loading");
  }

  function onThumbError(img) {
    const thumb = img && img.closest ? img.closest(".tt-att-thumb") : null;
    if (!thumb) return;
    thumb.classList.remove("tt-att-thumb--loading");
    img.classList.add("tt-att-img-broken");
    thumb.classList.add("tt-att-thumb--fallback");
  }

  const ATT_ICON = {
    open: '<svg class="tt-att-action-icon" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M12 4.5C7 4.5 2.7 7.6 1 12c1.7 4.4 6 7.5 11 7.5s9.3-3.1 11-7.5c-1.7-4.4-6-7.5-11-7.5Zm0 12.5a5 5 0 1 1 0-10 5 5 0 0 1 0 10Zm0-2.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z"/></svg>',
    download:
      '<svg class="tt-att-action-icon" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M12 3a1 1 0 0 1 1 1v9.6l2.3-2.3a1 1 0 1 1 1.4 1.4l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.4L11 13.6V4a1 1 0 0 1 1-1Zm-7 14a1 1 0 0 1 1 1v1h12v-1a1 1 0 1 1 2 0v2a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-2a1 1 0 0 1 1-1Z"/></svg>',
    remove:
      '<svg class="tt-att-action-icon" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M9 3a1 1 0 0 0-1 1v1H4a1 1 0 1 0 0 2h1v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7h1a1 1 0 1 0 0-2h-4V4a1 1 0 0 0-1-1H9Zm2 2h2v1h-2V5ZM7 7h10v13H7V7Zm3 3a1 1 0 0 1 1 1v6a1 1 0 1 1-2 0v-6a1 1 0 0 1 1-1Zm4 0a1 1 0 0 1 1 1v6a1 1 0 1 1-2 0v-6a1 1 0 0 1 1-1Z"/></svg>',
  };

  function attActionChip(label, iconKey, attrs, modClass) {
    const icon = ATT_ICON[iconKey] || "";
    const isLink = /href=/.test(attrs);
    const tag = isLink ? "a" : "button";
    const type = isLink ? "" : ' type="button"';
    return `<${tag}${type} class="tt-att-action${modClass ? ` ${modClass}` : ""}" ${attrs}>${icon}<span class="tt-att-action-label">${E(label)}</span></${tag}>`;
  }

  function shortDocLabel(mime, name) {
    const m = (mime || "").toLowerCase();
    if (m.includes("pdf")) return "PDF";
    if (m.includes("wordprocessingml") || m === "application/msword") return "DOC";
    if (m.includes("spreadsheetml") || m === "application/vnd.ms-excel") return "XLS";
    if (m === "text/plain") return "TXT";
    if (m.startsWith("image/")) {
      const sub = m.split("/")[1] || "img";
      if (sub === "jpeg") return "JPG";
      return sub.slice(0, 4).toUpperCase();
    }
    const ext = extOf(name).replace(/^\./, "").toUpperCase();
    return ext || "FILE";
  }

  function itemHtml(a, { readonly, isStaged, orderId, allowServerDelete }) {
    const prev = canPreview(a.mime);
    const docLabel = shortDocLabel(a.mime, a.name);
    const ext = extOf(a.name);
    const baseName = ext ? a.name.slice(0, -ext.length) : a.name;
    const thumb = prev
      ? `<button type="button" class="tt-att-thumb tt-att-thumb--loading" data-tt="attach-preview" data-att-id="${E(a.id)}" data-order="${E(orderId || "")}" aria-label="Открыть ${E(a.name)}"><img src="${E(a.url)}" alt="" loading="lazy" decoding="async" onload="TanTrackerAttachments.onThumbLoad(this)" onerror="TanTrackerAttachments.onThumbError(this)"><span class="tt-att-fallback" aria-hidden="true">${E(docLabel)}</span></button>`
      : `<div class="tt-att-doc" aria-hidden="true">${E(docLabel)}</div>`;
    const meta = `<div class="tt-att-name-row"><span class="tt-att-name">${E(baseName)}</span>${ext ? `<span class="tt-att-ext">${E(ext)}</span>` : ""}</div><span class="tt-att-meta">${E(fmtBytes(a.size))}${a.demo ? " · демо" : ""}${a.addedLabel ? ` · ${E(a.addedLabel)}` : ""}</span>`;
    const dl = attActionChip(
      "Скачать",
      "download",
      `data-tt="attach-download" data-att-id="${E(a.id)}" data-order="${E(orderId || "")}" href="${E(a.downloadUrl || attachmentDownloadUrl(a.url))}" download="${E(a.name)}"`,
      "tt-att-action--download"
    );
    const openBtn = prev
      ? attActionChip(
          "Открыть",
          "open",
          `data-tt="attach-preview" data-att-id="${E(a.id)}" data-order="${E(orderId || "")}"`,
          "tt-att-action--open"
        )
      : "";
    const rm =
      !readonly && isStaged
        ? attActionChip("Убрать", "remove", `data-tt="attach-remove" data-staging-id="${E(a.id)}"`, "tt-att-action--remove")
        : !readonly && allowServerDelete && a.url && !a.demo
          ? attActionChip(
              "Удалить",
              "delete",
              `data-tt="attach-delete" data-att-id="${E(a.id)}" data-order="${E(orderId || "")}"`,
              "tt-att-action--remove",
            )
          : "";
    return `<li class="tt-att-item" data-att-id="${E(a.id)}">${thumb}<div class="tt-att-info">${meta}${heicLike(a.mime, a.name) && !prev ? `<span class="tt-att-note">Предпросмотр HEIC недоступен в браузере — скачайте файл.</span>` : !prev && (a.mime || "").includes("pdf") ? `<span class="tt-att-note">Скачайте PDF, чтобы открыть его на устройстве.</span>` : ""}<div class="tt-att-actions">${openBtn}${dl}${rm}</div></div></li>`;
  }

  function lkAttachmentMode() {
    return !!(typeof window !== "undefined" && (window.__TT_LK_BOOTSTRAP__?.lkMode || window.__TT_PUBLIC_RECIPIENT__));
  }

  function blockHtml(opts) {
    const lk = lkAttachmentMode();
    const {
      title = "Фото и файлы",
      hint = lk
        ? "До 10 файлов · 10 МБ каждый · 50 МБ суммарно."
        : "До 10 файлов · 10 МБ каждый · 50 МБ суммарно. Демо: файлы только до обновления страницы.",
      items = [],
      readonly = false,
      showPicker = false,
      pickerLabel = "Прикрепить фото или файл",
      inputKey = "create",
      orderId = "",
      error = "",
      omitTitle = false,
      stagedIds = null,
      pickerMode = "native",
      compact = false,
      omitResetNote = false,
      allowServerDelete = false,
    } = opts;
    const inputId = `tt-att-file-${inputKey}`;
    const stagedSet = stagedIds instanceof Set ? stagedIds : stagedIds ? new Set(stagedIds) : null;
    const list =
      items.length > 0
        ? `<ul class="tt-att-list" data-tt="attach-list">${items
            .map((a) =>
              itemHtml(a, {
                readonly,
                isStaged: !!(stagedSet && stagedSet.has(a.id)),
                orderId,
                allowServerDelete,
              })
            )
            .join("")}</ul>`
        : `<p class="tt-muted tt-att-empty">Нет вложений.</p>`;
    const accept =
      ".jpg,.jpeg,.png,.webp,.pdf,.doc,.docx,.xls,.xlsx,.txt,.heic,.heif,image/jpeg,image/png,image/webp,application/pdf,text/plain";
    const hintHtml = compact || !hint ? "" : `<p class="tt-muted tt-att-hint">${E(hint)}</p>`;
    const pickerBtnClass = compact ? "tt-link tt-att-add-btn" : "tt-att-file-btn tt-wizard-btn";
    const picker =
      showPicker && pickerMode === "button"
        ? `<div class="tt-att-picker tt-att-picker-btn"><input type="file" id="${E(inputId)}" class="tt-att-input-sr" multiple accept="${accept}" data-tt="attach-input" data-input-key="${E(inputKey)}"><label for="${E(inputId)}" class="${pickerBtnClass}">${E(pickerLabel)}</label>${hintHtml}</div>`
        : showPicker
          ? `<div class="tt-att-picker"><label class="tt-att-file-label">${pickerLabel}<input type="file" multiple accept="${accept}" data-tt="attach-input" data-input-key="${E(inputKey)}"></label>${hintHtml}</div>`
          : "";
    const countLabel = items.length ? ` · ${items.length}` : "";
    const titleHtml = omitTitle ? "" : `<h3 class="tt-att-title">${E(title)}${compact ? countLabel : ""}</h3>`;
    const resetNote =
      omitResetNote || compact || lk
        ? ""
        : `<p class="tt-muted tt-att-reset-note">Вложения хранятся только в памяти демо и сбрасываются при обновлении страницы.</p>`;
    const head =
      compact && !omitTitle
        ? `<div class="tt-att-head-row">${titleHtml}${showPicker ? picker : ""}</div>`
        : `${titleHtml}${picker}`;
    return `<section class="tt-att-block${compact ? " tt-att-compact" : " tt-att-block--cards"}" data-tt="attachments"${orderId ? ` data-order-id="${E(orderId)}"` : ""}>${head}${list}${error ? `<p class="tt-error">${E(error)}</p>` : ""}${resetNote}</section>`;
  }

  function lightboxHtml() {
    return `<div class="tt-att-lightbox" data-tt="attach-lightbox" hidden role="dialog" aria-modal="true" aria-label="Просмотр вложения"><button type="button" class="tt-att-lightbox-close" data-tt="attach-lightbox-close">Закрыть</button><div class="tt-att-lightbox-stage" data-tt="attach-lightbox-stage"><p class="tt-att-lightbox-loading" data-tt="attach-lightbox-loading" hidden>Загрузка…</p><img data-tt="attach-lightbox-img" alt="" decoding="async"><div class="tt-att-lightbox-fallback" data-tt="attach-lightbox-fallback" hidden><p class="tt-att-lightbox-err" data-tt="attach-lightbox-err">Не удалось показать изображение.</p><div class="tt-att-lightbox-fallback-actions"><button type="button" class="tt-wizard-btn" data-tt="attach-lightbox-retry">Повторить</button><a class="tt-wizard-btn tt-wizard-btn-secondary" data-tt="attach-lightbox-download" href="" download="">Скачать файл</a></div></div></div><p class="tt-att-lightbox-cap" data-tt="attach-lightbox-cap"></p></div>`;
  }

  window.TanTrackerAttachments = {
    MAX_FILES,
    seedDemoAttachments,
    blockHtml,
    lightboxHtml,
    fmtBytes,
    validatePick,
    fileToStaging,
    attachRecord,
    revokeStaging,
    revokeStagingItems,
    revokeStagingItem,
    setRasterDelayForTests,
    setRasterProbeTimeoutForTests,
    trackUrl,
    untrackUrl,
    canPreview,
    onThumbLoad,
    onThumbError,
    lkAttachmentThumbUrl,
    lkAttachmentLightboxUrl,
    lkAttachmentPreviewUrl,
    lkAttachmentDownloadUrl,
    attachmentThumbUrl,
    attachmentLightboxUrl,
    attachmentPreviewUrl,
    attachmentDownloadUrl,
    totalBytes,
    mergeToOrder(order, stagingItems, addedBy) {
      if (!order.attachments) order.attachments = [];
      stagingItems.forEach((s) => {
        trackUrl(s.url, `order:${order.id}`);
        order.attachments.push({ ...s, addedBy: addedBy || s.addedBy, addedAt: Date.now() });
      });
    },
    listForOrder(order) {
      return order.attachments || [];
    },
    findAttachment(order, id) {
      return (order.attachments || []).find((a) => a.id === id);
    },
  };
})();
