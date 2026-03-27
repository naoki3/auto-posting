import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export interface GeneratedPost {
  content: string;
  prompt: string;
}

// 投稿テーマのリスト（毎日ローテーション）
const THEMES = [
  "生産性向上のコツ",
  "AIを使った仕事術",
  "朝のルーティンで変わる1日",
  "副業・フリーランスの現実",
  "読書から学んだこと",
  "マインドセットの重要性",
  "時間管理の本質",
  "人間関係を楽にするコツ",
  "お金の考え方を変える",
  "継続できる習慣の作り方",
  "集中力を高める環境づくり",
  "失敗から立ち直る力",
  "目標設定の落とし穴",
  "SNSとの正しい付き合い方",
];

/**
 * 今日のテーマを日付から決定する
 */
export function getTodayTheme(): string {
  const today = new Date();
  const dayOfYear =
    Math.floor(
      (today.getTime() - new Date(today.getFullYear(), 0, 0).getTime()) /
        86400000
    ) - 1;
  return THEMES[dayOfYear % THEMES.length];
}

/**
 * AIで投稿文を生成する
 * 構成: フック（共感）→ 価値（本文）→ CTA（行動）
 */
export async function generatePost(theme: string): Promise<GeneratedPost> {
  const prompt = buildPrompt(theme);

  const message = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 512,
    messages: [
      {
        role: "user",
        content: prompt,
      },
    ],
  });

  const rawContent = message.content[0];
  if (rawContent.type !== "text") {
    throw new Error("Unexpected response type from AI");
  }

  const content = rawContent.text.trim();
  return { content, prompt };
}

function buildPrompt(theme: string): string {
  return `あなたはX（旧Twitter）のバズる投稿を作る専門家です。

以下のテーマで、X投稿文を1つ作成してください。

テーマ: ${theme}

【構成ルール（必ず守ること）】
1. フック（1〜2行）: 読者が「わかる」「これ自分のことだ」と共感する問いかけや事実
2. 本文（3〜5行）: 具体的で価値ある情報。箇条書きOK
3. CTA（1行）: 「いいね」「保存」「フォロー」など自然な行動喚起

【制約】
- 全体で140文字以内に収めること
- 改行を適切に使うこと
- AIっぽい硬い表現を避け、人間らしい口語体で書くこと
- ハッシュタグは使わない
- 絵文字は2〜3個まで

投稿文のみを出力してください。前置きや説明は不要です。`;
}
