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
かわいい日本人女性の写真のシーンを考えてください。
毎回バラエティ豊かで面白いものにしてください。

以下の項目をすべて日本語で決めてください：
・場所: 実在する具体的な場所（例：原宿のタピオカ屋の前、京都の伏見稲荷の参道、新宿の居酒屋、渋谷スクランブル交差点の歩道橋など）
・時間帯: （例：昼下がり、夕暮れ、夜など）
・天気・光: （例：晴れで木漏れ日、曇り空、夜のネオン照明など）
・服装: 季節や場所に合ったリアルな日常コーデ（例：デニムジャケットとワンピース、ゆったりしたニットにスカートなど）
・髪型: （例：ゆるいポニーテール、おろしたまま、お団子など）
・表情・ポーズ: 自然な日常の一瞬（例：カメラを見て微笑む、横を向いて笑っている、飲み物を持っているなど）
・カメラ: （例：スマホの自撮り、友達に撮ってもらった、街中で自然に撮ったなど）

それをもとに：
1. OpenAI画像生成用の英語プロンプト（2〜3文。「shot on iPhone」「candid photo」「real place」などリアルな写真らしい表現を使い、具体的な場所・光・服装・ポーズをすべて含める）
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

  const prompt = `${scene}. Keep the exact same person as in the reference image: same face, same dark hair, same mask. Shot on iPhone, candid and natural, realistic background with real depth and texture, no AI art style, no illustration, no smooth skin filter, photojournalism quality.`;

  const response = await openai.images.edit({
    model: "gpt-image-2",
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
