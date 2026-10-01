import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { CATALOG_RELATIVE_FILES } from "../../src/onec-catalog/constants";
import { buildFileEntries, buildManifest } from "../../src/onec-catalog/manifest";
import type { CatalogFileEntry } from "../../src/onec-catalog/types";

export function buildMinimalCatalogXmlSet(): Record<(typeof CATALOG_RELATIVE_FILES)[number], string> {
  return {
    "catalog/groups/data.xml": `<?xml version="1.0" encoding="UTF-8"?>
<Группы>
  <Группа Код="g1" Родитель=""/>
  <Группа Код="g2" Родитель="g1"/>
</Группы>`,
    "catalog/section/data.xml": `<?xml version="1.0" encoding="UTF-8"?>
<Разделы>
  <Раздел Код="s1" Название="Section one" КодРодителя=""/>
  <Раздел Код="s2" Название="Section two" КодРодителя="s1"/>
</Разделы>`,
    "catalog/storage/data.xml": `<?xml version="1.0" encoding="UTF-8"?>
<Склады>
  <Склад Код="wh1" Название="Main" Адрес="Addr" Email="w@example.com" Телефон="+7"/>
</Склады>`,
    "catalog/types_prices/data.xml": `<?xml version="1.0" encoding="UTF-8"?>
<ТипыЦен>
  <ТипЦены КодЦены="pt1" Название="Retail"/>
  <ТипЦены КодЦены="pt-missing" Название="Legacy"/>
</ТипыЦен>`,
    "catalog/products/data.xml": `<?xml version="1.0" encoding="UTF-8"?>
<Товары>
  <Товар Код="p1" Группа="g1" Активность="Y" Название="Product one">
    <Картинки><Картинка>images/p1.jpg</Картинка></Картинки>
    <Свойства>
      <Свойство Код="type" Название="Тип товара" Значение="Складская"/>
    </Свойства>
    <Разделы><Раздел Код="s1"/></Разделы>
  </Товар>
  <Товар Код="p2" Группа="g2" Активность="Y" Название="Product two"/>
</Товары>`,
    "catalog/prices/data.xml": `<?xml version="1.0" encoding="UTF-8"?>
<Цены>
  <ЦенаТовара КодЦены="pt1" КодТовара="p1" Цена="347,39"/>
  <ЦенаТовара КодЦены="dc5ff0fd-f584-11e9-80ec-00155d0a0a4e" КодТовара="p1" Цена="100,00"/>
  <ЦенаТовара КодЦены="pt1" КодТовара="missing-product" Цена="50,00"/>
</Цены>`,
    "catalog/stock/data.xml": `<?xml version="1.0" encoding="UTF-8"?>
<ОстаткиСклада>
  <Остаток Код="p1">
    <Склады><Склад СкладID="wh1" Количество="10,5"/></Склады>
  </Остаток>
</ОстаткиСклада>`,
    "catalog/stock_expected/data.xml": `<?xml version="1.0" encoding="UTF-8"?>
<ОжидаемыеОстаткиСклада>
  <Остаток Код="p2">
    <Склады>
      <Склад СкладID="wh1" Количество="2" ОжидаемаяДата="10.08.2026 12:00:00" Доступно="2"/>
    </Склады>
  </Остаток>
  <Остаток Код="missing-product">
    <Склады><Склад СкладID="wh1" Количество="1" ОжидаемаяДата="31.12.2027 10:00:00"/></Склады>
  </Остаток>
</ОжидаемыеОстаткиСклада>`,
  };
}

export function catalogEntriesFromXmlSet(
  xmlSet: Record<(typeof CATALOG_RELATIVE_FILES)[number], string>,
): CatalogFileEntry[] {
  return buildFileEntries(
    CATALOG_RELATIVE_FILES.map((relativePath) => ({
      relativePath,
      bytes: Buffer.from(xmlSet[relativePath], "utf8"),
    })),
  );
}

export function buildLargeProductsXml(targetBytes: number): string {
  const header = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><Товары>`, "utf8");
  const footer = Buffer.from(`</Товары>`, "utf8");
  const chunks: Buffer[] = [header];
  let total = header.length + footer.length;
  let index = 0;
  while (total < targetBytes - footer.length) {
    const stamped = Buffer.from(
      `<Товар Код="bulk-${index}" Группа="g1" Активность="Y" Название="Bulk ${index}"><Свойства><Свойство Код="prop" Название="Тип" Значение="Складская"/></Свойства></Товар>`,
      "utf8",
    );
    if (total + stamped.length + footer.length > targetBytes) {
      break;
    }
    chunks.push(stamped);
    total += stamped.length;
    index += 1;
  }
  chunks.push(footer);
  let xml = Buffer.concat(chunks);
  if (xml.length < targetBytes) {
    const padSize = targetBytes - xml.length;
    const pad = Buffer.from(`<!--${"x".repeat(Math.max(0, padSize - 7))}-->`, "utf8");
    xml = Buffer.concat([xml.subarray(0, xml.length - footer.length), pad, footer]);
  }
  return xml.toString("utf8");
}

export async function writeCatalogFixtureDir(
  targetDir: string,
  xmlSet: Record<(typeof CATALOG_RELATIVE_FILES)[number], string>,
): Promise<void> {
  for (const relativePath of CATALOG_RELATIVE_FILES) {
    const absolute = path.join(targetDir, relativePath);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, xmlSet[relativePath], "utf8");
  }
}

export function manifestFromXmlSet(
  xmlSet: Record<(typeof CATALOG_RELATIVE_FILES)[number], string>,
): string {
  return buildManifest(catalogEntriesFromXmlSet(xmlSet)).manifestSha256;
}
