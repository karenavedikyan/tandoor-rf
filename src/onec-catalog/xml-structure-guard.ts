import type { CatalogRelativeFile } from "./constants";
import type { SchemaDriftWarning } from "./types";

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

export type XmlOpenDisposition = "handle" | "skip";

export class XmlStructureGuard {
  private readonly elementStack: string[] = [];
  private skipSubtreeDepth = 0;

  constructor(
    private readonly file: CatalogRelativeFile,
    private readonly rootElement: string,
    private readonly warnings: SchemaDriftWarning[],
  ) {}

  /** Decide whether to parse this element or skip an unknown/foreign subtree. */
  enterOpenTag(name: string): XmlOpenDisposition {
    if (this.skipSubtreeDepth > 0) {
      this.elementStack.push(name);
      this.skipSubtreeDepth += 1;
      return "skip";
    }

    const isKnown = name === this.rootElement || KNOWN_ELEMENTS[this.file]?.has(name) === true;
    if (!isKnown) {
      this.warnings.push({
        code: "SCHEMA_DRIFT",
        message: `Unknown element <${name}> observed; subtree skipped and not mapped automatically.`,
        file: this.file,
        element: name,
      });
      this.elementStack.push(name);
      this.skipSubtreeDepth = 1;
      return "skip";
    }

    if (name === this.rootElement && this.elementStack.length > 0) {
      throw new Error(`INVALID_STRUCTURE:nested_root_container:${name}`);
    }

    return "handle";
  }

  pushHandledOpenTag(name: string): void {
    this.elementStack.push(name);
  }

  /** Returns false when the close tag belongs to a skipped foreign subtree. */
  leaveCloseTag(name: string): boolean {
    if (this.elementStack[this.elementStack.length - 1] !== name) {
      // Balanced XML is enforced by the sax parser; keep stack best-effort.
    }
    this.elementStack.pop();
    if (this.skipSubtreeDepth > 0) {
      this.skipSubtreeDepth -= 1;
      return false;
    }
    return true;
  }

  parentName(): string | undefined {
    return this.elementStack[this.elementStack.length - 1];
  }

  isSkipping(): boolean {
    return this.skipSubtreeDepth > 0;
  }
}

export function assertDirectParent(
  parent: string | undefined,
  allowedParents: string[],
  errorCode: string,
): void {
  if (!parent || !allowedParents.includes(parent)) {
    throw new Error(`INVALID_STRUCTURE:${errorCode}:${parent ?? "none"}`);
  }
}
