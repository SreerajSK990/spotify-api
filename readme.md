# Spotify Anonymous API

A small Node.js API for resolving Spotify search results, playlists, and albums without using official Spotify client credentials.

The project is designed to run locally as a plain Node HTTP server and to deploy on Vercel as serverless API routes. It uses Spotify web-player style anonymous token generation, then calls Spotify internal and public metadata endpoints to return a simple normalized track list.

## What This Project Does

This API exposes three main endpoints:

```text
GET /api/search?query=<search-term>
GET /api/album?url=<spotify-album-url>
GET /api/playlist?url=<spotify-playlist-url>
```

Each endpoint returns JSON in a compact format:

```json
{
  "name": "Spotify Search: daft punk",
  "tracks": [
    {
      "title": "Get Lucky (feat. Pharrell Williams and Nile Rodgers)",
      "author": "Daft Punk, Pharrell Williams, Nile Rodgers",
      "duration": 369626,
      "identifier": "69kOkLUCkxIZYexIgSG8rq",
      "uri": "https://open.spotify.com/track/69kOkLUCkxIZYexIgSG8rq?explicit=false",
      "artworkUrl": "https://i.scdn.co/image/...",
      "isrc": null
    }
  ]
}
```

## How It Works

The server does not use the official Spotify Client Credentials flow.

Instead, it follows the behavior of Spotify's web player:

1. Decode a known obfuscated TOTP secret.
2. Generate a TOTP code with HMAC-SHA1.
3. Request an anonymous Spotify web-player access token.
4. Cache that token until close to expiry.
5. Use the token to query Spotify metadata APIs.

For playlist, album, and search resolution, the server prefers Spotify's internal Pathfinder GraphQL API first. If that fails, it falls back to Spotify's public Web API where possible.

This gives better behavior for many common playlist and search requests while keeping the public response format simple.

## Project Structure

```text
.
|-- api/
|   |-- album.js
|   |-- index.js
|   |-- playlist.js
|   `-- search.js
|-- LICENSE
|-- readme.md
|-- server.js
`-- vercel.json
```

### `server.js`

Contains the main implementation:

- token generation
- TOTP secret decoding
- Spotify token caching
- internal GraphQL requests
- public Web API fallback
- playlist parsing
- album parsing
- search parsing
- local HTTP server support
- Vercel-compatible request handler export

### `api/*.js`

These are Vercel serverless route entrypoints. They import the shared handler from `server.js`.

### `vercel.json`

Sets Vercel function configuration. The current configuration gives API routes up to 30 seconds to complete.

## Running Locally

No external npm packages are required.

You only need Node.js 18 or newer.

Run:

```bash
node server.js
```

The local server listens on:

```text
http://localhost:8080
```

Example requests:

```text
http://localhost:8080/api/search?query=daft%20punk
http://localhost:8080/api/album?url=https%3A%2F%2Fopen.spotify.com%2Falbum%2F4m2880jivSbbyEGAKfITCa
http://localhost:8080/api/playlist?url=https%3A%2F%2Fopen.spotify.com%2Fplaylist%2F37i9dQZF1DXcBWIGoYBM5M
```

When passing Spotify URLs as query parameters, URL-encode them.

## Deploying to Vercel

This folder is already shaped for Vercel.

Deploy it as a normal Vercel project. Vercel will use the files inside `api/` as serverless functions:

```text
/api/search
/api/album
/api/playlist
```

After deployment, your requests will look like:

```text
https://your-project.vercel.app/api/search?query=daft%20punk
https://your-project.vercel.app/api/album?url=<encoded-spotify-album-url>
https://your-project.vercel.app/api/playlist?url=<encoded-spotify-playlist-url>
```

No environment variables are required for the current implementation.

## Endpoint Details

### Search

```text
GET /api/search?query=<search-term>
```

Performs a Spotify track search and returns up to 10 tracks.

Example:

```text
/api/search?query=daft%20punk
```

### Album

```text
GET /api/album?url=<spotify-album-url>
```

Fetches album metadata and tracks.

The internal GraphQL path is tried first. If it does not return usable tracks, the server falls back to the public Web API.

Example:

```text
/api/album?url=https%3A%2F%2Fopen.spotify.com%2Falbum%2F4m2880jivSbbyEGAKfITCa
```

### Playlist

```text
GET /api/playlist?url=<spotify-playlist-url>
```

Fetches playlist metadata and tracks.

The internal GraphQL path is tried first. If it does not return usable tracks, the server falls back to the public Web API.

Example:

```text
/api/playlist?url=https%3A%2F%2Fopen.spotify.com%2Fplaylist%2F37i9dQZF1DXcBWIGoYBM5M
```

## Error Responses

Errors are returned as JSON:

```json
{
  "error": "Missing required query parameter: query"
}
```

Common error cases:

- missing `query`
- missing `url`
- invalid Spotify URL
- unsupported HTTP method
- Spotify token failure
- upstream Spotify rate limit
- upstream Spotify API error

## Important Notes

This project depends on behavior used by Spotify's web player. That behavior can change without notice.

The anonymous token flow may stop working if Spotify rotates secrets, changes token validation, changes internal API requirements, or blocks requests from a deployment platform.

This project is best treated as a lightweight metadata resolver, not as a guaranteed long-term replacement for the official Spotify API.

For production systems where reliability and policy compliance matter, the official Spotify Web API with client credentials is the safer option.

## Vercel Considerations

Serverless functions are short-lived. The token cache is stored in memory, so it may be reused during warm invocations but should not be treated as permanent.

This is acceptable for this API because the server can regenerate anonymous tokens when needed.

The project avoids long waits on Spotify public API rate limits. If Spotify returns a short `Retry-After`, the server may retry briefly. Longer rate limits are returned to the caller instead of holding the Vercel function open for too long.

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.
