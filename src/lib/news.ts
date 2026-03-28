import Parser from "rss-parser";

export interface NewsArticle {
  title: string;
  description: string;
  url: string;
  publishedAt: string;
  source: string;
}

const RSS_FEED_URL = "https://news.yahoo.co.jp/rss/topics/top-picks.xml";

/**
 * Yahoo!ニュース RSS から記事を取得する
 */
async function fetchFromRSS(): Promise<NewsArticle[]> {
  const parser = new Parser();
  const feed = await parser.parseURL(RSS_FEED_URL);

  return (feed.items ?? [])
    .filter((item) => item.title && item.link)
    .map((item) => ({
      title: item.title!,
      description: item.contentSnippet ?? item.title!,
      url: item.link!,
      publishedAt: item.pubDate ?? new Date().toISOString(),
      source: "Yahoo!ニュース",
    }));
}

/**
 * NewsAPI から記事を取得する（APIキーが設定されている場合のみ）
 */
async function fetchFromNewsAPI(): Promise<NewsArticle[]> {
  const apiKey = process.env.NEWS_API_KEY;
  if (!apiKey) return [];

  const url = new URL("https://newsapi.org/v2/everything");
  url.searchParams.set("q", "日本");
  url.searchParams.set("language", "ja");
  url.searchParams.set("sortBy", "popularity");
  url.searchParams.set("pageSize", "20");
  url.searchParams.set("apiKey", apiKey);

  const res = await fetch(url.toString());
  if (!res.ok) return [];

  const data = (await res.json()) as {
    status: string;
    articles: Array<{
      title: string;
      description: string | null;
      url: string;
      publishedAt: string;
      source: { name: string };
    }>;
  };

  if (data.status !== "ok") return [];

  return data.articles
    .filter((a) => a.title && a.description)
    .map((a) => ({
      title: a.title,
      description: a.description!,
      url: a.url,
      publishedAt: a.publishedAt,
      source: a.source.name,
    }));
}

/**
 * NewsAPI + Yahoo RSS の両方から取得してマージ
 * 既投稿URLを除外して最大 limit 件返す
 */
export async function fetchTopNews(
  postedUrls: Set<string>,
  limit = 3
): Promise<NewsArticle[]> {
  const [rssArticles, newsApiArticles] = await Promise.allSettled([
    fetchFromRSS(),
    fetchFromNewsAPI(),
  ]);

  const rss = rssArticles.status === "fulfilled" ? rssArticles.value : [];
  const api = newsApiArticles.status === "fulfilled" ? newsApiArticles.value : [];

  console.log(`[news] RSS: ${rss.length} articles, NewsAPI: ${api.length} articles`);

  // マージして重複URLを除外
  const seen = new Set<string>();
  const merged: NewsArticle[] = [];

  for (const article of [...rss, ...api]) {
    if (!seen.has(article.url) && !postedUrls.has(article.url)) {
      seen.add(article.url);
      merged.push(article);
    }
  }

  return merged.slice(0, limit);
}
