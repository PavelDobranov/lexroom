CREATE TABLE `findings` (
	`review_id` text NOT NULL,
	`position` integer NOT NULL,
	`clause` text,
	`title` text NOT NULL,
	`severity` text NOT NULL,
	`excerpt` text,
	`explanation` text NOT NULL,
	`emitted_at` text NOT NULL,
	PRIMARY KEY(`review_id`, `position`),
	FOREIGN KEY (`review_id`) REFERENCES `reviews`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "findings_position_non_negative_integer" CHECK(typeof("findings"."position") = 'integer' and "findings"."position" >= 0),
	CONSTRAINT "findings_severity_enum" CHECK("findings"."severity" in ('low', 'medium', 'high')),
	CONSTRAINT "findings_emitted_at_iso_8601_utc" CHECK(
    substr("findings"."emitted_at", 1, 19) glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]'
    and unixepoch("findings"."emitted_at") is not null
    and strftime('%Y-%m-%dT%H:%M:%S', unixepoch("findings"."emitted_at"), 'unixepoch') = substr("findings"."emitted_at", 1, 19)
    and (
      (length("findings"."emitted_at") = 20 and substr("findings"."emitted_at", 20, 1) = 'Z')
      or (
        length("findings"."emitted_at") > 21
        and substr("findings"."emitted_at", 20, 1) = '.'
        and substr("findings"."emitted_at", -1, 1) = 'Z'
        and substr("findings"."emitted_at", 21, length("findings"."emitted_at") - 21) not glob '*[^0-9]*'
      )
    )
  )
);
--> statement-breakpoint
CREATE TABLE `reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`requested_by_lawyer_id` text NOT NULL,
	`request_id` text NOT NULL,
	`status` text NOT NULL,
	`allowance_month` text NOT NULL,
	`requested_at` text NOT NULL,
	`deadline_at` text NOT NULL,
	`completed_at` text,
	`failed_at` text,
	`failure_reason` text,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`requested_by_lawyer_id`) REFERENCES `lawyers`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "reviews_status_enum" CHECK("reviews"."status" in ('running', 'completed', 'failed')),
	CONSTRAINT "reviews_failure_reason_enum" CHECK("reviews"."failure_reason" is null or "reviews"."failure_reason" in ('ai_error', 'timed_out', 'interrupted')),
	CONSTRAINT "reviews_allowance_month_format" CHECK("reviews"."allowance_month" glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]'
        and cast(substr("reviews"."allowance_month", 6, 2) as integer) between 1 and 12),
	CONSTRAINT "reviews_requested_at_iso_8601_utc" CHECK(
    substr("reviews"."requested_at", 1, 19) glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]'
    and unixepoch("reviews"."requested_at") is not null
    and strftime('%Y-%m-%dT%H:%M:%S', unixepoch("reviews"."requested_at"), 'unixepoch') = substr("reviews"."requested_at", 1, 19)
    and (
      (length("reviews"."requested_at") = 20 and substr("reviews"."requested_at", 20, 1) = 'Z')
      or (
        length("reviews"."requested_at") > 21
        and substr("reviews"."requested_at", 20, 1) = '.'
        and substr("reviews"."requested_at", -1, 1) = 'Z'
        and substr("reviews"."requested_at", 21, length("reviews"."requested_at") - 21) not glob '*[^0-9]*'
      )
    )
  ),
	CONSTRAINT "reviews_deadline_at_iso_8601_utc" CHECK(
    substr("reviews"."deadline_at", 1, 19) glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]'
    and unixepoch("reviews"."deadline_at") is not null
    and strftime('%Y-%m-%dT%H:%M:%S', unixepoch("reviews"."deadline_at"), 'unixepoch') = substr("reviews"."deadline_at", 1, 19)
    and (
      (length("reviews"."deadline_at") = 20 and substr("reviews"."deadline_at", 20, 1) = 'Z')
      or (
        length("reviews"."deadline_at") > 21
        and substr("reviews"."deadline_at", 20, 1) = '.'
        and substr("reviews"."deadline_at", -1, 1) = 'Z'
        and substr("reviews"."deadline_at", 21, length("reviews"."deadline_at") - 21) not glob '*[^0-9]*'
      )
    )
  ),
	CONSTRAINT "reviews_completed_at_iso_8601_utc" CHECK("reviews"."completed_at" is null or (
    substr("reviews"."completed_at", 1, 19) glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]'
    and unixepoch("reviews"."completed_at") is not null
    and strftime('%Y-%m-%dT%H:%M:%S', unixepoch("reviews"."completed_at"), 'unixepoch') = substr("reviews"."completed_at", 1, 19)
    and (
      (length("reviews"."completed_at") = 20 and substr("reviews"."completed_at", 20, 1) = 'Z')
      or (
        length("reviews"."completed_at") > 21
        and substr("reviews"."completed_at", 20, 1) = '.'
        and substr("reviews"."completed_at", -1, 1) = 'Z'
        and substr("reviews"."completed_at", 21, length("reviews"."completed_at") - 21) not glob '*[^0-9]*'
      )
    )
  )),
	CONSTRAINT "reviews_failed_at_iso_8601_utc" CHECK("reviews"."failed_at" is null or (
    substr("reviews"."failed_at", 1, 19) glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]'
    and unixepoch("reviews"."failed_at") is not null
    and strftime('%Y-%m-%dT%H:%M:%S', unixepoch("reviews"."failed_at"), 'unixepoch') = substr("reviews"."failed_at", 1, 19)
    and (
      (length("reviews"."failed_at") = 20 and substr("reviews"."failed_at", 20, 1) = 'Z')
      or (
        length("reviews"."failed_at") > 21
        and substr("reviews"."failed_at", 20, 1) = '.'
        and substr("reviews"."failed_at", -1, 1) = 'Z'
        and substr("reviews"."failed_at", 21, length("reviews"."failed_at") - 21) not glob '*[^0-9]*'
      )
    )
  )),
	CONSTRAINT "reviews_running_has_no_terminal_fields" CHECK("reviews"."status" != 'running'
        or ("reviews"."completed_at" is null and "reviews"."failed_at" is null and "reviews"."failure_reason" is null)),
	CONSTRAINT "reviews_completed_has_completion_only" CHECK("reviews"."status" != 'completed'
        or ("reviews"."completed_at" is not null and "reviews"."failed_at" is null and "reviews"."failure_reason" is null)),
	CONSTRAINT "reviews_failed_has_failure_only" CHECK("reviews"."status" != 'failed'
        or ("reviews"."failed_at" is not null and "reviews"."failure_reason" is not null and "reviews"."completed_at" is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reviews_request_id_unique` ON `reviews` (`request_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `reviews_one_running_per_document` ON `reviews` (`document_id`) WHERE "reviews"."status" = 'running';--> statement-breakpoint
CREATE INDEX `reviews_allowance_month_status` ON `reviews` (`allowance_month`,`status`);--> statement-breakpoint
CREATE INDEX `reviews_document_requested_at` ON `reviews` (`document_id`,`requested_at`,`id`);--> statement-breakpoint
CREATE INDEX `reviews_document_completed_at` ON `reviews` (`document_id`,`completed_at`,`id`) WHERE "reviews"."status" = 'completed';