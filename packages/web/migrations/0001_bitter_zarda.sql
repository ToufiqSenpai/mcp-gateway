PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`mcp` text NOT NULL,
	`slug` text NOT NULL,
	`provider` text NOT NULL,
	`provider_subject` text NOT NULL,
	`email` text NOT NULL,
	`display_name` text,
	`access_token` text,
	`refresh_token` text,
	`access_token_expires_at` integer NOT NULL,
	`scopes` text NOT NULL,
	`state` text NOT NULL,
	`is_default` integer DEFAULT 0 NOT NULL,
	`cache_epoch` integer DEFAULT 0 NOT NULL,
	`refresh_lock_until` integer,
	`refresh_lock_token` text,
	`last_refreshed_at` integer,
	`last_error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`revoked_at` integer,
	CONSTRAINT "accounts_mcp_enum" CHECK("__new_accounts"."mcp" IN ('calendar', 'notes', 'sheets')),
	CONSTRAINT "accounts_provider_enum" CHECK("__new_accounts"."provider" IN ('google', 'microsoft')),
	CONSTRAINT "accounts_state_enum" CHECK("__new_accounts"."state" IN ('active', 'needs_reauth', 'revoked')),
	CONSTRAINT "accounts_slug_format" CHECK("__new_accounts"."slug" GLOB '[a-z0-9]*' AND "__new_accounts"."slug" NOT GLOB '*[^a-z0-9-]*' AND length("__new_accounts"."slug") <= 32),
	CONSTRAINT "accounts_provider_pairing" CHECK((("__new_accounts"."mcp" = 'calendar' AND "__new_accounts"."provider" = 'google') OR ("__new_accounts"."mcp" = 'notes' AND "__new_accounts"."provider" = 'microsoft') OR ("__new_accounts"."mcp" = 'sheets' AND "__new_accounts"."provider" = 'google')))
);
--> statement-breakpoint
INSERT INTO `__new_accounts`("id", "mcp", "slug", "provider", "provider_subject", "email", "display_name", "access_token", "refresh_token", "access_token_expires_at", "scopes", "state", "is_default", "cache_epoch", "refresh_lock_until", "refresh_lock_token", "last_refreshed_at", "last_error", "created_at", "updated_at", "revoked_at") SELECT "id", "mcp", "slug", "provider", "provider_subject", "email", "display_name", "access_token", "refresh_token", "access_token_expires_at", "scopes", "state", "is_default", "cache_epoch", "refresh_lock_until", "refresh_lock_token", "last_refreshed_at", "last_error", "created_at", "updated_at", "revoked_at" FROM `accounts`;--> statement-breakpoint
DROP TABLE `accounts`;--> statement-breakpoint
ALTER TABLE `__new_accounts` RENAME TO `accounts`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_mcp_slug` ON `accounts` (`mcp`,`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_identity` ON `accounts` (`mcp`,`provider`,`provider_subject`);--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_default` ON `accounts` (`mcp`) WHERE "accounts"."is_default" = 1;--> statement-breakpoint
CREATE TABLE `__new_oauth_states` (
	`state` text PRIMARY KEY NOT NULL,
	`mcp` text NOT NULL,
	`provider` text NOT NULL,
	`slug` text NOT NULL,
	`code_verifier` text NOT NULL,
	`target_account_id` text,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`target_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "oauth_states_mcp_enum" CHECK("__new_oauth_states"."mcp" IN ('calendar', 'notes', 'sheets')),
	CONSTRAINT "oauth_states_provider_enum" CHECK("__new_oauth_states"."provider" IN ('google', 'microsoft'))
);
--> statement-breakpoint
INSERT INTO `__new_oauth_states`("state", "mcp", "provider", "slug", "code_verifier", "target_account_id", "created_at", "expires_at") SELECT "state", "mcp", "provider", "slug", "code_verifier", "target_account_id", "created_at", "expires_at" FROM `oauth_states`;--> statement-breakpoint
DROP TABLE `oauth_states`;--> statement-breakpoint
ALTER TABLE `__new_oauth_states` RENAME TO `oauth_states`;