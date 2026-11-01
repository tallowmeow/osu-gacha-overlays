// Card value and market deal overlays for osu! gacha.
// Paste into the browser console on /market, /collection, /inventory, /packs, or /cards/:id.
(() => {
  const STYLE_ID = "osugacha-local-deal-style";
  const MARKET_STATS_ID = "osugacha-market-flipping-stats";
  const OVERLAY_CLASS = "osugacha-local-deal-overlay";
  const MIN_COMPS = 2;
  const LEGENDARY_QUICKSELL = 375;
  const API_ORIGIN = "https://osugacha.com";
  const PAGE_SIZE = 100;
  const PAGE_CONCURRENCY = 6;
  const API_REFRESH_MS = 60_000;
  const REFRESH_DEBOUNCE_MS = 120;
  const CARD_VALUE_STYLE_ID = "osugacha-card-value-style";
  const CARD_VALUE_BADGE_CLASS = "osugacha-card-value-badge";
  const CARD_VALUE_ABOVE_NEW_CLASS = `${CARD_VALUE_BADGE_CLASS}-above-new`;
  const CARD_VALUE_HOST_CLASS = "osugacha-card-value-host";
  const CARD_VALUE_CONCURRENCY = 6;
  const CARD_VALUE_REFRESH_MS = 60_000;
  const CARD_VALUE_DEBOUNCE_MS = 160;
  const CARD_PATH = /^\/cards\/([^/]+)\/?$/;
  const path = window.location.pathname;
  const isSupportedPath =
    path === "/collection" ||
    path === "/inventory" ||
    path === "/packs" ||
    path === "/market" ||
    CARD_PATH.test(path);

  if (
    window.location.origin !== API_ORIGIN ||
    !isSupportedPath
  ) {
    throw new Error(
      "Run this overlay on osu! gacha /market, /collection, /inventory, /packs, or /cards/:id.",
    );
  }

  window.osugachaOverlayStop?.();
  window.osugachaLocalOverlayStop?.();
  window.osugachaCardValueOverlayStop?.();
  document.getElementById(STYLE_ID)?.remove();
  document.getElementById(MARKET_STATS_ID)?.remove();
  document.getElementById(CARD_VALUE_STYLE_ID)?.remove();
  document.getElementById("osugacha-local-deal-status")?.remove();
  document.getElementById("osugacha-card-value-status")?.remove();
  document.querySelectorAll(`.${OVERLAY_CLASS}`).forEach((overlay) => overlay.remove());
  document.querySelectorAll(".osugacha-local-deal-host").forEach((host) => {
    host.classList.remove("osugacha-local-deal-host");
  });
  document.querySelectorAll(`.${CARD_VALUE_BADGE_CLASS}`).forEach((badge) => badge.remove());
  document.querySelectorAll(`.${CARD_VALUE_HOST_CLASS}`).forEach((host) => {
    host.classList.remove(CARD_VALUE_HOST_CLASS);
  });

  function startCardValueOverlay() {
    const style = document.createElement("style");
    style.id = CARD_VALUE_STYLE_ID;
    style.textContent = `
      .${CARD_VALUE_HOST_CLASS} { position: relative !important; }
      .${CARD_VALUE_BADGE_CLASS} {
        position: absolute;
        right: 5px;
        top: 5px;
        z-index: 2147483647;
        max-width: calc(100% - 10px);
        padding: 4px 7px;
        overflow: hidden;
        border: 1px solid rgba(255, 255, 255, .28);
        border-radius: 7px;
        background: rgba(20, 20, 24, .94);
        color: #fff;
        font: 700 11px/1.25 system-ui, sans-serif;
        text-align: center;
        text-overflow: ellipsis;
        white-space: nowrap;
        box-shadow: 0 1px 5px rgba(0, 0, 0, .45);
        pointer-events: none;
      }
      .${CARD_VALUE_ABOVE_NEW_CLASS} { z-index: 10; }
    `;
    document.head.append(style);

    const cardCache = new Map();
    const cardLoadedAt = new Map();
    const cardRequests = new Map();
    let isRefreshing = false;
    let refreshQueued = false;
    let stopped = false;
    let refreshDebounce = 0;

    async function getJson(path) {
      const response = await fetch(new URL(path, API_ORIGIN), {
        headers: { Accept: "application/json" },
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(`Card API returned HTTP ${response.status} for ${path}.`);
      }
      try {
        return await response.json();
      } catch (error) {
        throw new Error(
          `Card API returned invalid JSON for ${path}: ${error.message}`,
        );
      }
    }

    function collectVisibleCards() {
      const found = new Map();
      for (const anchor of document.querySelectorAll(
        '.gacha-card:not(.skeleton-card) a.gc-hit[href^="/cards/"]',
      )) {
        const cardId = new URL(anchor.getAttribute("href"), API_ORIGIN)
          .pathname.match(CARD_PATH)?.[1];
        const host = anchor.closest(".gacha-card");
        if (cardId && host) found.set(cardId, { cardId, host });
      }

      const pageCardId = window.location.pathname.match(CARD_PATH)?.[1];
      if (pageCardId && !found.has(pageCardId)) {
        const host = document.querySelector(
          "main .gacha-card:not(.skeleton-card)",
        );
        if (host) found.set(pageCardId, { cardId: pageCardId, host });
      }
      return [...found.values()];
    }

    async function getCardDetails(cardIds, forceRefresh) {
      const now = Date.now();
      const cards = [];
      for (
        let start = 0;
        start < cardIds.length;
        start += CARD_VALUE_CONCURRENCY
      ) {
        const batch = cardIds
          .slice(start, start + CARD_VALUE_CONCURRENCY)
          .map((cardId) => {
            const cachedCard = cardCache.get(cardId);
            if (
              !forceRefresh &&
              cachedCard &&
              now - cardLoadedAt.get(cardId) < CARD_VALUE_REFRESH_MS
            ) {
              return Promise.resolve(cachedCard);
            }
            if (!cardRequests.has(cardId)) {
              const request = getJson(
                `/api/cards/${encodeURIComponent(cardId)}`,
              )
                .then((card) => {
                  if (
                    !card ||
                    card.id !== cardId ||
                    !Number.isFinite(card.value) ||
                    card.value < 0
                  ) {
                    throw new Error(
                      `Card API returned no valid in-game value for ${cardId}.`,
                    );
                  }
                  cardCache.set(cardId, card);
                  cardLoadedAt.set(cardId, Date.now());
                  return card;
                })
                .finally(() => cardRequests.delete(cardId));
              cardRequests.set(cardId, request);
            }
            return cardRequests.get(cardId);
          });
        cards.push(...(await Promise.all(batch)));
        if (stopped) return [];
      }
      return cards;
    }

    function renderValue(host, value) {
      const front = host.closest(".flip-front");
      const layer = front?.querySelector(".new-badge") ? front : host;
      let badge =
        host.querySelector(`:scope > .${CARD_VALUE_BADGE_CLASS}`) ??
        front?.querySelector(`:scope > .${CARD_VALUE_BADGE_CLASS}`) ??
        null;
      if (!badge) {
        badge = document.createElement("span");
        badge.className = CARD_VALUE_BADGE_CLASS;
        badge.setAttribute("aria-hidden", "true");
      }
      badge.classList.toggle(CARD_VALUE_ABOVE_NEW_CLASS, layer !== host);
      host.classList.add(CARD_VALUE_HOST_CLASS);
      if (badge.parentElement !== layer) layer.append(badge);
      const amount = new Intl.NumberFormat().format(value);
      badge.textContent = `Value ★ ${amount}`;
      badge.title =
        `In-game card value: ${amount} Stars. This is the card's Value field, not market lowest, median, or highest prices.`;
    }

    function clearBadges() {
      document
        .querySelectorAll(`.${CARD_VALUE_BADGE_CLASS}`)
        .forEach((badge) => badge.remove());
      document
        .querySelectorAll(`.${CARD_VALUE_HOST_CLASS}`)
        .forEach((host) => host.classList.remove(CARD_VALUE_HOST_CLASS));
    }

    async function refresh(forceRefresh = false) {
      if (stopped) return;
      if (isRefreshing) {
        refreshQueued = true;
        return;
      }
      isRefreshing = true;

      try {
        const entries = collectVisibleCards();
        if (entries.length === 0) {
          clearBadges();
          return;
        }

        const cards = await getCardDetails(
          entries.map((entry) => entry.cardId),
          forceRefresh,
        );
        if (stopped) return;
        for (const [index, entry] of entries.entries()) {
          const card = cards[index];
          if (card) renderValue(entry.host, card.value);
        }
      } catch (error) {
        clearBadges();
        console.error("osu! gacha card value scan failed:", error);
      } finally {
        isRefreshing = false;
        if (refreshQueued && !stopped) {
          refreshQueued = false;
          void refresh();
        }
      }
    }

    const observer = new MutationObserver((records) => {
      const cardSelector =
        '.gacha-card:not(.skeleton-card), a.gc-hit[href^="/cards/"]';
      const needsRefresh = records.some((record) => {
        if (
          record.target instanceof Element &&
          record.target.closest(`.${CARD_VALUE_BADGE_CLASS}`)
        ) {
          return false;
        }
        return [...record.addedNodes, ...record.removedNodes].some(
          (node) =>
            node instanceof Element &&
            (node.matches(cardSelector) || node.querySelector(cardSelector)),
        );
      });
      if (!needsRefresh) return;
      window.clearTimeout(refreshDebounce);
      refreshDebounce = window.setTimeout(
        () => void refresh(),
        CARD_VALUE_DEBOUNCE_MS,
      );
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    const refreshTimer = window.setInterval(
      () => void refresh(true),
      CARD_VALUE_REFRESH_MS,
    );
    void refresh();

    return () => {
      if (stopped) return;
      stopped = true;
      observer.disconnect();
      window.clearTimeout(refreshDebounce);
      window.clearInterval(refreshTimer);
      clearBadges();
      document.getElementById(CARD_VALUE_STYLE_ID)?.remove();
    };
  }

  function startMarketOverlay() {
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .osugacha-local-deal-host { position: relative !important; }
    .${OVERLAY_CLASS} {
      position: absolute;
      inset: 0;
      z-index: 20;
      display: flex;
      align-items: center;
      justify-content: center;
      box-sizing: border-box;
      pointer-events: none;
    }
    .${OVERLAY_CLASS} span {
      max-width: calc(100% - 12px);
      padding: 5px 8px;
      border: 1px solid rgba(255, 255, 255, .28);
      border-radius: 8px;
      background: rgba(20, 20, 24, .94);
      color: #fff;
      font: 700 12px/1.3 system-ui, sans-serif;
      box-shadow: 0 1px 5px rgba(0, 0, 0, .45);
      text-align: center;
      overflow-wrap: anywhere;
    }
  `;
  document.head.append(style);

  const marketStats = document.createElement("div");
  marketStats.id = MARKET_STATS_ID;
  marketStats.setAttribute("role", "status");
  Object.assign(marketStats.style, {
    position: "fixed",
    top: "12px",
    right: "12px",
    zIndex: "2147483647",
    maxWidth: "min(400px, calc(100vw - 24px))",
    padding: "9px 12px",
    border: "1px solid rgba(255, 255, 255, .25)",
    borderRadius: "10px",
    background: "rgba(20, 20, 24, .96)",
    color: "#fff",
    font: "600 12px/1.45 system-ui, sans-serif",
    boxShadow: "0 2px 12px rgba(0, 0, 0, .4)",
    pointerEvents: "none",
  });
  marketStats.textContent = "Market flipping · loading listing data…";
  document.body.append(marketStats);
  const setMarketStats = (text, error = false) => {
    marketStats.textContent = text;
    marketStats.dataset.error = String(error);
    marketStats.style.borderColor = error
      ? "rgba(255, 130, 130, .72)"
      : "rgba(255, 255, 255, .25)";
  };

  const marketData = {
    card: { listings: null, loadedAt: 0, request: null },
    item: { listings: null, loadedAt: 0, request: null },
  };
  let isRefreshing = false;
  let refreshQueued = false;
  let stopped = false;
  let stopMarketOverlay = () => {};

  function getCardKey(card) {
    const playerId =
      typeof card.player === "object" && card.player !== null
        ? card.player.id
        : card.player;
    if (playerId === undefined || playerId === null) {
      throw new Error("Market API returned a card without player identity.");
    }

    const signature =
      card.sig && typeof card.sig === "object"
        ? { id: card.sig.id, tier: card.sig.tier }
        : card.sig;
    const mods = (card.mods || []).map((mod) => ({
      type: mod.type,
      rarity: mod.rarity,
      level: mod.level,
      main: mod.main,
      subs: mod.subs,
    }));

    return JSON.stringify({
      player: playerId,
      rarity: card.rarity,
      level: card.level,
      ascension: card.ascension,
      eidolon: card.eidolon,
      skill: card.skill,
      passive: card.passive,
      signature,
      mods,
    });
  }

  async function fetchListingPage(kind, offset) {
      const url = new URL("/api/market/listings", API_ORIGIN);
      url.search = new URLSearchParams({
        mode: "bin",
        kind,
        sort: "price_asc",
        limit: String(PAGE_SIZE),
        offset: String(offset),
      });

      const response = await fetch(url, {
        headers: { Accept: "application/json" },
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(`Market API returned HTTP ${response.status}.`);
      }

      const page = await response.json();
      if (
        !page ||
        !Array.isArray(page.items) ||
        !Number.isInteger(page.total) ||
        page.total < 0
      ) {
        throw new Error("Market API returned an unexpected listings response.");
      }

      for (const listing of page.items) {
        const validListing =
          listing &&
          typeof listing.id === "string" &&
          Number.isInteger(listing.price) &&
          listing.price >= 0 &&
          (kind === "card"
            ? listing.card && typeof listing.card.id === "string"
            : listing.item &&
              typeof listing.item.id === "string" &&
              Number.isInteger(listing.item.qty) &&
              listing.item.qty > 0);
        if (!validListing) {
          throw new Error(`Market API returned a malformed ${kind} listing.`);
        }
      }

      if (page.items.length === 0 && offset < page.total) {
        throw new Error("Market API returned an incomplete card listing page.");
      }
      return page;
  }

  function indexListings(kind, listings) {
    const byCardId = new Map();
    const byKey = new Map();
    const byVisibleItem = new Map();
    for (const listing of listings) {
      const key =
        kind === "card"
          ? getCardKey(listing.card)
          : listing.item.id;
      if (kind === "card") byCardId.set(listing.card.id, listing);
      if (kind === "item") {
        const visibleKey = getVisibleItemKey(
          listing.seller?.username,
          listing.price,
          listing.item.qty,
        );
        const matches = byVisibleItem.get(visibleKey) || [];
        matches.push(listing);
        byVisibleItem.set(visibleKey, matches);
      }
      const group = byKey.get(key) || [];
      group.push(listing);
      byKey.set(key, group);
    }
    return { kind, listings, byCardId, byKey, byVisibleItem };
  }

  async function fetchAllListings(kind) {
    const firstPage = await fetchListingPage(kind, 0);
    const pages = [firstPage];
    const offsets = [];
    for (let offset = PAGE_SIZE; offset < firstPage.total; offset += PAGE_SIZE) {
      offsets.push(offset);
    }

    for (let start = 0; start < offsets.length; start += PAGE_CONCURRENCY) {
      const batch = offsets.slice(start, start + PAGE_CONCURRENCY);
      pages.push(
        ...(await Promise.all(batch.map((offset) => fetchListingPage(kind, offset)))),
      );
    }

    const listings = new Map();
    for (const page of pages) {
      for (const listing of page.items) listings.set(listing.id, listing);
    }
    if (listings.size < firstPage.total) {
      throw new Error(
        `Market scan was incomplete (${listings.size} of ${firstPage.total} listings loaded).`,
      );
    }
    return indexListings(kind, [...listings.values()]);
  }

  async function getMarketListings(kind, forceRefresh) {
    const cache = marketData[kind];
    if (
      !forceRefresh &&
      cache.listings &&
      Date.now() - cache.loadedAt < API_REFRESH_MS
    ) {
      return cache.listings;
    }
    if (!cache.request) {
      cache.request = fetchAllListings(kind)
        .then((listings) => {
          cache.listings = listings;
          cache.loadedAt = Date.now();
          return listings;
        })
        .finally(() => {
          cache.request = null;
        });
    }
    return cache.request;
  }

  function getOtherSellerListings(candidate, listings) {
    const candidateSeller = candidate.seller || {};
    return listings
      .filter((other) => {
        if (other.id === candidate.id) return false;
        const otherSeller = other.seller || {};
        if (candidateSeller.id && otherSeller.id) {
          return candidateSeller.id !== otherSeller.id;
        }
        return Boolean(
          candidateSeller.username &&
            otherSeller.username &&
            candidateSeller.username.toLowerCase() !==
              otherSeller.username.toLowerCase(),
        );
      });
  }

  function getVisibleItemKey(seller, price, quantity) {
    if (!seller || !Number.isInteger(price) || !Number.isInteger(quantity)) {
      return null;
    }
    return `${seller.toLocaleLowerCase()}|${price}|${quantity}`;
  }

  function clearHighlights(selector) {
    document.querySelectorAll(`.${OVERLAY_CLASS}`).forEach((overlay) => {
      if (!selector || overlay.parentElement?.matches(selector)) overlay.remove();
    });
    document.querySelectorAll(".osugacha-local-deal-host").forEach((host) => {
      if (!selector || host.matches(selector)) {
        host.classList.remove("osugacha-local-deal-host");
      }
    });
  }

  function getVisibleCards(listings) {
    return [...document.querySelectorAll(".card-cell:not([aria-hidden='true'])")]
      .map((cell) => {
        const card = cell.querySelector(".gacha-card:not(.skeleton-card)");
        const href = card?.querySelector('a.gc-hit[href^="/cards/"]')?.getAttribute("href");
        const cardId = href && new URL(href, window.location.origin).pathname.split("/").pop();
        const listing = cardId && listings.byCardId.get(cardId);
        const priceTitle = cell.querySelector(".mk-price .money")?.getAttribute("title");
        const visiblePrice = priceTitle
          ? Number(priceTitle.replace(/[^\d]/g, ""))
          : null;
        if (!card || !listing || visiblePrice !== listing.price) return null;
        return { cell, listing };
      })
      .filter(Boolean);
  }

  function getVisibleItems(listings) {
    return [...document.querySelectorAll(".mk-grid.mk-items .it-tile")]
      .map((cell) => {
        const quantityText = cell.querySelector(".it-qty")?.textContent || "";
        const quantity = Number(quantityText.replace(/[^\d]/g, ""));
        const priceTitle = cell.querySelector(".mk-price .money")?.getAttribute("title");
        const price = priceTitle
          ? Number(priceTitle.replace(/[^\d]/g, ""))
          : null;
        const seller = cell
          .querySelector('.mk-seller a[href^="/u/"]')
          ?.textContent.trim();
        const key = getVisibleItemKey(seller, price, quantity);
        const matches = key ? listings.byVisibleItem.get(key) || [] : [];
        const itemIds = new Set(matches.map((listing) => listing.item.id));
        if (itemIds.size !== 1 || matches.length === 0) return null;
        return { cell, listing: matches[0] };
      })
      .filter(Boolean);
  }

  function median(values) {
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2
      ? sorted[middle]
      : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  function calculateProfit(resalePrice, purchasePrice, feeRate = 0.05) {
    const grossProfit = resalePrice - purchasePrice;
    const fee = Math.floor(Math.max(0, grossProfit) * feeRate);
    const profit = grossProfit - fee;
    const profitPercent =
      purchasePrice > 0 ? (profit / purchasePrice) * 100 : null;
    return { grossProfit, profit, profitPercent };
  }

  function formatProfitPercent(profitPercent) {
    return profitPercent === null
      ? "N/A"
      : `+${profitPercent.toLocaleString(undefined, {
          maximumFractionDigits: 1,
        })}% profit gained`;
  }

  function setDealBadge(cell, profit, label, details) {
    let overlay = cell.querySelector(`:scope > .${OVERLAY_CLASS}`);
    if (profit <= 0) {
      overlay?.remove();
      cell.classList.remove("osugacha-local-deal-host");
      return false;
    }

    cell.classList.add("osugacha-local-deal-host");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.className = OVERLAY_CLASS;
      overlay.setAttribute("aria-hidden", "true");
      cell.append(overlay);
    }
    let badge = overlay.querySelector("span");
    if (!badge) {
      badge = document.createElement("span");
      overlay.append(badge);
    }
    const badgeText = `+${profit.toLocaleString()} · ${label}`;
    if (badge.textContent !== badgeText) badge.textContent = badgeText;
    if (details) overlay.title = details;
    return true;
  }

  function renderCardDeals(cards, listings) {
    let opportunityCount = 0;
    for (const entry of cards) {
      const candidate = entry.listing;
      const comparableListings =
        listings.byKey.get(getCardKey(candidate.card)) || [];
      const otherPrices = getOtherSellerListings(candidate, comparableListings).map(
        (other) => other.price,
      );
      let resalePrice = 0;
      let exitLabel = "";

      if (otherPrices.length >= MIN_COMPS) {
        resalePrice = median(otherPrices);
        exitLabel = "market";
      }

      if (
        candidate.card.rarity === "legendary" &&
        LEGENDARY_QUICKSELL > resalePrice
      ) {
        resalePrice = LEGENDARY_QUICKSELL;
        exitLabel = "quicksell";
      }

      const { grossProfit, profit, profitPercent } = calculateProfit(
        resalePrice,
        candidate.price,
        exitLabel === "quicksell" ? 0 : 0.05,
      );
      const eidolon = Number(candidate.card.eidolon) || 0;
      if (
        setDealBadge(
          entry.cell,
          profit,
          `E${eidolon} ${exitLabel} · ${formatProfitPercent(profitPercent)}`,
          `${otherPrices.length} other-seller listings · resale ${resalePrice.toLocaleString()} · gross profit ${grossProfit.toLocaleString()} · net profit ${profit.toLocaleString()} · ${formatProfitPercent(profitPercent)} based on purchase price.`,
        )
      ) {
        opportunityCount += 1;
      }
    }
    return opportunityCount;
  }

  function renderItemDeals(items, listings) {
    let opportunityCount = 0;
    for (const entry of items) {
      const candidate = entry.listing;
      if (!candidate) {
        setDealBadge(entry.cell, 0, "", "");
        continue;
      }
      const comparableListings =
        listings.byKey.get(candidate.item.id) || [];
      const otherListings = getOtherSellerListings(candidate, comparableListings);
      if (otherListings.length < MIN_COMPS) {
        setDealBadge(entry.cell, 0, "", "");
        continue;
      }

      const medianUnitPrice = median(
        otherListings.map((other) => other.price / other.item.qty),
      );
      const resalePrice = Math.round(medianUnitPrice * candidate.item.qty);
      const { grossProfit, profit, profitPercent } = calculateProfit(
        resalePrice,
        candidate.price,
      );
      if (
        setDealBadge(
          entry.cell,
          profit,
          `item median · ${formatProfitPercent(profitPercent)}`,
          `${otherListings.length} other-seller listings · median ${medianUnitPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })} each · resale ${resalePrice.toLocaleString()} · gross profit ${grossProfit.toLocaleString()} · net profit ${profit.toLocaleString()} · ${formatProfitPercent(profitPercent)} based on purchase price.`,
        )
      ) {
        opportunityCount += 1;
      }
    }
    return opportunityCount;
  }

  async function refresh(forceRefresh = false) {
    if (stopped) return;
    if (window.location.pathname !== "/market") {
      stopMarketOverlay();
      return;
    }
    if (isRefreshing) {
      refreshQueued = true;
      return;
    }
    isRefreshing = true;

    try {
      const visibleCards = document.querySelectorAll(
        ".card-cell:not([aria-hidden='true'])",
      );
      const visibleItemCells = document.querySelectorAll(
        ".mk-grid.mk-items .it-tile",
      );
      if (visibleCards.length === 0 && visibleItemCells.length === 0) {
        clearHighlights();
        setMarketStats("Market flipping · no visible listings");
        return;
      }
      const selectedMode = document
        .querySelector('[role="tab"][aria-selected="true"]')
        ?.textContent.trim();
      if (selectedMode && selectedMode !== "Buy now") {
        clearHighlights();
        setMarketStats("Market flipping · switch to Buy now to see deal stats");
        return;
      }

      const kind = visibleCards.length > 0 ? "card" : "item";
      const inactiveSelector =
        kind === "card" ? ".it-tile" : ".card-cell";
      clearHighlights(inactiveSelector);
      setMarketStats(
        `Market flipping · scanning ${kind} listings…`,
      );
      const listings = await getMarketListings(kind, forceRefresh);
      if (stopped) return;
      const entries =
        kind === "card"
          ? getVisibleCards(listings)
          : getVisibleItems(listings);
      const opportunityCount =
        kind === "card"
          ? renderCardDeals(entries, listings)
          : renderItemDeals(entries, listings);
      setMarketStats(
        `Market flipping · ${opportunityCount} deal(s) / ${entries.length} visible ${kind} listing(s) · ${listings.listings.length.toLocaleString()} listings scanned · showing net profit gained`,
      );
    } catch (error) {
      clearHighlights();
      setMarketStats(`Market flipping scan failed · ${error.message}`, true);
      console.error("osu! gacha market API scan failed:", error);
    } finally {
      isRefreshing = false;
      if (refreshQueued && !stopped) {
        refreshQueued = false;
        void refresh();
      }
    }
  }

  void refresh();
  let refreshDebounce = 0;
  const observer = new MutationObserver((records) => {
    const needsRefresh = records.some((record) => {
      if (
        record.target instanceof Element &&
        (record.target.closest(`.${OVERLAY_CLASS}`) ||
          record.target.closest(`#${MARKET_STATS_ID}`))
      ) {
        return false;
      }
      const changedNodes = [
        ...record.addedNodes,
        ...record.removedNodes,
      ];
      return changedNodes.some(
        (node) =>
          !(node instanceof Element) ||
          (!node.matches(`.${OVERLAY_CLASS}, #${MARKET_STATS_ID}`) &&
            !node.querySelector(`.${OVERLAY_CLASS}, #${MARKET_STATS_ID}`)),
      );
    });
    if (!needsRefresh) return;
    window.clearTimeout(refreshDebounce);
    refreshDebounce = window.setTimeout(
      () => void refresh(),
      REFRESH_DEBOUNCE_MS,
    );
  });
  observer.observe(document.querySelector("main") || document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  const refreshTimer = window.setInterval(
    () => void refresh(true),
    API_REFRESH_MS,
  );

  stopMarketOverlay = () => {
    if (stopped) return;
    stopped = true;
    observer.disconnect();
    window.clearTimeout(refreshDebounce);
    window.clearInterval(refreshTimer);
    document.getElementById(STYLE_ID)?.remove();
    document.getElementById(MARKET_STATS_ID)?.remove();
    document.querySelectorAll(`.${OVERLAY_CLASS}`).forEach((overlay) => overlay.remove());
    document.querySelectorAll(".osugacha-local-deal-host").forEach((host) => {
      host.classList.remove("osugacha-local-deal-host");
    });
  };
  return stopMarketOverlay;
  }

  let activeRoute = "";
  let activeStop = null;
  let routeCheckTimer = 0;
  let stopped = false;
  const supportedRoutes = new Set([
    "/market",
    "/collection",
    "/inventory",
    "/packs",
  ]);
  const syncOverlayWithRoute = () => {
    if (stopped) return;
    const currentPath = window.location.pathname;
    const currentRoute = CARD_PATH.test(currentPath)
      ? "card"
      : supportedRoutes.has(currentPath)
        ? currentPath
        : "";
    if (currentRoute === activeRoute) return;

    activeStop?.();
    activeStop = null;
    activeRoute = currentRoute;
    if (currentRoute === "/market") {
      activeStop = startMarketOverlay();
    } else if (currentRoute) {
      activeStop = startCardValueOverlay();
    }
  };
  const stopOverlay = () => {
    if (stopped) return;
    stopped = true;
    window.clearInterval(routeCheckTimer);
    activeStop?.();
    activeStop = null;
    document.getElementById(STYLE_ID)?.remove();
    document.getElementById(MARKET_STATS_ID)?.remove();
    document.getElementById(CARD_VALUE_STYLE_ID)?.remove();
    document.querySelectorAll(`.${OVERLAY_CLASS}`).forEach((overlay) => overlay.remove());
    document.querySelectorAll(`.${CARD_VALUE_BADGE_CLASS}`).forEach((badge) => badge.remove());
    delete window.osugachaOverlayStop;
    delete window.osugachaLocalOverlayStop;
    delete window.osugachaCardValueOverlayStop;
  };
  window.osugachaOverlayStop = stopOverlay;
  window.osugachaLocalOverlayStop = stopOverlay;
  window.osugachaCardValueOverlayStop = stopOverlay;
  syncOverlayWithRoute();
  routeCheckTimer = window.setInterval(syncOverlayWithRoute, 500);
})();
