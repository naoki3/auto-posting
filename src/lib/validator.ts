// X（Twitter）の文字数制限
// URLは23文字としてカウント、日本語は1文字=1としてカウント
const MAX_TWEET_LENGTH = 140;

// 投稿NGワードリスト（スパム・規約違反リスクのある表現）
const NG_WORDS = [
  "フォロバ",
  "フォロバ100",
  "相互フォロー",
  "RT&いいね",
  "拡散希望",
  "懸賞",
  "プレゼント企画",
  "当選",
  "クリックして",
  "今すぐ登録",
  "無料で稼げる",
  "副収入保証",
  "借金",
  "消費者金融",
];

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  charCount: number;
}

/**
 * 投稿文のバリデーション
 * - 文字数チェック
 * - NGワードチェック
 * - 空文字チェック
 */
export function validatePost(content: string): ValidationResult {
  const errors: string[] = [];

  // 空文字チェック
  if (!content || content.trim().length === 0) {
    errors.push("投稿内容が空です");
    return { valid: false, errors, charCount: 0 };
  }

  const charCount = countTweetLength(content);

  // 文字数チェック
  if (charCount > MAX_TWEET_LENGTH) {
    errors.push(
      `文字数オーバー: ${charCount}文字 (上限 ${MAX_TWEET_LENGTH}文字)`
    );
  }

  // NGワードチェック
  const foundNgWords = NG_WORDS.filter((word) => content.includes(word));
  if (foundNgWords.length > 0) {
    errors.push(`NGワードが含まれています: ${foundNgWords.join(", ")}`);
  }

  return {
    valid: errors.length === 0,
    errors,
    charCount,
  };
}

/**
 * Xの文字数カウントルール:
 * - URLは23文字固定
 * - それ以外はUnicode文字数
 */
export function countTweetLength(text: string): number {
  // URLをプレースホルダーに置換してカウント
  const urlRegex = /https?:\/\/\S+/g;
  const urls = text.match(urlRegex) ?? [];

  let length = text.length;
  for (const url of urls) {
    // 元のURL長を引いて、23文字（X標準）を足す
    length = length - url.length + 23;
  }

  return length;
}
