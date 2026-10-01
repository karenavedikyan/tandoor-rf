import type { CatalogImportProfile, CatalogRelativeFile } from "./constants";
import {
  CATALOG_FILE_ROOTS,
  DEFAULT_CATALOG_IMPORT_PROFILE,
  getCatalogFilesForProfile,
  ROOT_PARENT_CODES,
} from "./constants";
import { parseXmlBufferSafely, ensureNonEmptyFile } from "./safe-xml";
import { buildManifest, buildFileEntries } from "./manifest";
import { readXmlScalar } from "./xml-field";
import { XmlStructureGuard, assertDirectParent } from "./xml-structure-guard";
import type {
  CatalogFileEntry,
  ParsedCatalogGroup,
  ParsedCatalogSection,
  ParsedCatalogStorage,
  ParsedCatalogPriceType,
  ParsedCatalogProduct,
  ParsedCatalogPrice,
  ParsedCatalogStockLine,
  ParsedCatalogStockExpectedLine,
  ParsedCatalogSet,
  SchemaDriftWarning,
  ValidationIssue,
} from "./types";

const KNOWN_ATTRIBUTES: Partial<Record<CatalogRelativeFile, Record<string, Set<string>>>> = {
  "catalog/groups/data.xml": { Группа: new Set(["Код", "Родитель"]) },
  "catalog/section/data.xml": { Раздел: new Set(["Код", "Название", "КодРодителя"]) },
  "catalog/storage/data.xml": { Склад: new Set(["Код", "Название", "Адрес", "Email", "Телефон"]) },
  "catalog/types_prices/data.xml": { ТипЦены: new Set(["КодЦены", "Название"]) },
  "catalog/products/data.xml": {
    Товар: new Set(["Код", "Группа", "Активность", "Название"]),
    Свойство: new Set(["Код", "Название", "Значение"]),
    Раздел: new Set(["Код"]),
  },
  "catalog/prices/data.xml": { ЦенаТовара: new Set(["КодЦены", "КодТовара", "Цена"]) },
  "catalog/stock/data.xml": {
    Остаток: new Set(["Код"]),
    Склад: new Set(["СкладID", "Количество"]),
  },
  "catalog/stock_expected/data.xml": {
    Остаток: new Set(["Код"]),
    Склад: new Set(["СкладID", "Количество", "ОжидаемаяДата", "Доступно"]),
  },
};

function normalizeParentCode(raw: string | undefined): string | null {
  if (raw === undefined) {
    return null;
  }
  const trimmed = raw.trim();
  if (ROOT_PARENT_CODES.has(trimmed)) {
    return null;
  }
  return trimmed;
}

function trackUnknownAttributes(
  warnings: SchemaDriftWarning[],
  file: CatalogRelativeFile,
  element: string,
  attrs: Record<string, string>,
): void {
  const known = KNOWN_ATTRIBUTES[file]?.[element];
  if (!known) return;
  for (const key of Object.keys(attrs)) {
    if (!known.has(key)) {
      warnings.push({
        code: "SCHEMA_DRIFT",
        message: `Unknown attribute ${key} on <${element}>; not mapped automatically.`,
        file,
        element: `${element}@${key}`,
      });
    }
  }
}

async function parseGroups(bytes: Buffer, warnings: SchemaDriftWarning[]): Promise<{
  rows: ParsedCatalogGroup[];
  issue?: ValidationIssue;
}> {
  const rows: ParsedCatalogGroup[] = [];
  const seen = new Set<string>();
  const guard = new XmlStructureGuard("catalog/groups/data.xml", "Группы", warnings);
  let current: ParsedCatalogGroup | null = null;
  const parsed = await parseXmlBufferSafely(
    { bytes, file: "catalog/groups/data.xml", expectedRoot: CATALOG_FILE_ROOTS["catalog/groups/data.xml"] },
    {
      onOpenTag: (name, attrs) => {
        if (guard.enterOpenTag(name) === "skip") return;
        const parent = guard.parentName();
        if (name === "Группа") {
          assertDirectParent(parent, ["Группы"], "nested_group");
          trackUnknownAttributes(warnings, "catalog/groups/data.xml", name, attrs);
        const code = attrs["Код"]?.trim();
        if (!code) {
          throw new Error("INVALID_RECORD:group:missing_code");
        }
        if (seen.has(code)) {
          throw new Error(`DUPLICATE_KEY:group:${code}`);
        }
        seen.add(code);
          current = {
            code,
            parentCode: normalizeParentCode(attrs["Родитель"]),
          };
        }
        guard.pushHandledOpenTag(name);
      },
      onCloseTag: (name) => {
        if (!guard.leaveCloseTag(name)) return;
        if (name === "Группа" && current) {
          rows.push(current);
          current = null;
        }
      },
    },
  );
  if (parsed.issue) return { rows, issue: parsed.issue };
  return { rows };
}

