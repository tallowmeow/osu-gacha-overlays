# osu! gacha overlays

A browser-console overlay for osu! gacha market listings and card values.

## Features

- On `/market`, compares visible Buy now card and item listings with other sellers and highlights profitable deals.
- Card comparisons use matching card details, including Eidolon, and median comparable prices.
- Item comparisons use median price per item.
- Profit percentages are net profit relative to the listing purchase price. Market-sale calculations account for the 5% fee on positive gross profit; legendary quicksell does not.
- On `/packs`, `/collection`, `/inventory`, and `/cards/:id`, displays each card's in-game **Value** field.
- Automatically switches between market and card-value overlays when navigating supported pages.

## Install for automatic execution

1. Install the Tampermonkey extension in Firefox.
2. Open the [raw userscript](https://raw.githubusercontent.com/tallowmeow/osu-gacha-overlays/main/market_flipping_overlay.js).
3. Confirm **Install** in Tampermonkey.
4. Open or refresh osu! gacha. The script runs automatically on supported pages.

With the userscript installed, enter `-disable` in the Firefox Web Console to stop the overlay and keep it disabled across refreshes. Enter `-enable` to re-enable it and reload the page. These commands require the userscript to be installed in Tampermonkey.

## Run manually

1. Sign in to [osu! gacha](https://osugacha.com) in Firefox.
2. Open `market_flipping_overlay.js` and copy its contents.
3. Open the osu! gacha page, open Firefox's Web Console, paste the script, and run it.

The script uses same-origin browser requests to the site's `/api/market/listings` and `/api/cards/:id` endpoints. It does not send account credentials to another origin.

Run `window.osugachaOverlayStop()` in the Web Console to stop the active overlay.
