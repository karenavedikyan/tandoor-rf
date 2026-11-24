-- Cheap, transactional invalidation of the bot-only catalogue view.
-- Separate rows avoid making thumbnail writes contend with 1C group writes.
CREATE TABLE public.tanbot_catalog_source_revisions (
  source_table TEXT PRIMARY KEY,
  revision BIGINT NOT NULL DEFAULT 0
);

INSERT INTO public.tanbot_catalog_source_revisions (source_table) VALUES
  ('internal_catalog_snapshots'),
  ('internal_catalog_products'),
  ('internal_catalog_thumbnails'),
  ('onec_manual_object_versions'),
  ('onec_manual_records'),
  ('onec_manual_batches');

CREATE FUNCTION public.bump_tanbot_catalog_source_revision()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = pg_catalog
AS $$
BEGIN
  UPDATE public.tanbot_catalog_source_revisions
  SET revision = revision + 1 WHERE source_table = TG_TABLE_NAME;
  RETURN NULL;
END;
$$;

REVOKE ALL ON TABLE public.tanbot_catalog_source_revisions FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bump_tanbot_catalog_source_revision() FROM PUBLIC;

DO $$
DECLARE
  source TEXT;
BEGIN
  FOR source IN SELECT source_table FROM public.tanbot_catalog_source_revisions LOOP
    EXECUTE format(
      'CREATE TRIGGER tanbot_catalog_view_changed
       AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.%I
       FOR EACH STATEMENT EXECUTE FUNCTION public.bump_tanbot_catalog_source_revision()',
      source
    );
  END LOOP;
END;
$$;