async function parseSections(bytes: Buffer, warnings: SchemaDriftWarning[]): Promise<{
  rows: ParsedCatalogSection[];
  issue?: ValidationIssue;
}> {
  const rows: ParsedCatalogSection[] = [];
  const seen = new Set<string>();
  const guard = new XmlStructureGuard("catalog/section/data.xml", "Разделы", warnings);
  let current: ParsedCatalogSection | null = null;
  const parsed = await parseXmlBufferSafely(
    { bytes, file: "catalog/section/data.xml", expectedRoot: CATALOG_FILE_ROOTS["catalog/section/data.xml"] },
    {
      onOpenTag: (name, attrs) => {
        if (guard.enterOpenTag(name) === "skip") return;
        const parent = guard.parentName();
        if (name === "Раздел") {
          assertDirectParent(parent, ["Разделы"], "nested_section");
          trackUnknownAttributes(warnings, "catalog/section/data.xml", name, attrs);
        const code = attrs["Код"]?.trim();
        const title = attrs["Название"]?.trim() ?? "";
        if (!code) {
          throw new Error("INVALID_RECORD:section:missing_code");
        }
        if (!title) {
          throw new Error("INVALID_RECORD:section:missing_name");
        }
        if (seen.has(code)) {
          throw new Error(`DUPLICATE_KEY:section:${code}`);
        }
        seen.add(code);
          current = {
            code,
            name: title,
            parentCode: normalizeParentCode(attrs["КодРодителя"]),
          };
        }
        guard.pushHandledOpenTag(name);
      },
      onCloseTag: (name) => {
        if (!guard.leaveCloseTag(name)) return;
        if (name === "Раздел" && current) {
          rows.push(current);
          current = null;
        }
      },
    },
  );
  if (parsed.issue) return { rows, issue: parsed.issue };
  return { rows };
}

async function parseStorages(bytes: Buffer, warnings: SchemaDriftWarning[]): Promise<{
  rows: ParsedCatalogStorage[];
  issue?: ValidationIssue;
}> {
  const rows: ParsedCatalogStorage[] = [];
  const seen = new Set<string>();
  const guard = new XmlStructureGuard("catalog/storage/data.xml", "Склады", warnings);
  let current: ParsedCatalogStorage | null = null;
  const parsed = await parseXmlBufferSafely(
    { bytes, file: "catalog/storage/data.xml", expectedRoot: CATALOG_FILE_ROOTS["catalog/storage/data.xml"] },
    {
      onOpenTag: (name, attrs) => {
        if (guard.enterOpenTag(name) === "skip") return;
        const parent = guard.parentName();
        if (name === "Склад") {
          assertDirectParent(parent, ["Склады"], "nested_storage");
          trackUnknownAttributes(warnings, "catalog/storage/data.xml", name, attrs);
        const code = attrs["Код"]?.trim();
        if (!code) {
          throw new Error("INVALID_RECORD:storage:missing_code");
        }
        if (seen.has(code)) {
          throw new Error(`DUPLICATE_KEY:storage:${code}`);
        }
        seen.add(code);
          current = {
            code,
            name: attrs["Название"]?.trim() ?? "",
            address: attrs["Адрес"]?.trim() ?? "",
            email: attrs["Email"]?.trim() ?? "",
            phone: attrs["Телефон"]?.trim() ?? "",
          };
        }
        guard.pushHandledOpenTag(name);
      },
      onCloseTag: (name) => {
        if (!guard.leaveCloseTag(name)) return;
        if (name === "Склад" && current) {
          rows.push(current);
          current = null;
        }
      },
    },
  );
  if (parsed.issue) return { rows, issue: parsed.issue };
  return { rows };
}

