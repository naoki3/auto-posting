import Anthropic from "@anthropic-ai/sdk";
import type { TopPost } from "@/lib/analytics";
import type { NewsArticle } from "@/lib/news";
import { countTweetLength } from "@/lib/validator";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export interface GeneratedPost {
  content: string;
  prompt: string;
  strategy: "inspired_by_top" | "fallback";
}

/**
 * AIで投稿文を生成する（140文字以内になるまで最大3回リトライ）
 */
export async function generatePost(
  topPost: TopPost | null
): Promise<GeneratedPost> {
  const { prompt, strategy } = topPost
    ? buildInspiredPrompt(topPost)
    : buildFallbackPrompt();

  for (let attempt = 1; attempt <= 3; attempt++) {
    const retryNote =
      attempt > 1
        ? `\n\n※前回の出力が140文字を超えました。必ず140文字以内に収めてください。`
        : "";

    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 512,
      messages: [{ role: "user", content: prompt + retryNote }],
    });

    const rawContent = message.content[0];
    if (rawContent.type !== "text") {
      throw new Error("Unexpected response type from AI");
    }

    const content = rawContent.text.trim();
    if (countTweetLength(content) <= 140) {
      return { content, prompt, strategy };
    }

    console.warn(`[ai] Attempt ${attempt}: ${countTweetLength(content)} chars, retrying...`);
  }

  throw new Error("Failed to generate a post within 140 characters after 3 attempts");
}

/**
 * 前日バズ投稿を分析して、その「勝ちパターン」を再現するプロンプト
 */
function buildInspiredPrompt(topPost: TopPost): {
  prompt: string;
  strategy: "inspired_by_top";
} {
  const prompt = `あなたはX（旧Twitter）のバズる投稿を作る専門家です。

【前日にバズった投稿】
---
${topPost.content}
---
パフォーマンス: いいね ${topPost.likes} / リポスト ${topPost.reposts} / インプレッション ${topPost.impressions}

この投稿がバズった理由を以下の観点で分析してください:
- どんな感情（共感・驚き・学び・笑い）を引き起こしているか
- フックの構造（問いかけ・数字・逆説・体験談など）
- どんな読者層に刺さったか

その分析をもとに、**同じ「なぜ刺さるか」の本質を維持しつつ**、内容は全く別のテーマで新しい投稿を1つ作成してください。

【制約】
- 全体で140文字以内
- 構成: フック（共感・驚き）→ 価値（具体的情報）→ CTA（行動喚起）
- 女性らしい自然な口語体（「〜だよ」「〜してみて」「〜なんだよね」など）
- AIっぽい硬い表現や男性的な断定表現は避ける
- ハッシュタグは使わない
- 絵文字は2〜3個まで
- 前日の投稿をそのままコピーしない（テーマを変えること）

投稿文のみを出力してください。分析や前置きは不要です。`;

  return { prompt, strategy: "inspired_by_top" };
}

/**
 * フォールバック: 前日データがない場合の汎用プロンプト
 */
function buildFallbackPrompt(): {
  prompt: string;
  strategy: "fallback";
} {
  const prompt = `あなたはX（旧Twitter）のバズる投稿を作る専門家です。

今日のX投稿文を1つ作成してください。

【構成ルール（必ず守ること）】
1. フック（1〜2行）: 読者が「わかる」「これ自分のことだ」と共感する問いかけや事実
2. 本文（3〜5行）: 具体的で価値ある情報。箇条書きOK
3. CTA（1行）: 「いいね」「保存」「フォロー」など自然な行動喚起

【制約】
- 全体で140文字以内
- 改行を適切に使うこと
- 女性らしい自然な口語体（「〜だよ」「〜してみて」「〜なんだよね」など）
- AIっぽい硬い表現や男性的な断定表現は避ける
- ハッシュタグは使わない
- 絵文字は2〜3個まで

投稿文のみを出力してください。前置きや説明は不要です。`;

  return { prompt, strategy: "fallback" };
}

/**
 * ニュース記事を要約してX投稿文を生成する（最大3回リトライ）
 * 形式: 何が起きたか（2〜3行）+ 一言コメント + URL
 * URLはXで23文字固定なので本文は約115文字以内
 */
export async function generateNewsPost(article: NewsArticle): Promise<string> {
  const prompt = `あなたはニュースをわかりやすく伝えるX（旧Twitter）投稿の専門家です。

以下のニュース記事をもとに、X投稿文を1つ作成してください。

【記事タイトル】
${article.title}

【記事概要】
${article.description}

【投稿フォーマット】
1行目〜3行目: 何が起きたかを簡潔に（2〜3行）
最終行: 一言コメント（感想・意見・驚き）

【制約】
- URL（23文字）を末尾に付けるので、本文は110文字以内に収めること
- 女性らしい自然な口語体（「〜だね」「〜みたい」「〜なのかな」など）
- 絵文字は1〜2個まで
- ハッシュタグは使わない
- AIっぽい硬い表現は避ける

投稿本文のみを出力してください（URLは含めない）。`;

  for (let attempt = 1; attempt <= 3; attempt++) {
    const retryNote =
      attempt > 1
        ? `\n\n※前回の出力が長すぎました。本文を110文字以内に収めてください。`
        : "";

    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 256,
      messages: [{ role: "user", content: prompt + retryNote }],
    });

    const rawContent = message.content[0];
    if (rawContent.type !== "text") {
      throw new Error("Unexpected response type from AI");
    }

    const body = rawContent.text.trim();
    const full = `${body}\n${article.url}`;

    if (countTweetLength(full) <= 140) {
      return full;
    }

    console.warn(`[ai] News attempt ${attempt}: ${countTweetLength(full)} chars, retrying...`);
  }

  throw new Error("Failed to generate news post within 140 characters after 3 attempts");
}

