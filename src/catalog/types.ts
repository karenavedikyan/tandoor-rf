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

export type CatalogSectionTreeNode = {
  code: string;
  name: string;
  parentCode: string | null;
  children: CatalogSectionTreeNode[];
};

export type CatalogKeyProperty = {
  code: string;
  name: string;
  value: string;
};

export type CatalogProductDistributionState = {
  installed: boolean;
  planned: boolean;
};

export type CatalogProductListItem = {
  code: string;
  name: string;
  groupCode: string | null;
  groupStatus: CatalogGroupStatus;
  sectionNames: string[];
  primaryImagePath: string | null;
  primaryImageAssetId: string | null;
  article: string | null;
  keyProperties: CatalogKeyProperty[];
  activity: string;
  distribution?: CatalogProductDistributionState;
};

export type CatalogProductSearchResult = {
  versionId: string;
  query: string;
  sectionCode: string | null;
  propertyFilters: Record<string, string[]>;
  page: number;
  pageSize: number;
  total: number;
  items: CatalogProductListItem[];
};

export type CatalogFacetValue = {
  value: string;
  count: number;
};

export type CatalogFacetGroup = {
  key: string;
  label: string;
  values: CatalogFacetValue[];
  totalValues: number;
  valuesTruncated: boolean;
};

export type CatalogFacetsResult = {
  versionId: string;
  total: number;
  facets: CatalogFacetGroup[];
  availableFilters: Array<{ key: string; label: string }>;
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
  imageAssetIds: string[];
  article: string | null;
  snapshotImportedAt: string | null;
  distribution?: CatalogProductDistributionState;
};
