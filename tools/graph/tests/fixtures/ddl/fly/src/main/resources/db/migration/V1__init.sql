-- Synthetic: a versioned-file tool's MySQL migrations.
CREATE TABLE customers (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  email VARCHAR(255) NOT NULL,
  tier ENUM('free','pro') NOT NULL DEFAULT 'free',
  PRIMARY KEY (id),
  UNIQUE KEY customers_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
