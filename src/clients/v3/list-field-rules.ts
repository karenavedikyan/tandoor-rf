import { isValidUuidParam } from "../uuid-param";
import { v3CategoryGuidSql, v3JsonManagerField, v3TypeGuidSql } from "./json-paths";
import { LEGAL_CITY_SQL, LEGAL_STATUS_SQL, RETAIL_CITY_SQL } from "./list-sql-expressions";
import type { V3ListEntity } from "./list";
import type { V3ResponsibleKind } from "./list";

export type V3FilterOp = "empty" | "filled" | "yes" | "no" | "eq" | "contains" | "gte" | "lte";

export type V3FilterRule = {
  field: string;
  op: V3FilterOp;
  value: string;
};

const MAX_RULES = 12;
const FILTER_TOKEN_RE = /^[\w.-]{1,64}$/;

type FieldKind = "text" | "enum" | "bool" | "guid" | "number";

export type V3FilterFieldDef = {
  id: string;
  label: string;
  entity: V3ListEntity[] | "both";
  kind: FieldKind;
  ops: V3FilterOp[];
  /** When set, value must be UUID (staff assignment). */
  guidKind?: V3ResponsibleKind;
  unavailableNote?: string;
};

export const V3_LIST_FILTER_FIELDS: readonly V3FilterFieldDef[] = [
  { id: "discountAmount", label: "Значение скидки", entity: ["legal"], kind: "number", ops: ["eq", "gte", "lte", "empty", "filled"] },
  { id: "warehouse", label: "Склад", entity: ["retail", "orphan_retail"], kind: "bool", ops: ["yes", "no"] },
  {
    id: "categoryGuid",
    label: "Категория (GUID)",
    entity: "both",
    kind: "enum",
    ops: ["eq", "empty", "filled"],
  },
  {
    id: "typeGuid",
    label: "Тип (GUID)",
    entity: "both",
    kind: "enum",
    ops: ["eq", "empty", "filled"],
  },
  {
    id: "managerGuid",
    label: "Менеджер (GUID)",
    entity: "both",
    kind: "guid",
    ops: ["eq", "empty", "filled"],
    guidKind: "manager",
  },
  {
    id: "regionalGuid",
    label: "Региональный (GUID)",
    entity: "both",
    kind: "guid",
    ops: ["eq", "empty", "filled"],
    guidKind: "regional",
  },
  {
    id: "hardwareGuid",
    label: "Фурнитура (GUID)",
    entity: "both",
    kind: "guid",
    ops: ["eq", "empty", "filled"],
    guidKind: "hardware",
  },
  {
    id: "ropGuid",
    label: "РОП (GUID)",
    entity: "both",
    kind: "guid",
    ops: ["eq", "empty", "filled"],
    guidKind: "manager",
  },
  {
    id: "city",
    label: "Город",
    entity: "both",
    kind: "text",
    ops: ["eq", "contains", "empty", "filled"],
  },
  {
    id: "legalStatus",
    label: "Статус юрлица",
    entity: ["legal"],
    kind: "text",
    ops: ["eq", "contains", "empty", "filled"],
  },
  {
    id: "legalName",
    label: "Юрлицо",
    entity: ["legal"],
    kind: "text",
    ops: ["contains", "eq", "empty", "filled"],
  },
  {
    id: "closed",
    label: "ТТ закрыта",
    entity: ["retail", "orphan_retail"],
    kind: "bool",
    ops: ["yes", "no"],
  },
  {
    id: "storeAddress",
    label: "Адрес магазина",
    entity: ["retail", "orphan_retail"],
    kind: "text",
    ops: ["contains", "empty", "filled"],
  },
  {
    id: "lprName",
    label: "ФИО ЛПР",
    entity: ["retail", "orphan_retail"],
    kind: "text",
    ops: ["contains", "eq", "empty", "filled"],
  },
  {
    id: "clubStatus",
    label: "Club (статус)",
    entity: ["retail", "orphan_retail"],
    kind: "text",
    ops: ["eq", "contains", "empty", "filled"],
  },
  {
    id: "clubBonus",
    label: "Club (бонус)",
    entity: ["retail", "orphan_retail"],
    kind: "text",
    ops: ["contains", "eq", "empty", "filled"],
  },
  {
    id: "loadingTime",
    label: "Время приёмки",
    entity: ["retail", "orphan_retail"],
    kind: "text",
    ops: ["eq", "contains", "empty", "filled"],
  },
  {
    id: "missingManager",
    label: "Менеджер не назначен",
    entity: ["legal"],
    kind: "bool",
    ops: ["yes", "no"],
  },
  {
    id: "clientName",
    label: "Название клиента (холдинг)",
    entity: ["retail", "orphan_retail"],
    kind: "text",
    ops: ["contains", "empty", "filled"],
    unavailableNote:
      "Фильтр по названию холдинга ТТ; связь юрлицо→ТТ в одном правиле не поддерживается.",
  },
];

