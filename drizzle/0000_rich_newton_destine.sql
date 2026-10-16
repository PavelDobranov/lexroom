CREATE TABLE `documents` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`type` text NOT NULL,
	`pages` integer NOT NULL,
	`uploaded_at` text NOT NULL,
	`uploaded_by_lawyer_id` text NOT NULL,
	`supersedes_document_id` text,
	FOREIGN KEY (`uploaded_by_lawyer_id`) REFERENCES `lawyers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`supersedes_document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "documents_title_non_empty" CHECK(length(trim("documents"."title")) > 0),
	CONSTRAINT "documents_type_non_empty" CHECK(length(trim("documents"."type")) > 0),
	CONSTRAINT "documents_pages_positive_integer" CHECK(typeof("documents"."pages") = 'integer' and "documents"."pages" > 0),
	CONSTRAINT "documents_uploaded_at_iso_8601_utc" CHECK(
        substr("documents"."uploaded_at", 1, 19) glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]'
        and strftime('%Y-%m-%dT%H:%M:%S', unixepoch("documents"."uploaded_at"), 'unixepoch') = substr("documents"."uploaded_at", 1, 19)
        and (
          (length("documents"."uploaded_at") = 20 and substr("documents"."uploaded_at", 20, 1) = 'Z')
          or (
            length("documents"."uploaded_at") > 21
            and substr("documents"."uploaded_at", 20, 1) = '.'
            and substr("documents"."uploaded_at", -1, 1) = 'Z'
            and substr("documents"."uploaded_at", 21, length("documents"."uploaded_at") - 21) not glob '*[^0-9]*'
          )
        )
      )
);
--> statement-breakpoint
CREATE TABLE `lawyers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`title` text NOT NULL,
	CONSTRAINT "lawyers_name_non_empty" CHECK(length(trim("lawyers"."name")) > 0),
	CONSTRAINT "lawyers_title_non_empty" CHECK(length(trim("lawyers"."title")) > 0)
);
