CREATE TABLE `accounts` (
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
	CONSTRAINT "accounts_mcp_enum" CHECK("accounts"."mcp" IN ('calendar', 'notes')),
	CONSTRAINT "accounts_provider_enum" CHECK("accounts"."provider" IN ('google', 'microsoft')),
	CONSTRAINT "accounts_state_enum" CHECK("accounts"."state" IN ('active', 'needs_reauth', 'revoked')),
	CONSTRAINT "accounts_slug_format" CHECK("accounts"."slug" GLOB '[a-z0-9]*' AND "accounts"."slug" NOT GLOB '*[^a-z0-9-]*' AND length("accounts"."slug") <= 32),
	CONSTRAINT "accounts_provider_pairing" CHECK((("accounts"."mcp" = 'calendar' AND "accounts"."provider" = 'google') OR ("accounts"."mcp" = 'notes' AND "accounts"."provider" = 'microsoft')))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_mcp_slug` ON `accounts` (`mcp`,`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_identity` ON `accounts` (`mcp`,`provider`,`provider_subject`);--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_default` ON `accounts` (`mcp`) WHERE "accounts"."is_default" = 1;--> statement-breakpoint
CREATE TABLE `oauth_states` (
	`state` text PRIMARY KEY NOT NULL,
	`mcp` text NOT NULL,
	`provider` text NOT NULL,
	`slug` text NOT NULL,
	`code_verifier` text NOT NULL,
	`target_account_id` text,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`target_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "oauth_states_mcp_enum" CHECK("oauth_states"."mcp" IN ('calendar', 'notes')),
	CONSTRAINT "oauth_states_provider_enum" CHECK("oauth_states"."provider" IN ('google', 'microsoft'))
);
