import { buildExtendedClientsFileBytes, sampleExtendedHolding } from "./onec-clients-extended-fixtures";

/** Synthetic outlet shapes matching observed live 1C export (no PII). */
export function liveFormatOutlet(overrides: Record<string, unknown> = {}) {
  return {
    holding: "Synthetic Holding",
    warehouse: false,
    address: {
      store_address: "Synthetic store address",
      delivery_address: "",
      direction_of_the_route: "",
    },
    information_loading: {
      loading_on_monday: true,
      loading_time: "0001-01-01T09:30:00",
    },
    managers: {
      guid_regional_manager: "00000000-0000-0000-0000-000000000000",
      name_regional_manager: "",
      guid_hardware_manager: "00000000-0000-0000-0000-000000000000",
      name_hardware_manager: "",
      guid_head_of_the_sales_department: "00000000-0000-0000-0000-000000000000",
      name_head_of_the_sales_department: "",
    },
    contact_information: {
      store_phone: "",
      accountant_phone: "",
      accountant_email: "",
    },
    LPR_information: {
      name: "",
      post: "",
      date_of_birth: "0001-01-01T00:00:00",
      phone: "",
      email: "",
      bonus: 12.5,
      conditions_bonus: "",
    },
    additional_information: {
      status_tandoor_club: "",
      bonus_tandoor_club: 0,
    },
    ...overrides,
  };
}

export function buildLiveFormatClientsBytes(outletOverrides?: Record<string, unknown>) {
  return buildExtendedClientsFileBytes([
    sampleExtendedHolding({
      retail_outlets: [liveFormatOutlet(outletOverrides)],
    }),
  ]);
}
