(function () {
  "use strict";
  var api = window.TandoorRf, shell = window.ClientsShell;
  var byId = function (id) { return document.getElementById("ic-" + id); };
  var el = {}, snapshot = null, currentPage = 1, listSequence = 0, detailSequence = 0, timer;
  var guidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  ["state", "app", "source-label", "search-form", "query", "section", "brand", "count", "reset",
    "results", "pagination", "prev", "next", "page-label", "detail", "detail-body", "close"].forEach(function (id) { el[id] = byId(id); });
  var esc = shell.escapeHtml;
  var number = function (value) { return Number(value).toLocaleString("ru-RU"); };
  function filters() {
    return { q: el.query.value.trim(), section: el.section.value, brand: el.brand.value, page: currentPage };
  }
  function filterKey() { return JSON.stringify(filters()); }
  function paramsWithFilters() {
    var p = new URLSearchParams(), f = filters();
    if (f.q) p.set("q", f.q);
    if (f.section) p.set("section", f.section);
    if (f.brand) p.set("brand", f.brand);
    if (f.page > 1) p.set("page", String(f.page));
    return p;
  }
  function url(p) { return "/internal-catalog" + (p.toString() ? "?" + p.toString() : ""); }
  function updateUrl(preserveProduct) {
    var p = paramsWithFilters(), product = new URLSearchParams(location.search).get("product");
    if (preserveProduct !== false && product) p.set("product", product);
    history.replaceState(preserveProduct !== false ? history.state : null, "", url(p));
  }
  function actionButton(id, label) { return '<button type="button" class="ic-button" id="' + id + '">' + label + "</button>"; }
  function state(title, text, retry) {
    el.app.hidden = true; el.state.hidden = false;
    el.state.innerHTML = "<h2>" + esc(title) + "</h2><p>" + esc(text) + "</p>" +
      (retry ? actionButton("ic-retry-boot", "Повторить загрузку") : "");
    if (retry) byId("retry-boot").onclick = boot;
  }
  async function request(path) {
    var result;
    try { result = await api.apiRequest("/api/internal-catalog" + path); }
    catch (error) { throw new Error(api.mapRequestError(error, api.REQUEST_TIMEOUT_MS / 1000)); }
    if (result.response.status === 401) { window.location.replace("/login"); throw new Error("Требуется вход в личный кабинет."); }
    if (result.response.status === 403) throw new Error("Нет доступа. Каталог доступен сотрудникам с правами просмотра раздела «Клиенты».");
    if (!result.response.ok) throw new Error(api.extractErrorMessage(result.data, "Не удалось загрузить данные. Попробуйте ещё раз."));
    return result.data;
  }
  function tags(items) { return '<div class="ic-sections">' + items.map(function (x) { return '<span class="ic-tag">' + esc(x.name) + "</span>"; }).join("") + "</div>"; }
  function productUrl(guid) { var p = paramsWithFilters(); p.set("product", guid); return url(p); }
  var imagesConfigured = false;
  function imageUrl(guid, fileGuid) {
    return "/api/internal-catalog/products/" + encodeURIComponent(guid) + "/images/" +
      encodeURIComponent(fileGuid) + "?version=" + encodeURIComponent(snapshot.id);
  }
  function photo(guid, file, title, cover) {
    var src = imageUrl(guid, file.guid);
    return '<div class="ic-photo' + (cover ? " ic-cover" : "") + '"><a href="' + esc(src) +
      '" target="_blank" rel="noopener noreferrer" aria-label="Открыть фотографию: ' + esc(title) + '">' +
      '<img src="' + esc(src) + '" alt="' + esc(title) + '" loading="lazy" decoding="async"></a>' +
      '<p class="ic-image-error" role="status" hidden>Фото недоступно. Попробуйте открыть карточку позднее.</p></div>';
  }
  function bindImageErrors(container) {
    container.querySelectorAll(".ic-photo img").forEach(function (image) {
      image.addEventListener("error", function () {
        var box = image.closest(".ic-photo");
        box.querySelector("a").hidden = true;
        box.querySelector(".ic-image-error").hidden = false;
      }, { once: true });
    });
  }
  function renderCard(item) {
    return '<article class="ic-card">' +
      (imagesConfigured && item.coverFileGuid ? photo(item.guid, { guid: item.coverFileGuid }, item.name, true) : "") +
      '<div class="ic-card-head"><span class="ic-brand">' +
      esc(item.brand || "Бренд не указан") + '</span><span class="ic-photo-note">' +
      (item.imagePathCount ? (imagesConfigured ? "Фото из 1С" : "Фото ещё не подключены") : "Без фото в выгрузке") + "</span></div><h2>" +
      '<a data-product="' + esc(item.guid) + '" href="' + esc(productUrl(item.guid)) + '">' + esc(item.name) + "</a></h2>" +
      '<div class="ic-card-body"><p class="ic-card-meta">' + (item.article ? "Артикул: " + esc(item.article) : "Артикул не указан") +
      "</p>" + tags(item.sections) + '</div><a class="ic-card-footer" data-product="' + esc(item.guid) +
      '" href="' + esc(productUrl(item.guid)) + '" aria-label="Открыть карточку: ' + esc(item.name) +
      '">Открыть карточку <span aria-hidden="true">↗</span></a></article>';
  }
  function listFailure(message) {
    el.results.innerHTML = '<div class="ic-empty"><h2>Не удалось выполнить поиск</h2><p>' + esc(message) +
      "</p>" + actionButton("ic-retry-list", "Повторить") + "</div>";
    byId("retry-list").onclick = function () { loadList(false); };
    el.count.textContent = "Данные не загружены"; el.pagination.hidden = true;
  }
  async function loadList(scroll) {
    if (!snapshot) return;
    var sequence = ++listSequence, key = filterKey(), f = filters();
    el.results.setAttribute("aria-busy", "true"); el.results.inert = true;
    el.count.textContent = "Ищем товары…";
    el.reset.hidden = !f.q && !f.section && !f.brand;
    try {
      var p = paramsWithFilters(); p.set("version", snapshot.id);
      var data = await request("/products?" + p.toString());
      if (sequence !== listSequence || key !== filterKey()) return;
      currentPage = data.page; updateUrl();
      el.count.textContent = "Найдено: " + number(data.total) + " из " + number(snapshot.summary.products);
      el.results.innerHTML = data.items.length ? data.items.map(renderCard).join("") :
        '<div class="ic-empty"><h2>Ничего не найдено</h2><p>Попробуйте другое название, артикул или сбросьте фильтры.</p>' +
        actionButton("ic-empty-reset", "Показать все товары") + "</div>";
      bindImageErrors(el.results);
      if (byId("empty-reset")) byId("empty-reset").onclick = reset;
      el.pagination.hidden = data.total <= data.pageSize;
      el.prev.disabled = data.page <= 1; el.next.disabled = data.page * data.pageSize >= data.total;
      el["page-label"].textContent = "Страница " + data.page + " из " + Math.max(1, Math.ceil(data.total / data.pageSize));
      if (scroll) el.count.scrollIntoView({ block: "start", behavior: "auto" });
    } catch (error) {
      if (sequence === listSequence && key === filterKey()) listFailure(error.message || "Проверьте соединение и повторите попытку.");
    } finally {
      if (sequence === listSequence) { el.results.setAttribute("aria-busy", "false"); el.results.inert = false; }
    }
  }
  function readUrl() {
    var p = new URLSearchParams(location.search);
    el.query.value = (p.get("q") || "").slice(0, 160);
    el.section.value = p.get("section") || ""; el.brand.value = p.get("brand") || "";
    currentPage = /^[1-9]\d{0,6}$/.test(p.get("page") || "") ? Number(p.get("page")) : 1;
  }
  function changed() { clearTimeout(timer); currentPage = 1; updateUrl(); loadList(false); }
  function reset() { el.query.value = ""; el.section.value = ""; el.brand.value = ""; changed(); el.query.focus(); }
  function property(product, name) {
    var found = product.properties.find(function (x) { return x.name.trim() === name; });
    return found && found.value.trim() ? found.value.trim() : "";
  }
  function renderDetail(data) {
    var p = data.product;
    function technical(x) { return /^(Главная|СсылкаНаГлавную(?:NEW)?|Название для сайта|сайт Тандор|АкцияДействует(?:До|С)_.+)$/.test(x.name.trim()); }
    function row(x) {
      return '<div class="ic-property"><dt>' + esc(x.name) + "</dt><dd>" + esc(x.value.trim() ? x.value : "Не указано в выгрузке") + "</dd></div>";
    }
    var rows = p.properties.filter(function (x) { return !technical(x); }).map(row).join("");
    var technicalRows = p.properties.filter(technical);
    return '<h2 id="ic-detail-title" tabindex="-1">' + esc(p.name) + "</h2>" +
      '<p class="ic-card-meta">' + esc([property(p, "Бренд"), property(p, "Артикул") ? "Артикул: " + property(p, "Артикул") : ""].filter(Boolean).join(" · ") || "Артикул и бренд не указаны") + "</p>" +
      tags(p.chapter) + '<h3>Фотографии</h3>' +
      (imagesConfigured && p.files.length ? '<p class="ic-card-meta">Нажмите на фотографию, чтобы открыть крупнее.</p><div class="ic-gallery">' +
        p.files.map(function (file) { return photo(p.guid, file, file.name || p.name, false); }).join("") + "</div>" :
        '<p class="ic-notice">' + (p.files.length ? "В 1С указано файлов изображений: " + p.files.length + ". Сами фотографии не входят в JSON. Они появятся после подключения папки с изображениями." :
          "В этой выгрузке у товара не указаны файлы изображений.") + "</p>") +
      '<h3>Характеристики из 1С</h3><p class="ic-card-meta">Справочные данные: цены, остатки и даты ожидания могли измениться. Актуальные значения уточняйте в 1С.</p>' +
      (rows ? '<dl class="ic-properties">' + rows + "</dl>" : '<p class="ic-card-meta">Характеристики не указаны.</p>') +
      (technicalRows.length ? '<details><summary>Служебные поля 1С (' + technicalRows.length + ')</summary><dl class="ic-properties">' + technicalRows.map(row).join("") + "</dl></details>" : "") +
      (p.files.length ? '<details><summary>Файлы изображений из 1С (' + p.files.length + ")</summary>" +
        p.files.map(function (file) { return '<p class="ic-file">' + esc(file.name) + ' <span class="ic-photo-note">· ' +
          (imagesConfigured ? "доступность проверяется при загрузке фото" : "не подключён") + "</span></p>"; }).join("") + "</details>" : "") +
      (p.properties.some(function (x) { return x.value.length === 1024; }) ?
        '<p class="ic-card-meta">В выгрузке есть текст длиной 1024 символа. Его полноту необходимо проверить в 1С; каталог показывает полученное значение без дополнений.</p>' : "") +
      '<p class="ic-provenance">GUID: ' + esc(p.guid) + "<br>Источник: " + esc(snapshot.sourceName) + " · загружен " +
      esc(new Date(data.importedAt).toLocaleString("ru-RU")) + "</p>";
  }
  async function openProduct(guid, push) {
    clearTimeout(timer);
    if (push) { var p = paramsWithFilters(); p.set("product", guid); history.pushState({ icModal: true }, "", url(p)); }
    var sequence = ++detailSequence;
    el["detail-body"].innerHTML = '<h2 id="ic-detail-title">Загружаем карточку…</h2>';
    if (!el.detail.open) el.detail.showModal();
    el.detail.scrollTop = 0;
    try {
      if (!guidPattern.test(guid)) throw new Error("Некорректная ссылка на товар.");
      var data = await request("/products/" + encodeURIComponent(guid) + "?version=" + encodeURIComponent(snapshot.id));
      if (sequence !== detailSequence || !el.detail.open) return;
      el["detail-body"].innerHTML = renderDetail(data);
      bindImageErrors(el["detail-body"]);
    } catch (error) {
      if (sequence !== detailSequence || !el.detail.open) return;
      el["detail-body"].innerHTML = '<h2 id="ic-detail-title">Карточка недоступна</h2><p>' + esc(error.message) + "</p>" +
        actionButton("ic-retry-detail", "Повторить");
      byId("retry-detail").onclick = function () { openProduct(guid, false); };
    }
  }
  function closeDetail() {
    detailSequence++;
    el.detail.close();
    if (history.state && history.state.icModal) history.back();
    else updateUrl(false);
  }
  async function boot() {
    state("Загружаем каталог…", "Получаем внутренний справочник из 1С.");
    try {
      var data = await request("/meta");
      snapshot = data.snapshot;
      imagesConfigured = data.imagesConfigured === true;
      byId("photo-status").textContent = imagesConfigured ? "Источник фотографий задан; доступность каждого файла проверяется при загрузке." : "Изображения ещё не подключены.";
      if (!snapshot) { state("Каталог ещё не загружен", "Данные появятся после загрузки проверенного products.json администратором.", false); return; }
      el.section.innerHTML = '<option value="">Все разделы</option>' + snapshot.summary.sections.map(function (s) {
        return '<option value="' + esc(s.guid) + '">' + esc(s.name) + "</option>";
      }).join("");
      el.brand.innerHTML = '<option value="">Все бренды</option>' + snapshot.summary.brands.map(function (b) {
        return '<option value="' + esc(b) + '">' + esc(b) + "</option>";
      }).join("");
      el["source-label"].textContent = number(snapshot.summary.products) + " товаров · " + number(snapshot.summary.sections.length) +
        " разделов · загрузка " + new Date(snapshot.importedAt).toLocaleDateString("ru-RU");
      readUrl(); el.state.hidden = true; el.app.hidden = false;
      // A deep-linked detail keeps its URL while the initial list loads.
      var product = new URLSearchParams(location.search).get("product");
      await loadList(false);
      if (product) openProduct(product, false);
    } catch (error) { state("Каталог недоступен", error.message || "Проверьте соединение и попробуйте снова.", true); }
  }
  el["search-form"].addEventListener("submit", function (event) { event.preventDefault(); changed(); });
  el.query.addEventListener("input", function () { clearTimeout(timer); timer = setTimeout(changed, 320); });
  el.section.addEventListener("change", changed); el.brand.addEventListener("change", changed);
  el.reset.onclick = reset;
  el.prev.onclick = function () { currentPage--; updateUrl(); loadList(true); };
  el.next.onclick = function () { currentPage++; updateUrl(); loadList(true); };
  el.results.addEventListener("click", function (event) {
    var link = event.target.closest("a[data-product]");
    if (!link || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault(); openProduct(link.dataset.product, true);
  });
  el.close.onclick = closeDetail;
  el.detail.addEventListener("cancel", function (event) { event.preventDefault(); closeDetail(); });
  window.addEventListener("popstate", function () {
    if (!snapshot) return;
    clearTimeout(timer);
    var oldKey = filterKey(); readUrl();
    var product = new URLSearchParams(location.search).get("product");
    if (product) openProduct(product, false);
    else { detailSequence++; if (el.detail.open) el.detail.close(); }
    if (oldKey !== filterKey()) loadList(false);
  });
  shell.mountAuthenticatedShell("internal-catalog", function (user, reason) {
    if (!user || reason) {
      state("Каталог недоступен", "Войдите в личный кабинет сотрудника. Если ошибка повторяется, проверьте соединение или обратитесь к администратору.", false);
      return;
    }
    boot();
  });
})();
