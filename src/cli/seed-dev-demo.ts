import { Pool, type PoolClient } from "pg";
import { hashPassword } from "../auth/password";
import { assertLocalDatabaseHost } from "../shared/test-database-guard";

const DEV_DATABASE_NAME = "tandoor_rf_dev";
const DEMO_PASSWORD = "LocalDev-Pass-1";
const SOURCE_SHA = "d".repeat(64);

const ROP_A = "a1111111-1111-4111-8111-111111111111";
const ROP_B = "a2222222-2222-4222-8222-222222222222";
const M1 = "b1111111-1111-4111-8111-111111111111";
const M2 = "b2222222-2222-4222-8222-222222222222";
const REGIONAL = "c1111111-1111-4111-8111-111111111111";
const DIRECTOR = "d1111111-1111-4111-8111-111111111111";
const CLIENT_M1 = "e1111111-1111-4111-8111-111111111111";
const CLIENT_M2 = "e2222222-2222-4222-8222-222222222222";
const OUTLET_M1 = "f1111111-1111-4111-8111-111111111111";
const OUTLET_M2 = "f2222222-2222-4222-8222-222222222222";

type DemoUser = {
  email: string;
  fullName: string;
  role: string;
  employeeId?: string;
};

const USERS: DemoUser[] = [
  { email: "admin@example.com", fullName: "Admin Demo", role: "admin" },
  {
    email: "director@example.com",
    fullName: "Director Demo",
    role: "director",
    employeeId: DIRECTOR,
  },
  { email: "rop-a@example.com", fullName: "ROP Alpha", role: "rop", employeeId: ROP_A },
  { email: "rop-b@example.com", fullName: "ROP Beta", role: "rop", employeeId: ROP_B },
  {
    email: "manager-m1@example.com",
    fullName: "Manager One",
    role: "manager",
    employeeId: M1,
  },
  {
    email: "manager-m2@example.com",
    fullName: "Manager Two",
    role: "manager",
    employeeId: M2,
  },
  {
    email: "regional@example.com",
    fullName: "Regional One",
    role: "regional_manager",
    employeeId: REGIONAL,
  },
];

function assertDevDemoTarget(url: string): void {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing demo seed when NODE_ENV=production.");
  }
  assertLocalDatabaseHost(url, "demo seed");
  let databaseName = "";
  try {
    databaseName = decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
  } catch {
    throw new Error("Refusing demo seed: invalid database URL.");
  }
  if (databaseName !== DEV_DATABASE_NAME) {
    throw new Error(
      `Refusing demo seed on database "${databaseName || "(empty)"}". Use ${DEV_DATABASE_NAME}.`,
    );
  }
}

function person(guid: string, name: string, state: "directory_unverified" | "not_provided" | "unassigned") {
  return { guid: state === "not_provided" || state === "unassigned" ? null : guid, name: state === "not_provided" ? "" : name, state };
}

function outletSnapshot(input: {
  guidStore: string;
  storeAddress: string;
  storePhone: string;
  sales: { guid: string; name: string };
  hardware: { guid: string; name: string } | null;
  rop: { guid: string; name: string };
  regional: { guid: string; name: string } | null;
}) {
  return {
    ordinal: 0,
    guidStore: input.guidStore,
    holdingName: "Synthetic TT",
    warehouse: false,
    outletGuidStatus: "confirmed",
    closed: false,
    closureStatus: "open",
    closureConfirmedInCurrentExport: true,
    closureHistory: [],
    address: {
      storeAddress: input.storeAddress,
      deliveryAddress: "",
      routeDirection: "",
    },
    loading: {
      loadingOnMonday: null,
      loadingOnTuesday: null,
      loadingOnWednesday: null,
      loadingOnThursday: null,
      loadingOnFriday: null,
      loadingOnSaturday: null,
      loadingOnSunday: null,
      loadingTime: null,
    },
    managers: {
      manager: person(input.sales.guid, input.sales.name, "directory_unverified"),
      regionalManager: input.regional
        ? person(input.regional.guid, input.regional.name, "directory_unverified")
        : person("", "", "not_provided"),
      hardwareManager: input.hardware
        ? person(input.hardware.guid, input.hardware.name, "directory_unverified")
        : person("", "", "not_provided"),
      headOfSales: person(input.rop.guid, input.rop.name, "directory_unverified"),
    },
    contacts: {
      storePhone: input.storePhone,
      accountantPhone: "",
      accountantEmail: "",
    },
    lpr: {
      name: "",
      post: "",
      dateOfBirth: null,
      phone: "",
      email: "",
      bonus: "",
      conditionsBonus: "",
    },
    additional: { statusTandoorClub: "", bonusTandoorClub: "" },
    provenance: {
      freshness: "current",
      sourceSha256: SOURCE_SHA,
      importedAt: "2026-01-01T10:00:00.000Z",
    },
    distributionAllowed: false,
  };
}

