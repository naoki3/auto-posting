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
魅力的で少し妖艶な雰囲気の日本人女性の写真のシーンを考えてください。
毎回バラエティ豊かで面白いものにしてください。

以下の項目をすべて日本語で決めてください：
・場所: 実在する具体的な場所（例：原宿のカフェ、京都の古い路地、新宿のバー、銀座の夜道など）
・時間帯: （例：昼下がり、夕暮れ、夜など）
・天気・光: （例：晴れで柔らかい光、夕焼け、夜のネオン照明など）
・服装: 女性らしく魅力的なコーデ（例：オフショルダー、シルクのブラウス、チャイナドレス風など）
・髪型: （例：ゆるくほどけた髪、横に流した髪、アップスタイルなど）
・表情・ポーズ: 少し妖艶で魅力的な一瞬（例：カメラをじっと見つめる、上目遣い、薄く微笑む、唇に指を当てるなど）
・カメラ: （例：スマホの自撮り、友達に撮ってもらった、自然な街撮りなど）

それをもとに：
1. OpenAI画像生成用の英語プロンプト（2〜3文。「shot on iPhone」「candid photo」「real place」などリアルな写真らしい表現を使い、具体的な場所・光・服装・ポーズをすべて含める。alluring/mysteriousな雰囲気を自然に表現する）
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
    scene: sceneMatch?.[1]?.trim() ?? "A young Japanese woman in a stylish outfit at a Japanese street at night",
    tweetText,
  };
}

async function loadImageFile(photoSource: string): Promise<File> {
  if (photoSource.startsWith("http://") || photoSource.startsWith("https://")) {
    const res = await fetch(photoSource);
    if (!res.ok) throw new Error(`Failed to fetch image from URL: ${photoSource}`);
    const arrayBuffer = await res.arrayBuffer();
    const ext = photoSource.split(".").pop()?.toLowerCase() ?? "png";
    const mimeType = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "image/png";
    return new File([arrayBuffer], `photo.${ext}`, { type: mimeType });
  }

  const filePath = path.isAbsolute(photoSource)
    ? photoSource
    : path.join(process.cwd(), photoSource);
  const buffer = fs.readFileSync(filePath);
  const ext = path.extname(filePath).slice(1).toLowerCase();
  const mimeType = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "image/png";
  return new File([buffer], path.basename(filePath), { type: mimeType });
}

export async function generateCharacterImage(photoSource?: string): Promise<ImagePostContent> {
  const { scene, tweetText } = await generateTheme();
  console.log(`[image-gen] Scene: ${scene}`);
  console.log(`[image-gen] Tweet: ${tweetText}`);

  const source = photoSource ?? path.join(process.cwd(), "public", "character.png");
  const imageFile = await loadImageFile(source);

  const prompt = `${scene}. Keep the exact same person as in the reference image: same face, same dark hair. She has an alluring and slightly mysterious expression, captivating gaze, soft lips. Shot on iPhone, candid and natural, realistic background with real depth and texture, no AI art style, no illustration, no smooth skin filter, photojournalism quality.`;

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
