// ==UserScript==
// @name         osu! gacha market and card overlays
// @namespace    https://github.com/tallowmeow/osu-gacha-overlays
// @version      1.0.1
// @description  Shows market flipping stats and in-game card values.
// @match        https://osugacha.com/*
// @run-at       document-idle
// @grant        none
// @updateURL    https://raw.githubusercontent.com/tallowmeow/osu-gacha-overlays/main/market_flipping_overlay.js
// @downloadURL  https://raw.githubusercontent.com/tallowmeow/osu-gacha-overlays/main/market_flipping_overlay.js
// ==/UserScript==

// Card value and market deal overlays for osu! gacha.
// Install with Tampermonkey to auto-run after page loads and refreshes.
(() => {
  const API_ORIGIN = "https://osugacha.com";
  if (window.location.origin !== API_ORIGIN) {
    throw new Error("Run this overlay on osu! gacha.");
  }

  const AUTOEXEC_DISABLED_KEY = "osugachaOverlayAutoexecDisabled";
  const QUICKSELL_ALERTS_ENABLED_KEY = "osugachaQuicksellAlertsEnabled";
  const bindConsoleCommand = (name, action) => {
    Object.defineProperty(window, name, {
      configurable: true,
      value: {
        [Symbol.toPrimitive]() {
          action();
          return 0;
        },
      },
    });
  };
  bindConsoleCommand("disable", () => {
    localStorage.setItem(AUTOEXEC_DISABLED_KEY, "true");
    window.osugachaOverlayStop?.();
  });
  bindConsoleCommand("enable", () => {
    localStorage.removeItem(AUTOEXEC_DISABLED_KEY);
    window.location.reload();
  });

  if (localStorage.getItem(AUTOEXEC_DISABLED_KEY) === "true") {
    window.osugachaOverlayStop?.();
    return;
  }

  const STYLE_ID = "osugacha-local-deal-style";
  const MARKET_STATS_ID = "osugacha-market-flipping-stats";
  const PROFITABLE_LISTINGS_ID = "osugacha-profitable-listings";
  const QUICKSELL_NOTIFICATIONS_ID = "osugacha-quicksell-notifications";
  const OVERLAY_CLASS = "osugacha-local-deal-overlay";
  const MIN_COMPS = 2;
  const MARKET_LISTING_FEE_RATE = 0.02;
  const LEGENDARY_QUICKSELL = 375;
  const PAGE_SIZE = 100;
  const PAGE_CONCURRENCY = 6;
  const API_REFRESH_MS = 60_000;
  const REFRESH_DEBOUNCE_MS = 120;
  const CARD_VALUE_STYLE_ID = "osugacha-card-value-style";
  const CARD_VALUE_BADGE_CLASS = "osugacha-card-value-badge";
  const CARD_VALUE_ABOVE_NEW_CLASS = `${CARD_VALUE_BADGE_CLASS}-above-new`;
  const CARD_VALUE_HOST_CLASS = "osugacha-card-value-host";
  const PULL_NOTIFICATION_CLASS = "osugacha-pull-notification";
  const WATCHED_CARD_RARITIES = new Set([
    "divine",
    "mythic",
    "mythical",
    "legendary",
  ]);
  const WATCHED_COPY_NUMBERS = new Set([
    "0",
    "1",
    "2",
    "3",
    "67",
    "69",
    "677",
    "699",
    "727",
  ]);
  const CARD_VALUE_CONCURRENCY = 6;
  const CARD_VALUE_REFRESH_MS = 60_000;
  const CARD_VALUE_DEBOUNCE_MS = 160;
  const CARD_PATH = /^\/cards\/([^/]+)\/?$/;
  const path = window.location.pathname;
  const isSupportedPath =
    path === "/collection" ||
    path === "/inventory" ||
    path === "/packs" ||
    path === "/settings" ||
    path === "/market" ||
    CARD_PATH.test(path);

  if (!isSupportedPath) return;

  window.osugachaOverlayStop?.();
  window.osugachaLocalOverlayStop?.();
  window.osugachaCardValueOverlayStop?.();
  document.getElementById(STYLE_ID)?.remove();
  document.getElementById(MARKET_STATS_ID)?.remove();
  document.getElementById(PROFITABLE_LISTINGS_ID)?.remove();
  document.getElementById(QUICKSELL_NOTIFICATIONS_ID)?.remove();
  document.getElementById("osugacha-quicksell-alert-setting")?.remove();
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
  document.querySelectorAll(".osugacha-pull-notifications").forEach((host) => {
    host.remove();
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
      .osugacha-pull-notifications {
        position: fixed;
        top: 12px;
        left: 12px;
        z-index: 2147483647;
        display: grid;
        gap: 8px;
        max-width: min(360px, calc(100vw - 24px));
        pointer-events: none;
      }
      .${PULL_NOTIFICATION_CLASS} {
        padding: 10px 14px;
        border: 1px solid rgba(255, 215, 0, .7);
        border-radius: 10px;
        background: rgba(20, 20, 24, .96);
        color: #fff;
        font: 700 14px/1.4 system-ui, sans-serif;
        box-shadow: 0 2px 12px rgba(0, 0, 0, .45);
        animation: osugacha-pull-notification-in .2s ease-out;
      }
      @keyframes osugacha-pull-notification-in {
        from { opacity: 0; transform: translateY(-6px); }
        to { opacity: 1; transform: translateY(0); }
      }
    `;
    document.head.append(style);
    const pullNotificationHost = document.createElement("div");
    pullNotificationHost.className = "osugacha-pull-notifications";
    document.body.append(pullNotificationHost);

    const cardCache = new Map();
    const cardLoadedAt = new Map();
    const cardRequests = new Map();
    const notifiedCardIds = new Set();
    const newlyPulledCardIds = new Set();
    let notificationPermissionRequest = null;
    let isRefreshing = false;
    let refreshQueued = false;
    let stopped = false;
    let refreshDebounce = 0;

    function notifyIfPulledWatchedCard(card, isNewlyPulled) {
      if (!card || !card.id || !isNewlyPulled) return;
      const rarity = String(card.rarity ?? "").toLowerCase();
      const copyNumber =
        card.copy_number === undefined || card.copy_number === null
          ? null
          : String(card.copy_number).replaceAll(",", "");
      const isWatchedRarity = WATCHED_CARD_RARITIES.has(rarity);
      const isWatchedCopyNumber =
        copyNumber !== null && WATCHED_COPY_NUMBERS.has(copyNumber);
      if (!isWatchedRarity && !isWatchedCopyNumber) return;
      const cardId = String(card.id);
      if (notifiedCardIds.has(cardId)) return;
      notifiedCardIds.add(cardId);

      const label = rarity.charAt(0).toUpperCase() + rarity.slice(1);
      const title = isWatchedCopyNumber
        ? `Pulled watched copy #${copyNumber}!`
        : `Pulled ${label}!`;
      const body = `${card.name || "Unknown card"} · ${
        copyNumber === null ? `Card #${cardId}` : `Copy #${copyNumber}`
      }`;
      const toast = document.createElement("div");
      toast.className = PULL_NOTIFICATION_CLASS;
      toast.textContent = `${title} ${body}`;
      pullNotificationHost.append(toast);
      window.setTimeout(() => toast.remove(), 8000);

      if (!("Notification" in window)) return;
      if (window.Notification.permission === "default") {
        if (!notificationPermissionRequest) {
          notificationPermissionRequest = window.Notification.requestPermission()
            .finally(() => {
              notificationPermissionRequest = null;
            });
        }
        void notificationPermissionRequest
          .then((permission) => {
            if (permission === "granted") {
              showSystemNotification(title, body, cardId);
            }
          })
          .catch((error) => {
            console.warn("osu! gacha notification permission request failed:", error);
          });
      } else if (window.Notification.permission === "granted") {
        showSystemNotification(title, body, cardId);
      }
    }

    function showSystemNotification(title, body, cardId) {
      try {
        const notification = new window.Notification(title, {
          body,
          tag: `osugacha-card-${cardId}`,
        });
        window.setTimeout(() => notification.close(), 6000);
      } catch (error) {
        console.warn("osu! gacha system notification failed:", error);
      }
    }

    function markNewlyAddedCards(records) {
      if (window.location.pathname !== "/packs") return;
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (!(node instanceof Element)) continue;
          const hosts = new Set();
          const containingHost = node.closest(
            ".gacha-card:not(.skeleton-card)",
          );
          if (containingHost) hosts.add(containingHost);
          if (node.matches(".gacha-card:not(.skeleton-card)")) hosts.add(node);
          node
            .querySelectorAll(".gacha-card:not(.skeleton-card)")
            .forEach((host) => hosts.add(host));
          for (const host of hosts) {
            const href = host
              .querySelector('a.gc-hit[href^="/cards/"]')
              ?.getAttribute("href");
            const cardId = href
              ? new URL(href, API_ORIGIN).pathname.match(CARD_PATH)?.[1]
              : null;
            if (cardId) newlyPulledCardIds.add(cardId);
          }
        }
      }
    }

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
          if (!card) continue;
          const isNewlyPulled = Boolean(
            newlyPulledCardIds.has(entry.cardId) ||
            entry.host.closest(".flip-front")?.querySelector(".new-badge") ||
            entry.host.querySelector(".new-badge"),
          );
          notifyIfPulledWatchedCard(card, isNewlyPulled);
          newlyPulledCardIds.delete(entry.cardId);
          renderValue(entry.host, card.value);
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
      markNewlyAddedCards(records);
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
    void refresh();
    const refreshTimer = window.setInterval(
      () => void refresh(true),
      CARD_VALUE_REFRESH_MS,
    );

    return () => {
      if (stopped) return;
      stopped = true;
      observer.disconnect();
      window.clearTimeout(refreshDebounce);
      window.clearInterval(refreshTimer);
      clearBadges();
      pullNotificationHost.remove();
      document.getElementById(CARD_VALUE_STYLE_ID)?.remove();
    };
  }

  function startSettingsOverlay() {
    let stopped = false;
    const settingId = "osugacha-quicksell-alert-setting";
    const syncSetting = () => {
      if (stopped) return;
      const settingsRows = document.querySelector("main .set-section .set-rows");
      if (!settingsRows || document.getElementById(settingId)) return;

      const row = document.createElement("div");
      row.id = settingId;
      row.className = "set-row";
      const label = document.createElement("span");
      label.className = "set-row-label";
      const category = document.createElement("small");
      category.textContent = "Market alerts";
      const title = document.createElement("b");
      title.textContent = "Quicksell deals";
      const description = document.createElement("span");
      description.textContent =
        "Show alerts for Legendary, Mythic, and Divine cards listed below quicksell value.";
      label.append(category, title, description);

      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "btn ghost";
      toggle.setAttribute("aria-pressed", "true");
      const updateToggle = () => {
        const enabled =
          localStorage.getItem(QUICKSELL_ALERTS_ENABLED_KEY) !== "false";
        toggle.textContent = `Quicksell alerts: ${enabled ? "On" : "Off"}`;
        toggle.setAttribute("aria-pressed", String(enabled));
      };
      toggle.addEventListener("click", () => {
        const enabled =
          localStorage.getItem(QUICKSELL_ALERTS_ENABLED_KEY) !== "false";
        localStorage.setItem(QUICKSELL_ALERTS_ENABLED_KEY, String(!enabled));
        updateToggle();
      });
      updateToggle();
      row.append(label, toggle);
      settingsRows.append(row);
    };

    const observer = new MutationObserver(syncSetting);
    observer.observe(document.querySelector("main") || document.body, {
      childList: true,
      subtree: true,
    });
    syncSetting();

    return () => {
      stopped = true;
      observer.disconnect();
      document.getElementById(settingId)?.remove();
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
    #${PROFITABLE_LISTINGS_ID} {
      position: fixed;
      bottom: 12px;
      right: 12px;
      z-index: 2147483647;
      width: min(360px, calc(100vw - 24px));
      max-height: 72vh;
      overflow: hidden;
      border: 1px solid rgba(255, 255, 255, .25);
      border-radius: 10px;
      background: rgba(20, 20, 24, .97);
      color: #fff;
      font: 600 12px/1.45 system-ui, sans-serif;
      box-shadow: 0 2px 12px rgba(0, 0, 0, .45);
    }
    #${PROFITABLE_LISTINGS_ID} button {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      width: 100%;
      padding: 10px 12px;
      border: 0;
      background: transparent;
      color: inherit;
      font: inherit;
      text-align: left;
      cursor: pointer;
    }
    #${PROFITABLE_LISTINGS_ID} button:hover,
    #${PROFITABLE_LISTINGS_ID} button:focus-visible {
      background: rgba(255, 255, 255, .08);
    }
    #${PROFITABLE_LISTINGS_ID} [data-profitable-listings-body] {
      max-height: calc(72vh - 44px);
      overflow: auto;
      border-top: 1px solid rgba(255, 255, 255, .16);
    }
    #${PROFITABLE_LISTINGS_ID} [data-profitable-listings-message] {
      margin: 0;
      padding: 12px;
      color: rgba(255, 255, 255, .75);
    }
    #${PROFITABLE_LISTINGS_ID} [data-profitable-listings-message][data-error="true"] {
      color: #ffb0b0;
    }
    #${PROFITABLE_LISTINGS_ID} [data-profitable-listing] {
      display: block;
      padding: 10px 12px;
      border-bottom: 1px solid rgba(255, 255, 255, .12);
      color: inherit;
      text-decoration: none;
    }
    #${PROFITABLE_LISTINGS_ID} [data-profitable-listing]:last-child {
      border-bottom: 0;
    }
    #${PROFITABLE_LISTINGS_ID} [data-profitable-listing]:hover,
    #${PROFITABLE_LISTINGS_ID} [data-profitable-listing]:focus-visible {
      background: rgba(255, 102, 170, .16);
    }
    #${PROFITABLE_LISTINGS_ID} [data-profitable-listing-title] {
      display: block;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    #${PROFITABLE_LISTINGS_ID} [data-profitable-listing-details] {
      display: block;
      margin-top: 3px;
      color: rgba(255, 255, 255, .72);
      font-size: 11px;
    }
    #${QUICKSELL_NOTIFICATIONS_ID} {
      position: fixed;
      bottom: 12px;
      left: 12px;
      z-index: 2147483647;
      display: flex;
      flex-direction: column-reverse;
      gap: 8px;
      width: min(340px, calc(100vw - 24px));
      max-height: 45vh;
      overflow-y: auto;
      pointer-events: auto;
    }
    #${QUICKSELL_NOTIFICATIONS_ID} a {
      display: block;
      padding: 10px 12px;
      border: 1px solid rgba(255, 102, 170, .65);
      border-radius: 10px;
      background: rgba(20, 20, 24, .97);
      color: #fff;
      font: 600 12px/1.45 system-ui, sans-serif;
      box-shadow: 0 2px 12px rgba(0, 0, 0, .45);
      pointer-events: auto;
      text-decoration: none;
    }
    #${QUICKSELL_NOTIFICATIONS_ID} a:hover,
    #${QUICKSELL_NOTIFICATIONS_ID} a:focus-visible {
      background: rgba(48, 28, 40, .98);
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

  const profitablePanel = document.createElement("section");
  profitablePanel.id = PROFITABLE_LISTINGS_ID;
  profitablePanel.dataset.expanded = "false";
  profitablePanel.setAttribute("aria-label", "All profitable listings");
  const profitableToggle = document.createElement("button");
  profitableToggle.type = "button";
  profitableToggle.setAttribute("aria-expanded", "false");
  const profitableToggleLabel = document.createElement("span");
  const profitableToggleIcon = document.createElement("span");
  profitableToggleIcon.setAttribute("aria-hidden", "true");
  profitableToggleLabel.textContent = "All profitable listings (0)";
  profitableToggleIcon.textContent = "+";
  profitableToggle.append(profitableToggleLabel, profitableToggleIcon);
  const profitableBody = document.createElement("div");
  profitableBody.dataset.profitableListingsBody = "";
  profitableBody.id = `${PROFITABLE_LISTINGS_ID}-body`;
  profitableBody.setAttribute("aria-live", "polite");
  profitableToggle.setAttribute("aria-controls", profitableBody.id);
  const profitableMessage = document.createElement("p");
  profitableMessage.dataset.profitableListingsMessage = "";
  profitableMessage.textContent = "Waiting for market listings…";
  profitableBody.append(profitableMessage);
  profitablePanel.append(profitableToggle, profitableBody);
  profitableToggle.addEventListener("click", () => {
    const expanded = profitablePanel.dataset.expanded !== "true";
    profitablePanel.dataset.expanded = String(expanded);
    profitableToggle.setAttribute("aria-expanded", String(expanded));
    profitableToggleIcon.textContent = expanded ? "−" : "+";
    profitableBody.hidden = !expanded;
  });
  profitableBody.hidden = true;
  document.body.append(profitablePanel);

  const quicksellNotificationHost = document.createElement("div");
  quicksellNotificationHost.id = QUICKSELL_NOTIFICATIONS_ID;
  quicksellNotificationHost.setAttribute("aria-live", "polite");
  quicksellNotificationHost.setAttribute("aria-label", "Quicksell deal alerts");
  document.body.append(quicksellNotificationHost);
  const notifiedQuicksellListings = new Set();

  function getMarketListingUrl(kind, listing) {
    const search = new URLSearchParams({
      mode: "bin",
      kind,
      sort: "price_asc",
    });
    if (kind === "card") {
      const player = listing.card.player;
      const query =
        typeof player === "object" && player !== null
          ? player.username || player.name || player.id
          : player;
      if (query !== undefined && query !== null) {
        search.set("q", String(query));
      }
    } else {
      search.set("itemId", listing.item.id);
    }
    return `/market?${search}`;
  }

  function notifyQuicksellListings(kind, listings) {
    if (
      kind !== "card" ||
      localStorage.getItem(QUICKSELL_ALERTS_ENABLED_KEY) === "false"
    ) {
      return;
    }
    for (const listing of listings.listings) {
      if (
        !WATCHED_CARD_RARITIES.has(listing.card.rarity) ||
        listing.price >= LEGENDARY_QUICKSELL
      ) {
        continue;
      }
      const notificationKey = listing.id;
      if (notifiedQuicksellListings.has(notificationKey)) continue;
      notifiedQuicksellListings.add(notificationKey);

      const notification = document.createElement("a");
      notification.href = getMarketListingUrl("card", listing);
      const player =
        typeof listing.card.player === "object" && listing.card.player !== null
          ? listing.card.player.username || listing.card.player.name
          : `Player ${listing.card.player}`;
      notification.textContent =
        `${listing.card.rarity} card below quicksell · ${player} · ${listing.price.toLocaleString()} Stars (quicksell ${LEGENDARY_QUICKSELL.toLocaleString()})`;
      quicksellNotificationHost.append(notification);
      window.setTimeout(() => notification.remove(), 12_000);
    }
  }

  function setProfitableListingsMessage(message, error = false) {
    profitableToggleLabel.textContent = "All profitable listings (0)";
    const paragraph = document.createElement("p");
    paragraph.dataset.profitableListingsMessage = "";
    paragraph.dataset.error = String(error);
    paragraph.textContent = message;
    profitableBody.replaceChildren(paragraph);
  }

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

  function calculateProfit(
    resalePrice,
    purchasePrice,
    feeRate = MARKET_LISTING_FEE_RATE,
  ) {
    const grossProfit = resalePrice - purchasePrice;
    const fee = Math.floor(Math.max(0, resalePrice) * feeRate);
    const profit = grossProfit - fee;
    const profitPercent =
      purchasePrice > 0 ? (profit / purchasePrice) * 100 : null;
    return { grossProfit, fee, profit, profitPercent };
  }

  function getCardDeal(candidate, listings) {
    const comparableListings =
      listings.byKey.get(getCardKey(candidate.card)) || [];
    const otherPrices = getOtherSellerListings(candidate, comparableListings).map(
      (other) => other.price,
    );
    let resalePrice = 0;
    let exitLabel = "";

    if (otherPrices.length >= MIN_COMPS) {
      resalePrice = Math.min(...otherPrices);
      exitLabel = "lowest market";
    }

    if (
      candidate.card.rarity === "legendary" &&
      LEGENDARY_QUICKSELL > resalePrice
    ) {
      resalePrice = LEGENDARY_QUICKSELL;
      exitLabel = "quicksell";
    }

    return {
      ...calculateProfit(
        resalePrice,
        candidate.price,
        exitLabel === "quicksell" ? 0 : MARKET_LISTING_FEE_RATE,
      ),
      resalePrice,
      exitLabel,
      otherSellerCount: otherPrices.length,
    };
  }

  function getItemDeal(candidate, listings) {
    const comparableListings =
      listings.byKey.get(candidate.item.id) || [];
    const otherListings = getOtherSellerListings(candidate, comparableListings);
    if (otherListings.length < MIN_COMPS) return null;

    const medianUnitPrice = median(
      otherListings.map((other) => other.price / other.item.qty),
    );
    const resalePrice = Math.round(medianUnitPrice * candidate.item.qty);
    return {
      ...calculateProfit(resalePrice, candidate.price),
      resalePrice,
      medianUnitPrice,
      otherSellerCount: otherListings.length,
    };
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
      const {
        grossProfit,
        fee,
        profit,
        profitPercent,
        resalePrice,
        otherSellerCount,
      } = getCardDeal(candidate, listings);
      if (
        setDealBadge(
          entry.cell,
          profit,
          formatProfitPercent(profitPercent),
          `${otherSellerCount} other-seller listings · lowest resale ${resalePrice.toLocaleString()} · gross profit ${grossProfit.toLocaleString()} · listing fee ${fee.toLocaleString()} · net profit ${profit.toLocaleString()} · ${formatProfitPercent(profitPercent)} based on purchase price.`,
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
      const deal = getItemDeal(candidate, listings);
      if (!deal) {
        setDealBadge(entry.cell, 0, "", "");
        continue;
      }
      const {
        grossProfit,
        fee,
        profit,
        profitPercent,
        resalePrice,
        medianUnitPrice,
        otherSellerCount,
      } = deal;
      if (
        setDealBadge(
          entry.cell,
          profit,
          `item median · ${formatProfitPercent(profitPercent)}`,
          `${otherSellerCount} other-seller listings · median ${medianUnitPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })} each · resale ${resalePrice.toLocaleString()} · gross profit ${grossProfit.toLocaleString()} · listing fee ${fee.toLocaleString()} · net profit ${profit.toLocaleString()} · ${formatProfitPercent(profitPercent)} based on purchase price.`,
        )
      ) {
        opportunityCount += 1;
      }
    }
    return opportunityCount;
  }

  function renderProfitableListings(listings) {
    const opportunities = [];
    for (const listing of listings.listings) {
      const deal = getCardDeal(listing, listings);
      if (deal.profit > 0) opportunities.push({ listing, deal });
    }
    opportunities.sort((a, b) => b.deal.profit - a.deal.profit);
    profitableToggleLabel.textContent =
      `All profitable listings (${opportunities.length.toLocaleString()})`;

    if (opportunities.length === 0) {
      setProfitableListingsMessage("No profitable listings found in this category.");
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const { listing, deal } of opportunities) {
      const link = document.createElement("a");
      link.dataset.profitableListing = "";
      link.href = getMarketListingUrl("card", listing);
      const title = document.createElement("span");
      title.dataset.profitableListingTitle = "";
      const player =
        typeof listing.card.player === "object" && listing.card.player !== null
          ? listing.card.player.username || listing.card.player.name
          : `Player ${listing.card.player}`;
      title.textContent = [
        `Card · ${listing.card.rarity}`,
        player,
        listing.card.level ? `Lv. ${listing.card.level}` : "",
      ]
        .filter(Boolean)
        .join(" · ");
      const details = document.createElement("span");
      details.dataset.profitableListingDetails = "";
      details.textContent =
        `Buy ${listing.price.toLocaleString()} · net +${deal.profit.toLocaleString()} Stars · ${formatProfitPercent(deal.profitPercent)}`;
      link.append(title, details);
      fragment.append(link);
    }
    profitableBody.replaceChildren(fragment);
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
        setProfitableListingsMessage("Waiting for market listings…");
        return;
      }
      const selectedMode = document
        .querySelector('[role="tab"][aria-selected="true"]')
        ?.textContent.trim();
      if (selectedMode && selectedMode !== "Buy now") {
        clearHighlights();
        setMarketStats("Market flipping · switch to Buy now to see deal stats");
        setProfitableListingsMessage("Switch to Buy now to find profitable listings.");
        return;
      }

      const kind = visibleCards.length > 0 ? "card" : "item";
      const otherKind = kind === "card" ? "item" : "card";
      const inactiveSelector =
        kind === "card" ? ".it-tile" : ".card-cell";
      clearHighlights(inactiveSelector);
      setMarketStats(
        `Market flipping · scanning ${kind} listings…`,
      );
      const otherListingsPromise = getMarketListings(
        otherKind,
        forceRefresh,
      ).then(
        (otherListings) => ({ otherListings }),
        (error) => ({ error }),
      );
      const listings = await getMarketListings(kind, forceRefresh);
      if (stopped) return;
      notifyQuicksellListings(kind, listings);
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
      const otherResult = await otherListingsPromise;
      if (stopped) return;
      if ("otherListings" in otherResult) {
        notifyQuicksellListings(otherKind, otherResult.otherListings);
      } else {
        console.error(
          `osu! gacha ${otherKind} market scan failed:`,
          otherResult.error,
        );
      }
      const cardListings =
        kind === "card"
          ? listings
          : "otherListings" in otherResult
            ? otherResult.otherListings
            : null;
      if (cardListings) {
        renderProfitableListings(cardListings);
      } else {
        const errorMessage =
          otherResult.error instanceof Error
            ? otherResult.error.message
            : String(otherResult.error);
        setProfitableListingsMessage(
          `Could not load card listings; the full list is unavailable. ${errorMessage}`,
          true,
        );
      }
    } catch (error) {
      clearHighlights();
      setMarketStats(`Market flipping scan failed · ${error.message}`, true);
      setProfitableListingsMessage(`Listing scan failed · ${error.message}`, true);
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
          record.target.closest(`#${MARKET_STATS_ID}`) ||
          record.target.closest(`#${PROFITABLE_LISTINGS_ID}`) ||
          record.target.closest(`#${QUICKSELL_NOTIFICATIONS_ID}`))
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
          (!node.matches(
            `.${OVERLAY_CLASS}, #${MARKET_STATS_ID}, #${PROFITABLE_LISTINGS_ID}, #${QUICKSELL_NOTIFICATIONS_ID}`,
          ) &&
            !node.querySelector(
              `.${OVERLAY_CLASS}, #${MARKET_STATS_ID}, #${PROFITABLE_LISTINGS_ID}, #${QUICKSELL_NOTIFICATIONS_ID}`,
            )),
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
    document.getElementById(PROFITABLE_LISTINGS_ID)?.remove();
    document.getElementById(QUICKSELL_NOTIFICATIONS_ID)?.remove();
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
    "/settings",
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
    } else if (currentRoute === "/settings") {
      activeStop = startSettingsOverlay();
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
    document.getElementById(PROFITABLE_LISTINGS_ID)?.remove();
    document.getElementById(QUICKSELL_NOTIFICATIONS_ID)?.remove();
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
