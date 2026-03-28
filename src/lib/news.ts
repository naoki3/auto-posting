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
export async function fetchFromRSS(
  postedUrls: Set<string>,
  limit = 3
): Promise<NewsArticle[]> {
  const parser = new Parser();
  const feed = await parser.parseURL(RSS_FEED_URL);

  return (feed.items ?? [])
    .filter((item) => item.title && item.link && !postedUrls.has(item.link))
    .slice(0, limit)
    .map((item) => ({
      title: item.title!,
      description: item.contentSnippet ?? item.title!,
      url: item.link!,
      publishedAt: item.pubDate ?? new Date().toISOString(),
      source: "Yahoo!ニュース",
    }));
}

/**
 * NewsAPI から記事を取得する
 */
export async function fetchFromNewsAPI(
  postedUrls: Set<string>,
  limit = 3
): Promise<NewsArticle[]> {
  const apiKey = process.env.NEWS_API_KEY;
  if (!apiKey) throw new Error("NEWS_API_KEY is not set");

  const url = new URL("https://newsapi.org/v2/everything");
  url.searchParams.set("q", "日本");
  url.searchParams.set("language", "ja");
  url.searchParams.set("sortBy", "popularity");
  url.searchParams.set("pageSize", "20");
  url.searchParams.set("apiKey", apiKey);

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`NewsAPI error: ${res.status}`);

  const data = (await res.json()) as {
    status: string;
    message?: string;
    articles: Array<{
      title: string;
      description: string | null;
      url: string;
      publishedAt: string;
      source: { name: string };
    }>;
  };

  if (data.status !== "ok") {
    throw new Error(`NewsAPI returned error: ${data.message ?? data.status}`);
  }

  return data.articles
    .filter((a) => a.title && a.description && !postedUrls.has(a.url))
    .slice(0, limit)
    .map((a) => ({
      title: a.title,
      description: a.description!,
      url: a.url,
      publishedAt: a.publishedAt,
      source: a.source.name,
    }));
}

/**
 * NEWS_SOURCE 環境変数で切り替え
 * NEWS_SOURCE=newsapi → NewsAPI
 * NEWS_SOURCE=rss（デフォルト） → Yahoo RSS
 */
export async function fetchTopNews(
  postedUrls: Set<string>,
  limit = 3
): Promise<NewsArticle[]> {
  const source = process.env.NEWS_SOURCE ?? "rss";

  if (source === "newsapi") {
    return fetchFromNewsAPI(postedUrls, limit);
  }
  return fetchFromRSS(postedUrls, limit);
}
