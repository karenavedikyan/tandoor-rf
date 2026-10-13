/** Supported keys inside all_clients.json `other` — explicit map; unknown keys ignored at import. */
export const V3_SUPPORTED_CLIENT_OTHER_KEYS = [
  "Код",
  "НаименованиеПолное",
  "ЮрФизЛицо",
  "Оптовик_ОГРН",
  "Оптовик_ОсновнойДоговор",
  "Оптовик_ОсновноеСоглашение",
  "Оптовик_Наличные",
  "Оптовик_ДопустимаяСуммаЗадолженности",
  "Оптовик_ДопустимоеЧислоДнейЗадолженности",
  "Оптовик_КонтролироватьСуммуЗадолженности",
  "Оптовик_КонтролироватьЧислоДнейЗадолженности",
  "Оптовик_Неблагонадёжный",
  "Оптовик_КатегорияТорговойТочкиТандор",
  "Оптовик_ТипКлиентаТандор",
  "Оптовик_ВитринВсегоТандор",
  "Оптовик_ВитринТандорТандор",
  "Оптовик_ЭксклюзивТандор",
  "Оптовик_РетроБонус",
  "Оптовик_ЗапретСамовывоз",
  "Оптовик_КрайГород",
  "Оптовик_НаселенныйПункт",
  "БизнесРегион",
  "Комментарий",
] as const;

export type V3ClientOtherFields = Partial<Record<(typeof V3_SUPPORTED_CLIENT_OTHER_KEYS)[number], unknown>>;

export function pickSupportedOtherFields(raw: Record<string, unknown>): V3ClientOtherFields {
  const result: V3ClientOtherFields = {};
  for (const key of V3_SUPPORTED_CLIENT_OTHER_KEYS) {
    if (key in raw) {
      result[key] = raw[key];
    }
  }
  return result;
}
