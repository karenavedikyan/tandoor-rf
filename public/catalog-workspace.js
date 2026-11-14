/* Rendering contract: supplied catalog-v1.css, Golos font and prototype DOM classes.
   Data and access remain those of the authenticated, admin-only JSON catalogue. */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById("ic-" + id); };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var icon = function (n) { return '<i data-lucide="' + n + '"></i>'; };
  var num = function (n) { return Number(n).toLocaleString("ru-RU"); };
  var money = function (n) { return n == null ? "Не определена" : num(n) + " ₽"; };
  var s = { group: "", properties: {}, priceType: "", min: "", max: "", availability: "", flag: "", sort: "name", view: "show", client: false };
  var meta = {}, bridge, lastList, detail, galleryIndex = 0, light = null, navParent = "", defaultPriceType = "", photoIndexes = Object.create(null);
  var productCache = new Map(), groupCounts = {}, filterTimer, photoConfigured = false;
  function icons() { if (window.lucide) window.lucide.createIcons(); }
  function prop(p, name) {
    var found = (p.properties || []).find(function (x) { return x.name.trim() === name; });
    return found ? found.value.trim() : "";
  }
  function commerce(p) { return p.commerce || { prices: [], warehouses: [], quantity: null }; }
  function price(p) { return (commerce(p).prices || []).find(function (x) { return x.guid === s.priceType; }); }
  function priceHtml(p) {
    if (s.client) return "";
    var v = price(p);
    return '<div class="cat-pricerow ic-private"><span class="cat-price">' + money(v ? v.value : null) +
      '</span><span class="cat-partner">' + esc(v ? v.name : "Выберите тип цены в фильтре") + "</span></div>";
  }
  function stockHtml(p, compact) {
    var c = commerce(p), known = c.quantity != null, positive = known && c.quantity > 0;
    var label = !known ? "Остаток не определён" : positive ? (s.client ? "Есть остаток в 1С" : "Остаток в 1С · " + num(c.quantity)) : "Нулевой остаток в 1С";
    return '<span class="cat-stock ' + (positive ? "ok" : "none") + '">' + esc(label) + "</span>" +
      (!compact && !s.client ? '<div class="cat-wh ic-private">' + (c.warehouses || []).map(function (w) {
        return "<span>" + esc(w.name) + " <b>" + (w.value == null ? "Проверить" : num(w.value)) + "</b></span>";
      }).join("") + "</div>" : "");
  }
  function imageUrl(p, file, preview) {
    return "/api/internal-catalog/products/" + encodeURIComponent(p.guid) + "/images/" +
      encodeURIComponent(file.guid) + "?version=" + encodeURIComponent(bridge.snapshot().id) +
      (preview && meta.thumbnailsReady === true ? "&preview=" + preview : "");
  }
  function files(p) { return photoConfigured ? p.files || (p.coverFileGuid ? [{ guid: p.coverFileGuid, name: p.name }] : []) : []; }
  function photo(p, panel) {
    var list = files(p), i = panel ? galleryIndex : photoIndexes[p.guid] || 0;
    i = Math.max(0, Math.min(i, list.length - 1));
    return '<div class="cat-img' + (list.length > 1 ? " has-gallery" : "") + '" data-gallery="' + esc(p.guid) + '">' +
      (list.length ? '<img src="' + esc(imageUrl(p, list[i], panel ? "" : "list")) + '" data-action="light" data-guid="' + esc(p.guid) + '" data-index="' + i + '" alt="' + esc(p.name + " · " + (list[i].name || "Фото " + (i + 1))) + '" loading="lazy" decoding="async">' +
        '<button type="button" class="cat-zoom" data-action="light" data-guid="' + esc(p.guid) + '" data-index="' + i + '" aria-label="Увеличить фото ' + esc(p.name) + '">' + icon("zoom-in") + "</button>" +
        (list.length > 1 ? '<button type="button" class="cat-arr prev" data-action="photo" data-dir="-1" data-guid="' + esc(p.guid) + '" aria-label="Предыдущее фото">' + icon("chevron-left") + '</button><button type="button" class="cat-arr next" data-action="photo" data-dir="1" data-guid="' + esc(p.guid) + '" aria-label="Следующее фото">' + icon("chevron-right") + '</button><div class="cat-dots" aria-hidden="true">' +
          list.slice(0, 8).map(function (_, k) { return '<i class="' + (i === k ? "on" : "") + '"></i>'; }).join("") + "</div>" : "") : "") +
      '<span class="cat-img-missing"' + (list.length ? " hidden" : "") + ">" + (p.imagePathCount || (p.files || []).length ? "Фото пока недоступно" : "Фото не передано") + "</span></div>";
  }
  function badges(p) {
    var f = p.flags || {};
    return '<div class="cat-badges">' + (f.new ? '<span class="cat-badge new">NEW</span>' : "") +
      (f.sale ? '<span class="cat-badge sale">Акция</span>' : "") + (f.hit ? '<span class="cat-badge">Хит</span>' : "") + "</div>";
  }
  function quality(p) {
    var c = commerce(p), conflict = c.prices.concat(c.warehouses).some(function (v) { return v.conflict; });
    return (window.OnecQuality ? window.OnecQuality.render(p._onecQuality) : "") +
      (conflict ? '<div class="ic-conflict" role="note">Проверить цены или остатки в 1С</div>' : "");
  }
  function cache(p) {
    productCache.set(p.guid, p);
    if (productCache.size > 200) productCache.delete(productCache.keys().next().value);
  }
  function sizes(p, panel) {
    var variants = p.variants || [];
    if (variants.length < 2) return "";
    return '<div class="cat-options ic-sizes" role="group" aria-label="Размер модели"><div class="row"><span>Размер, мм</span>' +
      variants.map(function (v) {
        return '<button type="button" class="cat-opt' + (v.guid === p.guid ? " active" : "") +
          '" data-action="' + (panel ? "detail-size" : "size") + '" data-guid="' + esc(v.guid) +
          '" data-family="' + esc(p.guid) + '" aria-pressed="' + (v.guid === p.guid) + '"' +
          (v.matchesFilters === false ? ' title="Этот размер не соответствует текущим фильтрам"' : "") + ">" +
          esc(v.size || prop(v, "Размер, мм")) + (v.matchesFilters === false ? " · вне фильтра" : "") + "</button>";
      }).join("") + "</div></div>";
  }
  function selectSize(guid, familyGuid) {
    if (!lastList) return;
    lastList.items = lastList.items.map(function (p) {
      if (p.guid !== familyGuid) return p;
      var variant = (p.variants || []).find(function (v) { return v.guid === guid; });
      return variant ? Object.assign({}, variant, { variants: p.variants, modelName: p.modelName }) : p;
    });
    $("results").innerHTML = renderResults(lastList); icons();
    var selected = document.querySelector('#ic-results [data-action="size"][data-guid="' + guid + '"]');
    if (selected) selected.focus();
  }
  function card(p) {
    cache(p);
    var name = '<div class="cat-name" title="' + esc(p.name) + '">' + esc(p.modelName || p.name) + '</div><div class="cat-color">' +
      esc([prop(p, "Цвет"), (p.sections || []).map(function (x) { return x.name; }).join(" · ")].filter(Boolean).join(" · ")) + "</div>";
    var specs = (p.properties || []).filter(function (x) { return ["Покрытие", "Размер, мм", "Вид двери"].includes(x.name.trim()); });
    return '<article class="cat-card" data-product="' + esc(p.guid) + '" tabindex="0" role="button" aria-label="Открыть карточку: ' + esc(p.name) + '">' +
      badges(p) + (s.view === "site" ? '<div class="cat-head">' + name + "</div>" : "") + photo(p, false) +
      '<div class="cat-body">' + (s.view === "site" ? "" : name) +
      (specs.length && s.view !== "site" ? '<div class="cat-meta">' + specs.slice(0, 3).map(function (x) { return "<span>" + esc(x.value) + "</span>"; }).join("") + "</div>" : "") +
      sizes(p, false) + quality(p) + priceHtml(p) + stockHtml(p, s.view === "site") + "</div>" +
      (s.view === "site" ? '<button type="button" class="cat-cta" data-product="' + esc(p.guid) + '">' + icon("arrow-up-right") + "Открыть карточку</button>" :
        (!s.client ? '<div class="cat-quick"><button type="button" data-action="reply" data-guid="' + esc(p.guid) + '">' + icon("copy") + "Ответ клиенту</button></div>" : "")) + "</article>";
  }
  function table(items) {
    return '<div class="card tablewrap"><table class="cat-table" role="table" aria-label="Товары каталога"><thead><tr><th></th><th>Модель</th><th class="cat-hide-m">Раздел</th><th class="cat-hide-m cat-hide-l">Размеры</th>' +
      (!s.client ? '<th class="num">Цена из 1С</th>' : "") + '<th>Наличие</th></tr></thead><tbody role="rowgroup">' +
      items.map(function (p) {
        cache(p); var list = files(p), v = price(p);
        return '<tr role="row" data-product="' + esc(p.guid) + '" tabindex="0"><td role="cell"><div class="cat-thumb">' +
          (list.length ? '<img src="' + esc(imageUrl(p, list[0], "small")) + '" alt="" loading="lazy" decoding="async">' : "") +
          '</div></td><td role="cell"><div class="cat-name">' + esc(p.modelName || p.name) + '</div><span class="small ic-product-code' + (p.article ? "" : " ic-source-guid") + '">' + esc(p.article || p.guid) + "</span>" + sizes(p, false) + quality(p) +
          '</td><td role="cell" class="cat-hide-m"><span class="small">' + esc((p.sections || []).map(function (x) { return x.name; }).join(", ")) +
          '</span></td><td role="cell" class="cat-hide-m cat-hide-l"><span class="small">' + esc(prop(p, "Размер, мм")) + "</span></td>" +
          (!s.client ? '<td role="cell" class="num ic-table-price"><strong>' + money(v ? v.value : null) + '</strong><span class="small">' + esc(v ? v.name : "") + "</span></td>" : "") +
          '<td role="cell" class="ic-table-stock">' + stockHtml(p, true) + "</td></tr>";
      }).join("") + "</tbody></table></div>";
  }
  function renderResults(data) {
    lastList = data;
    if (!data.items.length) return '<section class="card cat-empty"><h3>Ничего не найдено</h3><p>Проверьте написание модели или снимите часть фильтров.</p><button type="button" id="ic-empty-reset">Сбросить фильтры</button></section>';
    return s.view === "table" ? table(data.items) : '<div class="cat-grid view-' + s.view + '">' + data.items.map(card).join("") + "</div>";
  }
  function syncView() {
    document.querySelectorAll("[data-view]").forEach(function (b) { b.classList.toggle("active", b.dataset.view === s.view); b.setAttribute("aria-pressed", String(b.dataset.view === s.view)); });
    $("client-view").checked = s.client;
    document.body.classList.toggle("ic-client-mask", s.client);
    $("client-view").closest("label").classList.toggle("on", s.client);
  }
  function group(guid) { return (meta.groups || []).find(function (x) { return x.guid === guid; }); }
  function parentPath(guid) {
    var path = [], visited = new Set();
    while (guid && !visited.has(guid)) { visited.add(guid); var g = group(guid); if (!g) break; path.unshift(g); guid = g.parent; }
    return path;
  }
  function treeHtml(mobile) {
    var groups = meta.groups || [], current = group(navParent), path = parentPath(navParent);
    var list = groups.filter(function (g) { return (g.parent || "") === navParent && groupCounts[g.guid] > 0; });
    var row = function (g, name, n, active) {
      return '<button type="button" class="cat-nav-item' + (active ? " cur" : "") + '" data-group="' + esc(g) + '">' +
        icon("layers") + "<span>" + esc(name) + "</span><small>" + num(n) + "</small>" + icon("chevron-right") + "</button>";
    };
    return '<div class="cat-nav-box" aria-label="Разделы каталога"><div class="cat-nav-head">' +
      '<button type="button" class="cat-nav-back" data-action="nav-back" aria-label="Назад"' + (!navParent ? " disabled" : "") + ">" + icon("arrow-left") +
      '</button><div class="cat-nav-ttl"><small>' + esc(current ? (path.length > 1 ? path[path.length - 2].name : "Каталог") : "как в меню tandoor.ru") +
      '</small><b class="m">' + esc(current ? current.name : "Каталог") + "</b></div>" +
      (mobile ? '<button type="button" class="cat-nav-close" data-close="nav" aria-label="Закрыть разделы">' + icon("x") + "</button>" : "") +
      '</div><div class="cat-nav-cols"><div class="cat-nav-col c1" style="display:flex">' +
      row(navParent, navParent ? "Все товары" : "Все разделы", navParent ? groupCounts[navParent] || 0 : bridge.snapshot().summary.products, s.group === navParent) +
      list.map(function (g) { return row(g.guid, g.name, groupCounts[g.guid], s.group === g.guid); }).join("") +
      (!groups.length ? '<p class="cat-nav-hint">Группы 1С не переданы. Разделы доступны в фильтре.</p>' : "") + "</div></div></div>";
  }
  function renderTree() {
    $("tree").innerHTML = treeHtml(false); $("mobile-tree").innerHTML = treeHtml(true);
    var path = parentPath(s.group);
    $("path").innerHTML = '<button type="button" class="cat-crumb" data-group="">Все разделы</button>' +
      path.map(function (g) { return icon("chevron-right") + '<button type="button" class="cat-crumb" data-group="' + esc(g.guid) + '">' + esc(g.name) + "</button>"; }).join("");
    $("nav-open").querySelector("span").textContent = path.length ? path[path.length - 1].name : "Все разделы";
    icons();
  }
  function quick() {
    $("marks").innerHTML = [["hit", "Хит"], ["new", "Новинки"], ["sale", "Акции"], ["in", "В наличии"]].map(function (f) {
      var on = f[0] === "in" ? s.availability === "in" : s.flag === f[0];
      return '<button type="button" class="cat-check' + (on ? " on" : "") + '" aria-pressed="' + on + '" data-flag="' + f[0] +
        '"><span class="box">' + icon("check") + "</span>" + f[1] + "</button>";
    }).join("");
  }
  function filtersRead() {
    ["priceType", "min", "max", "availability", "sort"].forEach(function (key) { s[key] = $(key === "priceType" ? "price-type" : key).value; });
    if (!s.priceType) {
      s.min = ""; s.max = ""; $("min").value = ""; $("max").value = "";
      if (["asc", "desc"].includes(s.sort)) { s.sort = "name"; $("sort").value = "name"; }
    }
    $("min").disabled = $("max").disabled = !s.priceType;
    Array.from($("sort").options).forEach(function (o) { o.disabled = ["asc", "desc"].includes(o.value) && !s.priceType; });
    s.properties = {};
    document.querySelectorAll("[data-property]:checked").forEach(function (input) {
      (s.properties[input.dataset.property] || (s.properties[input.dataset.property] = [])).push(input.value);
    });
    quick(); icons();
  }
  function readUrl(params) {
    s.group = params.get("group") || ""; s.view = ["show", "site", "table"].includes(params.get("view")) ? params.get("view") : "show";
    s.client = params.get("client") === "1";
    ["priceType", "min", "max", "availability", "flag", "sort"].forEach(function (key) {
      s[key] = params.has(key) ? params.get(key) || "" : key === "priceType" ? defaultPriceType : key === "sort" ? "name" : "";
    });
    try { s.properties = JSON.parse(params.get("filters") || "{}"); } catch (_) { s.properties = {}; }
    if (!s.properties || typeof s.properties !== "object" || Array.isArray(s.properties)) s.properties = {};
    ["priceType", "min", "max", "availability", "sort"].forEach(function (key) { $(key === "priceType" ? "price-type" : key).value = s[key]; });
    document.querySelectorAll("[data-property]").forEach(function (input) {
      input.checked = Array.isArray(s.properties[input.dataset.property]) && s.properties[input.dataset.property].includes(input.value);
    });
    navParent = s.group; syncView(); renderTree(); filtersRead();
    if (lastList) $("results").innerHTML = renderResults(lastList);
    icons();
  }
  function appendParams(params) {
    ["group", "priceType", "min", "max", "availability", "flag", "sort"].forEach(function (key) { if (s[key] && !(key === "sort" && s[key] === "name")) params.set(key, s[key]); });
    if (Object.keys(s.properties).length) params.set("filters", JSON.stringify(s.properties));
    if (s.view !== "show") params.set("view", s.view);
    if (s.client) params.set("client", "1");
  }
  function extra() { return JSON.stringify([s.group, s.properties, s.priceType, s.min, s.max, s.availability, s.flag, s.sort]); }
  function reset() {
    Object.assign(s, { group: "", properties: {}, min: "", max: "", availability: "", flag: "", sort: "name" });
    var params = new URLSearchParams(); if (s.priceType) params.set("priceType", s.priceType);
    params.set("view", s.view); if (s.client) params.set("client", "1"); readUrl(params);
  }
  function date(value) { return value ? new Date(value).toLocaleString("ru-RU") : "Не передано"; }
  function detailsHtml(data) {
    detail = data; galleryIndex = 0;
    var p = Object.assign({}, data.product, { commerce: data.commerce, _onecQuality: data._onecQuality, variants: data.variants || [] });
    cache(p); detail.item = p;
    var technical = function (x) { return /^(Главная|СсылкаНаГлавную(?:NEW)?|Название для сайта|сайт Тандор|АкцияДействует(?:До|С)_.+)$/.test(x.name.trim()); };
    function fields(rows) { return rows.map(function (x) { return '<div class="field"><div class="small">' + esc(x.name) + "</div><div>" + esc(x.value.trim() || "Не указано в выгрузке") + "</div></div>"; }).join(""); }
    var c = commerce(p);
    return '<div class="cat-panel-head"><div><div class="cat-crumbs">' + esc(p.guid) + '</div><h2 id="ic-detail-title">' + esc(p.name) +
      '</h2><div class="sub">' + esc([prop(p, "Цвет"), prop(p, "Размер, мм"), prop(p, "Бренд")].filter(Boolean).join(" / ")) + "</div></div></div>" +
      '<div class="cat-panel-body"><div class="cat-gallery" id="ic-product-gallery">' + galleryHtml(p) + '</div><div class="cat-info">' + sizes(p, true) + quality(p) +
      (!s.client ? '<div><div class="cat-h3row"><span class="small">Цены из 1С</span></div><div class="cat-pricebox">' + (c.prices.length ? c.prices.map(function (v) {
        return '<div class="tile"><div class="small">' + esc(v.name) + '</div><span class="cat-price' + (v.conflict ? " ic-conflict" : "") + '">' + (v.conflict ? "Проверить" : money(v.value)) + "</span></div>";
      }).join("") : '<div class="tile">Цены не переданы</div>') + '</div><p class="small">Загрузка: ' + esc(date(c.pricesImportedAt)) + "</p></div>" : "") +
      '<div><div class="cat-h3row"><h3>Остатки по складам</h3></div>' + (s.client ? stockHtml(p, true) :
        '<div class="cat-stocktable">' + (c.warehouses.length ? c.warehouses.map(function (w) { return '<div class="item"><span>' + esc(w.name) + '</span><b class="' + (w.conflict ? "ic-conflict" : "") + '">' + (w.conflict ? "Проверить" : num(w.value)) + "</b></div>"; }).join("") : '<div class="item">Остатки не переданы</div>') +
        '</div><p class="small">Загрузка: ' + esc(date(c.stocksImportedAt)) + ". Свободный остаток и единица измерения не подтверждены.</p>") + "</div>" +
      '<div><div class="cat-h3row"><h3>Характеристики</h3></div><div class="cat-specs">' + fields(p.properties.filter(function (x) { return !technical(x); })) + "</div></div>" +
      '<div class="cat-actions"><button type="button" class="primary" data-action="reply" data-guid="' + esc(p.guid) + '">' + icon("copy") +
      'Ответ клиенту</button></div><p class="cat-copy-hint">Копирование вручную. Сообщения клиентам не отправляются.</p>' +
      '<p class="small">Размеры сгруппированы только при совпадении связи модели, исполнения и цены. Аналоги и совместимость не определяются по названию.</p></div></div>' +
      '<details class="ic-raw"><summary>Источник и служебные поля 1С</summary><div class="cat-specs">' + fields(p.properties.filter(technical)) + "</div>" +
      (!s.client ? (data.sourceValues || []).map(function (x) { return "<pre>" + esc(JSON.stringify(x.record, null, 2)) + "</pre>"; }).join("") : "") +
      '<p>Источник: ' + esc(bridge.snapshot().sourceName) + " · загружен " + esc(date(data.importedAt)) + "</p></details>";
  }
  function galleryHtml(p) {
    var list = files(p);
    return photo(p, true) + (list.length > 1 ? '<div class="cat-thumbs" aria-label="Фото товара">' +
      list.map(function (f, i) { return '<button type="button" class="' + (galleryIndex === i ? "active" : "") + '" data-action="thumb" data-index="' + i +
        '" aria-label="Фото ' + (i + 1) + '" aria-pressed="' + (galleryIndex === i) + '"><img src="' + esc(imageUrl(p, f, "small")) + '" alt="" loading="lazy"></button>'; }).join("") + "</div>" : "") +
      '<small>Нажмите на фото, чтобы увеличить' + (list.length ? " · " + list.length + " фото" : "") + "</small>";
  }
  function renderLight() {
    if (!light) return;
    var p = light.product, list = files(p), f = list[light.index];
    if (!f) return;
    $("light").innerHTML = '<button type="button" class="cat-light-close" data-close="light" aria-label="Закрыть фото">' + icon("x") + "</button>" +
      (list.length > 1 ? '<button type="button" class="cat-arr prev" data-action="light-step" data-dir="-1" aria-label="Предыдущее фото">' + icon("chevron-left") + '</button><button type="button" class="cat-arr next" data-action="light-step" data-dir="1" aria-label="Следующее фото">' + icon("chevron-right") + "</button>" : "") +
      '<figure class="cat-light-fig' + (light.big ? " big" : "") + '" data-action="light-zoom"><img src="' + esc(imageUrl(p, f)) + '" alt="' + esc(p.name) +
      '"></figure><div class="cat-light-cap"><b>' + esc(p.name) + "</b><span>" + esc(f.name) + '</span><span class="cat-light-n">' + (light.index + 1) + " / " + list.length +
      "</span><small>Нажмите на фото, чтобы приблизить · Esc — закрыть</small></div>";
    icons();
  }
  function showCopy(p) {
    var c = commerce(p), v = price(p);
    var lines = [p.name, p.article ? "Артикул: " + p.article : ""];
    (p.properties || []).forEach(function (x) {
      // Allowlist shared descriptive facets only; no private source/price/stock properties in a reply.
      if ((meta.facets || []).some(function (f) { return f.name === x.name.trim(); })) lines.push(x.name + ": " + x.value);
    });
    if (!s.client && v && v.value != null) lines.push(v.name + ": " + money(v.value) + " (не персональный расчёт; загрузка " + date(c.pricesImportedAt) + ")");
    lines.push((c.quantity == null ? "Остаток не определён." : c.quantity > 0 ? "Есть остаток в 1С. Возможность отгрузки уточняйте." : "В выгрузке нулевой остаток.") +
      (c.stocksImportedAt ? " Загрузка остатков: " + date(c.stocksImportedAt) + "." : ""));
    lines.push("Загрузка каталога: " + date(bridge.snapshot().importedAt) + ".");
    $("copy-text").value = lines.filter(Boolean).join("\n"); $("copy-status").textContent = "Выделите текст и скопируйте. Ничего не отправляется автоматически.";
    $("copy").showModal(); $("copy-text").select();
  }
  function bind(config) {
    bridge = config;
    document.addEventListener("click", async function (event) {
      var button = event.target.closest("[data-action],[data-close],[data-view],[data-group],[data-flag]");
      if (!button) return;
      if (button.closest(".internal-catalog-page") == null) return;
      event.preventDefault(); event.stopPropagation();
      if (button.dataset.close) { $(button.dataset.close).close(); return; }
      if (button.dataset.view) { s.view = button.dataset.view; syncView(); if (lastList) $("results").innerHTML = renderResults(lastList); icons(); bridge.updateUrl(); return; }
      if (button.hasAttribute("data-group")) {
        s.group = button.dataset.group; navParent = s.group;
        var hasChildren = (meta.groups || []).some(function (g) { return g.parent === navParent && groupCounts[g.guid] > 0; });
        if (!hasChildren && s.group) navParent = (group(s.group) || {}).parent || "";
        renderTree(); if ($("nav").open && !hasChildren) $("nav").close(); bridge.changed(); return;
      }
      if (button.dataset.flag) {
        if (button.dataset.flag === "in") s.availability = s.availability === "in" ? "" : "in";
        else s.flag = s.flag === button.dataset.flag ? "" : button.dataset.flag;
        $("availability").value = s.availability; quick(); icons(); bridge.changed(); return;
      }
      var action = button.dataset.action, p = productCache.get(button.dataset.guid);
      if (action === "size") { selectSize(button.dataset.guid, button.dataset.family); return; }
      if (action === "detail-size") { bridge.openProduct(button.dataset.guid, "replace"); return; }
      if (action === "nav-back") { navParent = (group(navParent) || {}).parent || ""; renderTree(); return; }
      if (action === "photo" && p) {
        var inPanel = !!button.closest("#ic-detail"), list = files(p), current = inPanel ? galleryIndex : photoIndexes[p.guid] || 0;
        current = (current + Number(button.dataset.dir) + list.length) % list.length;
        if (inPanel) { galleryIndex = current; $("product-gallery").innerHTML = galleryHtml(p); }
        else { photoIndexes[p.guid] = current; button.closest("[data-gallery]").outerHTML = photo(p, false); }
        icons(); return;
      }
      if (action === "thumb" && detail) { galleryIndex = Number(button.dataset.index); $("product-gallery").innerHTML = galleryHtml(detail.item); icons(); return; }
      if (action === "light" && p) {
        light = { product: p, index: Number(button.dataset.index), big: false };
        renderLight(); $("light").showModal(); return;
      }
      if (action === "light-step" && light) { light.index = (light.index + Number(button.dataset.dir) + files(light.product).length) % files(light.product).length; light.big = false; renderLight(); return; }
      if (action === "light-zoom" && light) { light.big = !light.big; renderLight(); return; }
      if (action === "reply" && p) {
        button.disabled = true;
        try {
          if (!p.chapter) {
            var data = await bridge.request("/products/" + encodeURIComponent(p.guid) + "?version=" + encodeURIComponent(bridge.snapshot().id));
            p = Object.assign({}, data.product, { commerce: data.commerce }); cache(p);
          }
          showCopy(p);
        } catch (_) { $("copy-text").value = "Не удалось подготовить ответ. Откройте карточку и повторите попытку."; $("copy").showModal(); }
        finally { button.disabled = false; }
      }
    }, true);
    document.addEventListener("error", function (event) {
      var image = event.target;
      if (!(image instanceof HTMLImageElement)) return;
      var thumb = image.closest(".cat-thumb");
      if (thumb) {
        image.hidden = true; thumb.classList.add("ic-photo-unavailable");
        thumb.setAttribute("aria-label", "Фото пока недоступно"); thumb.setAttribute("role", "img");
      }
      var box = image.closest(".cat-img");
      if (box) { image.hidden = true; var msg = box.querySelector(".cat-img-missing"); if (msg) msg.hidden = false; }
      if (image.closest("#ic-light")) { image.alt = "Фото пока недоступно"; }
    }, true);
    $("filter-open").onclick = function () { $("filters").showModal(); $("filter-open").setAttribute("aria-expanded", "true"); };
    $("filters").addEventListener("close", function () { $("filter-open").setAttribute("aria-expanded", "false"); });
    $("nav-open").onclick = function () { $("nav").showModal(); $("nav-open").setAttribute("aria-expanded", "true"); };
    $("nav").addEventListener("close", function () { $("nav-open").setAttribute("aria-expanded", "false"); });
    $("filters").addEventListener("change", function (event) {
      if (["ic-section", "ic-brand"].includes(event.target.id)) return;
      filtersRead(); bridge.changed();
    });
    $("filters").addEventListener("input", function (event) {
      if (!["ic-min", "ic-max"].includes(event.target.id)) return;
      clearTimeout(filterTimer); filterTimer = setTimeout(function () { filtersRead(); bridge.changed(); }, 300);
    });
    $("filter-reset").onclick = function () { bridge.reset(); };
    $("client-view").onchange = function () {
      s.client = this.checked; syncView(); if (lastList) $("results").innerHTML = renderResults(lastList);
      if (detail && $("detail").open) $("detail-body").innerHTML = detailsHtml(detail);
      icons(); bridge.updateUrl();
    };
    $("full").onclick = function () {
      var full = document.body.classList.toggle("cat-fullscreen"); document.querySelector("#catalog-root>.cat").classList.toggle("cat-full", full);
      this.querySelector("span").textContent = full ? "Выйти" : "На весь экран";
    };
    $("copy-button").onclick = async function () {
      try { await navigator.clipboard.writeText($("copy-text").value); $("copy-status").textContent = "Текст скопирован."; }
      catch (_) { $("copy-text").focus(); $("copy-text").select(); $("copy-status").textContent = "Скопируйте выделенный текст вручную."; }
    };
    document.addEventListener("keydown", function (event) {
      if ($("light").open && ["ArrowLeft", "ArrowRight"].includes(event.key) && light) {
        event.preventDefault(); light.index = (light.index + (event.key === "ArrowLeft" ? -1 : 1) + files(light.product).length) % files(light.product).length; renderLight();
      }
      if (event.key === "Escape" && !document.querySelector("dialog[open]")) {
        document.body.classList.remove("cat-fullscreen"); document.querySelector("#catalog-root>.cat").classList.remove("cat-full"); $("full").querySelector("span").textContent = "На весь экран";
      }
      if (["Enter", " "].includes(event.key) && event.target.matches("[data-product]")) {
        event.preventDefault(); bridge.openProduct(event.target.dataset.product, true);
      }
    });
  }
  function setup(data) {
    meta = data; photoConfigured = data.imagesConfigured === true;
    (meta.groupCounts || []).forEach(function (x) {
      parentPath(x.guid).forEach(function (g) { groupCounts[g.guid] = (groupCounts[g.guid] || 0) + Number(x.count); });
    });
    $("price-type").innerHTML = '<option value="">Выберите тип цены</option>' + (meta.priceTypes || []).map(function (t) { return '<option value="' + esc(t.guid) + '">' + esc(t.name) + "</option>"; }).join("");
    var retail = (meta.priceTypes || []).find(function (x) { return x.name === "РРЦ Тандор"; });
    defaultPriceType = s.priceType = retail ? retail.guid : "";
    $("facets").innerHTML = (meta.facets || []).map(function (f) {
      return '<details class="cat-fg" open><summary>' + esc(f.name) + '</summary><div class="cat-fg-body">' +
        f.values.map(function (v) { return '<label class="cat-check ic-facet-check"><input class="ic-facet-input" type="checkbox" data-property="' + esc(f.name) + '" value="' + esc(v) + '"><span class="box">' + icon("check") + '</span><span class="lbl">' + esc(v) + "</span></label>"; }).join("") + "</div></details>";
    }).join("");
    document.querySelectorAll("#ic-filters .cat-fg summary").forEach(function (summary) { summary.insertAdjacentHTML("beforeend", icon("chevron-down")); });
    icons();
  }
  window.CatalogWorkspace = { bind: bind, setup: setup, extra: extra, appendParams: appendParams, readUrl: readUrl, reset: reset,
    results: renderResults, detail: detailsHtml, afterRender: function () { quick(); syncView(); icons(); },
    active: function () { return !!(s.group || Object.keys(s.properties).length || s.min || s.max || s.availability || s.flag || s.sort !== "name"); } };
})();