async function parsePriceTypes(bytes: Buffer, warnings: SchemaDriftWarning[]): Promise<{
  rows: ParsedCatalogPriceType[];
  issue?: ValidationIssue;
}> {
  const rows: ParsedCatalogPriceType[] = [];
  const seen = new Set<string>();
  const guard = new XmlStructureGuard("catalog/types_prices/data.xml", "ТипыЦен", warnings);
  let current: ParsedCatalogPriceType | null = null;
  const parsed = await parseXmlBufferSafely(
    {
      bytes,
      file: "catalog/types_prices/data.xml",
      expectedRoot: CATALOG_FILE_ROOTS["catalog/types_prices/data.xml"],
    },
    {
      onOpenTag: (name, attrs) => {
        if (guard.enterOpenTag(name) === "skip") return;
        const parent = guard.parentName();
        if (name === "ТипЦены") {
          assertDirectParent(parent, ["ТипыЦен"], "nested_price_type");
          trackUnknownAttributes(warnings, "catalog/types_prices/data.xml", name, attrs);
        const code = attrs["КодЦены"]?.trim();
        if (!code) {
          throw new Error("INVALID_RECORD:price_type:missing_code");
        }
        if (seen.has(code)) {
          throw new Error(`DUPLICATE_KEY:price_type:${code}`);
        }
        seen.add(code);
          current = { priceTypeCode: code, name: attrs["Название"]?.trim() ?? "" };
        }
        guard.pushHandledOpenTag(name);
      },
      onCloseTag: (name) => {
        if (!guard.leaveCloseTag(name)) return;
        if (name === "ТипЦены" && current) {
          rows.push(current);
          current = null;
        }
      },
    },
  );
  if (parsed.issue) return { rows, issue: parsed.issue };
  return { rows };
}

