<div align="center">

# Spotify Anonymous API

**A zero-dependency Node.js API that resolves Spotify metadata without official client credentials.**

Built for projects that need fast, anonymous access to Spotify track, album, playlist, and artist data.

![License](https://img.shields.io/badge/license-MIT-blue)
![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)
![Dependencies](https://img.shields.io/badge/dependencies-zero-brightgreen)
![Deploy](https://img.shields.io/badge/deploy-Vercel-black)

[Live Demo](https://spotify-api-lime-xi.vercel.app) | [Report Issue](https://github.com/knownasrazi/spotify-api/issues)

</div>

---

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [How It Works](#how-it-works)
- [Quick Start](#quick-start)
- [Deployment](#deployment)
- [API Reference](#api-reference)
- [Architecture](#architecture)
- [Configuration](#configuration)
- [Error Handling](#error-handling)
- [Limitations](#limitations)
- [Contributing](#contributing)
- [License](#license)

---

## Overview

Spotify Anonymous API replicates the authentication flow of Spotify's web player to obtain anonymous access tokens. It then queries Spotify's internal GraphQL API (Pathfinder) and public Web API to return normalized, compact metadata — all without requiring official API credentials or user login.

**Use cases:** Music discovery apps, playlist analytics, track metadata enrichment, discography crawlers, and any project that needs Spotify data without OAuth complexity.

## Features

- **Zero dependencies** — runs on Node.js built-ins only
- **Anonymous auth** — no Spotify Developer app required
- **Dual API strategy** — prefers internal GraphQL, falls back to public REST
- **Full pagination** — playlists and albums load completely (no page cap)
- **Rate limit handling** — automatic retry on short `Retry-After` windows
- **ISRC enrichment** — album tracks include International Standard Recording Codes
- **Local track filtering** — skips `spotify:local:` entries automatically
- **CORS enabled** — ready for browser-based consumption
- **Vercel-ready** — deploy with zero configuration

## How It Works

```
Client Request
      │
      ▼
┌─────────────────────┐
│  TOTP Token Engine   │  Decode secrets → Generate HMAC-SHA1 TOTP
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│  Anonymous Token     │  POST to Spotify /api/token with web-player TOTP
└─────────┬───────────┘
          │
          ▼
┌─────────────────────────────────────────────┐
│            Spotify APIs                      │
│  1. Pathfinder GraphQL (primary)             │
│  2. Public Web API (fallback)                │
│  3. spclient API (user playlists)            │
└─────────────────────────────────────────────┘
```

The server decodes obfuscated TOTP secrets (versions 59–61 hardcoded + remote latest), generates time-based codes, and exchanges them for anonymous access tokens. Tokens are cached in memory and refreshed 5 minutes before expiry.

## Quick Start

**Prerequisites:** Node.js 18+

```bash
# Clone the repository
git clone https://github.com/knownasrazi/spotify-api.git
cd spotify-api

# Start the server
node server.js
```

The API is now running at `http://localhost:8080`.

### Try It Out

```bash
# Search for tracks
curl "http://localhost:8080/api/search?query=daft+punk"

# Get track metadata
curl "http://localhost:8080/api/track?url=https://open.spotify.com/track/0yQKGjwHEcxZ2RQzLcFhyD"

# Fetch a playlist
curl "http://localhost:8080/api/playlist?url=https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M"

# Health check
curl "http://localhost:8080/api/status"
```

## Deployment

### Vercel (Recommended)

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel
```

The project is pre-configured for Vercel. Each file in `api/` becomes a serverless function with a 30-second timeout.

### Docker

```bash
# Build the image
docker build -t spotify-api .

# Run the container
docker run -d -p 8080:8080 --name spotify-api spotify-api
```

The API will be available at `http://localhost:8080`.

**With docker-compose:**

```yaml
# docker-compose.yml
services:
  spotify-api:
    build: .
    ports:
      - "8080:8080"
    restart: unless-stopped
```

```bash
docker compose up -d
```

### Other Platforms

Any Node.js hosting works. Just run `node server.js`. The server listens on port `8080` by default (configurable via the `PORT` environment variable on supported platforms).

## API Reference

### Search Tracks

```
GET /api/search?query=<search-term>
```

Returns up to 10 matching tracks.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `query` | Yes | Search keyword(s) |

**Response:**
```json
{
  "name": "Spotify Search: daft punk",
  "tracks": [
    {
      "title": "Get Lucky",
      "author": "Daft Punk, Pharrell Williams, Nile Rodgers",
      "albumName": "Random Access Memories",
      "albumId": "4m2880jivSbbyEGAKfITCa",
      "duration": 369626,
      "identifier": "69kOkLUCkxIZYexIgSG8rq",
      "uri": "https://open.spotify.com/track/69kOkLUCkxIZYexIgSG8rq?explicit=false",
      "artworkUrl": "https://i.scdn.co/image/...",
      "isrc": "USRC11300104"
    }
  ]
}
```

---

### Get Track

```
GET /api/track?url=<spotify-track-url>
```

Fetches detailed metadata for a single track.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `url` | Yes | Spotify track URL or URI |

---

### Similar Tracks

```
GET /api/similar-tracks?url=<spotify-track-url>[&limit=10]
```

Returns recommended tracks based on a seed track (like Spotify Radio).

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `url` | Yes | — | Spotify track URL or URI |
| `limit` | No | `10` | Max results (1–50) |

---

### Similar Albums

```
GET /api/similar-albums?url=<spotify-track-url>[&limit=10]
```

Returns recommended albums based on a seed track.

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `url` | Yes | — | Spotify track URL or URI |
| `limit` | No | `10` | Max results (1–50) |

---

### Get Album

```
GET /api/album?url=<spotify-album-url>
```

Fetches album metadata and all tracks. Fully paginated — returns every track regardless of album size.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `url` | Yes | Spotify album URL or URI |

**Response:**
```json
{
  "name": "Random Access Memories",
  "trackCount": 13,
  "tracks": [...]
}
```

---

### Get Playlist

```
GET /api/playlist?url=<spotify-playlist-url>
```

Fetches playlist metadata and all tracks. Fully paginated. Local tracks and non-track items are automatically filtered out.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `url` | Yes | Spotify playlist URL or URI |

---

### User Playlists

```
GET /api/user-playlists?userId=<spotify-user-id>
```

Fetches a user's public playlists via Spotify's spclient API.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `userId` | Yes | Spotify user ID |

**Response:**
```json
{
  "name": "Spotify Playlists for User: 316ndylmu6sebwsoxpe557lveywy",
  "playlistCount": 12,
  "playlists": [
    {
      "name": "My Playlist",
      "identifier": "37i9dQZF1DXcBWIGoYBM5M",
      "uri": "spotify:playlist:37i9dQZF1DXcBWIGoYBM5M",
      "url": "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M",
      "artworkUrl": "https://i.scdn.co/image/..."
    }
  ]
}
```

---

### Get Artist

```
GET /api/artist?url=<spotify-artist-url>
```

Fetches artist profile including biography, listener counts, followers, and top tracks.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `url` | Yes | Spotify artist URL or URI |

**Response:**
```json
{
  "name": "Daft Punk",
  "biography": "...",
  "monthlyListeners": 32456789,
  "followers": 12345678,
  "verified": true,
  "headerImageUrl": "https://i.scdn.co/image/...",
  "avatarImageUrl": "https://i.scdn.co/image/...",
  "topTracks": [...]
}
```

---

### Artist Discography

```
GET /api/artist-discography?url=<spotify-artist-url>[&nolimit=true][&offset=0][&limit=50]
```

Fetches the full release catalog (albums, singles, compilations). Pass `nolimit=true` to recursively load everything.

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `url` | Yes | — | Spotify artist URL or URI |
| `nolimit` | No | `false` | Fetch entire discography; accepts `true` or `false` |
| `offset` | No | `0` | Non-negative pagination offset |
| `limit` | No | `50` | Items per page (1–100) |

---

### Home

```
GET /api/home[?timeZone=<timezone>]
```

Fetches personalized Spotify home page sections (Recently Played, Made for You, Trending, etc.).

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `timeZone` | No | `Asia/Calcutta` | IANA timezone string |

---

### Status

```
GET /api/status
```

Health check endpoint. Returns current timestamp in IST.

**Response:**
```json
{
  "status": "OK",
  "timestamp": "2026-08-10T14:30:00+05:30",
  "timezone": "Asia/Kolkata",
  "offset": "+05:30"
}
```

---

## Architecture

```
spotify-api/
├── api/                    # Vercel serverless route handlers
│   ├── album.js            # GET /api/album
│   ├── artist.js           # GET /api/artist
│   ├── artist-discography.js  # GET /api/artist-discography
│   ├── home.js             # GET /api/home
│   ├── index.js            # GET /api (root)
│   ├── playlist.js         # GET /api/playlist
│   ├── search.js           # GET /api/search
│   ├── similar-albums.js   # GET /api/similar-albums
│   ├── similar-tracks.js   # GET /api/similar-tracks
│   ├── status.js           # GET /api/status
│   ├── track.js            # GET /api/track
│   └── user-playlists.js   # GET /api/user-playlists
├── server.js               # Core logic (token gen, routing, data mapping)
├── package.json            # Project metadata and scripts
├── vercel.json             # Vercel deployment config
├── Dockerfile              # Docker container config
├── .dockerignore           # Docker build exclusions
├── endpoints.json          # Deployed endpoint reference
├── LICENSE                 # MIT License
└── readme.md
```

**Key design decisions:**
- **Single-file core** — all business logic lives in `server.js` (1167 lines)
- **Thin route handlers** — each `api/*.js` file is a 5-line wrapper
- **No frameworks** — pure `http.createServer()` for local dev
- **No dependencies** — zero `node_modules`

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8080` | Local server port |

No environment variables are required. All Spotify API secrets are embedded in the source or fetched at runtime from a public repository.

## Error Handling

All errors return JSON:

```json
{
  "error": "Error message describing what went wrong"
}
```

| Status | Meaning |
|--------|---------|
| `400` | Missing or invalid parameters |
| `404` | Endpoint or resource not found |
| `405` | Unsupported HTTP method |
| `429` | Rate limited by Spotify (short retries handled automatically) |
| `500` | Internal server error |
| `502` | Upstream Spotify API failure |

## Limitations

- **No guaranteed uptime** — Spotify can change their internal API at any time
- **Anonymous tokens only** — no user-specific data (playback, saved tracks, etc.)
- **Serverless cold starts** — token cache may expire between invocations on Vercel
- **Large playlist timeouts** — very large playlists may exceed the 30s Vercel limit
- **No search filters** — currently limited to track search only

## Future Improvements

<details>
<summary>Click to expand potential features</summary>

- [ ] **Package.json** — add project metadata, scripts (`npm start`, `npm test`)
- [ ] **Album/Artist/Podcast search** — extend search to support `type=album,artist,podcast`
- [ ] **Episode/Podcast support** — fetch podcast episode metadata
- [ ] **Audio features** — track tempo, key, energy, danceability via internal API
- [ ] **Batch track lookup** — accept multiple track IDs in a single request
- [ ] **Rate limit headers** — expose `X-RateLimit-*` headers to consumers
- [ ] **Response caching** — cache album/playlist responses to reduce Spotify calls
- [ ] **Streaming audio URLs** — extract preview URLs from track metadata
- [ ] **Market parameter** — allow consumers to specify a market for availability filtering
- [ ] **TypeScript rewrite** — add type safety and auto-generated API docs
- [ ] **Test suite** — add unit tests for token generation, URL parsing, and data mapping
- [ ] **Docker support** — containerize for self-hosted deployments
- [ ] **Rate limiting** — add consumer-side rate limiting to protect upstream

</details>

## Contributing

Contributions are welcome. Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.

---

<div align="center">

**Built by [SreerajSK990](https://github.com/knownasrazi)**

*If this project helps you, consider giving it a star.*

</div>
