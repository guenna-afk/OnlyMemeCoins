let articles = [];
let currentCat = "all";
let currentSearch = "";
let currentPage = 1;
const PAGE_SIZE = 5;

const state = {
  feedsLoaded: 0,
  feedsFailed: 0,
};

const catMeta = {
  all: { label: "All News", tag: "All" },
  memecoin: { label: "Memecoins", tag: "Memecoin" },
  markets: { label: "Markets", tag: "Markets" },
  bitcoin: { label: "Bitcoin", tag: "Bitcoin" },
  ethereum: { label: "Ethereum", tag: "Ethereum" },
  altcoin: { label: "Altcoins", tag: "Altcoin" },
  security: { label: "Security", tag: "Security" },
  regulation: { label: "Regulation", tag: "Regulation" },
};

document.addEventListener("DOMContentLoaded", () => {
  bindUi();
  renderLoading();
  loadNews();
  loadPrices();
});

function bindUi(){
  document.querySelectorAll("[data-cat]").forEach((btn) => {
    btn.addEventListener("click", () => filterCat(btn.dataset.cat, btn));
  });

  document.querySelector(".nav-logo").addEventListener("click", goHome);
  document.querySelector(".article-back").addEventListener("click", showHome);

  document.querySelectorAll("[data-search]").forEach((btn) => {
    btn.addEventListener("click", () => searchArticles(btn.dataset.search || ""));
  });

  document.getElementById("search-input").addEventListener("input", (event) => {
    searchArticles(event.target.value);
  });

  document.getElementById("refresh-news").addEventListener("click", () => {
    loadNews();
    loadPrices();
  });
}

async function loadNews(){
  state.feedsLoaded = 0;
  state.feedsFailed = 0;
  setStatus("Refreshing real news feeds...");

  const batches = await Promise.allSettled(NEWS_FEEDS.map(fetchFeed));
  const merged = [];

  batches.forEach((result) => {
    if(result.status === "fulfilled"){
      state.feedsLoaded += 1;
      merged.push(...result.value);
    } else {
      state.feedsFailed += 1;
    }
  });

  articles = dedupeArticles(merged)
    .sort((a,b) => b.timestamp - a.timestamp)
    .map((article, index) => ({ ...article, id: index }));

  renderAll();
  setStatus(`${articles.length} real stories · ${state.feedsLoaded} feeds loaded${state.feedsFailed ? ` · ${state.feedsFailed} failed` : ""}`);
}

