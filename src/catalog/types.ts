export type CatalogGroupStatus = "found" | "missing_reference" | "not_specified";

export type CatalogSnapshotMeta = {
  state: "ready" | "empty";
  versionId: string | null;
  importedAt: string | null;
  importProfile: string | null;
  distributionReady: boolean;
  productCount: number;
  sectionCount: number;
  propertyCount: number;
  imagePathCount: number;
  classificationIncomplete: boolean;
  message?: string;
};

export type CatalogSectionOption = {
  code: string;
  name: string;
};

export type CatalogProductListItem = {
  code: string;
  name: string;
  groupCode: string | null;
  groupStatus: CatalogGroupStatus;
  sectionNames: string[];
  primaryImagePath: string | null;
  activity: string;
};

export type CatalogProductSearchResult = {
  versionId: string;
  query: string;
  sectionCode: string | null;
  page: number;
  pageSize: number;
  total: number;
  items: CatalogProductListItem[];
};

export type CatalogProductProperty = {
  code: string;
  name: string;
  value: string;
};

export type CatalogProductDetail = {
  versionId: string;
  code: string;
  name: string;
  groupCode: string | null;
  groupStatus: CatalogGroupStatus;
  activity: string;
  sectionNames: string[];
  properties: CatalogProductProperty[];
  imagePaths: string[];
  snapshotImportedAt: string | null;
};
