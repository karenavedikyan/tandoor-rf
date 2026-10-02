import { validateClientsFileBytes } from "../../src/onec-clients/validate";
import { buildClientsFileBytes, sampleClient, sampleClientTwo } from "./onec-clients-fixtures";

const HOLDING_GUID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CHILD_GUID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MANAGER_A = "22222222-2222-4222-8222-222222222222";
const MANAGER_B = "55555555-5555-4555-8555-555555555555";
const REGIONAL = "66666666-6666-4666-8666-666666666666";
const UNKNOWN = "99999999-9999-4999-8999-999999999999";

export function sampleExtendedHolding(overrides: Record<string, unknown> = {}) {
  return {
    guid_client: HOLDING_GUID,
    name_client: "Holding Alpha",
    guid_holding: "",
    name_holding: "",
    guid_manager: MANAGER_A,
    name_manager: "Manager One",
    address: "HQ Address",
    telephone: ["+79990001122"],
    holding: true,
    guid_regional_manager: REGIONAL,
    name_regional_manager: "Regional Lead",
    guid_hardware_manager: "",
    name_hardware_manager: "",
    guid_head_of_the_sales_department: "",
    name_head_of_the_sales_department: "",
    retail_outlets: [
      {
        holding: "Holding Alpha",
        warehouse: true,
        address: {
          store_address: "Store 1 street",
          delivery_address: "Delivery dock 1",
          direction_of_the_route: "North",
        },
        information_loading: {
          loading_on_monday: true,
          loading_on_wednesday: true,
          loading_time: "09:00",
        },
        managers: {
          guid_manager: "",
          name_manager: "",
          guid_regional_manager: REGIONAL,
          name_regional_manager: "Regional Lead",
          guid_hardware_manager: UNKNOWN,
          name_hardware_manager: "Unknown Hardware",
          guid_head_of_the_sales_department: "",
          name_head_of_the_sales_department: "",
        },
        contact_information: {
          store_phone: "+7 (495) 111-22-33",
          accountant_phone: "",
          accountant_email: "acc@example.test",
        },
        LPR_information: {
          name: "Secret LPR",
          post: "Director",
          date_of_birth: "1980-05-01",
          phone: "+79990000000",
          email: "lpr@example.test",
          bonus: "10",
          conditions_bonus: "Special",
        },
        additional_information: {
          status_tandoor_club: "active",
          bonus_tandoor_club: "5",
        },
      },
    ],
    ...overrides,
  };
}

export function sampleExtendedChild(overrides: Record<string, unknown> = {}) {
  return {
    guid_client: CHILD_GUID,
    name_client: "Child Shop",
    guid_holding: HOLDING_GUID,
    name_holding: "",
    guid_manager: MANAGER_B,
    name_manager: "Manager Two",
    address: "Child address",
    telephone: [],
    holding: false,
    retail_outlets: [
      {
        holding: "Holding Alpha",
        warehouse: false,
        address: {
          store_address: "Child store",
          delivery_address: "",
          direction_of_the_route: "",
        },
        information_loading: {
          loading_on_friday: true,
          loading_time: "10:30",
        },
        managers: {
          guid_manager: MANAGER_B,
          name_manager: "Manager Two",
          guid_regional_manager: "",
          name_regional_manager: "",
          guid_hardware_manager: "",
          name_hardware_manager: "",
          guid_head_of_the_sales_department: "",
          name_head_of_the_sales_department: "",
        },
        contact_information: {
          store_phone: "",
          accountant_phone: "",
          accountant_email: "",
        },
        LPR_information: {},
        additional_information: {},
      },
    ],
    ...overrides,
  };
}

export function buildExtendedClientsFileBytes(
  records: Record<string, unknown>[],
): Buffer {
  return buildClientsFileBytes(records);
}

export const EXTENDED_FIXTURE_GUIDS = {
  HOLDING_GUID,
  CHILD_GUID,
  MANAGER_A,
  MANAGER_B,
  REGIONAL,
  UNKNOWN,
};

export function legacyOnlyFileBytes(): Buffer {
  return buildClientsFileBytes([sampleClient(), sampleClientTwo()]);
}

/** Test-only: apply extended snapshots with explicitly confirmed synthetic contract. */
export function validateClientsForApplyTest(bytes: Buffer) {
  return validateClientsFileBytes(bytes, { extendedContractVerification: "synthetic_confirmed" });
}
