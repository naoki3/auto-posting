-- auto-posting initial schema migration
-- Run this SQL against your Neon database to set up tables

CREATE TYPE "public"."post_status" AS ENUM('pending', 'posted', 'failed', 'skipped');

CREATE TABLE IF NOT EXISTS "accounts" (
  "account_id" varchar(100) PRIMARY KEY NOT NULL,
  "access_token" text NOT NULL,
  "access_secret" text NOT NULL,
  "description" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "posts" (
  "id" serial PRIMARY KEY NOT NULL,
  "content" text NOT NULL,
  "account_id" varchar(100) NOT NULL REFERENCES "accounts"("account_id"),
  "tweet_id" varchar(50),
  "posted_at" timestamp,
  "status" "post_status" DEFAULT 'pending' NOT NULL,
  "theme" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "analytics" (
  "id" serial PRIMARY KEY NOT NULL,
  "post_id" integer NOT NULL REFERENCES "posts"("id"),
  "likes" integer DEFAULT 0 NOT NULL,
  "impressions" integer DEFAULT 0 NOT NULL,
  "reposts" integer DEFAULT 0 NOT NULL,
  "recorded_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "prompts" (
  "id" serial PRIMARY KEY NOT NULL,
  "prompt" text NOT NULL,
  "output" text NOT NULL,
  "theme" text,
  "post_id" integer REFERENCES "posts"("id"),
  "created_at" timestamp DEFAULT now() NOT NULL
);