async function parseProducts(bytes: Buffer, warnings: SchemaDriftWarning[]): Promise<{
  rows: ParsedCatalogProduct[];
  issue?: ValidationIssue;
}> {
  const rows: ParsedCatalogProduct[] = [];
  const seen = new Set<string>();
  const guard = new XmlStructureGuard("catalog/products/data.xml", "Товары", warnings);
  let current: ParsedCatalogProduct | null = null;
  let inProperties = false;
  let inImages = false;
  let inSections = false;
  const propertyIndex = new Map<string, { code: string; name: string; value: string }>();
  const parsed = await parseXmlBufferSafely(
    { bytes, file: "catalog/products/data.xml", expectedRoot: CATALOG_FILE_ROOTS["catalog/products/data.xml"] },
    {
      onOpenTag: (name, attrs) => {
        if (guard.enterOpenTag(name) === "skip") return;
        const parent = guard.parentName();
        if (name === "Товар") {
          assertDirectParent(parent, ["Товары"], "nested_product");
          trackUnknownAttributes(warnings, "catalog/products/data.xml", name, attrs);
          const code = attrs["Код"]?.trim();
          if (!code) {
            throw new Error("INVALID_PRODUCT:missing_code");
          }
          const productName = attrs["Название"]?.trim() ?? "";
          if (!productName) {
            throw new Error(`INVALID_PRODUCT:missing_name:${code}`);
          }
          if (seen.has(code)) {
            throw new Error(`DUPLICATE_KEY:product:${code}`);
          }
          seen.add(code);
          propertyIndex.clear();
          current = {
            code,
            groupCode: attrs["Группа"]?.trim() || null,
            activity: attrs["Активность"]?.trim() ?? "",
            name: productName,
            properties: [],
            images: [],
            sectionCodes: [],
          };
          inProperties = false;
          inImages = false;
          inSections = false;
        } else if (name === "Свойства") {
          assertDirectParent(parent, ["Товар"], "properties_parent");
          inProperties = true;
        } else if (name === "Картинки") {
          assertDirectParent(parent, ["Товар"], "images_parent");
          inImages = true;
        } else if (name === "Разделы") {
          assertDirectParent(parent, ["Товар"], "sections_parent");
          inSections = true;
        } else if (name === "Свойство") {
          if (!inProperties) {
            throw new Error("INVALID_STRUCTURE:property_outside_properties");
          }
          assertDirectParent(parent, ["Свойства"], "property_parent");
          trackUnknownAttributes(warnings, "catalog/products/data.xml", name, attrs);
          const propCode = attrs["Код"]?.trim() ?? "";
          if (!current) {
            throw new Error("INVALID_STRUCTURE:property_without_product");
          }
          if (!propCode) {
            throw new Error(`INVALID_PROPERTY:missing_code:${current.code}`);
          }
          const prop = {
            code: propCode,
            name: attrs["Название"]?.trim() ?? "",
            value: attrs["Значение"]?.trim() ?? "",
          };
          const existing = propertyIndex.get(propCode);
          if (existing) {
            if (existing.name === prop.name && existing.value === prop.value) {
              guard.pushHandledOpenTag(name);
              return;
            }
            throw new Error(`CONFLICTING_PROPERTY:product:${current!.code}:${propCode}`);
          }
          propertyIndex.set(propCode, prop);
          current!.properties.push(prop);
        } else if (name === "Раздел") {
          if (!inSections) {
            throw new Error("INVALID_STRUCTURE:section_outside_sections");
          }
          if (!current) {
            throw new Error("INVALID_STRUCTURE:section_without_product");
          }
          assertDirectParent(parent, ["Разделы"], "product_section_parent");
          trackUnknownAttributes(warnings, "catalog/products/data.xml", name, attrs);
          const sectionCode = attrs["Код"]?.trim();
          if (!sectionCode) {
            throw new Error(`INVALID_SECTION_REF:product:${current.code}`);
          }
          if (current!.sectionCodes.includes(sectionCode)) {
            guard.pushHandledOpenTag(name);
            return;
          }
          current!.sectionCodes.push(sectionCode);
        } else if (name === "Картинка") {
          assertDirectParent(parent, ["Картинки"], "image_parent");
        }
        guard.pushHandledOpenTag(name);
      },
      onText: (text) => {
        if (guard.isSkipping() || !current) return;
        if (inImages && text) {
          current.images.push(text);
        }
      },
      onCloseTag: (name) => {
        if (!guard.leaveCloseTag(name)) return;
        if (name === "Товар" && current) {
          rows.push(current);
          current = null;
        }
        if (name === "Свойства") inProperties = false;
        if (name === "Картинки") inImages = false;
        if (name === "Разделы") inSections = false;
      },
    },
  );
  if (parsed.issue) return { rows, issue: parsed.issue };
  return { rows };
}

type MutablePriceRow = ParsedCatalogPrice & { _attrs: Record<string, string>; _text: string };

async function parsePrices(bytes: Buffer, warnings: SchemaDriftWarning[]): Promise<{
  rows: ParsedCatalogPrice[];
  issue?: ValidationIssue;
}> {
  const rows: ParsedCatalogPrice[] = [];
  const guard = new XmlStructureGuard("catalog/prices/data.xml", "Цены", warnings);
  let current: MutablePriceRow | null = null;
  const parsed = await parseXmlBufferSafely(
    { bytes, file: "catalog/prices/data.xml", expectedRoot: CATALOG_FILE_ROOTS["catalog/prices/data.xml"] },
    {
      onOpenTag: (name, attrs) => {
        if (guard.enterOpenTag(name) === "skip") return;
        const parent = guard.parentName();
        if (name === "ЦенаТовара") {
          assertDirectParent(parent, ["Цены"], "price_row_parent");
          trackUnknownAttributes(warnings, "catalog/prices/data.xml", name, attrs);
          current = {
          priceTypeCode: attrs["КодЦены"]?.trim() ?? "",
          productCode: attrs["КодТовара"]?.trim() ?? "",
          priceRaw: "",
            _attrs: attrs,
            _text: "",
          };
        }
        guard.pushHandledOpenTag(name);
      },
      onText: (text) => {
        if (guard.isSkipping() || !current || !text) return;
        current._text += text;
      },
      onCloseTag: (name) => {
        if (!guard.leaveCloseTag(name)) return;
        if (name === "ЦенаТовара" && current) {
          const scalar = readXmlScalar("Цена", current._attrs, current._text);
          if (scalar.kind === "ambiguous") {
            throw new Error(`AMBIGUOUS_SCALAR:price:${current.productCode}`);
          }
          rows.push({
            priceTypeCode: current.priceTypeCode,
            productCode: current.productCode,
            priceRaw: scalar.kind === "value" ? scalar.raw : "",
          });
          current = null;
        }
      },
    },
  );
  if (parsed.issue) return { rows, issue: parsed.issue };
  return { rows };
}