function clientSnapshot(input: {
  headOfSales: { guid: string; name: string };
  sales: { guid: string; name: string };
  hardware: { guid: string; name: string } | null;
  regional: { guid: string; name: string } | null;
  outlet: ReturnType<typeof outletSnapshot>;
}) {
  return {
    formatVersion: "extended_v1",
    sourceSha256: SOURCE_SHA,
    importedAt: "2026-01-01T10:00:00.000Z",
    isHolding: false,
    holdingLink: { state: "none", pendingGuid: null },
    clientManagerRosterState: "in_wholesale_roster",
    regionalManager: input.regional
      ? person(input.regional.guid, input.regional.name, "directory_unverified")
      : person("", "", "not_provided"),
    hardwareManager: input.hardware
      ? person(input.hardware.guid, input.hardware.name, "directory_unverified")
      : person("", "", "not_provided"),
    headOfSales: person(input.headOfSales.guid, input.headOfSales.name, "directory_unverified"),
    currentRetailOutlets: [input.outlet],
    retailOutletHistory: [],
    blocks: { clientExtendedReady: true, outletNormalizedReady: true },
  };
}

async function upsertUser(
  db: PoolClient,
  user: DemoUser,
  passwordHash: string,
): Promise<string> {
  const existing = await db.query<{ id: string }>(
    "SELECT id::text AS id FROM users WHERE email = $1",
    [user.email],
  );
  if (existing.rows[0]) {
    const id = existing.rows[0].id;
    await db.query(
      `
        UPDATE users
        SET password_hash = $2, full_name = $3, role = $4, status = 'active', phone = NULL
        WHERE id = $1::uuid
      `,
      [id, passwordHash, user.fullName, user.role],
    );
    return id;
  }
  const inserted = await db.query<{ id: string }>(
    `
      INSERT INTO users (email, password_hash, full_name, role, status)
      VALUES ($1, $2, $3, $4, 'active')
      RETURNING id::text AS id
    `,
    [user.email, passwordHash, user.fullName, user.role],
  );
  return inserted.rows[0]!.id;
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for the demo seed.");
  }
  assertDevDemoTarget(databaseUrl);

  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const ids = new Map<string, string>();
    for (const user of USERS) {
      const id = await upsertUser(client, user, passwordHash);
      ids.set(user.email, id);
      if (!user.employeeId) {
        continue;
      }
      const link = await client.query(
        `
          UPDATE user_onec_employee_links
          SET employee_id = $2::uuid,
              basis = $3,
              confirmed_by_user_id = $4::uuid,
              revoked_at = NULL,
              revoked_by_user_id = NULL,
              revoke_reason = NULL
          WHERE user_id = $1::uuid AND revoked_at IS NULL
        `,
        [id, user.employeeId, "local demo seed", ids.get("admin@example.com")],
      );
      if (link.rowCount === 0) {
        await client.query(
          `
            INSERT INTO user_onec_employee_links (user_id, employee_id, basis, confirmed_by_user_id)
            VALUES ($1::uuid, $2::uuid, $3, $4::uuid)
          `,
          [id, user.employeeId, "local demo seed", ids.get("admin@example.com")],
        );
      }
    }

    await client.query(
      `
        INSERT INTO onec_wholesale_roster_state (id, source_sha256, employee_count)
        VALUES (1, $1, 6)
        ON CONFLICT (id) DO UPDATE
        SET source_sha256 = EXCLUDED.source_sha256, employee_count = EXCLUDED.employee_count
      `,
      [SOURCE_SHA],
    );
    for (const [guid, name, post] of [
      [ROP_A, "ROP Alpha", "РОП"],
      [ROP_B, "ROP Beta", "РОП"],
      [M1, "Manager One", "Менеджер"],
      [M2, "Manager Two", "Менеджер"],
      [REGIONAL, "Regional One", "Региональный менеджер"],
      [DIRECTOR, "Director Demo", "Директор"],
    ] as const) {
      await client.query(
        `
          INSERT INTO onec_wholesale_employee_roster (guid_manager, name_manager, post, raw_json)
          VALUES ($1::uuid, $2, $3, '{}'::jsonb)
          ON CONFLICT (guid_manager) DO UPDATE
          SET name_manager = EXCLUDED.name_manager, post = EXCLUDED.post
        `,
        [guid, name, post],
      );
    }

    const adminId = ids.get("admin@example.com")!;
    for (const [ropEmail, memberEmail] of [
      ["rop-a@example.com", "manager-m1@example.com"],
      ["rop-b@example.com", "manager-m2@example.com"],
    ] as const) {
      await client.query(
        `
          INSERT INTO rop_team_members (rop_user_id, member_user_id, basis, created_by_user_id)
          SELECT $1::uuid, $2::uuid, $3, $4::uuid
          WHERE NOT EXISTS (
            SELECT 1 FROM rop_team_members
            WHERE rop_user_id = $1::uuid
              AND member_user_id = $2::uuid
              AND revoked_at IS NULL
          )
        `,
        [ids.get(ropEmail), ids.get(memberEmail), "local demo seed", adminId],
      );
    }

    const outletM1 = outletSnapshot({
      guidStore: OUTLET_M1,
      storeAddress: "Synthetic Street 1",
      storePhone: "+70000000001",
      sales: { guid: M1, name: "Manager One" },
      hardware: { guid: M1, name: "Manager One" },
      rop: { guid: ROP_A, name: "ROP Alpha" },
      regional: { guid: REGIONAL, name: "Regional One" },
    });
    const outletM2 = outletSnapshot({
      guidStore: OUTLET_M2,
      storeAddress: "Synthetic Street 2",
      storePhone: "",
      sales: { guid: M2, name: "Manager Two" },
      hardware: null,
      rop: { guid: ROP_B, name: "ROP Beta" },
      regional: null,
    });
    const snapshotM1 = clientSnapshot({
      headOfSales: { guid: ROP_A, name: "ROP Alpha" },
      sales: { guid: M1, name: "Manager One" },
      hardware: { guid: M1, name: "Manager One" },
      regional: { guid: REGIONAL, name: "Regional One" },
      outlet: outletM1,
    });
    const snapshotM2 = clientSnapshot({
      headOfSales: { guid: ROP_B, name: "ROP Beta" },
      sales: { guid: M2, name: "Manager Two" },
      hardware: null,
      regional: null,
      outlet: outletM2,
    });

    for (const row of [
      {
        guid: CLIENT_M1,
        name: "Client M1",
        managerGuid: M1,
        managerName: "Manager One",
        phone: ["+70000000001"],
        address: "Synthetic Street 1",
        hardwareGuid: M1,
        hardwareName: "Manager One",
        headGuid: ROP_A,
        headName: "ROP Alpha",
        regionalGuid: REGIONAL,
        regionalName: "Regional One",
        snapshot: snapshotM1,
      },
      {
        guid: CLIENT_M2,
        name: "Client M2",
        managerGuid: M2,
        managerName: "Manager Two",
        phone: [],
        address: "Synthetic Street 2",
        hardwareGuid: null,
        hardwareName: "",
        headGuid: ROP_B,
        headName: "ROP Beta",
        regionalGuid: null,
        regionalName: "",
        snapshot: snapshotM2,
      },
    ]) {
      await client.query(
        `
          INSERT INTO onec_clients (
            guid_client, name_client, guid_manager, name_manager, address, telephone,
            source_sha256, manager_roster_state, baseline_status,
            guid_hardware_manager, name_hardware_manager, guid_head_sales, name_head_sales,
            guid_regional_manager, name_regional_manager,
            extended_format_version, extended_source_sha256, extended_freshness_state, extended_snapshot
          )
          VALUES (
            $1::uuid, $2, $3::uuid, $4, $5, $6::jsonb,
            $7, 'in_wholesale_roster', 'active',
            $8::uuid, $9, $10::uuid, $11,
            $12::uuid, $13,
            'extended_v1', $7, 'current', $14::jsonb
          )
          ON CONFLICT (guid_client) DO UPDATE SET
            name_client = EXCLUDED.name_client,
            guid_manager = EXCLUDED.guid_manager,
            name_manager = EXCLUDED.name_manager,
            address = EXCLUDED.address,
            telephone = EXCLUDED.telephone,
            source_sha256 = EXCLUDED.source_sha256,
            manager_roster_state = EXCLUDED.manager_roster_state,
            baseline_status = EXCLUDED.baseline_status,
            guid_hardware_manager = EXCLUDED.guid_hardware_manager,
            name_hardware_manager = EXCLUDED.name_hardware_manager,
            guid_head_sales = EXCLUDED.guid_head_sales,
            name_head_sales = EXCLUDED.name_head_sales,
            guid_regional_manager = EXCLUDED.guid_regional_manager,
            name_regional_manager = EXCLUDED.name_regional_manager,
            extended_format_version = EXCLUDED.extended_format_version,
            extended_source_sha256 = EXCLUDED.extended_source_sha256,
            extended_freshness_state = EXCLUDED.extended_freshness_state,
            extended_snapshot = EXCLUDED.extended_snapshot
        `,
        [
          row.guid,
          row.name,
          row.managerGuid,
          row.managerName,
          row.address,
          JSON.stringify(row.phone),
          SOURCE_SHA,
          row.hardwareGuid,
          row.hardwareName,
          row.headGuid,
          row.headName,
          row.regionalGuid,
          row.regionalName,
          JSON.stringify(row.snapshot),
        ],
      );
    }

    for (const outlet of [
      { store: OUTLET_M1, client: CLIENT_M1 },
      { store: OUTLET_M2, client: CLIENT_M2 },
    ]) {
      await client.query(
        `
          INSERT INTO onec_retail_outlets (
            guid_store, guid_client, is_closed, first_source_sha256, last_source_sha256
          )
          VALUES ($1::uuid, $2::uuid, FALSE, $3, $3)
          ON CONFLICT (guid_store) DO UPDATE SET
            guid_client = EXCLUDED.guid_client,
            is_closed = FALSE,
            last_source_sha256 = EXCLUDED.last_source_sha256
        `,
        [outlet.store, outlet.client, SOURCE_SHA],
      );
    }

    await client.query(
      `
        INSERT INTO onec_client_import_runs (
          status, mode, source_sha256, source_record_count, finished_at
        )
        SELECT 'success', 'apply', $1, 2, NOW()
        WHERE NOT EXISTS (
          SELECT 1 FROM onec_client_import_runs
          WHERE source_sha256 = $1 AND status = 'success'
        )
      `,
      [SOURCE_SHA],
    );

    const regionalId = ids.get("regional@example.com")!;
    await client.query(
      `
        DELETE FROM access_grants
        WHERE user_id = $1::uuid AND grant_type = 'client' AND revoked_at IS NULL
      `,
      [regionalId],
    );
    await client.query(
      `
        INSERT INTO access_grants (user_id, grant_type, object_id, basis, granted_by_user_id)
        VALUES ($1::uuid, 'client', $2::uuid, $3, $4::uuid)
      `,
      [regionalId, CLIENT_M1, "local demo seed", adminId],
    );

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }

  console.log(`Demo seed applied to ${DEV_DATABASE_NAME}.`);
  console.log("Accounts: admin, director, rop-a, rop-b, manager-m1, manager-m2, regional @example.com");
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Demo seed failed: ${message}`);
  process.exit(1);
});