async function fetchFeed(feed){
  const endpoint = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(feed.url)}`;
  const response = await fetch(endpoint);
  if(!response.ok) throw new Error(`Feed failed: ${feed.source}`);

  const data = await response.json();
  if(data.status !== "ok" || !Array.isArray(data.items)) throw new Error(`Bad feed: ${feed.source}`);

  return data.items.map((item) => normalizeArticle(item, feed)).filter(Boolean);
}

function normalizeArticle(item, feed){
  const title = cleanText(item.title);
  const rawContent = item.content || item.description || "";
  const rawDescription = item.description || item.content || "";
  const excerpt = cleanText(rawDescription);
  const link = item.link || item.guid;
  if(!title || !link) return null;

  const rawDate = item.pubDate ? new Date(item.pubDate.replace(" ", "T")) : new Date();
  const timestamp = Number.isNaN(rawDate.getTime()) ? Date.now() : rawDate.getTime();
  const textForTags = `${title} ${excerpt} ${item.categories || ""}`;
  const cat = classifyCategory(textForTags, feed.category);

  return {
    id: 0,
    cat,
    title,
    excerpt: excerpt || "Open the original source to read the full story.",
    author: cleanText(item.author || feed.source),
    date: formatDate(timestamp),
    timestamp,
    source: feed.source,
    link,
    image: extractImage(item),
    tags: buildTags(textForTags, cat),
    paragraphs: buildParagraphs(rawContent, rawDescription),
    read: estimateRead(excerpt),
  };
}

function classifyCategory(text, fallback){
  const value = text.toLowerCase();
  if(hasAny(value, ["hack", "exploit", "stolen", "phishing", "scam", "rug", "drain", "fraud", "lawsuit"])) return "security";
  if(hasAny(value, ["sec", "senate", "congress", "regulation", "regulator", "lawmakers", "court", "judge", "policy", "clarity act", "lawsuit"])) return "regulation";
  if(hasAny(value, ["meme", "memecoin", "doge", "dogecoin", "pepe", "shib", "bonk", "wif", "floki", "trump coin", "mother"])) return "memecoin";
  if(hasAny(value, ["ethereum", "ether", "eth", "layer 2", "arbitrum", "base"])) return "ethereum";
  if(hasAny(value, ["bitcoin", "btc", "satoshi"])) return "bitcoin";
  if(hasAny(value, ["solana", "sol", "xrp", "bnb", "ada", "altcoin", "token"])) return "altcoin";
  return fallback || "markets";
}

function buildTags(text, cat){
  const pool = ["bitcoin","btc","ethereum","eth","solana","doge","dogecoin","pepe","shib","bonk","wif","floki","sec","etf","hack","airdrop","trump","base","defi","stablecoin"];
  const value = text.toLowerCase();
  const tags = pool.filter((tag) => value.includes(tag)).slice(0, 6);
  return Array.from(new Set([cat, ...tags]));
}

function dedupeArticles(items){
  const seen = new Set();
  return items.filter((item) => {
    const key = (item.link || item.title).replace(/\?.*$/, "").toLowerCase();
    if(seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function loadPrices(){
  const ids = PRICE_COINS.map((coin) => coin.id).join(",");
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true`;

  try {
    const response = await fetch(url);
    if(!response.ok) throw new Error("CoinGecko request failed");
    const data = await response.json();
    renderPrices(data);
  } catch(error) {
    document.getElementById("price-list").innerHTML = `<div class="empty">Live prices are unavailable right now.</div>`;
    document.getElementById("ticker-strip").innerHTML = `<span>Live price API unavailable. Try Refresh.</span>`;
  }
}

function renderAll(){
  renderFeatured();
  renderTopGrid();
  renderTrending();
  renderList();
}

function visibleArticles(){
  let filtered = articles;
  if(currentCat !== "all") filtered = filtered.filter((a) => a.cat === currentCat);
  if(currentSearch){
    const q = currentSearch.toLowerCase();
    filtered = filtered.filter((a) => {
      return a.title.toLowerCase().includes(q)
        || a.excerpt.toLowerCase().includes(q)
        || a.source.toLowerCase().includes(q)
        || a.tags.some((tag) => tag.includes(q));
    });
  }
  return filtered;
}

function renderLoading(){
  document.getElementById("article-list").innerHTML = `<div class="skeleton">Loading 50+ real headlines from crypto feeds...</div>`;
  document.getElementById("top-grid").innerHTML = "";
  document.getElementById("pagination").innerHTML = "";
}

function renderFeatured(){
  const a = visibleArticles()[0];
  const target = document.getElementById("featured-card");
  if(!a){
    target.innerHTML = `<div class="skeleton">No live stories loaded yet.</div>`;
    return;
  }

  target.innerHTML = `
    <div class="featured-top">
      <div class="featured-image" ${bgStyle(a.image)}></div>
      <div class="featured-body">
        <span class="cat-tag tag-${a.cat}">${catLabel(a.cat)}</span>
        <h2>${escapeHtml(a.title)}</h2>
        <p>${escapeHtml(a.excerpt)}</p>
        <div class="meta">
          <span>${escapeHtml(a.source)}</span><span class="meta-dot">·</span><span>${a.date}</span><span class="meta-dot">·</span><span>${a.read}</span>
        </div>
      </div>
    </div>
  `;
  target.onclick = () => openArticle(a.id);
}