type MutableStockRow = ParsedCatalogStockLine & { _attrs: Record<string, string>; _text: string };

async function parseStock(bytes: Buffer, warnings: SchemaDriftWarning[]): Promise<{
  rows: ParsedCatalogStockLine[];
  issue?: ValidationIssue;
}> {
  const rows: ParsedCatalogStockLine[] = [];
  const guard = new XmlStructureGuard("catalog/stock/data.xml", "ОстаткиСклада", warnings);
  let productCode = "";
  let currentStorage: MutableStockRow | null = null;
  const parsed = await parseXmlBufferSafely(
    { bytes, file: "catalog/stock/data.xml", expectedRoot: CATALOG_FILE_ROOTS["catalog/stock/data.xml"] },
    {
      onOpenTag: (name, attrs) => {
        if (guard.enterOpenTag(name) === "skip") return;
        const parent = guard.parentName();
        if (name === "Остаток") {
          assertDirectParent(parent, ["ОстаткиСклада"], "stock_product_parent");
          trackUnknownAttributes(warnings, "catalog/stock/data.xml", name, attrs);
          const code = attrs["Код"]?.trim() ?? "";
          if (!code) {
            throw new Error("INVALID_RECORD:stock:missing_product_code");
          }
          productCode = code;
        } else if (name === "Склады") {
          assertDirectParent(parent, ["Остаток"], "stock_storages_parent");
        } else if (name === "Склад") {
          assertDirectParent(parent, ["Склады"], "stock_storage_parent");
          trackUnknownAttributes(warnings, "catalog/stock/data.xml", name, attrs);
          currentStorage = {
            productCode,
            storageCode: attrs["СкладID"]?.trim() ?? "",
            quantityRaw: "",
            _attrs: attrs,
            _text: "",
          };
        }
        guard.pushHandledOpenTag(name);
      },
      onText: (text) => {
        if (guard.isSkipping() || !currentStorage || !text) return;
        currentStorage._text += text;
      },
      onCloseTag: (name) => {
        if (!guard.leaveCloseTag(name)) return;
        if (name === "Склад" && currentStorage) {
          const scalar = readXmlScalar("Количество", currentStorage._attrs, currentStorage._text);
          if (scalar.kind === "ambiguous") {
            throw new Error(`AMBIGUOUS_SCALAR:stock:${currentStorage.productCode}:${currentStorage.storageCode}`);
          }
          rows.push({
            productCode: currentStorage.productCode,
            storageCode: currentStorage.storageCode,
            quantityRaw: scalar.kind === "value" ? scalar.raw : "",
          });
          currentStorage = null;
        }
        if (name === "Остаток") productCode = "";
      },
    },
  );
  if (parsed.issue) return { rows, issue: parsed.issue };
  return { rows };
}

type MutableStockExpectedRow = ParsedCatalogStockExpectedLine & {
  _attrs: Record<string, string>;
  _text: string;
};

