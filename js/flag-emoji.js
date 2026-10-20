/*
  Country flag emoji fallback for Windows, which has no flag emoji (so 🇧🇷
  shows as "BR"). Same check as the country-flag-emoji-polyfill package
  (MIT, TalkJS): if a normal emoji draws in colour but a flag doesn't, define
  the self-hosted Twemoji flag font (webfonts/, CC-BY 4.0 — see
  webfonts/TwemojiCountryFlags-LICENSE.md). unicode-range limits it to flag
  characters, and the browser only downloads it once a flag is actually
  drawn — other devices never fetch it.

  Load as a plain (classic) <script> in <head>, and give flag elements the
  .flag-emoji class from css/tokens.css (connect.html's .country-flag uses
  the same font stack).
*/
        (function () {
            try {
                var stack = '"Twemoji Mozilla","Apple Color Emoji","Segoe UI Emoji","Segoe UI Symbol","Noto Color Emoji","EmojiOne Color","Android Emoji",sans-serif';
                var canvas = document.createElement('canvas');
                canvas.width = canvas.height = 1;
                var ctx = canvas.getContext('2d', { willReadFrequently: true });
                if (!ctx) return;
                ctx.textBaseline = 'top';
                ctx.font = '100px ' + stack;
                ctx.scale(0.01, 0.01);
                // A colour emoji ignores fillStyle, so it draws the same pixel
                // in white and in black; a plain-letter fallback doesn't.
                var drawsInColour = function (text) {
                    var draw = function (fill) {
                        ctx.clearRect(0, 0, 100, 100);
                        ctx.fillStyle = fill;
                        ctx.fillText(text, 0, 0);
                        return ctx.getImageData(0, 0, 1, 1).data.join(',');
                    };
                    var white = draw('#fff'), black = draw('#000');
                    return black === white && black.indexOf('0,0,0,') !== 0;
                };
                if (drawsInColour('\uD83D\uDE0A') && !drawsInColour('\uD83C\uDDE8\uD83C\uDDED')) {
                    var style = document.createElement('style');
                    style.textContent = '@font-face { font-family: "Twemoji Country Flags";'
                        + ' unicode-range: U+1F1E6-1F1FF, U+1F3F4, U+E0062-E0063, U+E0065, U+E0067, U+E006C, U+E006E, U+E0073-E0074, U+E0077, U+E007F;'
                        + ' src: url("webfonts/TwemojiCountryFlags.woff2") format("woff2"); font-display: swap; }';
                    document.head.appendChild(style);
                }
            } catch (e) { /* no canvas — keep whatever the device shows */ }
        })();
