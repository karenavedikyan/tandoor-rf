import { EXTENDED_FIXTURE_GUIDS } from "./onec-clients-extended-fixtures";

export type SyntheticTeamEntry = {
  guid_team: string;
  name_team?: string | null;
  guid_team_leader?: string | null;
  name_team_leader?: string | null;
};

export type SyntheticEmployeeRosterEntry = {
  guid_manager: string;
  name_manager?: string;
  guid_post?: string;
  post?: string;
  guid_team?: string | null;
  name_team?: string | null;
  team?: SyntheticTeamEntry[];
  condition?: string;
  date_of_assumption?: string;
  guid_work_schedule?: string;
  work_schedule?: string;
  decree?: string;
  email?: string;
  telephone?: string;
};

export function buildEmployeeRosterEntry(
  guidManager: string,
  overrides: Partial<SyntheticEmployeeRosterEntry> = {},
): SyntheticEmployeeRosterEntry {
  return {
    guid_manager: guidManager,
    name_manager: overrides.name_manager ?? "Synthetic Wholesale Manager",
    guid_post: overrides.guid_post ?? "66666666-6666-4666-8666-666666666666",
    post: overrides.post ?? "Менеджер ОПТ",
    condition: overrides.condition ?? "active",
    date_of_assumption: overrides.date_of_assumption ?? "2024-01-01T00:00:00",
    guid_work_schedule: overrides.guid_work_schedule ?? "77777777-7777-4777-8777-777777777777",
    work_schedule: overrides.work_schedule ?? "5/2",
    decree: overrides.decree ?? "",
    email: overrides.email ?? "wholesale-mgr@example.test",
    telephone: overrides.telephone ?? "+79990000001",
    ...overrides,
  };
}

export function buildEmployeeRosterBytes(entries: SyntheticEmployeeRosterEntry[]): Buffer {
  return Buffer.from(JSON.stringify(entries), "utf8");
}

export function wholesaleRosterWithManagers(): Buffer {
  return buildEmployeeRosterBytes([
    buildEmployeeRosterEntry(EXTENDED_FIXTURE_GUIDS.MANAGER_A, {
      name_manager: "Synthetic Manager A",
      email: "mgr-a@example.test",
    }),
    buildEmployeeRosterEntry(EXTENDED_FIXTURE_GUIDS.MANAGER_B, {
      name_manager: "Synthetic Manager B",
      email: "mgr-b@example.test",
    }),
    buildEmployeeRosterEntry(EXTENDED_FIXTURE_GUIDS.REGIONAL, {
      name_manager: "Synthetic Regional",
      email: "regional@example.test",
    }),
  ]);
}

export function wholesaleRosterWithoutUnknown(): Buffer {
  return buildEmployeeRosterBytes([
    buildEmployeeRosterEntry(EXTENDED_FIXTURE_GUIDS.MANAGER_A),
    buildEmployeeRosterEntry(EXTENDED_FIXTURE_GUIDS.REGIONAL),
  ]);
}
