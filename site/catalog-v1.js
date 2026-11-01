/* Каталог продукции — раздел единого прототипа.
   Данные: window.CATALOG_DATA (catalog-data.js). Названия, цвета, фото и розничные цены — с tandoor.ru;
   остатки, партнёрские цены, поступления — вымышленные демо-значения. Ничего во внешние системы не отправляется. */
(function () {
  const ROUTE = "catalog";
  const D = window.CATALOG_DATA || { sections: [], products: [], warehouses: [] };
  const PAGE = 48;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const money = (n) => n.toLocaleString("ru-RU") + " ₽";
  const icon = (n, cls = "") => `<i data-lucide="${n}" class="${cls}"></i>`;

  const state = {
    sec: "", sub: "", q: "", view: "show", clientView: false,
    avail: "", tags: [], f: {}, min: "", max: "", sort: "default",
    limit: PAGE, panelId: null, zoom: false, size: null, type: null, filtersOpen: false, full: false, gIdx: 0,
  };
  const cardIdx = {}; // индекс фото на карточках (карусель)
  const imgsOf = (p) => (p.imgs && p.imgs.length ? p.imgs : [p.img]);
  const sideLabel = (p, i) => (p.sides && p.sides[i] ? p.sides[i] : `Фото ${i + 1}`);
  /* Фото на карточке: все снимки в полный рост, стрелки и точки — карусель; у входных дверей подписи «Снаружи / Изнутри». */
  /* Другие цвета той же модели (как палитра на карточке tandoor.ru) — клик открывает карточку соседнего цвета. */
  const siblingsOf = (p) => D.products.filter((q) => q.section === p.section && q.name === p.name && q.id !== p.id);
  function colorsHtml(p, max = 4) {
    const sib = siblingsOf(p); if (!sib.length) return "";
    const all = [p, ...sib];
    return `<div class="cat-colors" aria-label="Цвета модели">${all.slice(0, max).map((q) => `<button type="button" class="${q.id === p.id ? "active" : ""}" data-cat="open" data-id="${q.id}" title="${esc(q.color)}" aria-label="${esc(q.name)} ${esc(q.color)}"><img src="${q.img}" alt="" loading="lazy"></button>`).join("")}${all.length > max ? `<span>+${all.length - max}</span>` : ""}</div>`;
  }
  function imgHtml(p, cls = "cat-img") {
    const imgs = imgsOf(p); const i = Math.min(cardIdx[p.id] || 0, imgs.length - 1);
    const multi = imgs.length > 1;
    /* Входные двери: как на tandoor.ru — обе стороны сразу, снаружи впереди, изнутри чуть позади; клик по задней выводит её вперёд. */
    if (p.sides && imgs.length >= 2 && cls === "cat-img") {
      const front = i < 2 ? i : 0, back = front === 0 ? 1 : 0;
      return `<div class="${cls} has-gallery cat-pair" data-gallery="${p.id}">
      <img class="side back" src="${imgs[back]}" alt="${esc(p.name)} — ${esc(sideLabel(p, back))}" loading="lazy" data-cat="cimg" data-id="${p.id}" data-idx="${back}" title="${esc(sideLabel(p, back))} — показать впереди">
      <img class="side front" src="${imgs[front]}" alt="${esc(p.name)} ${esc(p.color)} — ${esc(sideLabel(p, front))}" loading="lazy">
      ${colorsHtml(p)}
      <div class="cat-sides">${[0, 1].map((k) => `<button class="${k === front ? "active" : ""}" data-cat="cimg" data-id="${p.id}" data-idx="${k}">${esc(p.sides[k])}</button>`).join("")}${imgs.length > 2 ? `<span>+${imgs.length - 2}</span>` : ""}</div>
    </div>`;
    }
    return `<div class="${cls} ${multi ? "has-gallery" : ""}" data-gallery="${p.id}">
      <img src="${imgs[i]}" alt="${esc(p.name)} ${esc(p.color)} — ${esc(sideLabel(p, i))}" loading="lazy">
      ${colorsHtml(p)}
      ${multi ? `<button class="cat-arr prev" data-cat="cimg" data-id="${p.id}" data-dir="-1" aria-label="Предыдущее фото">${icon("chevron-left")}</button>
      <button class="cat-arr next" data-cat="cimg" data-id="${p.id}" data-dir="1" aria-label="Следующее фото">${icon("chevron-right")}</button>
      <div class="cat-dots" aria-hidden="true">${imgs.slice(0, 8).map((_, k) => `<i class="${k === i ? "on" : ""}"></i>`).join("")}${imgs.length > 8 ? `<b>${imgs.length}</b>` : ""}</div>` : ""}
    </div>`;
  }
  function stepCardImg(id, dir, idx) {
    const p = D.products.find((x) => x.id === id); if (!p) return;
    const n = imgsOf(p).length; const cur = cardIdx[id] || 0;
    cardIdx[id] = idx != null ? Number(idx) : (cur + Number(dir) + n) % n;
    document.querySelectorAll(`[data-gallery="${CSS.escape(id)}"]`).forEach((el) => { const cls = el.className.split(" ")[0]; el.outerHTML = imgHtml(p, cls); });
    lucide.createIcons();
  }

  /* ---------- данные ---------- */
  const total = (p) => Object.values(p.stock || {}).reduce((a, b) => a + b, 0);
  const lowLimit = (p) => (p.section === "hardware" || p.section === "molding" ? 10 : 3);
  function stockStatus(p) {
    const t = total(p);
    if (t === 0) {
      if (p.incoming) return { cls: "soon", label: `Ожидается ${p.incoming.qty} шт · ${p.incoming.date}`, short: "Ожидается" };
      return { cls: "none", label: p.kind === "Заказная" ? "Под заказ" : "Нет на складе", short: p.kind === "Заказная" ? "Под заказ" : "Нет" };
    }
    if (t < lowLimit(p)) return { cls: "low", label: `Мало · ${t} шт`, short: "Мало" };
    return { cls: "ok", label: `В наличии · ${t} шт`, short: "В наличии" };
  }
  function clientStatus(p) {
    const t = total(p);
    if (t > 0) return { cls: "ok", label: "В наличии" };
    if (p.incoming) return { cls: "soon", label: "Скоро поступит" };
    return { cls: "none", label: "Под заказ" };
  }
  /* Схема фильтров повторяет панель «Фильтр» на tandoor.ru по разделам (снято 01.11.2026):
     общие — Цена, Сортировка, Хит / Новинки / Акции / В наличии;
     межкомнатные — Дизайн, Цветовая гамма, Материал\Покрытие, Вид двери;
     входные — Место назначения, Вид двери, Толщина полотна, Толщина стали, Терморазрыв, Ковка, Стеклопакет, Зеркало
       (+ «по стоимости» из дерева каталога как Ценовой сегмент);
     фурнитура — Бренд, Цветовая гамма, Вид ручки, Основание ручки, Тип установки, Высота петли, Вид замка/защёлки, Материал язычка, Дизайн;
     плинтус — Материал, Цвет. Сверх сайта добавлено только «Наличие» для сотрудника (ожидается / под заказ). */
  const SITE_FILTERS = {
    interior: [
      ["Дизайн", ["Классика", "Модерн", "Модерн/Классика"]],
      ["Цветовая гамма", ["Белая", "Под покраску", "Светлая", "Серая", "Тёмная"]],
      ["Материал\\Покрытие", ["Грунт", "Ламинированное покрытие", "Массив", "ПВХ", "ПЭТ", "Современные покрытия", "Шпон", "Эмаль"]],
      ["Вид двери", ["Глухая (ДГ)", "Стеклянная (ДО)", "Частично остеклённая (ДЧ)"]],
    ],
    entry: [
      ["Место назначения", ["для дома", "для дома/для квартиры", "для квартиры"]],
      ["Вид двери", ["МДФ - МДФ", "Металл - МДФ", "Металл - металл", "Металл - ХДФ", "Эмаль-Эмаль"]],
      ["Толщина полотна, мм", ["до 69 мм", "от 70 до 89 мм", "от 90 до 99 мм", "100 мм и более"]],
      ["Толщина стали, мм", ["до 0,99 мм", "от 1 до 1,49 мм", "от 1,5 до 2 мм"]],
      ["Терморазрыв", ["да", "нет"]],
      ["Ковка", ["да", "нет"]],
      ["Стеклопакет", ["да", "нет"]],
      ["Зеркало", ["да", "нет"]],
      ["Ценовой сегмент", ["бюджет", "стандарт", "премиум"]],
    ],
    hardware: [
      ["Бренд", null],
      ["Цветовая гамма", null],
      ["Вид ручки", ["купе", "купе/с механизмом", "на планке/ с механизмом", "на розетке", "на розетке/ с механизмом"]],
      ["Основание ручки", ["квадратное", "круглое", "планка", "прямоугольное"]],
      ["Тип установки", ["врезные", "накладные"]],
      ["Высота петли", ["100 мм", "120 мм", "125 мм"]],
      ["Вид замка/защёлки", ["Замок под цилиндр", "Замок сантехнический", "Защёлка межкомнатная под фиксатор", "Защёлка межкомнатная сантехническая"]],
      ["Материал язычка", ["магнитный", "пластиковый"]],
      ["Дизайн", ["Классический стиль", "Современный стиль"]],
    ],
    molding: [
      ["Материал", ["МДФ"]],
      ["Цвет", null],
    ],
    "": [["Цветовая гамма", ["Белая", "Светлая", "Серая", "Тёмная"]]],
  };
  const TAGS = [["hit", "Хит"], ["new", "Новинки"], ["sale", "Акции"]];
  const attrOf = (p, key) => (key === "Цветовая гамма" && state.sec !== "hardware" ? p.gamma : (p.attrs || {})[key]);
  const hasAttr = (p, key, v) => { const a = attrOf(p, key); return Array.isArray(a) ? a.includes(v) : a === v; };
  const hasTag = (p, t) => (t === "hit" ? !!p.hit : t === "new" ? !!p.isNew : t === "sale" ? !!p.oldPrice : true);
  function passBase(p, skipKey) {
    if (state.sec && p.section !== state.sec) return false;
    if (state.sub && p.sub !== state.sub) return false;
    if (state.min && p.price < Number(state.min)) return false;
    if (state.max && p.price > Number(state.max)) return false;
    if (state.avail === "in" && total(p) === 0) return false;
    if (state.avail === "soon" && !(total(p) === 0 && p.incoming)) return false;
    if (state.avail === "order" && !(total(p) === 0 && !p.incoming)) return false;
    if (state.tags.length && !state.tags.every((t) => hasTag(p, t))) return false;
    for (const [k, vals] of Object.entries(state.f)) {
      if (k === skipKey || !vals.length) continue;
      if (!vals.some((v) => hasAttr(p, k, v))) return false;
    }
    return true;
  }
  function filtered() {
    const q = state.q.trim().toLowerCase();
    const terms = q ? q.split(/\s+/) : [];
    let list = D.products.filter((p) => {
      if (!passBase(p)) return false;
      if (terms.length) {
        const attrs = Object.values(p.attrs || {}).flat().join(" ");
        const hay = `${p.name} ${p.color} ${p.code} ${p.sub} ${p.coating} ${p.sizes.join(" ")} ${attrs}`.toLowerCase();
        if (!terms.every((t) => hay.includes(t))) return false;
      }
      return true;
    });
    if (state.sort === "asc") list = list.slice().sort((a, b) => a.price - b.price);
    else if (state.sort === "desc") list = list.slice().sort((a, b) => b.price - a.price);
    else if (state.sort === "stock") list = list.slice().sort((a, b) => total(b) - total(a));
    else if (state.sort === "name") list = list.slice().sort((a, b) => a.name.localeCompare(b.name, "ru"));
    return list;
  }
  const countIn = (sec, sub) => D.products.filter((p) => p.section === sec && (!sub || p.sub === sub)).length;
  const sectionOf = (id) => D.sections.find((s) => s.id === id);
  function sizesShort(p) {
    if (!p.sizes.length) return "—";
    if (p.section === "interior") {
      const byH = {};
      p.sizes.forEach((s) => { const [h, w] = s.split("×"); (byH[h] = byH[h] || []).push(w); });
      return Object.entries(byH).map(([h, ws]) => `${ws.join("/")} × ${h}`).join("; ");
    }
    return p.sizes.join(", ");
  }

  /* ---------- URL ---------- */
  function writeUrl() {
    const p = new URLSearchParams(location.hash.split("?")[1] || "");
    const set = (k, v) => (v ? p.set(k, v) : p.delete(k));
    set("sec", state.sec); set("sub", state.sub); set("q", state.q); set("view", state.view === "show" ? "" : state.view);
    set("client", state.clientView ? "1" : ""); set("item", state.panelId || "");
    history.replaceState(null, "", `#${ROUTE}?${p}`);
  }
  function readUrl() {
    const p = new URLSearchParams(location.hash.split("?")[1] || "");
    if (p.has("sec")) state.sec = sectionOf(p.get("sec")) ? p.get("sec") : "";
    if (p.has("sub")) state.sub = p.get("sub");
    if (p.has("q")) state.q = p.get("q");
    if (p.has("view") && ["site", "show", "table"].includes(p.get("view"))) state.view = p.get("view");
    if (p.has("client")) state.clientView = p.get("client") === "1";
    if (p.has("item") && D.products.some((x) => x.id === p.get("item"))) state.panelId = p.get("item");
  }

  /* ---------- разметка ---------- */
  function sectionsBar() {
    const all = D.products.length;
    return `<div class="cat-secbar" role="tablist" aria-label="Разделы каталога"><button class="cat-chip ${!state.sec ? "active" : ""}" data-cat="sec" data-sec="">${icon("layout-grid")}Все<small>${all}</small></button>${D.sections.map((s) => `<button class="cat-chip ${state.sec === s.id ? "active" : ""}" data-cat="sec" data-sec="${s.id}">${icon(s.icon)}${esc(s.name)}<small>${countIn(s.id)}</small></button>`).join("")}</div>`;
  }
  function sideHtml() {
    const all = D.products.length;
    return `<section class="card cat-tree" data-cat-tree>
      <button class="cat-tree-item ${!state.sec ? "active" : ""}" data-cat="sec" data-sec="">${icon("layout-grid")}Все разделы<span class="cat-count">${all}</span></button>
      ${D.sections.map((s) => `
        <button class="cat-tree-item ${state.sec === s.id && !state.sub ? "active" : ""}" data-cat="sec" data-sec="${s.id}">${icon(s.icon)}${esc(s.name)}<span class="cat-count">${countIn(s.id)}</span></button>
        ${state.sec === s.id ? `<div class="cat-tree-sub">${s.subs.map((u) => `<button class="cat-tree-item ${state.sub === u ? "active" : ""}" data-cat="sub" data-sub="${esc(u)}">${esc(u)}<span class="cat-count">${countIn(s.id, u)}</span></button>`).join("")}</div>` : ""}`).join("")}
    </section>
    <div class="card cat-side-note"><b>Источник данных</b>Названия, цвета, фото и розничные цены — с tandoor.ru. Остатки по складам, партнёрские цены и поступления — демо-значения; в рабочем ЛК они приходят из 1С.</div>`;
  }
  function chips(name, key, items) {
    return `<div class="cat-fgroup"><span>${name}</span><div class="cat-chips">${items.map(([v, l]) => `<button class="cat-chip ${state[key] === v ? "active" : ""}" data-cat="chip" data-key="${key}" data-val="${esc(v)}">${l}</button>`).join("")}</div></div>`;
  }
  function tagChips() {
    const scope = D.products.filter((p) => (!state.sec || p.section === state.sec) && (!state.sub || p.sub === state.sub));
    return `<div class="cat-fgroup"><span>Метки</span><div class="cat-chips">${TAGS.map(([v, l]) => {
      const n = scope.filter((p) => hasTag(p, v)).length;
      return `<button class="cat-chip ${state.tags.includes(v) ? "active" : ""} ${n ? "" : "empty"}" data-cat="tag" data-val="${v}" ${n ? "" : "disabled"}>${l}<small>${n}</small></button>`;
    }).join("")}</div></div>`;
  }
  function attrGroups() {
    const schema = SITE_FILTERS[state.sec] || [];
    const scope = D.products.filter((p) => (!state.sec || p.section === state.sec) && (!state.sub || p.sub === state.sub));
    return schema.map(([key, siteOpts]) => {
      const present = [...new Set(scope.flatMap((p) => [].concat(attrOf(p, key) || [])))];
      if (!present.length && !(state.f[key] || []).length) return "";
      const opts = siteOpts ? siteOpts.slice() : present.slice().sort((a, b) => a.localeCompare(b, "ru"));
      present.forEach((v) => { if (!opts.includes(v)) opts.push(v); });
      const sel = state.f[key] || [];
      const base = D.products.filter((p) => passBase(p, key));
      const items = opts.map((v) => {
        const n = base.filter((p) => hasAttr(p, key, v)).length;
        const on = sel.includes(v);
        if (!n && !on && opts.length > 8) return "";
        return `<button class="cat-chip ${on ? "active" : ""} ${n || on ? "" : "empty"}" data-cat="attr" data-key="${esc(key)}" data-val="${esc(v)}" ${n || on ? "" : "disabled"} title="${n ? "" : "На tandoor.ru есть такой фильтр, в демо-данных товаров нет"}">${esc(v)}<small>${n}</small></button>`;
      }).join("");
      return `<div class="cat-fgroup cat-fgroup-attr"><span>${esc(key)}</span><div class="cat-chips">${items}</div></div>`;
    }).join("");
  }
  function priceBounds() {
    const scope = D.products.filter((p) => (!state.sec || p.section === state.sec) && (!state.sub || p.sub === state.sub));
    if (!scope.length) return ["от", "до"];
    const ps = scope.map((p) => p.price);
    return [`от ${Math.min(...ps).toLocaleString("ru-RU")}`, `до ${Math.max(...ps).toLocaleString("ru-RU")}`];
  }
  function filtersHtml() {
    const [lo, hi] = priceBounds();
    return `
      ${chips("Наличие", "avail", [["in", "В наличии"], ["soon", "Ожидается"], ["order", "Под заказ"]])}
      ${tagChips()}
      <div class="cat-fgroup"><span>Цена, ₽</span><div class="cat-price-range"><input type="number" inputmode="numeric" placeholder="${lo}" value="${esc(state.min)}" data-cat-input="min" aria-label="Цена от"> — <input type="number" inputmode="numeric" placeholder="${hi}" value="${esc(state.max)}" data-cat-input="max" aria-label="Цена до"></div></div>
      <div class="cat-fgroup"><span>Сортировка</span><select data-cat-select="sort" aria-label="Сортировка">
        <option value="default" ${state.sort === "default" ? "selected" : ""}>Как в каталоге</option>
        <option value="asc" ${state.sort === "asc" ? "selected" : ""}>Цена: по возрастанию</option>
        <option value="desc" ${state.sort === "desc" ? "selected" : ""}>Цена: по убыванию</option>
        <option value="stock" ${state.sort === "stock" ? "selected" : ""}>Сначала в наличии</option>
        <option value="name" ${state.sort === "name" ? "selected" : ""}>По названию</option></select></div>
      ${hasFilters() ? `<button class="link cat-reset" data-cat="reset">Сбросить фильтры</button>` : ""}
      ${attrGroups() ? `<div class="cat-fsep"><span>${state.sec ? "Фильтры раздела — как на tandoor.ru" : "Выберите раздел, чтобы увидеть его фильтры как на tandoor.ru"}</span></div>${attrGroups()}` : ""}`;
  }
  const attrCount = () => Object.values(state.f).reduce((a, v) => a + v.length, 0);
  const hasFilters = () => !!(state.q || state.sec || state.avail || state.tags.length || attrCount() || state.min || state.max || state.sort !== "default");
  function activeChips() {
    const out = [];
    const chip = (l, key, val = "") => out.push(`<button class="cat-chip" data-cat="chip" data-key="${key}" data-val="${esc(val)}" aria-label="Убрать фильтр ${esc(l)}">${esc(l)}${icon("x")}</button>`);
    if (state.q) chip(`Поиск: ${state.q}`, "q");
    if (state.avail) chip({ in: "В наличии", soon: "Ожидается", order: "Под заказ" }[state.avail], "avail", state.avail);
    state.tags.forEach((t) => out.push(`<button class="cat-chip" data-cat="tag" data-val="${t}" aria-label="Убрать фильтр">${TAGS.find((x) => x[0] === t)[1]}${icon("x")}</button>`));
    Object.entries(state.f).forEach(([k, vals]) => vals.forEach((v) => out.push(`<button class="cat-chip" data-cat="attr" data-key="${esc(k)}" data-val="${esc(v)}" aria-label="Убрать фильтр ${esc(v)}">${esc(k === "Терморазрыв" || k === "Ковка" || k === "Стеклопакет" || k === "Зеркало" ? `${k}: ${v}` : v)}${icon("x")}</button>`)));
    if (state.min || state.max) out.push(`<button class="cat-chip" data-cat="price-clear">${state.min ? "от " + Number(state.min).toLocaleString("ru-RU") : ""} ${state.max ? "до " + Number(state.max).toLocaleString("ru-RU") : ""} ₽${icon("x")}</button>`);
    return out.join("");
  }
  function badges(p) {
    const b = [];
    if (p.isNew) b.push(`<span class="cat-badge new">NEW</span>`);
    if (p.oldPrice) b.push(`<span class="cat-badge sale">−${Math.round((1 - p.price / p.oldPrice) * 100)}%</span>`);
    if (p.hit && !p.isNew) b.push(`<span class="cat-badge">Хит</span>`);
    return b.length ? `<div class="cat-badges">${b.join("")}</div>` : "";
  }
  function stockHtml(p, compact) {
    if (state.clientView) {
      const c = clientStatus(p);
      return `<span class="cat-stock ${c.cls}">${c.label}</span>`;
    }
    const s = stockStatus(p);
    const wh = total(p) > 0 && !compact ? `<div class="cat-wh">${D.warehouses.map((w) => p.stock[w.id] ? `<span>${esc(w.short)} <b>${p.stock[w.id]}</b></span>` : "").join("")}</div>` : "";
    return `<span class="cat-stock ${s.cls}">${s.label}</span>${wh}`;
  }
  function priceHtml(p) {
    return `<div class="cat-pricerow"><span class="cat-price">${money(p.price)}</span>${p.oldPrice ? `<span class="cat-old">${money(p.oldPrice)}</span>` : ""}
      ${!state.clientView ? `<span class="cat-partner">Партнёр: <b>${money(p.partner)}</b></span>` : ""}</div>`;
  }
  function cardSite(p) {
    return `<article class="cat-card" data-cat="open" data-id="${p.id}" tabindex="0" role="button" aria-label="${esc(p.name)} ${esc(p.color)}">${badges(p)}
      <div class="cat-head"><div class="cat-name">${esc(p.name)}</div><div class="cat-color">${esc(p.color)}<br>${esc(p.sub)}</div></div>
      ${imgHtml(p)}
      <div class="cat-body">${stockHtml(p, true)}<div class="cat-pricerow"><span class="cat-label">Розничная цена</span><span class="cat-price">${money(p.price)}</span></div>
      ${!state.clientView ? `<div class="cat-partner">Партнёр: <b>${money(p.partner)}</b></div>` : ""}</div>
      <button type="button" class="cat-cta" data-cat="open" data-id="${p.id}" aria-label="Открыть карточку ${esc(p.name)}">${icon("arrow-up-right")}Открыть карточку</button></article>`;
  }
  function cardShow(p) {
    const coatShort = { "Современные покрытия": "", "Ламинированное покрытие": "Ламинат" };
    const meta = [coatShort[p.coating] ?? p.coating, p.sizes.length ? (p.section === "interior" ? p.sizes.map((s) => s.split("×")[1]).join("/") : p.sizes.join(", ")) : "", p.types.length ? p.types.join("/") : ""].filter(Boolean);
    return `<article class="cat-card" data-cat="open" data-id="${p.id}" tabindex="0" role="button" aria-label="${esc(p.name)} ${esc(p.color)}">${badges(p)}
      ${imgHtml(p)}
      <div class="cat-body"><div class="cat-name">${esc(p.name)}</div><div class="cat-color">${esc(p.color)} · ${esc(p.sub)}</div>
      ${meta.length ? `<div class="cat-meta">${meta.map((m) => `<span>${esc(m)}</span>`).join("")}</div>` : ""}
      ${priceHtml(p)}${stockHtml(p)}</div>
      ${!state.clientView ? `<div class="cat-quick"><button data-cat="copy" data-id="${p.id}">${icon("copy")}Ответ клиенту</button></div>` : ""}</article>`;
  }
  function tableHtml(list) {
    const emp = !state.clientView;
    return `<div class="card tablewrap"><table class="cat-table"><thead><tr><th></th><th>Модель</th><th class="cat-hide-m">Раздел</th><th class="cat-hide-m cat-hide-l">Размеры</th><th class="num">Розница</th>${emp ? `<th class="num cat-hide-m">Партнёр</th>` : ""}<th>Наличие</th>${emp ? D.warehouses.map((w) => `<th class="num cat-hide-m">${esc(w.short)}</th>`).join("") + "<th></th>" : ""}</tr></thead><tbody>
      ${list.map((p) => `<tr data-cat="open" data-id="${p.id}" tabindex="0"><td><div class="cat-thumb"><img src="${p.img}" alt="" loading="lazy">${imgsOf(p).length > 1 ? `<span class="cat-thumb-n">${imgsOf(p).length}</span>` : ""}</div></td>
        <td><div class="cat-name">${esc(p.name)}</div><span class="small">${esc(p.color)}</span></td>
        <td class="cat-hide-m"><span class="small">${esc(p.sub)}</span></td>
        <td class="cat-hide-m cat-hide-l"><span class="small">${esc(sizesShort(p))}${p.types.length ? " · " + esc(p.types.join("/")) : ""}</span></td>
        <td class="num"><strong>${money(p.price)}</strong>${p.oldPrice ? `<span class="small cat-old">${money(p.oldPrice)}</span>` : ""}</td>
        ${emp ? `<td class="num cat-hide-m">${money(p.partner)}</td>` : ""}
        <td>${stockHtml(p, true)}</td>
        ${emp ? D.warehouses.map((w) => `<td class="num cat-hide-m">${p.stock[w.id] || "—"}</td>`).join("") + `<td><button class="cat-copy" data-cat="copy" data-id="${p.id}" aria-label="Скопировать ответ клиенту">${icon("copy")}</button></td>` : ""}</tr>`).join("")}
    </tbody></table></div>`;
  }
  function resultsHtml(list) {
    const shown = list.slice(0, state.limit);
    if (!list.length) return `<section class="card cat-empty"><h3>Ничего не найдено</h3><p>Проверьте написание модели или снимите часть фильтров.</p><button data-cat="reset">Сбросить фильтры</button></section>`;
    const body = state.view === "table" ? tableHtml(shown) : `<div class="cat-grid view-${state.view}">${shown.map(state.view === "site" ? cardSite : cardShow).join("")}</div>`;
    const more = list.length > state.limit ? `<div class="cat-more"><button data-cat="more">Показать ещё ${Math.min(PAGE, list.length - state.limit)} из ${list.length - state.limit}</button></div>` : "";
    return body + more;
  }
  function subChips() {
    const s = sectionOf(state.sec);
    if (!s) return "";
    return `<div class="cat-subchips"><button class="cat-chip ${!state.sub ? "active" : ""}" data-cat="sub" data-sub="">Все · ${countIn(s.id)}</button>${s.subs.map((u) => `<button class="cat-chip ${state.sub === u ? "active" : ""}" data-cat="sub" data-sub="${esc(u)}">${esc(u)} · ${countIn(s.id, u)}</button>`).join("")}</div>`;
  }
  function mainHtml() {
    const list = filtered();
    const s = sectionOf(state.sec);
    return `<section class="card cat-toolbar">
      <div class="cat-search">${icon("search")}<input type="search" id="cat-search" placeholder="Модель, цвет или артикул" value="${esc(state.q)}" autocomplete="off" aria-label="Поиск по каталогу">${state.q ? `<button class="cat-clear" data-cat="chip" data-key="q" aria-label="Очистить поиск">${icon("x")}</button>` : ""}</div>
      <button class="cat-filterbtn" data-cat="toggle-filters">${icon("sliders-horizontal")}Фильтры${hasFilters() ? " · есть" : ""}</button>
      <div class="cat-seg" role="group" aria-label="Вид карточек">
        <button class="${state.view === "site" ? "active" : ""}" data-cat="view" data-view="site" title="Как на tandoor.ru">${icon("layout-grid")}<span>Как на сайте</span></button>
        <button class="${state.view === "show" ? "active" : ""}" data-cat="view" data-view="show" title="Витрина: фото крупно, цена и остаток рядом">${icon("rows-3")}<span>Витрина</span></button>
        <button class="${state.view === "table" ? "active" : ""}" data-cat="view" data-view="table" title="Таблица: быстрый ответ по остаткам">${icon("table-2")}<span>Таблица</span></button>
      </div>
      <label class="cat-mode ${state.clientView ? "on" : ""}" title="Показать каталог так, как его увидит клиент в боте: без партнёрских цен и точных остатков"><input type="checkbox" data-cat-client ${state.clientView ? "checked" : ""}>${icon(state.clientView ? "eye" : "eye-off")}<span>Как видит клиент</span></label>
      <button class="cat-fullbtn ${state.full ? "on" : ""}" data-cat="full" title="${state.full ? "Вернуться в личный кабинет (Esc)" : "Каталог на весь экран: без меню и шапки"}">${icon(state.full ? "minimize-2" : "maximize-2")}<span>${state.full ? "Выйти" : "На весь экран"}</span>${state.full ? "<kbd>Esc</kbd>" : ""}</button>
    </section>
    <section class="card cat-filters ${state.filtersOpen ? "open" : ""}" data-cat-filters>${filtersHtml()}</section>
    ${subChips()}
    <div class="cat-summary"><div><b>${list.length}</b> ${plural(list.length)}${s ? ` · ${esc(s.name)}${state.sub ? " / " + esc(state.sub) : ""}` : ""}${state.clientView ? ` · <span class="tag warn">режим клиента</span>` : ""}</div><div class="cat-active">${activeChips()}</div></div>
    <div data-cat-results>${resultsHtml(list)}</div>`;
  }
  const plural = (n) => { const m10 = n % 10, m100 = n % 100; return m10 === 1 && m100 !== 11 ? "товар" : m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20) ? "товара" : "товаров"; };

  /* ---------- панель товара ---------- */
  function replyText(p) {
    const size = state.size || p.sizes[0] || "";
    const type = state.type || optTypes(p)[0] || "";
    const t = total(p);
    const what = p.section === "interior" ? "Межкомнатная дверь" : p.section === "entry" ? "Входная дверь" : "";
    const lines = [`${what ? what + " " : ""}${p.name}, ${p.color}${size ? ", " + size : ""}${type ? (p.types.length ? " (" + type + ")" : ", открывание " + type.toLowerCase()) : ""}.`];
    lines.push(`Розничная цена: ${money(p.price)}${p.oldPrice ? ` (до акции ${money(p.oldPrice)})` : ""}.`);
    if (t > 0) lines.push(`В наличии${p.stock.krd ? " на складе в Краснодаре" : p.stock.rnd ? " на складе в Ростове" : " в шоуруме"}, можем отгрузить в ближайшие дни.`);
    else if (p.incoming) lines.push(`Сейчас нет на складе, ожидаем поступление ${p.incoming.date}.`);
    else lines.push(`Позиция под заказ, срок уточним при оформлении.`);
    return lines.join("\n");
  }
  /* Варианты выбора в карточке: у межкомнатных — вид двери (ДГ/ДО/ДЧ), у входных — сторона открывания (на сайте «Тип L / R»). */
  const optTypes = (p) => p.types.length ? p.types : (p.section === "entry" && /\//.test(p.specs?.["Открывание"] || "") ? ["Левое", "Правое"] : []);
  const optLabel = (p) => p.types.length ? "Тип" : "Открывание";
  function panelHtml(p) {
    const s = sectionOf(p.section);
    const types = optTypes(p);
    const curSize = state.size || p.sizes[0] || "", curType = state.type || types[0] || "";
    const sib = siblingsOf(p);
    const outdoorNote = p.section === "entry" && /^нет/i.test(p.specs?.["Терморазрыв"] || "");
    const derived = { "Модель": p.name, "Цвет": p.color, ...(curSize ? { "Размер": curSize } : {}), ...(curType ? { [p.types.length ? "Вид двери" : "Открывание"]: curType } : {}) };
    const specRows = Object.entries({ ...derived, ...Object.fromEntries(Object.entries(p.specs || {}).filter(([k]) => !(k in derived))) });
    const st = stockStatus(p);
    const cl = clientStatus(p);
    const t = total(p);
    return `<div class="cat-panel-bg" data-cat="close"></div><div class="cat-panel-box" role="dialog" aria-modal="true" aria-labelledby="cat-panel-title">
      <div class="cat-panel-head"><div><div class="cat-crumbs">${esc(s?.name || "")} / ${esc(p.sub)} · код ${esc(p.code)}</div><h2 id="cat-panel-title">${esc(p.name)}</h2><div class="sub">${esc([p.color, curSize, curType].filter(Boolean).join(" / "))}${p.coating ? " · " + esc(p.coating) : ""}</div></div><button class="cat-close" data-cat="close" aria-label="Закрыть">${icon("x")}</button></div>
      <div class="cat-panel-body">
        ${(() => { const imgs = imgsOf(p); const i = Math.min(state.gIdx, imgs.length - 1); return `
        <div class="cat-gallery ${state.zoom ? "zoom" : ""}">
          <div class="cat-img" data-cat="zoom">${badges(p)}<img src="${imgs[i]}" alt="${esc(p.name)} ${esc(p.color)} — ${esc(sideLabel(p, i))}">
            ${imgs.length > 1 ? `<button class="cat-arr prev" data-cat="gimg" data-dir="-1" aria-label="Предыдущее фото">${icon("chevron-left")}</button><button class="cat-arr next" data-cat="gimg" data-dir="1" aria-label="Следующее фото">${icon("chevron-right")}</button><span class="cat-gcount">${i + 1} / ${imgs.length}${p.sides && p.sides[i] ? " · " + esc(p.sides[i]) : ""}</span>` : ""}
          </div>
          ${imgs.length > 1 ? `<div class="cat-thumbs" role="tablist" aria-label="Фото модели">${imgs.map((src, k) => `<button role="tab" aria-selected="${k === i}" class="${k === i ? "active" : ""}" data-cat="gimg" data-idx="${k}" title="${esc(sideLabel(p, k))}"><img src="${src}" alt="" loading="lazy">${p.sides && p.sides[k] ? `<span>${esc(p.sides[k])}</span>` : ""}</button>`).join("")}</div>` : ""}
          <small>${state.zoom ? "Нажмите, чтобы уменьшить" : "Нажмите на фото, чтобы увеличить"} · ${imgs.length} ${imgs.length === 1 ? "фото" : "фото"}${imgs.length > 1 ? " · листайте стрелками ← →" : ""}${p.site ? ` · <a href="${esc(p.site)}" target="_blank" rel="noopener">страница на сайте</a>` : ""}</small>
        </div>`; })()}
        <div class="cat-info">
          <div class="cat-pricebox">
            <div class="tile"><div class="small">Розничная цена${p.section === "interior" ? " · за полотно" : ""}</div><span class="cat-price">${money(p.price)}</span>${p.oldPrice ? ` <span class="cat-old">${money(p.oldPrice)}</span>` : ""}</div>
            ${!state.clientView ? `<div class="tile"><div class="small">Цена партнёра · демо</div><span class="cat-price">${money(p.partner)}</span></div>` : `<div class="tile"><div class="small">Наличие</div><span class="cat-stock ${cl.cls}">${cl.label}</span></div>`}
          </div>
          ${p.sizes.length || types.length || sib.length ? `<div class="cat-options">
            ${types.length ? `<div class="row"><span>${optLabel(p)}</span>${types.map((x) => `<button class="cat-opt ${curType === x ? "active" : ""}" data-cat="type" data-val="${esc(x)}">${esc(x)}</button>`).join("")}</div>` : ""}
            ${p.sizes.length ? `<div class="row"><span>Размер</span>${p.sizes.map((x) => `<button class="cat-opt ${curSize === x ? "active" : ""}" data-cat="size" data-val="${esc(x)}">${esc(x)}</button>`).join("")}${p.section === "entry" ? `<span class="cat-nonstd" title="На сайте — «Рассчитать нестандарт»; в ЛК расчёт по запросу">нестандарт — по запросу</span>` : ""}</div>` : ""}
            ${sib.length ? `<div class="row"><span>Цвет</span><div class="cat-colors big">${[p, ...sib].map((q) => `<button type="button" class="${q.id === p.id ? "active" : ""}" data-cat="open" data-id="${q.id}" title="${esc(q.color)}"><img src="${q.img}" alt="" loading="lazy"><em>${esc(q.color)}</em></button>`).join("")}</div></div>` : ""}
          </div>` : ""}
          ${outdoorNote ? `<p class="cat-note">${icon("info")}Без терморазрыва: Tandoor не рекомендует устанавливать эту дверь на улицу.</p>` : ""}
          ${!state.clientView ? `<div><h3 style="margin-bottom:8px">Остатки по складам <span class="tag warn">демо</span></h3><div class="cat-stocktable">
            ${D.warehouses.map((w) => `<div class="item"><span>${esc(w.name)}</span><b>${p.stock[w.id] ? p.stock[w.id] + " шт" : "—"}</b></div>`).join("")}
            ${p.incoming ? `<div class="item"><span>Ожидается поступление</span><b>${p.incoming.qty} шт · ${esc(p.incoming.date)}</b></div>` : ""}
            <div class="item total"><span>Итого · ${esc(p.kind)} позиция</span><span class="cat-stock ${st.cls}">${t > 0 ? t + " шт" : st.label}</span></div></div></div>` : ""}
          <div><h3 style="margin-bottom:4px">Характеристики</h3><div class="cat-specs">${specRows.map(([k, v]) => `<div class="field"><div class="small">${esc(k)}</div><div>${esc(v)}</div></div>`).join("")}</div></div>
          ${!state.clientView ? `<div><div class="cat-reply-label"><span>Готовый ответ клиенту</span><span>обновляется по типу и размеру</span></div><div class="cat-reply" data-cat-reply>${esc(replyText(p))}</div></div>` : ""}
          <div class="cat-actions">
            ${!state.clientView ? `<button class="primary" data-cat="copy" data-id="${p.id}">${icon("copy")}Скопировать ответ</button><button data-cat="send" data-id="${p.id}">${icon("send")}Отправить в чат клиенту</button>` : ""}
            ${p.site ? `<a href="${esc(p.site)}" target="_blank" rel="noopener">${icon("external-link")}Открыть на tandoor.ru</a>` : ""}
          </div>
          <p class="cat-demo-note">Прототип: остатки, партнёрская цена и поступления — вымышленные. Отправка в чат ничего не делает; в рабочем ЛК будет уходить через MAX/Telegram-бот с учётом прав.</p>
        </div>
      </div></div>`;
  }
  function renderPanel(keepFocus) {
    let el = document.querySelector(".cat-panel");
    const p = D.products.find((x) => x.id === state.panelId);
    if (!p) { if (el) { el.classList.remove("open"); el.innerHTML = ""; } document.body.style.overflow = ""; return; }
    if (!el) { el = document.createElement("div"); el.className = "cat-panel"; document.body.appendChild(el); }
    el.innerHTML = panelHtml(p);
    el.classList.add("open");
    document.body.style.overflow = "hidden";
    lucide.createIcons();
    if (!keepFocus) el.querySelector(".cat-close")?.focus({ preventScroll: true });
  }
  function openPanel(id) { state.panelId = id; state.zoom = false; state.gIdx = cardIdx[id] || 0; state.size = null; state.type = null; writeUrl(); renderPanel(); }
  function stepPanelImg(dir, idx) {
    const p = D.products.find((x) => x.id === state.panelId); if (!p) return;
    const n = imgsOf(p).length; state.gIdx = idx != null ? Number(idx) : (state.gIdx + Number(dir) + n) % n;
    renderPanel(true);
  }
  function setFull(on) {
    state.full = !!on;
    document.body.classList.toggle("cat-fullscreen", state.full && current === ROUTE);
    rerender();
    if (state.full) document.querySelector(".cat-fullbtn")?.focus({ preventScroll: true });
  }
  function closePanel() { const had = !!state.panelId; state.panelId = null; writeUrl(); renderPanel(); if (had) document.querySelector(`[data-id="${CSS.escape(lastOpened || "")}"]`)?.focus?.({ preventScroll: true }); }
  let lastOpened = null;

  /* ---------- рендер ---------- */
  function root() { return document.getElementById("catalog-root"); }
  function renderCatalog(focusSearch) {
    const r = root();
    if (!r) return;
    document.querySelector(".screenbody .r-other-example")?.remove();
    document.body.classList.toggle("cat-fullscreen", state.full);
    r.innerHTML = `<div class="cat ${state.full ? "cat-full" : ""}">${state.full ? `<div class="cat-fullhead">${sectionsBar()}</div>` : `<aside class="cat-side">${sideHtml()}</aside>`}<div class="cat-main">${mainHtml()}</div></div>`;
    lucide.createIcons();
    if (focusSearch && matchMedia("(min-width: 901px)").matches) {
      const i = document.getElementById("cat-search");
      if (i) { i.focus({ preventScroll: true }); i.setSelectionRange(i.value.length, i.value.length); }
    }
    renderPanel();
  }
  function rerender(partial, opts = {}) {
    const r = root();
    if (!r) return;
    if (partial === "results") {
      const res = r.querySelector("[data-cat-results]");
      const list = filtered();
      if (res) res.innerHTML = resultsHtml(list);
      const sum = r.querySelector(".cat-summary");
      if (sum) {
        const s = sectionOf(state.sec);
        sum.innerHTML = `<div><b>${list.length}</b> ${plural(list.length)}${s ? ` · ${esc(s.name)}${state.sub ? " / " + esc(state.sub) : ""}` : ""}${state.clientView ? ` · <span class="tag warn">режим клиента</span>` : ""}</div><div class="cat-active">${activeChips()}</div>`;
      }
      const f = r.querySelector("[data-cat-filters]");
      if (f && opts.filters !== false) f.innerHTML = filtersHtml();
      const clr = r.querySelector(".cat-search .cat-clear");
      const search = r.querySelector(".cat-search");
      if (state.q && !clr && search) search.insertAdjacentHTML("beforeend", `<button class="cat-clear" data-cat="chip" data-key="q" aria-label="Очистить поиск">${icon("x")}</button>`);
      if (!state.q && clr) clr.remove();
      lucide.createIcons();
      return;
    }
    const active = document.activeElement?.id === "cat-search";
    renderCatalog(active);
  }
  function notice(text) {
    const n = document.getElementById("notice");
    if (!n) return;
    n.textContent = text; n.classList.add("show");
    clearTimeout(notice.t); notice.t = setTimeout(() => n.classList.remove("show"), 2600);
  }
  async function copyReply(id) {
    const p = D.products.find((x) => x.id === id);
    if (!p) return;
    const text = replyText(p);
    try { await navigator.clipboard.writeText(text); notice("Ответ скопирован. Вставьте его в чат клиенту."); }
    catch { notice("Буфер обмена недоступен — текст показан в карточке товара."); if (state.panelId !== id) openPanel(id); }
  }

  /* ---------- события ---------- */
  document.addEventListener("click", (e) => {
    if (current !== ROUTE) return;
    const b = e.target.closest("[data-cat]");
    if (!b) return;
    const a = b.dataset.cat;
    if (e.target.closest("a")) return;
    if (a === "sec") { state.sec = b.dataset.sec; state.sub = ""; state.f = {}; state.limit = PAGE; writeUrl(); rerender(); return; }
    if (a === "tag") { const v = b.dataset.val; state.tags = state.tags.includes(v) ? state.tags.filter((x) => x !== v) : [...state.tags, v]; state.limit = PAGE; rerender("results"); return; }
    if (a === "attr") { const k = b.dataset.key, v = b.dataset.val; const cur = state.f[k] || []; const next = cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]; if (next.length) state.f[k] = next; else delete state.f[k]; state.limit = PAGE; rerender("results"); return; }
    if (a === "sub") { state.sub = b.dataset.sub; state.limit = PAGE; writeUrl(); rerender(); return; }
    if (a === "view") { state.view = b.dataset.view; state.limit = PAGE; writeUrl(); rerender(); return; }
    if (a === "chip") { const k = b.dataset.key; state[k] = state[k] === (b.dataset.val || "") || !b.dataset.val ? "" : b.dataset.val; state.limit = PAGE; if (k === "q") writeUrl(); if (k === "q") rerender(); else rerender("results"); return; }
    if (a === "price-clear") { state.min = ""; state.max = ""; rerender(); return; }
    if (a === "reset") { Object.assign(state, { sec: "", sub: "", q: "", avail: "", tags: [], f: {}, min: "", max: "", sort: "default", limit: PAGE }); writeUrl(); rerender(); return; }
    if (a === "more") { state.limit += PAGE; rerender("results"); return; }
    if (a === "toggle-filters") { state.filtersOpen = !state.filtersOpen; document.querySelector("[data-cat-filters]")?.classList.toggle("open", state.filtersOpen); return; }
    if (a === "open") { lastOpened = b.dataset.id; openPanel(b.dataset.id); return; }
    if (a === "close") { closePanel(); return; }
    if (a === "cimg") { e.preventDefault(); e.stopPropagation(); stepCardImg(b.dataset.id, b.dataset.dir, b.dataset.idx); return; }
    if (a === "gimg") { e.preventDefault(); e.stopPropagation(); stepPanelImg(b.dataset.dir, b.dataset.idx); return; }
    if (a === "full") { setFull(!state.full); return; }
    if (a === "zoom") { state.zoom = !state.zoom; renderPanel(); return; }
    if (a === "size") { state.size = b.dataset.val; renderPanel(); return; }
    if (a === "type") { state.type = b.dataset.val; renderPanel(); return; }
    if (a === "copy") { e.stopPropagation(); copyReply(b.dataset.id); return; }
    if (a === "send") { notice("Демо: в рабочем ЛК ответ уйдёт клиенту через MAX или Telegram. Сейчас ничего не отправлено."); return; }
  }, true);
  document.addEventListener("keydown", (e) => {
    if (current !== ROUTE) return;
    if (e.key === "Escape" && state.panelId) { e.preventDefault(); closePanel(); return; }
    if (e.key === "Escape" && state.full) { e.preventDefault(); setFull(false); return; }
    if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && state.panelId && !e.target.matches?.("input,select,textarea")) { e.preventDefault(); stepPanelImg(e.key === "ArrowLeft" ? -1 : 1); return; }
    if (e.key === "Enter" && e.target.matches?.('[data-cat="open"]')) { e.preventDefault(); lastOpened = e.target.dataset.id; openPanel(e.target.dataset.id); }
  });
  let debounce;
  document.addEventListener("input", (e) => {
    if (current !== ROUTE) return;
    if (e.target.id === "cat-search") {
      clearTimeout(debounce);
      debounce = setTimeout(() => { state.q = e.target.value; state.limit = PAGE; writeUrl(); rerender("results"); }, 120);
    }
    if (e.target.dataset.catInput) {
      clearTimeout(debounce);
      debounce = setTimeout(() => { state[e.target.dataset.catInput] = e.target.value; state.limit = PAGE; rerender("results", { filters: false }); }, 200);
    }
  });
  document.addEventListener("change", (e) => {
    if (current !== ROUTE) return;
    if (e.target.dataset.catSelect) { state[e.target.dataset.catSelect] = e.target.value; state.limit = PAGE; rerender("results"); }
    if (e.target.hasAttribute("data-cat-client")) { state.clientView = e.target.checked; writeUrl(); rerender(); }
  });

  /* ---------- регистрация в оболочке ---------- */
  add(ROUTE, "Каталог продукции", "Цены, остатки и фото моделей — чтобы ответить клиенту за один экран", "Менеджер", ROUTE, '<div id="catalog-root"></div>', "");
  const priorNav = roleNav;
  roleNav = function (items) {
    const rows = priorNav(items);
    if (rows.some((r) => r[0] === ROUTE)) return rows;
    const assistantOnly = rows.length > 0 && rows.every((r) => String(r[0]).startsWith("assistant"));
    if (assistantOnly) return rows;
    let at = rows.findIndex((r) => r[0] === "exchange" || /Клиенты|Мои клиенты|Мои торговые точки/.test(String(r[1])));
    if (at < 0) at = rows.findIndex((r) => r[0] === "clients" && r[3] === "clients");
    const insert = [ROUTE, "Каталог", "door-open", ROUTE];
    if (at >= 0) rows.splice(at + 1, 0, insert); else rows.push(insert);
    return rows;
  };
  const priorRender = render;
  render = function () {
    const onRoute = current === ROUTE;
    if (!onRoute) {
      if (state.panelId) { state.panelId = null; renderPanel(); }
      if (state.full) { state.full = false; }
      document.body.classList.remove("cat-fullscreen");
      priorRender();
      return;
    }
    readUrl();
    priorRender();
    renderCatalog(true);
  };
  window.CatalogPrototype = { state, filtered, total, stockStatus, replyText, imgsOf };
  if (location.hash.slice(1).split("?")[0] === ROUTE) current = ROUTE;
  render();
})();
