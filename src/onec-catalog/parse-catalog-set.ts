import type { CatalogRelativeFile } from "./constants";
import { CATALOG_FILE_ROOTS, ROOT_PARENT_CODES } from "./constants";
import { parseXmlBufferSafely, ensureNonEmptyFile } from "./safe-xml";
import { buildManifest, buildFileEntries } from "./manifest";
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

const KNOWN_ELEMENTS: Partial<Record<CatalogRelativeFile, Set<string>>> = {
  "catalog/groups/data.xml": new Set(["Группы", "Группа"]),
  "catalog/section/data.xml": new Set(["Разделы", "Раздел"]),
  "catalog/storage/data.xml": new Set(["Склады", "Склад"]),
  "catalog/types_prices/data.xml": new Set(["ТипыЦен", "ТипЦены"]),
  "catalog/products/data.xml": new Set([
    "Товары",
    "Товар",
    "Картинки",
    "Картинка",
    "Свойства",
    "Свойство",
    "Разделы",
    "Раздел",
  ]),
  "catalog/prices/data.xml": new Set(["Цены", "ЦенаТовара"]),
  "catalog/stock/data.xml": new Set(["ОстаткиСклада", "Остаток", "Склады", "Склад"]),
  "catalog/stock_expected/data.xml": new Set([
    "ОстаткиСклада",
    "Остаток",
    "Склады",
    "Склад",
    "ОжидаемыеОстаткиСклада",
  ]),
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

function trackDrift(
  warnings: SchemaDriftWarning[],
  file: CatalogRelativeFile,
  element: string,
): void {
  warnings.push({
    code: "SCHEMA_DRIFT",
    message: `Unknown element <${element}> observed; not mapped automatically.`,
    file,
    element,
  });
}

async function parseGroups(bytes: Buffer, warnings: SchemaDriftWarning[]): Promise<{
  rows: ParsedCatalogGroup[];
  issue?: ValidationIssue;
}> {
  const rows: ParsedCatalogGroup[] = [];
  const seen = new Set<string>();
  let current: ParsedCatalogGroup | null = null;
  const parsed = await parseXmlBufferSafely(
    { bytes, file: "catalog/groups/data.xml", expectedRoot: CATALOG_FILE_ROOTS["catalog/groups/data.xml"] },
    {
      onOpenTag: (name, attrs) => {
        if (!KNOWN_ELEMENTS["catalog/groups/data.xml"]!.has(name) && name !== "Группы") {
          trackDrift(warnings, "catalog/groups/data.xml", name);
          return;
        }
        if (name !== "Группа") return;
        const code = attrs["Код"]?.trim();
        if (!code) return;
        if (seen.has(code)) {
          throw new Error(`DUPLICATE_KEY:group:${code}`);
        }
        seen.add(code);
        current = {
          code,
          parentCode: normalizeParentCode(attrs["Родитель"]),
        };
      },
      onCloseTag: (name) => {
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
  let current: ParsedCatalogSection | null = null;
  const parsed = await parseXmlBufferSafely(
    { bytes, file: "catalog/section/data.xml", expectedRoot: CATALOG_FILE_ROOTS["catalog/section/data.xml"] },
    {
      onOpenTag: (name, attrs) => {
        if (!KNOWN_ELEMENTS["catalog/section/data.xml"]!.has(name) && name !== "Разделы") {
          trackDrift(warnings, "catalog/section/data.xml", name);
          return;
        }
        if (name !== "Раздел") return;
        const code = attrs["Код"]?.trim();
        const title = attrs["Название"]?.trim() ?? "";
        if (!code) return;
        if (seen.has(code)) {
          throw new Error(`DUPLICATE_KEY:section:${code}`);
        }
        seen.add(code);
        current = {
          code,
          name: title,
          parentCode: normalizeParentCode(attrs["КодРодителя"]),
        };
      },
      onCloseTag: (name) => {
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
  let current: ParsedCatalogStorage | null = null;
  const parsed = await parseXmlBufferSafely(
    { bytes, file: "catalog/storage/data.xml", expectedRoot: CATALOG_FILE_ROOTS["catalog/storage/data.xml"] },
    {
      onOpenTag: (name, attrs) => {
        if (!KNOWN_ELEMENTS["catalog/storage/data.xml"]!.has(name) && name !== "Склады") {
          trackDrift(warnings, "catalog/storage/data.xml", name);
          return;
        }
        if (name !== "Склад") return;
        const code = attrs["Код"]?.trim();
        if (!code) return;
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
      },
      onCloseTag: (name) => {
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
  let current: ParsedCatalogPriceType | null = null;
  const parsed = await parseXmlBufferSafely(
    {
      bytes,
      file: "catalog/types_prices/data.xml",
      expectedRoot: CATALOG_FILE_ROOTS["catalog/types_prices/data.xml"],
    },
    {
      onOpenTag: (name, attrs) => {
        if (!KNOWN_ELEMENTS["catalog/types_prices/data.xml"]!.has(name) && name !== "ТипыЦен") {
          trackDrift(warnings, "catalog/types_prices/data.xml", name);
          return;
        }
        if (name !== "ТипЦены") return;
        const code = attrs["КодЦены"]?.trim();
        if (!code) return;
        if (seen.has(code)) {
          throw new Error(`DUPLICATE_KEY:price_type:${code}`);
        }
        seen.add(code);
        current = { priceTypeCode: code, name: attrs["Название"]?.trim() ?? "" };
      },
      onCloseTag: (name) => {
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
  let current: ParsedCatalogProduct | null = null;
  let inProperties = false;
  let inImages = false;
  let inSections = false;
  const parsed = await parseXmlBufferSafely(
    { bytes, file: "catalog/products/data.xml", expectedRoot: CATALOG_FILE_ROOTS["catalog/products/data.xml"] },
    {
      onOpenTag: (name, attrs) => {
        if (!KNOWN_ELEMENTS["catalog/products/data.xml"]!.has(name) && name !== "Товары") {
          trackDrift(warnings, "catalog/products/data.xml", name);
          return;
        }
        if (name === "Товар") {
          const code = attrs["Код"]?.trim();
          if (!code) return;
          if (seen.has(code)) {
            throw new Error(`DUPLICATE_KEY:product:${code}`);
          }
          seen.add(code);
          current = {
            code,
            groupCode: attrs["Группа"]?.trim() || null,
            activity: attrs["Активность"]?.trim() ?? "",
            name: attrs["Название"]?.trim() ?? "",
            properties: [],
            images: [],
            sectionCodes: [],
          };
          inProperties = false;
          inImages = false;
          inSections = false;
          return;
        }
        if (!current) return;
        if (name === "Свойства") inProperties = true;
        if (name === "Картинки") inImages = true;
        if (name === "Разделы") inSections = true;
        if (name === "Свойство" && inProperties) {
          const value = attrs["Значение"]?.trim() ?? "";
          current.properties.push({
            code: attrs["Код"]?.trim() ?? "",
            name: attrs["Название"]?.trim() ?? "",
            value,
          });
        }
        if (name === "Раздел" && inSections) {
          const sectionCode = attrs["Код"]?.trim();
          if (sectionCode) current.sectionCodes.push(sectionCode);
        }
      },
      onText: (text) => {
        if (!current) return;
        if (inImages && text) {
          current.images.push(text);
        }
      },
      onCloseTag: (name) => {
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

async function parsePrices(bytes: Buffer, warnings: SchemaDriftWarning[]): Promise<{
  rows: ParsedCatalogPrice[];
  issue?: ValidationIssue;
}> {
  const rows: ParsedCatalogPrice[] = [];
  let current: ParsedCatalogPrice | null = null;
  const parsed = await parseXmlBufferSafely(
    { bytes, file: "catalog/prices/data.xml", expectedRoot: CATALOG_FILE_ROOTS["catalog/prices/data.xml"] },
    {
      onOpenTag: (name, attrs) => {
        if (!KNOWN_ELEMENTS["catalog/prices/data.xml"]!.has(name) && name !== "Цены") {
          trackDrift(warnings, "catalog/prices/data.xml", name);
          return;
        }
        if (name !== "ЦенаТовара") return;
        current = {
          priceTypeCode: attrs["КодЦены"]?.trim() ?? "",
          productCode: attrs["КодТовара"]?.trim() ?? "",
          priceRaw: "",
        };
      },
      onText: (text) => {
        if (current && text) current.priceRaw = text;
      },
      onCloseTag: (name) => {
        if (name === "ЦенаТовара" && current) {
          rows.push(current);
          current = null;
        }
      },
    },
  );
  if (parsed.issue) return { rows, issue: parsed.issue };
  return { rows };
}

async function parseStock(bytes: Buffer, warnings: SchemaDriftWarning[]): Promise<{
  rows: ParsedCatalogStockLine[];
  issue?: ValidationIssue;
}> {
  const rows: ParsedCatalogStockLine[] = [];
  let productCode = "";
  let currentStorage: ParsedCatalogStockLine | null = null;
  const parsed = await parseXmlBufferSafely(
    { bytes, file: "catalog/stock/data.xml", expectedRoot: CATALOG_FILE_ROOTS["catalog/stock/data.xml"] },
    {
      onOpenTag: (name, attrs) => {
        if (!KNOWN_ELEMENTS["catalog/stock/data.xml"]!.has(name) && name !== "ОстаткиСклада") {
          trackDrift(warnings, "catalog/stock/data.xml", name);
          return;
        }
        if (name === "Остаток") {
          productCode = attrs["Код"]?.trim() ?? "";
          return;
        }
        if (name === "Склад" && productCode) {
          currentStorage = {
            productCode,
            storageCode: attrs["СкладID"]?.trim() ?? "",
            quantityRaw: "",
          };
        }
      },
      onText: (text) => {
        if (currentStorage && text) currentStorage.quantityRaw = text;
      },
      onCloseTag: (name) => {
        if (name === "Склад" && currentStorage) {
          rows.push(currentStorage);
          currentStorage = null;
        }
        if (name === "Остаток") productCode = "";
      },
    },
  );
  if (parsed.issue) return { rows, issue: parsed.issue };
  return { rows };
}

async function parseStockExpected(bytes: Buffer, warnings: SchemaDriftWarning[]): Promise<{
  rows: ParsedCatalogStockExpectedLine[];
  issue?: ValidationIssue;
}> {
  const rows: ParsedCatalogStockExpectedLine[] = [];
  let productCode = "";
  let currentStorage: ParsedCatalogStockExpectedLine | null = null;
  const parsed = await parseXmlBufferSafely(
    {
      bytes,
      file: "catalog/stock_expected/data.xml",
      expectedRoot: CATALOG_FILE_ROOTS["catalog/stock_expected/data.xml"],
    },
    {
      onOpenTag: (name, attrs) => {
        if (
          !KNOWN_ELEMENTS["catalog/stock_expected/data.xml"]!.has(name) &&
          name !== "ОжидаемыеОстаткиСклада"
        ) {
          trackDrift(warnings, "catalog/stock_expected/data.xml", name);
          return;
        }
        if (name === "Остаток") {
          productCode = attrs["Код"]?.trim() ?? "";
          return;
        }
        if (name === "Склад" && productCode) {
          currentStorage = {
            productCode,
            storageCode: attrs["СкладID"]?.trim() ?? "",
            quantityRaw: "",
            expectedDateRaw: attrs["ОжидаемаяДата"]?.trim() ?? null,
            availableRaw: attrs["Доступно"]?.trim() ?? null,
          };
        }
      },
      onText: (text) => {
        if (currentStorage && text) currentStorage.quantityRaw = text;
      },
      onCloseTag: (name) => {
        if (name === "Склад" && currentStorage) {
          rows.push(currentStorage);
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
  return { code: "PARSE_ERROR", message, file };
}

export async function parseCatalogSet(
  fileInputs: Array<{ relativePath: CatalogRelativeFile; bytes: Buffer }>,
): Promise<{ ok: true; data: ParsedCatalogSet } | { ok: false; issues: ValidationIssue[] }> {
  const issues: ValidationIssue[] = [];
  const warnings: SchemaDriftWarning[] = [];
  const byPath = new Map(fileInputs.map((entry) => [entry.relativePath, entry.bytes]));

  for (const relativePath of Object.keys(CATALOG_FILE_ROOTS) as CatalogRelativeFile[]) {
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

  const entries = buildFileEntries(
    fileInputs.map((input) => ({ relativePath: input.relativePath, bytes: input.bytes })),
  );
  const manifest = buildManifest(entries);

  try {
    const groupsResult = await parseGroups(byPath.get("catalog/groups/data.xml")!, warnings);
    if (groupsResult.issue) return { ok: false, issues: [groupsResult.issue] };

    const sectionsResult = await parseSections(byPath.get("catalog/section/data.xml")!, warnings);
    if (sectionsResult.issue) return { ok: false, issues: [sectionsResult.issue] };

    const storagesResult = await parseStorages(byPath.get("catalog/storage/data.xml")!, warnings);
    if (storagesResult.issue) return { ok: false, issues: [storagesResult.issue] };

    const priceTypesResult = await parsePriceTypes(byPath.get("catalog/types_prices/data.xml")!, warnings);
    if (priceTypesResult.issue) return { ok: false, issues: [priceTypesResult.issue] };

    const productsResult = await parseProducts(byPath.get("catalog/products/data.xml")!, warnings);
    if (productsResult.issue) return { ok: false, issues: [productsResult.issue] };

    const pricesResult = await parsePrices(byPath.get("catalog/prices/data.xml")!, warnings);
    if (pricesResult.issue) return { ok: false, issues: [pricesResult.issue] };

    const stockResult = await parseStock(byPath.get("catalog/stock/data.xml")!, warnings);
    if (stockResult.issue) return { ok: false, issues: [stockResult.issue] };

    const stockExpectedResult = await parseStockExpected(
      byPath.get("catalog/stock_expected/data.xml")!,
      warnings,
    );
    if (stockExpectedResult.issue) return { ok: false, issues: [stockExpectedResult.issue] };

    const data: ParsedCatalogSet = {
      manifest,
      groups: groupsResult.rows,
      sections: sectionsResult.rows,
      storages: storagesResult.rows,
      priceTypes: priceTypesResult.rows,
      products: productsResult.rows,
      prices: pricesResult.rows,
      stock: stockResult.rows,
      stockExpected: stockExpectedResult.rows,
      warnings,
      quarantine: [],
      counts: {
        groups: groupsResult.rows.length,
        sections: sectionsResult.rows.length,
        storages: storagesResult.rows.length,
        priceTypes: priceTypesResult.rows.length,
        products: productsResult.rows.length,
        prices: pricesResult.rows.length,
        stockLines: stockResult.rows.length,
        stockExpectedLines: stockExpectedResult.rows.length,
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
