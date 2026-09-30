-- R2.2 work tab: task summary publication and contact-responsible actions

CREATE TABLE IF NOT EXISTS bitrix24_task_summary_publications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portal_id VARCHAR(255) NOT NULL,
  task_id VARCHAR(64) NOT NULL,
  object_type bitrix24_object_type NOT NULL,
  object_guid UUID NOT NULL,
  brief_text TEXT NOT NULL,
  published_by_user_id UUID NOT NULL REFERENCES users (id),
  confirmed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  CONSTRAINT bitrix24_task_summary_publications_brief_not_blank CHECK (BTRIM(brief_text) <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS bitrix24_task_summary_publications_active_uq
  ON bitrix24_task_summary_publications (portal_id, task_id)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS bitrix24_task_summary_publications_object_idx
  ON bitrix24_task_summary_publications (portal_id, object_type, object_guid)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS bitrix24_task_contact_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portal_id VARCHAR(255) NOT NULL,
  task_id VARCHAR(64) NOT NULL,
  object_type bitrix24_object_type NOT NULL,
  object_guid UUID NOT NULL,
  actor_user_id UUID NOT NULL REFERENCES users (id),
  action_type TEXT NOT NULL DEFAULT 'contact_responsible'
    CHECK (action_type = 'contact_responsible'),
  marked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  comment_text TEXT,
  revoked_at TIMESTAMPTZ,
  CONSTRAINT bitrix24_task_contact_actions_comment_len CHECK (
    comment_text IS NULL OR char_length(BTRIM(comment_text)) <= 2000
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS bitrix24_task_contact_actions_active_uq
  ON bitrix24_task_contact_actions (
    portal_id, task_id, object_type, object_guid, actor_user_id, action_type
  )
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS bitrix24_task_contact_action_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_id UUID NOT NULL REFERENCES bitrix24_task_contact_actions (id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('marked', 'revoked', 'comment_updated')),
  actor_user_id UUID NOT NULL REFERENCES users (id),
  comment_text TEXT,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS bitrix24_task_contact_action_history_action_idx
  ON bitrix24_task_contact_action_history (action_id, recorded_at DESC);
