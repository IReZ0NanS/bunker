CREATE TABLE `players` (
	`id` text PRIMARY KEY NOT NULL,
	`room_code` text NOT NULL,
	`name` text NOT NULL,
	`token` text NOT NULL,
	`seat` integer NOT NULL,
	`ready` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`last_seen` integer NOT NULL,
	`character_json` text DEFAULT '[]' NOT NULL,
	`revealed_json` text DEFAULT '[]' NOT NULL,
	`vote_target` text,
	`vote_round` integer,
	`vote_phase` text,
	FOREIGN KEY (`room_code`) REFERENCES `rooms`(`code`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `players_room_idx` ON `players` (`room_code`,`seat`);--> statement-breakpoint
CREATE TABLE `rooms` (
	`code` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'lobby' NOT NULL,
	`settings_json` text NOT NULL,
	`phase` text DEFAULT 'lobby' NOT NULL,
	`round` integer DEFAULT 0 NOT NULL,
	`phase_ends_at` integer,
	`turn_seat` integer,
	`catastrophe_json` text,
	`bunker_json` text,
	`outside_json` text,
	`current_event_json` text,
	`runoff_json` text,
	`seats` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`log_json` text DEFAULT '[]' NOT NULL
);
