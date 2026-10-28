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
  function setRasterDelayForTests(ms) {
    rasterDelayMs = Math.max(0, Number(ms) || 0);
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
        const ok = await rasterProbe(blobUrl);
        if (!ok) {
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
      const img = new Image();
      img.onload = () => resolve(img.naturalWidth > 0 && img.naturalHeight > 0);
      img.onerror = () => resolve(false);
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

  function itemHtml(a, { readonly, isStaged, orderId }) {
    const prev = canPreview(a.mime);
    const thumb = prev
      ? `<button type="button" class="tt-att-thumb" data-tt="attach-preview" data-att-id="${E(a.id)}" data-order="${E(orderId || "")}"><img src="${E(a.url)}" alt="${E(a.name)}" loading="lazy"></button>`
      : `<div class="tt-att-doc" aria-hidden="true">${E(shortDocLabel(a.mime, a.name))}</div>`;
    const meta = `<span class="tt-att-name">${E(a.name)}</span><span class="tt-att-meta">${E(fmtBytes(a.size))}${a.demo ? " · демо" : ""}${a.addedLabel ? ` · ${E(a.addedLabel)}` : ""}</span>`;
    const dl = `<a class="tt-link tt-att-dl" data-tt="attach-download" data-att-id="${E(a.id)}" data-order="${E(orderId || "")}" href="${E(a.url)}" download="${E(a.name)}">Скачать</a>`;
    const rm =
      !readonly && isStaged
        ? `<button type="button" class="tt-link tt-att-rm" data-tt="attach-remove" data-staging-id="${E(a.id)}">Убрать</button>`
        : "";
    return `<li class="tt-att-item" data-att-id="${E(a.id)}">${thumb}<div class="tt-att-info">${meta}${heicLike(a.mime, a.name) && !prev ? `<span class="tt-att-note">Предпросмотр HEIC недоступен в браузере — скачайте файл.</span>` : !prev && (a.mime || "").includes("pdf") ? `<span class="tt-att-note">Скачайте PDF, чтобы открыть его на устройстве.</span>` : ""}<div class="tt-att-actions">${prev ? `<button type="button" class="tt-link" data-tt="attach-preview" data-att-id="${E(a.id)}" data-order="${E(orderId || "")}">Открыть</button>` : ""}${dl}${rm}</div></div></li>`;
  }

  function blockHtml(opts) {
    const {
      title = "Фото и файлы",
      hint = "До 10 файлов · 10 МБ каждый · 50 МБ суммарно. Демо: файлы только до обновления страницы.",
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
              })
            )
            .join("")}</ul>`
        : `<p class="tt-muted tt-att-empty">Нет вложений.</p>`;
    const accept =
      ".jpg,.jpeg,.png,.webp,.pdf,.doc,.docx,.xls,.xlsx,.txt,.heic,.heif,image/jpeg,image/png,image/webp,application/pdf,text/plain";
    const picker =
      showPicker && pickerMode === "button"
        ? `<div class="tt-att-picker tt-att-picker-btn"><input type="file" id="${E(inputId)}" class="tt-att-input-sr" multiple accept="${accept}" data-tt="attach-input" data-input-key="${E(inputKey)}"><label for="${E(inputId)}" class="tt-att-file-btn tt-wizard-btn">${E(pickerLabel)}</label><p class="tt-muted tt-att-hint">${E(hint)}</p></div>`
        : showPicker
          ? `<div class="tt-att-picker"><label class="tt-att-file-label">${pickerLabel}<input type="file" multiple accept="${accept}" data-tt="attach-input" data-input-key="${E(inputKey)}"></label><p class="tt-muted tt-att-hint">${E(hint)}</p></div>`
          : "";
    const titleHtml = omitTitle ? "" : `<h3 class="tt-att-title">${E(title)}</h3>`;
    return `<section class="tt-att-block" data-tt="attachments"${orderId ? ` data-order-id="${E(orderId)}"` : ""}>${titleHtml}${picker}${list}${error ? `<p class="tt-error">${E(error)}</p>` : ""}<p class="tt-muted tt-att-reset-note">Вложения хранятся только в памяти демо и сбрасываются при обновлении страницы.</p></section>`;
  }

  function lightboxHtml() {
    return `<div class="tt-att-lightbox" data-tt="attach-lightbox" hidden role="dialog" aria-modal="true" aria-label="Просмотр вложения"><button type="button" class="tt-att-lightbox-close" data-tt="attach-lightbox-close">Закрыть</button><img data-tt="attach-lightbox-img" alt=""><p class="tt-att-lightbox-cap" data-tt="attach-lightbox-cap"></p></div>`;
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
    trackUrl,
    untrackUrl,
    canPreview,
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
