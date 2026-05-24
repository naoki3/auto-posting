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

async function generateTheme(location?: string): Promise<{ scene: string; tweetText: string }> {
  const today = new Date().toLocaleDateString("ja-JP", {
    month: "long",
    day: "numeric",
    weekday: "long",
  });

  const locationInstruction = location
    ? `場所は「${location}」に固定してください。`
    : "場所は実在する具体的な場所を自由に選んでください（例：原宿のカフェ、京都の古い路地、新宿のバー、銀座の夜道など）。";

  const message = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 512,
    messages: [
      {
        role: "user",
        content: `今日は${today}です。
魅力的で少し妖艶な雰囲気の日本人女性の写真のシーンを考えてください。

${locationInstruction}

以下の項目をすべて日本語で決めてください：
・時間帯: （例：昼下がり、夕暮れ、夜など）
・光: （例：柔らかい自然光、夕焼け、車内の間接照明など）
・服装: 女性らしく魅力的なコーデ（例：オフショルダー、シルクのブラウス、ワンピースなど）
・髪型: （例：ゆるくほどけた髪、横に流した髪など）
・表情・ポーズ: 少し妖艶で魅力的な一瞬（例：カメラをじっと見つめる、上目遣い、薄く微笑む、など）

それをもとに：
1. OpenAI画像生成用の英語プロンプト（2〜3文。以下のルールを厳守すること：
   - 使ってよい表現: cinematic portrait, moody lighting, editorial fashion photography, elegant atmosphere, sophisticated style, mysterious ambiance, soft natural light, stylish outfit, graceful pose, candid shot on iPhone
   - 絶対に使ってはいけない表現: seductive, alluring, sensual, sexy, revealing, provocative, intimate, tempting, sultry, erotic, suggestive, flirtatious, body-focused descriptions, lip/skin descriptions
   - 妖艶さはロケーション・照明・ファッションで間接的に表現すること）
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
  tweetText = tweetText.replace(/^@+/, "");

  return {
    scene: sceneMatch?.[1]?.trim() ?? "A young Japanese woman in a stylish outfit, alluring expression, candid photo",
    tweetText,
  };
}

export async function generateCharacterImage(location?: string): Promise<ImagePostContent> {
  const { scene, tweetText } = await generateTheme(location);
  console.log(`[image-gen] Location: ${location ?? "random"}`);
  console.log(`[image-gen] Scene: ${scene}`);
  console.log(`[image-gen] Tweet: ${tweetText}`);

  const characterImagePath = path.join(process.cwd(), "public", "character.png");
  let imageFile: File;
  if (fs.existsSync(characterImagePath)) {
    console.log(`[image-gen] Loading character from filesystem`);
    const imageBuffer = fs.readFileSync(characterImagePath);
    imageFile = new File([imageBuffer], "character.png", { type: "image/png" });
  } else {
    const appUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000";
    console.log(`[image-gen] Filesystem miss, fetching from ${appUrl}`);
    const charRes = await fetch(`${appUrl}/character.png`);
    if (!charRes.ok) throw new Error(`Character fetch failed: ${charRes.status}`);
    imageFile = new File([await charRes.arrayBuffer()], "character.png", { type: "image/png" });
  }

  const prompt = `${scene}. Keep the exact same person as in the reference image: same face, same dark hair. Cinematic editorial style, moody and sophisticated atmosphere, no AI art style, no illustration, photojournalism quality.`;

  console.log(`[image-gen] Calling OpenAI images.edit, prompt length: ${prompt.length}`);
  let response: Awaited<ReturnType<typeof openai.images.edit>>;
  try {
    response = await openai.images.edit({
      model: "gpt-image-2",
      image: imageFile,
      prompt,
      n: 1,
      size: "1024x1024",
    });
  } catch (openaiErr) {
    const msg = openaiErr instanceof Error ? openaiErr.message : String(openaiErr);
    console.error(`[image-gen] OpenAI error: ${msg}`);
    throw openaiErr;
  }

  const imageBase64 = response.data?.[0]?.b64_json;
  if (!imageBase64) {
    throw new Error("Image generation failed: no image data returned");
  }

  console.log(`[image-gen] Image generated successfully`);
  return { imageBase64, tweetText };
}