async function parseStockExpected(bytes: Buffer, warnings: SchemaDriftWarning[]): Promise<{
  rows: ParsedCatalogStockExpectedLine[];
  issue?: ValidationIssue;
}> {
  const rows: ParsedCatalogStockExpectedLine[] = [];
  const guard = new XmlStructureGuard(
    "catalog/stock_expected/data.xml",
    "ОжидаемыеОстаткиСклада",
    warnings,
  );
  let productCode = "";
  let currentStorage: MutableStockExpectedRow | null = null;
  const parsed = await parseXmlBufferSafely(
    {
      bytes,
      file: "catalog/stock_expected/data.xml",
      expectedRoot: CATALOG_FILE_ROOTS["catalog/stock_expected/data.xml"],
    },
    {
      onOpenTag: (name, attrs) => {
        if (guard.enterOpenTag(name) === "skip") return;
        const parent = guard.parentName();
        if (name === "Остаток") {
          assertDirectParent(parent, ["ОжидаемыеОстаткиСклада"], "stock_expected_product_parent");
          trackUnknownAttributes(warnings, "catalog/stock_expected/data.xml", name, attrs);
          const code = attrs["Код"]?.trim() ?? "";
          if (!code) {
            throw new Error("INVALID_RECORD:stock_expected:missing_product_code");
          }
          productCode = code;
        } else if (name === "Склады") {
          assertDirectParent(parent, ["Остаток"], "stock_expected_storages_parent");
        } else if (name === "Склад") {
          assertDirectParent(parent, ["Склады"], "stock_expected_storage_parent");
          trackUnknownAttributes(warnings, "catalog/stock_expected/data.xml", name, attrs);
          currentStorage = {
            productCode,
            storageCode: attrs["СкладID"]?.trim() ?? "",
            quantityRaw: "",
            expectedDateRaw: attrs["ОжидаемаяДата"]?.trim() || null,
            availableRaw: attrs["Доступно"]?.trim() || null,
            _attrs: attrs,
            _text: "",
          };
        }
        guard.pushHandledOpenTag(name);
      },
      onText: (text) => {
        if (guard.isSkipping() || !currentStorage || !text) return;
        currentStorage._text += text;
      },
      onCloseTag: (name) => {
        if (!guard.leaveCloseTag(name)) return;
        if (name === "Склад" && currentStorage) {
          const scalar = readXmlScalar("Количество", currentStorage._attrs, currentStorage._text);
          if (scalar.kind === "ambiguous") {
            throw new Error(
              `AMBIGUOUS_SCALAR:stock_expected:${currentStorage.productCode}:${currentStorage.storageCode}`,
            );
          }
          rows.push({
            productCode: currentStorage.productCode,
            storageCode: currentStorage.storageCode,
            quantityRaw: scalar.kind === "value" ? scalar.raw : "",
            expectedDateRaw: currentStorage.expectedDateRaw,
            availableRaw: currentStorage.availableRaw,
          });
          currentStorage = null;
        }
        if (name === "Остаток") productCode = "";
      },
    },
  );
  if (parsed.issue) return { rows, issue: parsed.issue };
  return { rows };
}

function mapThrownIssue(error: unknown, file: CatalogRelativeFile): ValidationIssue {
  const message = error instanceof Error ? error.message : String(error);
  if (message.startsWith("DUPLICATE_KEY:")) {
    return { code: "DUPLICATE_KEY", message: `Duplicate key in ${file}.`, file };
  }
  if (message.startsWith("CONFLICTING_PROPERTY:")) {
    return { code: "CONFLICTING_PROPERTY", message: "Conflicting duplicate product property codes.", file };
  }
  if (message.startsWith("AMBIGUOUS_SCALAR:")) {
    return {
      code: "AMBIGUOUS_SCALAR",
      message: "Ambiguous attribute and text values for the same scalar field.",
      file,
    };
  }
  if (message.startsWith("INVALID_STRUCTURE:")) {
    return { code: "INVALID_STRUCTURE", message: "Invalid XML nesting for catalog elements.", file };
  }
  if (
    message.startsWith("INVALID_PRODUCT:") ||
    message.startsWith("INVALID_RECORD:") ||
    message.startsWith("INVALID_PROPERTY:") ||
    message.startsWith("INVALID_SECTION_REF:")
  ) {
    return { code: "INVALID_BASE_RECORD", message: "Invalid base catalog record.", file };
  }
  return { code: "PARSE_ERROR", message: "Catalog XML parse failed.", file };
}