function fieldAppliesToEntity(def: V3FilterFieldDef, entity: V3ListEntity): boolean {
  const legalLike = entity === "legal" || entity === "legal_grouped";
  if (def.entity === "both") {
    return legalLike || entity === "retail" || entity === "orphan_retail";
  }
  if (legalLike && def.entity.includes("legal")) {
    return true;
  }
  return def.entity.includes(entity);
}

export function listFilterFieldsForEntity(entity: V3ListEntity): V3FilterFieldDef[] {
  return V3_LIST_FILTER_FIELDS.filter((f) => fieldAppliesToEntity(f, entity));
}

export function findFilterField(id: string): V3FilterFieldDef | undefined {
  return V3_LIST_FILTER_FIELDS.find((f) => f.id === id);
}

export function parseV3FilterRulesParam(raw: unknown, entity: V3ListEntity): V3FilterRule[] | undefined {
  if (raw === undefined || raw === null || raw === "") {
    return [];
  }
  if (typeof raw !== "string") {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed)) {
    return undefined;
  }
  if (parsed.length > MAX_RULES) return undefined;
  const rules: V3FilterRule[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") {
      return undefined;
    }
    const field = typeof (item as V3FilterRule).field === "string" ? (item as V3FilterRule).field.trim() : "";
    const op = typeof (item as V3FilterRule).op === "string" ? (item as V3FilterRule).op.trim() : "";
    const value = typeof (item as V3FilterRule).value === "string" ? (item as V3FilterRule).value : "";
    const def = findFilterField(field);
    if (!def || !fieldAppliesToEntity(def, entity) || !def.ops.includes(op as V3FilterOp)) {
      return undefined;
    }
    if (["empty", "filled", "yes", "no"].includes(op)) {
      rules.push({ field, op: op as V3FilterOp, value: "" });
      continue;
    }
    if (!value.trim()) {
      return undefined;
    }
    if (def.kind === "number" && (!/^-?\d+(\.\d+)?$/.test(value.trim()) || !Number.isFinite(Number(value)))) return undefined;
    if (def.kind === "guid" || field.endsWith("Guid")) {
      const guid = value.trim().toLowerCase();
      if (!isValidUuidParam(guid) && field !== "categoryGuid" && field !== "typeGuid") {
        return undefined;
      }
      if ((field === "categoryGuid" || field === "typeGuid") && !FILTER_TOKEN_RE.test(value.trim())) {
        return undefined;
      }
    }
    rules.push({ field, op: op as V3FilterOp, value: value.trim() });
    if (rules.length > MAX_RULES) {
      return undefined;
    }
  }
  return rules;
}

