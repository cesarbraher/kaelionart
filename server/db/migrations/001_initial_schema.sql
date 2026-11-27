-- KAELION.ART — Migración 001: Esquema inicial del portal de clientes y panel del taller
-- Motor: MySQL 8.0+ InnoDB · Charset: utf8mb4 · Fechas almacenadas en UTC

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  email_normalized VARCHAR(255) NOT NULL,
  email_raw VARCHAR(255) NOT NULL,
  full_name VARCHAR(160) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('client', 'admin') NOT NULL DEFAULT 'client',
  email_verified_at DATETIME(3) NULL,
  mfa_secret_enc VARCHAR(512) NULL,
  mfa_enabled TINYINT(1) NOT NULL DEFAULT 0,
  status ENUM('active', 'disabled') NOT NULL DEFAULT 'active',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email_normalized (email_normalized),
  KEY idx_users_role_status (role, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS email_tokens (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  token_hash CHAR(64) NOT NULL,
  purpose ENUM('verify_email', 'password_reset') NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  used_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_email_tokens_hash (token_hash),
  KEY idx_email_tokens_user_purpose (user_id, purpose),
  CONSTRAINT fk_email_tokens_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sessions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  token_hash CHAR(64) NOT NULL,
  csrf_token CHAR(64) NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  ip_address VARCHAR(64) NULL,
  user_agent VARCHAR(255) NULL,
  expires_at DATETIME(3) NOT NULL,
  revoked_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_sessions_token_hash (token_hash),
  KEY idx_sessions_user_active (user_id, revoked_at, expires_at),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS orders (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  folio VARCHAR(32) NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  status ENUM(
    'brief_saved',
    'awaiting_payment',
    'paid',
    'proposals_ready',
    'proposal_selected',
    'revision_requested',
    'revision_ready',
    'approved',
    'delivered',
    'refunded',
    'cancelled'
  ) NOT NULL DEFAULT 'brief_saved',
  product_code VARCHAR(64) NOT NULL DEFAULT 'smart_logo_promo',
  product_name VARCHAR(160) NOT NULL DEFAULT 'Diseño inteligente de logotipos',
  currency CHAR(3) NOT NULL DEFAULT 'mxn',
  amount_total_cents INT UNSIGNED NOT NULL DEFAULT 25000,
  selected_proposal_id BIGINT UNSIGNED NULL,
  revision_rounds_used TINYINT UNSIGNED NOT NULL DEFAULT 0,
  max_revision_rounds TINYINT UNSIGNED NOT NULL DEFAULT 3,
  paid_at DATETIME(3) NULL,
  approved_at DATETIME(3) NULL,
  approved_by_user_id BIGINT UNSIGNED NULL,
  approved_version INT UNSIGNED NULL,
  delivered_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_orders_folio (folio),
  KEY idx_orders_user_created (user_id, created_at),
  KEY idx_orders_status_created (status, created_at),
  CONSTRAINT fk_orders_user FOREIGN KEY (user_id) REFERENCES users (id),
  CONSTRAINT fk_orders_approved_by FOREIGN KEY (approved_by_user_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS briefs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id BIGINT UNSIGNED NOT NULL,
  brand_name VARCHAR(160) NOT NULL,
  contact_name VARCHAR(160) NOT NULL,
  contact_phone VARCHAR(40) NOT NULL,
  contact_email VARCHAR(255) NOT NULL,
  activity TEXT NOT NULL,
  target_audience TEXT NOT NULL,
  differentiator TEXT NOT NULL,
  personality VARCHAR(255) NOT NULL,
  usage_channels VARCHAR(255) NOT NULL,
  slogan VARCHAR(255) NULL,
  color_preferences TEXT NULL,
  style_preferences TEXT NULL,
  avoid_elements TEXT NULL,
  reference_links JSON NOT NULL,
  notes TEXT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_briefs_order_id (order_id),
  CONSTRAINT fk_briefs_order FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS checkout_attempts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id BIGINT UNSIGNED NOT NULL,
  stripe_session_id VARCHAR(128) NOT NULL,
  idempotency_key VARCHAR(128) NOT NULL,
  status ENUM('open', 'async_pending', 'complete', 'expired', 'failed') NOT NULL DEFAULT 'open',
  checkout_url TEXT NULL,
  amount_total_cents INT UNSIGNED NOT NULL DEFAULT 25000,
  currency CHAR(3) NOT NULL DEFAULT 'mxn',
  expires_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_checkout_attempts_stripe_session (stripe_session_id),
  UNIQUE KEY uq_checkout_attempts_idempotency (idempotency_key),
  KEY idx_checkout_attempts_order_status (order_id, status),
  CONSTRAINT fk_checkout_attempts_order FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS stripe_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  stripe_event_id VARCHAR(128) NOT NULL,
  event_type VARCHAR(96) NOT NULL,
  livemode TINYINT(1) NOT NULL DEFAULT 0,
  order_id BIGINT UNSIGNED NULL,
  outcome VARCHAR(64) NOT NULL,
  processed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_stripe_events_event_id (stripe_event_id),
  KEY idx_stripe_events_order (order_id),
  CONSTRAINT fk_stripe_events_order FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS private_files (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id BIGINT UNSIGNED NOT NULL,
  uploaded_by_user_id BIGINT UNSIGNED NOT NULL,
  purpose ENUM(
    'reference',
    'proposal',
    'revision',
    'final_ai',
    'final_svg',
    'final_pdf',
    'final_png',
    'final_jpg'
  ) NOT NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  storage_key VARCHAR(255) NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  mime_type VARCHAR(120) NOT NULL,
  detected_ext VARCHAR(16) NOT NULL,
  size_bytes BIGINT UNSIGNED NOT NULL,
  sha256 CHAR(64) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_private_files_storage_key (storage_key),
  KEY idx_private_files_order_purpose (order_id, purpose, version),
  CONSTRAINT fk_private_files_order FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE CASCADE,
  CONSTRAINT fk_private_files_uploader FOREIGN KEY (uploaded_by_user_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS proposals (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id BIGINT UNSIGNED NOT NULL,
  position TINYINT UNSIGNED NOT NULL,
  title VARCHAR(160) NOT NULL,
  concept TEXT NOT NULL,
  file_id BIGINT UNSIGNED NOT NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  is_published TINYINT(1) NOT NULL DEFAULT 0,
  published_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_proposals_order_position_version (order_id, position, version),
  KEY idx_proposals_order_published (order_id, is_published),
  CONSTRAINT chk_proposals_position CHECK (position BETWEEN 1 AND 3),
  CONSTRAINT fk_proposals_order FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE CASCADE,
  CONSTRAINT fk_proposals_file FOREIGN KEY (file_id) REFERENCES private_files (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS revision_requests (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id BIGINT UNSIGNED NOT NULL,
  proposal_id BIGINT UNSIGNED NOT NULL,
  round_number TINYINT UNSIGNED NOT NULL,
  comments TEXT NOT NULL,
  status ENUM('open', 'addressed') NOT NULL DEFAULT 'open',
  response_notes TEXT NULL,
  revised_file_id BIGINT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  addressed_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_revision_requests_order_round (order_id, round_number),
  KEY idx_revision_requests_order_status (order_id, status),
  CONSTRAINT chk_revision_round CHECK (round_number BETWEEN 1 AND 3),
  CONSTRAINT fk_revision_requests_order FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE CASCADE,
  CONSTRAINT fk_revision_requests_proposal FOREIGN KEY (proposal_id) REFERENCES proposals (id),
  CONSTRAINT fk_revision_requests_file FOREIGN KEY (revised_file_id) REFERENCES private_files (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS outbox (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id BIGINT UNSIGNED NULL,
  recipient_email VARCHAR(255) NOT NULL,
  template_name VARCHAR(64) NOT NULL,
  subject VARCHAR(200) NOT NULL,
  payload_json JSON NOT NULL,
  status ENUM('pending', 'sent', 'failed') NOT NULL DEFAULT 'pending',
  attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
  max_attempts TINYINT UNSIGNED NOT NULL DEFAULT 5,
  last_error VARCHAR(255) NULL,
  next_attempt_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  sent_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_outbox_status_next (status, next_attempt_at),
  KEY idx_outbox_order (order_id),
  CONSTRAINT fk_outbox_order FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS audit_log (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  actor_user_id BIGINT UNSIGNED NULL,
  actor_role VARCHAR(16) NOT NULL DEFAULT 'system',
  action VARCHAR(80) NOT NULL,
  order_id BIGINT UNSIGNED NULL,
  target_type VARCHAR(40) NULL,
  target_id VARCHAR(64) NULL,
  outcome VARCHAR(32) NOT NULL DEFAULT 'ok',
  metadata_json JSON NULL,
  ip_address VARCHAR(64) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_audit_order_created (order_id, created_at),
  KEY idx_audit_action_created (action, created_at),
  CONSTRAINT fk_audit_actor FOREIGN KEY (actor_user_id) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT fk_audit_order FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
