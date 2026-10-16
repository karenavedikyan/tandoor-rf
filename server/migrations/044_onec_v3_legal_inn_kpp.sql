-- Exchange v3: root inn/kpp on legal entities (confirmed all_clients.json contract).

ALTER TABLE onec_v3_legal_entities
  ADD COLUMN IF NOT EXISTS inn TEXT,
  ADD COLUMN IF NOT EXISTS kpp TEXT;

COMMENT ON COLUMN onec_v3_legal_entities.inn IS 'ИНН юрлица из корня all_clients.json (string, leading zeros preserved).';
COMMENT ON COLUMN onec_v3_legal_entities.kpp IS 'КПП юрлица из корня all_clients.json (string, nullable for ИП).';
