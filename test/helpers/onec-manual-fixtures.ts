import { FILES, type ManualFiles, type FileKey } from "../../src/onec-manual/model";
import { catalogueFixture, fixtureGuid } from "./internal-catalog-fixtures";
export { fixtureGuid };
export function manualFixture(overrides: Partial<Record<FileKey, unknown[]>> = {}): ManualFiles {
  const input: Record<FileKey, unknown[]> = {
    holdings: [{ guid_holding: fixtureGuid(600), name_holding: "Холдинг", legal_entities: [], retail_outlets: [] }],
    clients: [{ guid_client: fixtureGuid(601), name_client: "Клиент", inn: "1234567890", telephone: ["+70000000001"] }],
    retail: [{ guid_store: fixtureGuid(602), address: { store_address: "Адрес ТТ" } }],
    employees: [{ guid_manager: fixtureGuid(603), name_manager: "Сотрудник", telephone: "+70000000002" }],
    products: catalogueFixture().slice(0, 1), groups: [], prices: [], stocks: [],
    sales: [], saleItems: [], returns: [], returnItems: [], ...overrides,
  };
  return Object.fromEntries((Object.keys(FILES) as FileKey[]).map(file => [file,
    { sourceName: FILES[file].paths[0], bytes: Buffer.from(JSON.stringify(input[file])) }])) as ManualFiles;
}
