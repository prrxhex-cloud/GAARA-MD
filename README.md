# ⚡ GAARA X MD WhatsApp Bot & Web Dashboard

> **GAARA X MD** is an enterprise-grade Multi-Device WhatsApp Bot and cyber-themed Management Dashboard powered by [`@sasa-dev/void-baileys`](https://github.com/darksasa1-eng/void-baileys) (Baileys v7 engine, pure ESM, Node.js >= 20.0.0).

---

## 🌸 Key Highlights

- **Pure ESM & Modern Architecture**: Clean, modular structure using Node.js ES modules (`"type": "module"`).
- **Web Dashboard**: Dark red / neon cyber interface (`/pair`, `/settings`, `/status`) for real-time controls.
- **Render & Cloudflare Ready**: Embedded `/health` and `/ping` routes prevent 15-minute idle sleeping on free tiers.
- **Anti-Ban Protections**:
  - Humanized response jitter (1.2s – 2.8s delay)
  - Per-user rate limiting (token bucket)
  - Safe Baileys flags: `lowMemoryMode: true`, `alwaysOn: true`, `alwaysOnline: true`, `memoryGuardMb: 200`
  - Proper platform identification (`Windows (Desktop)`)
- **Anti-Bug Defense**: Automatically drops malformed stanzas, oversized messages (>15,000 chars), and known crash payloads.
- **Database & Security**:
  - Hashed panel passwords using `bcrypt` (zero plaintext credentials)
  - Zero hardcoded secrets/API keys (all loaded from `.env` via `config/`)
  - Isolated multi-file session storage in `session/`
- **In-Chat Framing Box**: Exact ASCII framing matching:
  ```text
  ╭───[ ⚡ {BOT_NAME} ]
  │◇│
  │◇│ ─────────────────
  ╰────────────────────

  ╭───[ {EMOJI} {SECTION_TITLE} ]
  │◇│
  │◇│  {CONTENT_LINES}
  │◇│
  ╰────────────────────

  THIS BOT BUILT BY GAARA DEV OFC.
  ```

---

## 🚀 Quick Start Guide

### 1. Prerequisites
- **Node.js**: `v20.0.0` or higher (verified on Node `v24.x`)
- **FFmpeg**: Installed and on system `PATH` (for stickers, audio, and media conversions)

### 2. Configuration (`.env`)
Copy `.env.example` to `.env` and configure your preferences:
```env
PORT=3000
NODE_ENV=production
APP_URL=http://localhost:3000

BOT_NAME="GAARA X MD"
BOT_PREFIX="."
OWNER_NUMBER=""
OWNER_NAME="GAARA DEV OFC"

# Sasa Dev AI Key (https://sasa-dev-api.xyz)
SASA_DEV_API_KEY=""

# Dashboard Credentials
PANEL_USERNAME="admin"
PANEL_PASSWORD=""
```

### 3. Start the Server & Bot
```bash
npm start
```
Or for development with hot-reload:
```bash
npm run dev
```

### 4. Link WhatsApp
1. Open `http://localhost:3000/pair` in your browser.
2. Enter your WhatsApp phone number with country code (e.g. `94771234567`).
3. Click **⚡ GET PAIRING CODE**.
4. Open WhatsApp on your phone: **Settings > Linked Devices > Link a Device > Link with phone number instead**.
5. Type the 8-digit code.
6. Once linked, the bot sends an automated **Connected Setup Message** with your generated panel password to your 'Message Yourself' chat.

---

## 🛠️ Web Dashboard Routes

- **`/pair`**: Pairing code portal with step-by-step instructions.
- **`/settings`**: Central control panel with 6 management tabs:
  - `01 Automation`: Anti-Call, Anti-Delete, Auto-Status, Smart AI Auto-Reply, View-Once Saver.
  - `02 Schedules`: Create, manage, and toggle one-time and daily recurring messages.
  - `03 Connection`: Real-time socket telemetry, uptime, device platform, restart controls.
  - `04 Smart Replies`: Configure custom trigger keywords and regex auto-replies.
  - `05 Identity & Profile`: Bot name, prefix, bot logo, owner profile for AI context.
  - `06 Security`: Update panel password with bcrypt hashing.
- **`/status`**: Real-time telemetry, memory usage, messages handled, ping latency.
- **`/health` & `/ping`**: Health check endpoints for Render, Cloudflare, and uptime bots.

---

## 📚 Complete Command Reference

Prefix defaults to `.` (customizable in dashboard or via `.setprefix`).

| Category | Command | Description |
|---|---|---|
| **System** | `.alive` | Bot operational status, RAM, uptime, owner |
| | `.ping` | Latency and socket response speed |
| | `.uptime` | Bot uptime duration |
| | `.owner` | Developer contact info & vCard |
| | `.speed` | System execution speed & heap stats |
| | `.runtime` | Start timestamp & total telemetry |
| | `.system` | Detailed host specs (OS, CPU, RAM, Node version) |
| | `.botinfo` | Bot overview and active feature set |
| | `.rules` | Bot usage rules and guidelines |
| **Navigation** | `.menu` / `.help` | Categorized command library with ASCII frame & buttons |
| | `.list` / `.allcmd` | Compact alphabetical list of all registered commands |
| **Media & Stickers** | `.sticker` / `.s` | Convert image or short video (<=10s) to WebP sticker |
| | `.take <pack\|author>` | Steal or change sticker watermark / exif |
| | `.toimg` | Convert quoted sticker to PNG/JPG image |
| | `.tomp3` | Convert video or audio to MP3 audio |
| | `.readviewonce` / `.vv` | Extract & resend View-Once media as normal media |
| | `.attp <text>` | Generate colorful text sticker using local font / API |
| | `.round` / `.circle` | Crop image into a circular WebP sticker |
| | `.emojimix <e1+e2>` | Mix two emojis into a sticker via Google Emoji Kitchen |
| | `.blur` | Apply blur filter to an image |
| | `.invert` | Invert colors of an image |
| | `.greyscale` | Convert image to black and white |
| | `.getpp` / `.saveprofile` | Download HD profile picture & status/bio |
| **Media Downloader** | `.play <query>` | Search and download song audio (MP3) |
| | `.song <query>` / `.ytmp3` | Download audio track |
| | `.video <query>` / `.ytmp4` | Download video track |
| | `.tiktok <url>` | Download TikTok videos without watermark |
| | `.ig <url>` | Download Instagram reels or posts |
| | `.fb <url>` | Download Facebook public videos |
| | `.twitter <url>` | Download Twitter / X videos |
| | `.gitclone <repo>` | Download public GitHub repo as ZIP |
| **Search & Research** | `.google <query>` | Web search summary and direct link |
| | `.wiki <topic>` | Wikipedia article summary and image |
| | `.lyrics <song>` | Song lyrics search |
| | `.github <user\|repo>` | GitHub user profile or repository lookup |
| | `.npm <package>` | NPM registry package information |
| | `.crypto <coin>` | Real-time cryptocurrency prices (BTC, ETH, etc.) |
| | `.imdb <movie>` | Movie and TV show ratings and plot |
| **Utilities & Tools** | `.calc <math>` | Safe arithmetic calculator with exponents (`^`) & Math functions |
| | `.qr <text>` | Generate QR Code image |
| | `.weather <city>` | Live weather conditions |
| | `.translate <lang> <text>` | Free multi-language translation |
| | `.tts <lang> <text>` | Text-to-Speech audio message |
| | `.shorturl <url>` | Shorten a long web URL |
| | `.time` | Current time in major world cities |
| | `.define <word>` | English dictionary definition and phonetic |
| | `.morse <text>` | Encode or decode Morse code |
| | `.base64 <enc\|dec>` | Base64 encoder and decoder |
| | `.binary <text>` | Binary to text and text to binary |
| | `.currency <amt> <from> <to>` | Currency conversion exchange rate |
| | `.ip <address>` | IP geolocation and ISP lookup |
| | `.fliptext <text>` | Upside-down and reversed text generator |
| | `.fancy <text>` | Generate stylish unicode fonts |
| | `.genpass <len>` | Generate secure random password |
| | `.quoted` | Inspect metadata of quoted message |
| | `.jid` | Show current chat JID or quoted user JID |
| **Group Management** | `.kick @user` | Remove participant from group (admin required) |
| | `.add <number>` | Add participant to group |
| | `.promote @user` | Promote member to group admin |
| | `.demote @user` | Demote admin to regular member |
| | `.tagall <text>` | Mention all members with formatted list |
| | `.hidetag <text>` | Mention all members invisibly |
| | `.tagadmin <text>` | Call all group admins with notice |
| | `.link` | Fetch group invite link |
| | `.revoke` | Revoke old invite link and generate new one |
| | `.mute` / `.unmute` | Lock / unlock group announcements |
| | `.setname <name>` | Change group title |
| | `.setdesc <desc>` | Change group description |
| | `.groupinfo` | Comprehensive group statistics |
| | `.leave` | Bot leaves the group |
| **Fun & Games** | `.tictactoe` / `.ttt` | Play Tic-Tac-Toe vs Bot using void-baileys engine |
| | `.chess` | Play Chess vs engine using UCI notation (e.g. `e2e4`) |
| | `.roll` | Roll a dice (1-6 or custom max) |
| | `.coin` | Flip a coin (Heads or Tails) |
| | `.joke` | Funny programming/general joke |
| | `.fact` | Fascinating science/history fact |
| | `.truth` | Truth question for party/group play |
| | `.dare` | Dare challenge for party/group play |
| | `.8ball <question>` | Magic 8-Ball fortune teller |
| | `.ship @u1 @u2` | Love compatibility percentage calculator |
| | `.riddle` | Brain riddle with hidden answer |
| | `.quote` | Inspirational quote |
| | `.roast` | Playful roast |
| | `.compliment` | Heartwarming compliment |
| | `.rate <item>` | Random rating out of 100 |
| **Anime & Art** | `.waifu` | Random anime waifu picture |
| | `.neko` | Cute anime neko picture |
| | `.shinobu` | Shinobu Kocho image |
| | `.megumin` | Megumin image |
| | `.animequote` | Wisdom quote from popular anime |
| | `.wallpaper` | HD anime wallpaper |
| **AI Chat** | `.ai <prompt>` | Query Sasa AI Plus (`https://sasa-dev-api.xyz`) |
| | `.ask <prompt>` | Ask questions to smart AI assistant |
| | `.chat <prompt>` | Interactive conversational prompt |
| **Profile Tools** | `.getbio @user` | View WhatsApp bio / about status |
| | `.setpp` | Update bot profile picture from quoted image |
| | `.setbio <text>` | Update bot WhatsApp status bio text |
| **Customization** | `.setbotname <name>` | Update bot display name |
| | `.setbotlogo <url>` | Update bot logo image URL |
| | `.addreply <trigger\|reply>`| Add custom auto-reply trigger |
| | `.delreply <trigger>` | Remove custom auto-reply trigger |
| | `.listreply` | List all configured custom auto-replies |
| | `.clearreplies` | Remove all custom auto-replies |
| **Owner Controls** | `.mode <public\|private>` | Switch bot between public and owner-only |
| | `.anticall <on\|off>` | Toggle Anti-Call guard |
| | `.antidelete <on\|off>` | Toggle Anti-Delete guard |
| | `.autostatus <on\|off>` | Toggle Auto-Status viewer & liker |
| | `.block @user` | Block contact on WhatsApp |
| | `.unblock @user` | Unblock contact on WhatsApp |
| | `.broadcast <text>` | Broadcast message to active chats |
| | `.setprefix <symbol>` | Change bot command prefix |
| | `.eval <code>` | Evaluate JavaScript in bot runtime |
| | `.exec <cmd>` | Execute shell command on host |
| | `.clearcache` | Flush in-memory message and rate caches |
| | `.restart` | Restart bot socket connection |
| | `.join <link>` | Join group via invite link |

---

## 🤖 Automations Architecture

1. **Anti-Call Guard**:
   Intercepts incoming voice and video calls, sends warning notices with `{warning}/3`, `{remaining_text}`, `{caller}`, and automatically blocks the contact upon the 4th attempt.
2. **Anti-Delete Recovery**:
   Caches incoming messages and media inside an LRU memory cache. When a message revoke stanza (`protocolMessage.type === 0`) is intercepted, recovers the text/media and reposts it directly to the bot owner's **Message Yourself** chat.
3. **Auto-Status Viewer & Liker**:
   Automatically marks WhatsApp status updates as read and reacts with the chosen emoji (default `💖`).
4. **Smart Auto-Reply System**:
   - Matches custom trigger words first (exact, contains, regex).
   - In direct 1-on-1 chats (`@s.whatsapp.net`), triggers Sasa AI Plus with Owner Profile context.
   - **Strictly ignores** group chats (`@g.us`), newsletters (`@newsletter`), and blacklisted numbers.
5. **Message Scheduler**:
   Background runner executes scheduled one-time and daily recurring messages accurately.

---

## 🧪 Testing

Run the automated test suite with Node's native test runner:
```bash
node --test tests/*.test.js
```
Runs **141 unit and integration tests** verifying database integrity, bcrypt password security, anti-bug stanza sanitization, in-chat ASCII formatting, command registration across all categories, media EXIF metadata injection, ATTP sticker generation, and keepalive endpoints.

---

## 🌸 License & Credits

Built with ❤️ by **GAARA DEV OFC**.
Engine: [`@sasa-dev/void-baileys`](https://github.com/darksasa1-eng/void-baileys)
All rights reserved.
