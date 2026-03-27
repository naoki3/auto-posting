import Anthropic from "@anthropic-ai/sdk";
import type { TopPost } from "@/lib/analytics";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export interface GeneratedPost {
  content: string;
  prompt: string;
  strategy: "inspired_by_top" | "fallback";
}

/**
 * AIで投稿文を生成する
 * topPost がある場合: 前日バズ投稿を分析して同じ「なぜ刺さったか」を活かす
 * topPost がない場合: フォールバックとして汎用プロンプトで生成
 */
export async function generatePost(
  topPost: TopPost | null
): Promise<GeneratedPost> {
  const { prompt, strategy } = topPost
    ? buildInspiredPrompt(topPost)
    : buildFallbackPrompt();

  const message = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 512,
    messages: [{ role: "user", content: prompt }],
  });

  const rawContent = message.content[0];
  if (rawContent.type !== "text") {
    throw new Error("Unexpected response type from AI");
  }

  return { content: rawContent.text.trim(), prompt, strategy };
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