function renderTopGrid(){
  const grid = document.getElementById("top-grid");
  const items = visibleArticles().slice(1, 5);
  const cards = items.map((a) => `
    <article class="grid-card" onclick="openArticle(${a.id})">
      <div class="grid-thumb" ${bgStyle(a.image)}></div>
      <div class="grid-card-body">
        <span class="cat-tag tag-${a.cat}">${catLabel(a.cat)}</span>
        <h4>${escapeHtml(a.title)}</h4>
        <p>${escapeHtml(a.excerpt)}</p>
        <div class="meta"><span>${escapeHtml(a.source)}</span><span class="meta-dot">·</span><span>${a.date}</span></div>
      </div>
    </article>
  `);

  cards.splice(2, 0, nativeAdCard());
  cards.push(nativeAdCard());
  grid.innerHTML = cards.join("");
}

function nativeAdCard(){
  return `
    <article class="grid-card native-ad-card" aria-label="Google AdSense native ad">
      <div class="native-ad-placeholder">google adsense · native</div>
    </article>
  `;
}

function renderTrending(){
  const list = document.getElementById("trending-list");
  const trendItems = (currentCat === "all" ? articles : visibleArticles()).slice(0, 8);
  list.innerHTML = trendItems.map((a, index) => `
    <article class="trend-item" onclick="openArticle(${a.id})">
      <div class="trend-rank">${index + 1}</div>
      <div>
        <div class="trend-title">${escapeHtml(a.title)}</div>
        <div class="trend-cat">${catLabel(a.cat)} · ${escapeHtml(a.source)}</div>
      </div>
    </article>
  `).join("");
}

function renderList(){
  const filtered = visibleArticles();
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  if(currentPage > totalPages) currentPage = totalPages;
  const start = (currentPage - 1) * PAGE_SIZE;
  const pageItems = filtered.slice(start, start + PAGE_SIZE);

  document.getElementById("list-title").querySelector("span").textContent = currentSearch ? `Search: "${currentSearch}"` : catMeta[currentCat].label;
  document.getElementById("list-count").textContent = `${filtered.length} stories · page ${currentPage}/${totalPages}`;

  const list = document.getElementById("article-list");
  if(!filtered.length){
    list.innerHTML = `<div class="empty">No real stories found for this filter.</div>`;
    document.getElementById("pagination").innerHTML = "";
    return;
  }

  list.innerHTML = pageItems.map((a) => `
    <article class="article-item" onclick="openArticle(${a.id})">
      <div class="item-thumb" ${bgStyle(a.image)}></div>
      <div class="item-body">
        <span class="cat-tag tag-${a.cat}">${catLabel(a.cat)}</span>
        <h3 class="item-title">${escapeHtml(a.title)}</h3>
        <p class="item-excerpt">${escapeHtml(a.excerpt)}</p>
        <div class="item-meta">
          <span>${escapeHtml(a.source)}</span><span class="meta-dot">·</span><span>${escapeHtml(a.author)}</span><span class="meta-dot">·</span><span>${a.date}</span><span class="meta-dot">·</span><span>${a.read}</span>
        </div>
      </div>
    </article>
  `).join("");
  renderPagination(totalPages);
}

function renderPagination(totalPages){
  const pagination = document.getElementById("pagination");
  if(totalPages <= 1){
    pagination.innerHTML = "";
    return;
  }

  const pages = paginationPages(currentPage, totalPages);
  pagination.innerHTML = `
    <button class="page-btn" type="button" ${currentPage === 1 ? "disabled" : ""} onclick="changePage(${currentPage - 1})">Previous</button>
    <div class="page-numbers">
      ${pages.map((page) => page === "..."
        ? `<span class="page-ellipsis">...</span>`
        : `<button class="page-num ${page === currentPage ? "active" : ""}" type="button" onclick="changePage(${page})">${page}</button>`
      ).join("")}
    </div>
    <button class="page-btn" type="button" ${currentPage === totalPages ? "disabled" : ""} onclick="changePage(${currentPage + 1})">Next</button>
  `;
}

