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
   - 日本人女性・マスク着用
   - 以下のカテゴリからランダムに1つ選んでユニークで面白いシーンを考える：
     * 非日常・旅行系（海外の街角・砂漠・雪山・トロピカルビーチなど）
     * トレンド・映え系（インスタ映えカフェ・廃墟・夜景スポットなど）
     * ギャップ・おもしろ系（ゲーセンでガチ勢・釣り・キャンプで失敗・UFOキャッチャーなど）
     * 季節イベント系（花火・お祭り・雪だるま・紅葉狩りなど）
   - ユーモアのある状況・ちょっとおかしい構図・思わず笑えるシーン
   - 全身または上半身・カジュアルな服装
   - 例: "A young Japanese woman wearing a mask, full body, frantically trying to catch a giant stuffed bear at an arcade UFO catcher machine, looking very serious and competitive"

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

  const prompt = `${scene}. Candid snapshot style, natural lighting, same character as the reference image: same face, same dark hair, same mask. Shot on smartphone, slightly imperfect, feels real and authentic, funny and charming moment captured naturally.`;

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
