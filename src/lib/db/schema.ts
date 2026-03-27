import {
  pgTable,
  serial,
  text,
  timestamp,
  integer,
  varchar,
  pgEnum,
} from "drizzle-orm/pg-core";

// ステータス enum
export const postStatusEnum = pgEnum("post_status", [
  "pending",
  "posted",
  "failed",
  "skipped",
]);

// アカウントテーブル
export const accounts = pgTable("accounts", {
  accountId: varchar("account_id", { length: 100 }).primaryKey(),
  accessToken: text("access_token").notNull(),
  accessSecret: text("access_secret").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// 投稿テーブル
export const posts = pgTable("posts", {
  id: serial("id").primaryKey(),
  content: text("content").notNull(),
  accountId: varchar("account_id", { length: 100 })
    .notNull()
    .references(() => accounts.accountId),
  tweetId: varchar("tweet_id", { length: 50 }),
  postedAt: timestamp("posted_at"),
  status: postStatusEnum("status").default("pending").notNull(),
  theme: text("theme"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// 分析テーブル
export const analytics = pgTable("analytics", {
  id: serial("id").primaryKey(),
  postId: integer("post_id")
    .notNull()
    .references(() => posts.id),
  likes: integer("likes").default(0).notNull(),
  impressions: integer("impressions").default(0).notNull(),
  reposts: integer("reposts").default(0).notNull(),
  recordedAt: timestamp("recorded_at").defaultNow().notNull(),
});

// プロンプト履歴テーブル
export const prompts = pgTable("prompts", {
  id: serial("id").primaryKey(),
  prompt: text("prompt").notNull(),
  output: text("output").notNull(),
  theme: text("theme"),
  postId: integer("post_id").references(() => posts.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
