CREATE TABLE users (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  business_name VARCHAR(160) NULL,
  email VARCHAR(190) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('team','customer') NOT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tickets (
  id VARCHAR(20) PRIMARY KEY,
  customer_id INT UNSIGNED NOT NULL,
  subject VARCHAR(200) NOT NULL,
  details TEXT NOT NULL,
  status ENUM('New','In progress','Waiting','Complete') NOT NULL DEFAULT 'New',
  eta_date DATE NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT tickets_customer_fk FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX tickets_customer_idx (customer_id),
  INDEX tickets_status_idx (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE contact_messages (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(190) NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ticket_messages (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  ticket_id VARCHAR(20) NOT NULL,
  author_id INT UNSIGNED NOT NULL,
  author_role ENUM('team','customer') NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT ticket_messages_ticket_fk FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
  INDEX ticket_messages_ticket_idx (ticket_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ticket_files (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  message_id BIGINT UNSIGNED NOT NULL,
  ticket_id VARCHAR(20) NOT NULL,
  name VARCHAR(200) NOT NULL,
  mime VARCHAR(100) NOT NULL,
  size INT UNSIGNED NOT NULL,
  data MEDIUMBLOB NOT NULL,
  CONSTRAINT ticket_files_message_fk FOREIGN KEY (message_id) REFERENCES ticket_messages(id) ON DELETE CASCADE,
  INDEX ticket_files_message_idx (message_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
