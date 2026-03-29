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
   - 日本人女性・マスク着用・かわいらしい雰囲気（大きめの目・ふんわりした髪・明るい表情）
   - 以下のカテゴリからランダムに1つ選んでバラエティ豊かなシーンを考える：
     * 日常・カフェ系（友達とカフェでおしゃべり・タピオカ・パンケーキ・読書・勉強カフェ）
     * グルメ系（屋台・ラーメン・焼肉・スイーツバイキング・コンビニ前でアイス）
     * お出かけ系（ショッピング・映画館・水族館・動物園・美術館・フォトブース・ゲーセン）
     * 夜遊び系（夜景バー・屋台祭り・クラブ・ネオン街・花火）
     * 旅行系（空港・新幹線・ホテルプール・海外の街角・砂浜・温泉旅館）
     * アクティブ系（海水浴・スノボ・スポーツ観戦・フェス・ヨガ・サイクリング）
     * 季節イベント系（花見・お祭り・ハロウィン・クリスマスマーケット・雪遊び）
     * おもしろ・ギャップ系（UFOキャッチャー本気・釣り・ボウリング・脱出ゲーム・VR体験）
     * まったり系（家でゲーム・お風呂上がりにアイス・ベッドでごろごろ・ネイルサロン）
   - 友達や賑やかな背景が入ってもOK・主役として自然に存在している構図
   - 服装はシーンに合わせて露出少し多めに（ミニスカート・ショート丈トップス・キャミソール・水着・浴衣の着崩しなど）
   - 例: "A cute young Japanese woman wearing a mask, at a night festival in a slightly open yukata, holding sparklers with friends, warm bokeh lights in background"

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

  const prompt = `${scene}. Candid snapshot style, natural lighting, same character as the reference image: same face, same dark hair, same mask. Cute and charming appearance, slightly stylish and subtly sexy but tasteful. Shot on smartphone, feels real and authentic, lively and fun atmosphere.`;

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