function appendRuleSql(
  sql: string,
  params: unknown[],
  entity: "legal" | "retail",
  alias: string,
  rule: V3FilterRule,
  joinHolding: { joined: boolean },
): string {
  const def = findFilterField(rule.field);
  if (!def) {
    return sql;
  }
  const op = rule.op;
  const val = rule.value;
  if (rule.field === "discountAmount") {
    if (op === "empty") return `${sql} AND ${alias}.discount_amount IS NULL`;
    if (op === "filled") return `${sql} AND ${alias}.discount_amount IS NOT NULL`;
    const operator = op === "gte" ? ">=" : op === "lte" ? "<=" : "=";
    params.push(val);
    return `${sql} AND ${alias}.discount_amount ${operator} $${params.length}::numeric`;
  }
  if (rule.field === "warehouse") return `${sql} AND ${alias}.warehouse = ${op === "yes" ? "TRUE" : "FALSE"}`;

  const textExpr = (expression: string): string => {
    if (op === "empty") {
      return `${sql} AND NULLIF(TRIM(COALESCE(${expression}, '')), '') IS NULL`;
    }
    if (op === "filled") {
      return `${sql} AND NULLIF(TRIM(COALESCE(${expression}, '')), '') IS NOT NULL`;
    }
    if (op === "contains") {
      params.push(`%${val.replace(/[%_\\]/g, "\\$&")}%`);
      return `${sql} AND COALESCE(${expression}, '') ILIKE $${params.length} ESCAPE '\\'`;
    }
    if (op === "eq") {
      params.push(val);
      return `${sql} AND COALESCE(${expression}, '') = $${params.length}`;
    }
    return sql;
  };

  if (rule.field === "categoryGuid") {
    const expr = v3CategoryGuidSql(alias);
    if (op === "empty") return `${sql} AND NULLIF(TRIM(COALESCE(${expr}, '')), '') IS NULL`;
    if (op === "filled") return `${sql} AND NULLIF(TRIM(COALESCE(${expr}, '')), '') IS NOT NULL`;
    if (op === "eq") {
      params.push(val);
      return `${sql} AND ${expr} = $${params.length}`;
    }
    return sql;
  }

  if (rule.field === "typeGuid") {
    const expr = v3TypeGuidSql(alias);
    if (op === "empty") return `${sql} AND NULLIF(TRIM(COALESCE(${expr}, '')), '') IS NULL`;
    if (op === "filled") return `${sql} AND NULLIF(TRIM(COALESCE(${expr}, '')), '') IS NOT NULL`;
    if (op === "eq") {
      params.push(val);
      return `${sql} AND ${expr} = $${params.length}`;
    }
    return sql;
  }

  if (rule.field === "managerGuid") {
    const expr = v3JsonManagerField(alias, "guidManager");
    return applyGuidRule(sql, params, expr, op, val);
  }
  if (rule.field === "regionalGuid") {
    const expr = v3JsonManagerField(alias, "guidRegionalManager");
    return applyGuidRule(sql, params, expr, op, val);
  }
  if (rule.field === "hardwareGuid") {
    const expr = v3JsonManagerField(alias, "guidHardwareManager");
    return applyGuidRule(sql, params, expr, op, val);
  }
  if (rule.field === "ropGuid") {
    const expr = v3JsonManagerField(alias, "guidHeadOfSales");
    return applyGuidRule(sql, params, expr, op, val);
  }

  if (rule.field === "city") {
    const expr = entity === "legal" ? LEGAL_CITY_SQL : RETAIL_CITY_SQL;
    return textExpr(expr);
  }

  if (rule.field === "legalStatus" && entity === "legal") {
    return textExpr(LEGAL_STATUS_SQL);
  }

  if (rule.field === "legalName" && entity === "legal") {
    return textExpr(`${alias}.name_client`);
  }

  if (rule.field === "closed" && entity === "retail") {
    if (op === "yes") return `${sql} AND ${alias}.closed = TRUE`;
    if (op === "no") return `${sql} AND ${alias}.closed = FALSE`;
    return sql;
  }

  if (rule.field === "storeAddress" && entity === "retail") {
    return textExpr(`${alias}.address->>'store_address'`);
  }

  if (rule.field === "lprName" && entity === "retail") {
    return textExpr(`${alias}.lpr_information->>'name'`);
  }

  if (rule.field === "clubStatus" && entity === "retail") {
    return textExpr(`${alias}.additional_information->>'status_tandoor_club'`);
  }

  if (rule.field === "clubBonus" && entity === "retail") {
    return textExpr(`${alias}.additional_information->>'bonus_tandoor_club'`);
  }

  if (rule.field === "loadingTime" && entity === "retail") {
    return textExpr(`${alias}.information_loading->>'loading_time'`);
  }

  if (rule.field === "missingManager" && entity === "legal") {
    const expr = v3JsonManagerField(alias, "guidManager");
    if (op === "yes") return `${sql} AND NULLIF(TRIM(COALESCE(${expr}, '')), '') IS NULL`;
    if (op === "no") return `${sql} AND NULLIF(TRIM(COALESCE(${expr}, '')), '') IS NOT NULL`;
    return sql;
  }

  if (rule.field === "clientName" && entity === "retail") {
    if (!joinHolding.joined) {
      joinHolding.joined = true;
    }
    return textExpr("h.name_holding");
  }

  return sql;
}

function applyGuidRule(sql: string, params: unknown[], expr: string, op: V3FilterOp, val: string): string {
  if (op === "empty") {
    return `${sql} AND NULLIF(TRIM(COALESCE(${expr}, '')), '') IS NULL`;
  }
  if (op === "filled") {
    return `${sql} AND NULLIF(TRIM(COALESCE(${expr}, '')), '') IS NOT NULL`;
  }
  if (op === "eq") {
    params.push(val.toLowerCase());
    return `${sql} AND NULLIF(TRIM(COALESCE(${expr}, '')), '')::uuid = $${params.length}::uuid`;
  }
  return sql;
}

export function appendV3FieldRulesSql(
  inputSql: string,
  params: unknown[],
  entity: V3ListEntity,
  alias: string,
  rules: V3FilterRule[] | undefined,
): { sql: string; needsHoldingJoin: boolean } {
  if (!rules?.length || entity === "holdings") {
    return { sql: inputSql, needsHoldingJoin: false };
  }
  const kind = entity === "legal" || entity === "legal_grouped" ? "legal" : "retail";
  let sql = inputSql;
  const joinHolding = { joined: false };
  for (const rule of rules) {
    sql = appendRuleSql(sql, params, kind, alias, rule, joinHolding);
  }
  return { sql, needsHoldingJoin: joinHolding.joined };
}