function paginationPages(page, totalPages){
  if(totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1);

  if(page <= 4) return [1, 2, 3, 4, 5, "...", totalPages];
  if(page >= totalPages - 3) return [1, "...", totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
  return [1, "...", page - 1, page, page + 1, "...", totalPages];
}

function changePage(page){
  const totalPages = Math.max(1, Math.ceil(visibleArticles().length / PAGE_SIZE));
  currentPage = Math.min(Math.max(1, page), totalPages);
  renderList();
  document.getElementById("list-title").scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderPrices(data){
  const rows = PRICE_COINS
    .filter((coin) => data[coin.id])
    .map((coin) => ({ ...coin, ...data[coin.id] }));

  document.getElementById("price-list").innerHTML = rows.map((coin) => {
    const change = coin.usd_24h_change || 0;
    return `
      <div class="price-item">
        <div>
          <div class="p-name">${coin.name}</div>
          <div class="p-sym">${coin.symbol}</div>
        </div>
        <div class="p-right">
          <div class="p-val">${formatUsd(coin.usd)}</div>
          <div class="${change >= 0 ? "up" : "down"}">${change >= 0 ? "▲" : "▼"} ${Math.abs(change).toFixed(2)}%</div>
          <div class="p-cap">MC ${formatCompact(coin.usd_market_cap)}</div>
        </div>
      </div>
    `;
  }).join("");

  document.getElementById("ticker-strip").innerHTML = rows.slice(0, 8).map((coin) => {
    const change = coin.usd_24h_change || 0;
    return `<span class="ticker-pill">${coin.symbol} ${formatUsd(coin.usd)} <span class="ticker-change ${change >= 0 ? "up" : "down"}">${change >= 0 ? "+" : ""}${change.toFixed(2)}%</span></span>`;
  }).join("");
}

function filterCat(cat, btn){
  currentCat = cat;
  currentSearch = "";
  currentPage = 1;
  document.getElementById("search-input").value = "";
  document.querySelectorAll(".nav-cat").forEach((item) => item.classList.remove("active"));
  btn.classList.add("active");
  showHome();
  renderAll();
}

function searchArticles(q){
  currentSearch = q.trim();
  currentCat = "all";
  currentPage = 1;
  document.querySelectorAll(".nav-cat").forEach((item) => item.classList.remove("active"));
  document.querySelector("[data-cat='all']").classList.add("active");
  showHome();
  renderAll();
}

function openArticle(id){
  const a = articles.find((item) => item.id === id);
  if(!a) return;

  const related = articles
    .filter((item) => item.id !== id && (item.cat === a.cat || item.tags.some((tag) => a.tags.includes(tag))))
    .slice(0, 4);

  document.getElementById("home-view").style.display = "none";
  document.getElementById("article-view").style.display = "block";
  const paragraphs = articleParagraphs(a);
  document.getElementById("article-content-area").innerHTML = `
    <div class="article-hero" ${bgStyle(a.image)}></div>
    <span class="cat-tag tag-${a.cat}">${catLabel(a.cat)}</span>
    <h1>${escapeHtml(a.title)}</h1>
    <div class="article-meta-full">
      <span>${escapeHtml(a.source)}</span><span>·</span><span>${escapeHtml(a.author)}</span><span>·</span><span>${a.date}</span><span>·</span><span>${a.read}</span>
    </div>
    <div class="ad">google adsense · in-article</div>
    <div class="article-content">
      ${paragraphs.map((paragraph, index) => `
        <p>${escapeHtml(paragraph)}</p>
        ${index === 0 ? `<div class="ad article-mid-ad">google adsense · article rectangle</div>` : ""}
      `).join("")}
      <div class="article-note">
        <strong>Source note:</strong> this page uses the publisher RSS summary and metadata only. The full reporting stays with the original newsroom.
      </div>
      <div class="article-facts">
        <div><span>Category</span><strong>${catLabel(a.cat)}</strong></div>
        <div><span>Publisher</span><strong>${escapeHtml(a.source)}</strong></div>
        <div><span>Tags</span><strong>${a.tags.slice(0, 4).map(escapeHtml).join(", ")}</strong></div>
      </div>
      <a class="source-link" href="${escapeAttr(a.link)}" target="_blank" rel="noopener noreferrer">Read full story at ${escapeHtml(a.source)}</a>
    </div>
    <div class="ad">google adsense · post-article banner</div>
    ${related.length ? `<div class="related-title">Related Real Stories</div>${related.map((r) => `
      <article class="article-item" onclick="openArticle(${r.id})">
        <div class="item-thumb" ${bgStyle(r.image)}></div>
        <div class="item-body">
          <span class="cat-tag tag-${r.cat}">${catLabel(r.cat)}</span>
          <h3 class="item-title">${escapeHtml(r.title)}</h3>
          <div class="item-meta"><span>${escapeHtml(r.source)}</span><span class="meta-dot">·</span><span>${r.date}</span></div>
        </div>
      </article>
    `).join("")}` : ""}
  `;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function showHome(){
  document.getElementById("home-view").style.display = "block";
  document.getElementById("article-view").style.display = "none";
}

function goHome(){
  currentCat = "all";
  currentSearch = "";
  currentPage = 1;
  document.getElementById("search-input").value = "";
  document.querySelectorAll(".nav-cat").forEach((item) => item.classList.remove("active"));
  document.querySelector("[data-cat='all']").classList.add("active");
  showHome();
  renderAll();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function catLabel(cat){
  return catMeta[cat]?.tag || cat;
}

function setStatus(text){
  document.getElementById("news-status").textContent = text;
}

function cleanText(html){
  const doc = new DOMParser().parseFromString(String(html || ""), "text/html");
  return doc.body.textContent.replace(/\s+/g, " ").trim();
}

function buildParagraphs(content, description){
  const html = String(content || description || "");
  const doc = new DOMParser().parseFromString(html, "text/html");
  const parts = Array.from(doc.querySelectorAll("p"))
    .map((node) => node.textContent.replace(/\s+/g, " ").trim())
    .filter((text) => text.length > 40 && !text.startsWith("http"));

  const fallback = cleanText(description || content);
  if(!parts.length && fallback) parts.push(fallback);
  return Array.from(new Set(parts)).slice(0, 4);
}

function articleParagraphs(article){
  const base = article.paragraphs?.length ? article.paragraphs : [article.excerpt];
  const extra = [
    `This story is filed under ${catLabel(article.cat).toLowerCase()} and was published by ${article.source} on ${article.date}.`,
    `Related signals on this page include ${article.tags.slice(0, 5).join(", ")}. Use the original source link for the complete report and any updates after the RSS snapshot.`,
  ];
  return [...base, ...extra].filter(Boolean).slice(0, 6);
}

function extractImage(item){
  if(item.enclosure?.link) return item.enclosure.link;
  if(typeof item.enclosure === "string"){
    const found = item.enclosure.match(/https?:\/\/[^;\s}]+/);
    if(found) return found[0].replace(/&amp;/g, "&");
  }
  const html = item.description || item.content || "";
  const match = String(html).match(/<img[^>]+src=["']([^"']+)["']/i);
  return match ? match[1] : "";
}

function bgStyle(url){
  if(!url) return "";
  return `style="background-image:url('${escapeAttr(url)}')"`;
}

function hasAny(text, terms){
  return terms.some((term) => text.includes(term));
}

function estimateRead(text){
  const words = cleanText(text).split(/\s+/).filter(Boolean).length;
  return `${Math.max(1, Math.ceil(words / 220))} min read`;
}

function formatDate(timestamp){
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(new Date(timestamp));
}

function formatUsd(value){
  const number = Number(value || 0);
  if(number >= 1) return `$${number.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  if(number >= 0.01) return `$${number.toFixed(4)}`;
  if(number >= 0.0001) return `$${number.toFixed(6)}`;
  return `$${number.toFixed(10).replace(/0+$/, "").replace(/\.$/, "")}`;
}

function formatCompact(value){
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 2 }).format(Number(value || 0));
}

function escapeHtml(value){
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value){
  return escapeHtml(value).replaceAll("`", "&#096;");
}