export async function parseCatalogSet(
  fileInputs: Array<{ relativePath: CatalogRelativeFile; bytes: Buffer }>,
  profile: CatalogImportProfile = DEFAULT_CATALOG_IMPORT_PROFILE,
): Promise<{ ok: true; data: ParsedCatalogSet } | { ok: false; issues: ValidationIssue[] }> {
  const issues: ValidationIssue[] = [];
  const warnings: SchemaDriftWarning[] = [];
  const byPath = new Map(fileInputs.map((entry) => [entry.relativePath, entry.bytes]));
  const requiredFiles = getCatalogFilesForProfile(profile);

  for (const relativePath of requiredFiles) {
    const bytes = byPath.get(relativePath);
    if (!bytes) {
      issues.push({
        code: "MISSING_SOURCE_FILE",
        message: `Required catalog file is missing: ${relativePath}.`,
        file: relativePath,
      });
      continue;
    }
    const emptyIssue = ensureNonEmptyFile(bytes, relativePath);
    if (emptyIssue) issues.push(emptyIssue);
  }
  if (issues.length > 0) {
    return { ok: false, issues };
  }

  const manifestInputs = requiredFiles.map((relativePath) => ({
    relativePath,
    bytes: byPath.get(relativePath)!,
  }));
  const entries = buildFileEntries(manifestInputs);
  const manifest = buildManifest(entries, profile);

  try {
    const groupsResult = await parseGroups(byPath.get("catalog/groups/data.xml")!, warnings);
    if (groupsResult.issue) return { ok: false, issues: [groupsResult.issue] };

    const sectionsResult = await parseSections(byPath.get("catalog/section/data.xml")!, warnings);
    if (sectionsResult.issue) return { ok: false, issues: [sectionsResult.issue] };

    const productsResult = await parseProducts(byPath.get("catalog/products/data.xml")!, warnings);
    if (productsResult.issue) return { ok: false, issues: [productsResult.issue] };

    let storages: ParsedCatalogStorage[] = [];
    let priceTypes: ParsedCatalogPriceType[] = [];
    let prices: ParsedCatalogPrice[] = [];
    let stock: ParsedCatalogStockLine[] = [];
    let stockExpected: ParsedCatalogStockExpectedLine[] = [];

    if (profile === "full") {
      const storagesResult = await parseStorages(byPath.get("catalog/storage/data.xml")!, warnings);
      if (storagesResult.issue) return { ok: false, issues: [storagesResult.issue] };
      storages = storagesResult.rows;

      const priceTypesResult = await parsePriceTypes(byPath.get("catalog/types_prices/data.xml")!, warnings);
      if (priceTypesResult.issue) return { ok: false, issues: [priceTypesResult.issue] };
      priceTypes = priceTypesResult.rows;

      const pricesResult = await parsePrices(byPath.get("catalog/prices/data.xml")!, warnings);
      if (pricesResult.issue) return { ok: false, issues: [pricesResult.issue] };
      prices = pricesResult.rows;

      const stockResult = await parseStock(byPath.get("catalog/stock/data.xml")!, warnings);
      if (stockResult.issue) return { ok: false, issues: [stockResult.issue] };
      stock = stockResult.rows;

      const stockExpectedResult = await parseStockExpected(
        byPath.get("catalog/stock_expected/data.xml")!,
        warnings,
      );
      if (stockExpectedResult.issue) return { ok: false, issues: [stockExpectedResult.issue] };
      stockExpected = stockExpectedResult.rows;
    }

    const data: ParsedCatalogSet = {
      manifest,
      profile,
      groups: groupsResult.rows,
      sections: sectionsResult.rows,
      storages,
      priceTypes,
      products: productsResult.rows,
      prices,
      stock,
      stockExpected,
      warnings,
      classificationWarnings: [],
      classificationIncomplete: false,
      commercialStatus: profile === "distribution" ? "not_requested" : "classified",
      quarantine: [],
      counts: {
        groups: groupsResult.rows.length,
        sections: sectionsResult.rows.length,
        storages: storages.length,
        priceTypes: priceTypes.length,
        products: productsResult.rows.length,
        prices: prices.length,
        stockLines: stock.length,
        stockExpectedLines: stockExpected.length,
        propertyCount: 0,
        imagePathCount: 0,
        quarantine: 0,
      },
    };
    return { ok: true, data };
  } catch (error) {
    return { ok: false, issues: [mapThrownIssue(error, "catalog/products/data.xml")] };
  }
}

export function fileEntriesFromInputs(
  fileInputs: Array<{ relativePath: CatalogFileEntry["relativePath"]; bytes: Buffer }>,
): CatalogFileEntry[] {
  return buildFileEntries(fileInputs);
}
