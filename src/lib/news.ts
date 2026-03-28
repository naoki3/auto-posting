export interface NewsArticle {
  title: string;
  description: string;
  url: string;
  publishedAt: string;
  source: string;
}

/**
 * NewsAPI から人気ニュースを取得する
 * 既投稿URLを除外して最大 limit 件返す
 */
export async function fetchTopNews(
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
  if (!res.ok) {
    throw new Error(`NewsAPI error: ${res.status} ${res.statusText}`);
  }

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

  console.log(`[news] Fetched ${data.articles.length} articles`);

  return data.articles
    .filter((a) => !postedUrls.has(a.url) && a.title && a.description)
    .slice(0, limit)
    .map((a) => ({
      title: a.title,
      description: a.description!,
      url: a.url,
      publishedAt: a.publishedAt,
      source: a.source.name,
    }));
}
