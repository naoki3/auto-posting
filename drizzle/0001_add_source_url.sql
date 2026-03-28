-- posts テーブルに source_url カラムを追加（ニュース記事のURL重複除外用）
ALTER TABLE "posts" ADD COLUMN IF NOT EXISTS "source_url" text;
