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
    max_tokens: 512,
    messages: [
      {
        role: "user",
        content: `今日は${today}です。
かわいい日本人女性の画像を生成するための設定を考えてください。
毎回バラエティ豊かで面白いものにしてください。

以下の項目をすべて日本語で決めてください：
・場所: （例：渋谷のカフェ、沖縄のビーチ、雪山のロッジなど）
・時間帯: （例：昼下がり、夕暮れ、深夜など）
・天気: （例：晴れ、小雨、雪など）
・服装: （例：ミニスカートにキャミソール、水着、浴衣の着崩しなど。露出は少し多めで）
・髪型: （例：ゆるいポニーテール、おろしたまま、お団子など）
・表情: （例：笑顔、驚いた顔、真剣な顔など）
・カメラ: （例：スマホの自撮り、友達に撮ってもらった、盗み撮り風など）
・雰囲気: （例：賑やか、ほっこり、ドキドキなど）
・テーマ: （例：夏の思い出、女子会、一人旅など）

それをもとに：
1. OpenAI画像生成用の英語プロンプト（1〜2文。上記の設定をすべて含める）
2. Xに投稿するツイート文（日本語・100文字以内・女性らしい口語体・絵文字1〜2個・関連ハッシュタグ1〜2個を末尾に）

以下の形式で出力してください（他の文章は不要）:
SCENE: [英語プロンプト]
TWEET: [日本語ツイート文]`,
      },
    ],
  });

  const text =
    message.content[0].type === "text" ? message.content[0].text.trim() : "";
  const sceneMatch = text.match(/SCENE:\s*(.+)/);
  const tweetMatch = text.match(/TWEET:\s*(.+)/);

  let tweetText = tweetMatch?.[1]?.trim() ?? "今日もいい一日になりますように✨ #日常";
  // @で始まるとリプライ扱いになるため除去
  tweetText = tweetText.replace(/^@+/, "");

  return {
    scene: sceneMatch?.[1]?.trim() ?? "A young Japanese woman wearing a mask in a seasonal Japanese setting",
    tweetText,
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

  const prompt = `${scene}. Same character as the reference image: same face, same dark hair, same mask. Cute and charming Japanese girl. Photorealistic, natural lighting, feels candid and authentic.`;

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
