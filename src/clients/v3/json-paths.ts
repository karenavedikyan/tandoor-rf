/** JSONB paths for v3 columns written by exchange import (camelCase DTO). */

export function v3JsonManagerField(alias: string, field: keyof V3ManagersJson): string {
  return `${alias}.managers->>'${field}'`;
}

export type V3ManagersJson = {
  guidManager: string;
  nameManager: string;
  guidRegionalManager: string;
  nameRegionalManager: string;
  guidHardwareManager: string;
  nameHardwareManager: string;
  guidHeadOfSales: string;
  nameHeadOfSales: string;
};

export function v3TypeGuidSql(alias: string): string {
  return `${alias}.type_category->>'guidType'`;
}

export function v3CategoryGuidSql(alias: string): string {
  return `${alias}.type_category->>'guidCategory'`;
}

export function v3TypeNameSql(alias: string): string {
  return `${alias}.type_category->>'nameType'`;
}

export function v3CategoryNameSql(alias: string): string {
  return `${alias}.type_category->>'nameCategory'`;
}
