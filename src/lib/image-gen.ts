import OpenAI from "openai";
import * as fs from "fs";
import * as path from "path";
import Anthropic from "@anthropic-ai/sdk";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export interface ImagePostContent {
  imageBase64: string;
  tweetText: string;
}

/**
 * Claudeで今日のシーンテーマとツイート文を生成する
 */
async function generateTheme(): Promise<{ scene: string; tweetText: string }> {
  const today = new Date().toLocaleDateString("ja-JP", {
    month: "long",
    day: "numeric",
    weekday: "long",
  });

  const message = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 256,
    messages: [
      {
        role: "user",
        content: `今日は${today}です。
季節感や行事、日常のシーンをもとに、以下を考えてください。

1. 画像生成用のシーン説明（英語・1文）
   - 日本人女性・マスク着用・その日に合った服装と背景
   - 全身または上半身が映る自然な日常シーン
   - カジュアルで季節感のある普段着（露出は控えめ）
   - 楽しそうな自然な動作（カフェでスマホ・公園で読書・買い物・散歩・食事など）
   - スマホで撮ったようなスナップ写真風・自然光・作り込みすぎない雰囲気
   - 例: "A young Japanese woman wearing a mask and casual clothes, candid snapshot style, sitting at a cafe with a drink"

2. Xに投稿するツイート文（日本語・100文字以内）
   - 女性らしい自然な口語体
   - 絵文字1〜2個
   - 関連ハッシュタグ1〜2個を末尾に

以下の形式で出力してください（他の文章は不要）:
SCENE: [英語のシーン説明]
TWEET: [日本語のツイート文]`,
      },
    ],
  });

  const text =
    message.content[0].type === "text" ? message.content[0].text.trim() : "";
  const sceneMatch = text.match(/SCENE:\s*(.+)/);
  const tweetMatch = text.match(/TWEET:\s*(.+)/);

  return {
    scene: sceneMatch?.[1]?.trim() ?? "A young Japanese woman wearing a mask in a seasonal Japanese setting",
    tweetText: tweetMatch?.[1]?.trim() ?? "今日もいい一日になりますように✨ #日常",
  };
}

/**
 * キャラ画像を参照して新しいシーンの画像を生成する
 */
export async function generateCharacterImage(): Promise<ImagePostContent> {
  const { scene, tweetText } = await generateTheme();
  console.log(`[image-gen] Scene: ${scene}`);
  console.log(`[image-gen] Tweet: ${tweetText}`);

  const characterImagePath = path.join(process.cwd(), "public", "character.png");
  const imageBuffer = fs.readFileSync(characterImagePath);
  const imageFile = new File([imageBuffer], "character.png", { type: "image/png" });

  const prompt = `${scene}. Candid snapshot style, natural lighting, same character as the reference image: same face, same dark hair, same mask. Casual everyday fashion. Shot on smartphone, slightly imperfect, feels real and authentic, not overly polished or AI-generated looking.`;

  const response = await openai.images.edit({
    model: "gpt-image-1",
    image: imageFile,
    prompt,
    n: 1,
    size: "1024x1024",
  });

  const imageBase64 = response.data?.[0]?.b64_json;
  if (!imageBase64) {
    throw new Error("Image generation failed: no image data returned");
  }

  console.log(`[image-gen] Image generated successfully`);
  return { imageBase64, tweetText };
}
