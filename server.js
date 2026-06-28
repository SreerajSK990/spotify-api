const http = require("http");
const https = require("https");
const crypto = require("crypto");
const { URL } = require("url");

const PORT = 8080;
const SPOTIFY_WEB_API = "https://api.spotify.com/v1";
const SPOTIFY_INTERNAL_API =
  "https://api-partner.spotify.com/pathfinder/v2/query";
const SECRETS_URL =
  "https://raw.githubusercontent.com/xyloflake/spot-secrets-go/refs/heads/main/secrets/secretDict.json";
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 15000;

const ENCODED_SECRETS = [
  { version: "61", encoded: ",7/*F(\"rLJ2oxaKL^f+E1xvP@N" },
  { version: "60", encoded: "OmE{ZA.J^\":0FG\\Uz?[@WW" },
  { version: "59", encoded: "{iOFn;4}<1PFYKPV?5{%u14]M>/V0hDH" },
];

const GRAPHQL_QUERIES = {
  getAlbum: {
    name: "getAlbum",
    hash: "b9bfabef66ed756e5e13f68a942deb60bd4125ec1f1be8cc42769dc0259b4b10",
  },
  getPlaylist: {
    name: "fetchPlaylist",
    hash: "bb67e0af06e8d6f52b531f97468ee4acd44cd0f82b988e15c2ea47b1148efc77",
  },
  searchDesktop: {
    name: "searchDesktop",
    hash: "fcad5a3e0d5af727fb76966f06971c19cfa2275e6ff7671196753e008611873c",
  },
};

let cachedToken = null;
let cachedSecretCandidates = null;
let lastSecretFetchTime = 0;

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

function decodeSecret(encoded) {
  let joined = "";
  for (let i = 0; i < encoded.length; i += 1) {
    joined += encoded.charCodeAt(i) ^ ((i % 33) + 9);
  }
  return Buffer.from(joined, "utf8").toString("hex");
}

function decodeSecretArray(values) {
  let joined = "";
  for (let i = 0; i < values.length; i += 1) {
    joined += Number(values[i]) ^ ((i % 33) + 9);
  }
  return Buffer.from(joined, "utf8").toString("hex");
}

function generateTotp(secretHex, timestampMs = Date.now(), stepSeconds = 30) {
  const counter = Math.floor(Math.floor(timestampMs / 1000) / stepSeconds);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  counterBuffer.writeUInt32BE(counter >>> 0, 4);

  const hmac = crypto
    .createHmac("sha1", Buffer.from(secretHex, "hex"))
    .update(counterBuffer)
    .digest();

  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  return String(binary % 1000000).padStart(6, "0");
}

function requestJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const requestBody =
      options.body === undefined
        ? null
        : typeof options.body === "string"
          ? options.body
          : JSON.stringify(options.body);
    const req = https.request(
      parsedUrl,
      {
        method: options.method || "GET",
        headers: {
          "accept": "application/json",
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
            "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
          ...(options.headers || {}),
          ...(requestBody ? { "content-length": Buffer.byteLength(requestBody) } : {}),
        },
        timeout: REQUEST_TIMEOUT_MS,
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => {
          let json = null;
          if (body) {
            try {
              json = JSON.parse(body);
            } catch (error) {
              return reject(
                new Error(`Invalid JSON from ${parsedUrl.hostname}: ${error.message}`)
              );
            }
          }

          if (res.statusCode < 200 || res.statusCode >= 300) {
            const message =
              json?.error?.message ||
              json?.error ||
              `HTTP ${res.statusCode} from ${parsedUrl.hostname}`;
            const error = new Error(message);
            error.statusCode = res.statusCode;
            error.headers = res.headers;
            error.body = json;
            return reject(error);
          }

          resolve(json);
        });
      }
    );

    req.on("timeout", () => {
      req.destroy(new Error(`Request timed out after ${REQUEST_TIMEOUT_MS}ms`));
    });
    req.on("error", reject);
    if (requestBody) {
      req.write(requestBody);
    }
    req.end();
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchAnonymousToken() {
  let lastError = null;
  const candidates = await getSecretCandidates();

  for (const candidate of candidates) {
    try {
      const token = await performTokenRequest(candidate.secretHex, candidate.version);

      if (!token.accessToken || !token.accessTokenExpirationTimestampMs) {
        throw new Error("Spotify token response did not contain access token data");
      }

      log(`Fetched anonymous Spotify token using secret version ${candidate.version}`);
      return {
        accessToken: token.accessToken,
        expiresAtMs: Number(token.accessTokenExpirationTimestampMs),
      };
    } catch (error) {
      lastError = error;
      log(`Token secret version ${candidate.version} failed:`, error.message);
    }
  }

  throw httpError(
    502,
    `Failed to obtain anonymous Spotify access token${
      lastError?.message ? `: ${lastError.message}` : ""
    }`
  );
}

async function getSecretCandidates() {
  const candidates = ENCODED_SECRETS.map((secret) => ({
    version: secret.version,
    secretHex: decodeSecret(secret.encoded),
  }));

  try {
    const fetched = await fetchLatestSecretCandidate();
    if (fetched) {
      candidates.unshift(fetched);
    }
  } catch (error) {
    log("Failed to fetch latest TOTP secret, using local candidates:", error.message);
  }

  return candidates;
}

async function fetchLatestSecretCandidate() {
  const now = Date.now();
  if (cachedSecretCandidates && now - lastSecretFetchTime < 60 * 60 * 1000) {
    return cachedSecretCandidates;
  }

  const secretDict = await requestJson(SECRETS_URL);
  const versions = Object.keys(secretDict || {})
    .map((version) => Number(version))
    .filter((version) => Number.isInteger(version))
    .sort((a, b) => b - a);

  for (const version of versions) {
    const secretData = secretDict[String(version)];
    if (Array.isArray(secretData)) {
      cachedSecretCandidates = {
        version: String(version),
        secretHex: decodeSecretArray(secretData),
      };
      lastSecretFetchTime = now;
      log(`Fetched latest TOTP secret version ${version}`);
      return cachedSecretCandidates;
    }
  }

  const fallbackData = [
    99, 111, 47, 88, 49, 56, 118, 65, 52, 67, 50, 104, 117, 101, 55, 94, 95,
    75, 94, 49, 69, 36, 85, 64, 74, 60,
  ];

  cachedSecretCandidates = {
    version: "19",
    secretHex: decodeSecretArray(fallbackData),
  };
  lastSecretFetchTime = now;
  return cachedSecretCandidates;
}

async function performTokenRequest(secretHex, version) {
  const localTimeMs = Date.now();
  const totpLocal = generateTotp(secretHex, localTimeMs, 30);
  const tokenUrl =
    "https://open.spotify.com/api/token" +
    "?reason=init" +
    "&productType=web-player" +
    `&totp=${encodeURIComponent(totpLocal)}` +
    `&totpServer=${encodeURIComponent(totpLocal)}` +
    `&totpVer=${encodeURIComponent(version)}`;

  return requestJson(tokenUrl, {
    headers: {
      "accept": "application/json",
      "origin": "https://open.spotify.com/",
      "referer": "https://open.spotify.com/",
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
    },
  });
}

async function getAccessToken() {
  const now = Date.now();
  if (
    cachedToken &&
    cachedToken.accessToken &&
    cachedToken.expiresAtMs - TOKEN_REFRESH_MARGIN_MS > now
  ) {
    return cachedToken.accessToken;
  }

  cachedToken = await fetchAnonymousToken();
  return cachedToken.accessToken;
}

async function spotifyApi(path, query = {}) {
  const token = await getAccessToken();
  const url = new URL(`${SPOTIFY_WEB_API}${path}`);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  try {
    return await requestJson(url.toString(), {
      headers: {
        authorization: `Bearer ${token}`,
      },
    });
  } catch (error) {
    const retryAfterSeconds = Number(error.headers?.["retry-after"]);
    if (error.statusCode === 429 && retryAfterSeconds > 0 && retryAfterSeconds <= 5) {
      log(`Spotify rate limited ${path}; retrying after ${retryAfterSeconds}s`);
      await sleep(retryAfterSeconds * 1000);
      return requestJson(url.toString(), {
        headers: {
          authorization: `Bearer ${token}`,
        },
      });
    }
    throw error;
  }
}

async function spotifyInternalApi(operation, variables) {
  const token = await getAccessToken();
  const response = await requestJson(SPOTIFY_INTERNAL_API, {
    method: "POST",
    body: {
      variables,
      operationName: operation.name,
      extensions: {
        persistedQuery: {
          version: 1,
          sha256Hash: operation.hash,
        },
      },
    },
    headers: {
      "authorization": `Bearer ${token}`,
      "accept": "application/json",
      "accept-language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
      "app-platform": "WebPlayer",
      "content-type": "application/json; charset=utf-8",
      "origin": "https://open.spotify.com/",
      "referer": "https://open.spotify.com/",
      "spotify-app-version": "1.2.87.221.ge160d899",
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
    },
  });

  if (Array.isArray(response.errors) && response.errors.length > 0) {
    throw httpError(502, `Spotify Pathfinder error: ${JSON.stringify(response.errors)}`);
  }

  return response.data || null;
}

function parseSpotifyUrl(rawUrl, expectedType) {
  let spotifyUrl;
  try {
    spotifyUrl = new URL(rawUrl);
  } catch {
    throw httpError(400, "Invalid Spotify URL");
  }

  if (!/(^|\.)spotify\.com$/i.test(spotifyUrl.hostname)) {
    throw httpError(400, "URL must be a spotify.com URL");
  }

  const parts = spotifyUrl.pathname.split("/").filter(Boolean);
  const typeIndex = parts.findIndex((part) => part === expectedType);
  const id = typeIndex >= 0 ? parts[typeIndex + 1] : null;

  if (!id || !/^[A-Za-z0-9]{16,32}$/.test(id)) {
    throw httpError(400, `Could not find a valid Spotify ${expectedType} ID`);
  }

  return id;
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function bestImage(images) {
  return Array.isArray(images) && images.length > 0 ? images[0].url : null;
}

function mapTrack(track, fallbackArtworkUrl = null) {
  return {
    title: track.name,
    author: Array.isArray(track.artists)
      ? track.artists.map((artist) => artist.name).join(", ")
      : "",
    duration: track.duration_ms,
    identifier: track.id,
    uri: track.uri,
    artworkUrl: bestImage(track.album?.images) || fallbackArtworkUrl,
    isrc: track.external_ids?.isrc || null,
  };
}

function isLocalTrack(track, wrapper = null) {
  return (
    track?.is_local === true ||
    wrapper?.is_local === true ||
    String(track?.uri || "").startsWith("spotify:local:")
  );
}

function internalTrackAuthor(track) {
  const artists = track?.artists?.items;
  if (Array.isArray(artists) && artists.length > 0) {
    return (
      artists
        .map((artist) => artist?.profile?.name || artist?.name)
        .filter(Boolean)
        .join(", ") || "Unknown"
    );
  }

  const firstArtist = track?.firstArtist?.items?.[0];
  return firstArtist?.profile?.name || firstArtist?.name || "Unknown";
}

function mapInternalTrack(track, fallbackArtworkUrl = null) {
  if (!track?.uri || isLocalTrack(track)) {
    return null;
  }

  const id = track.uri.split(":").pop();
  if (!id) {
    return null;
  }

  const explicit =
    track.contentRating?.label === "EXPLICIT" || track.explicit === true;

  return {
    title: track.name,
    author: internalTrackAuthor(track),
    duration:
      track.duration?.totalMilliseconds ||
      track.trackDuration?.totalMilliseconds ||
      0,
    identifier: id,
    uri: `https://open.spotify.com/track/${id}?explicit=${explicit}`,
    artworkUrl:
      fallbackArtworkUrl ||
      track.albumOfTrack?.coverArt?.sources?.[0]?.url ||
      track.album?.images?.[0]?.url ||
      null,
    isrc: track.externalIds?.isrc || null,
  };
}

async function fetchPlaylist(rawUrl) {
  const playlistId = parseSpotifyUrl(rawUrl, "playlist");
  const internal = await fetchPlaylistInternal(playlistId);
  if (internal.tracks.length > 0) {
    return internal;
  }

  const playlist = await spotifyApi(`/playlists/${encodeURIComponent(playlistId)}`, {
    fields: "name",
  });
  const tracks = [];

  for (let page = 0; page < 5; page += 1) {
    const items = await spotifyApi(
      `/playlists/${encodeURIComponent(playlistId)}/tracks`,
      {
        limit: 100,
        offset: page * 100,
        additional_types: "track",
      }
    );

    for (const item of items.items || []) {
      const track = item.track;
      if (!track || track.is_local || track.type !== "track") {
        continue;
      }
      tracks.push(mapTrack(track));
    }

    if (!items.next) {
      break;
    }
  }

  return { name: playlist.name || "Spotify Playlist", tracks };
}

async function fetchPlaylistInternal(playlistId) {
  const tracks = [];
  let name = "Spotify Playlist";
  let total = Infinity;

  try {
    for (let offset = 0; offset < total && tracks.length < 500; ) {
      const data = await spotifyInternalApi(GRAPHQL_QUERIES.getPlaylist, {
        uri: `spotify:playlist:${playlistId}`,
        offset,
        limit: 100,
        enableWatchFeedEntrypoint: false,
      });

      const playlist = data?.playlistV2;
      if (!playlist || playlist.__typename === "NotFound") {
        break;
      }

      if (offset === 0) {
        name = playlist.name || name;
        total = playlist.content?.totalCount || 0;
      }

      const items = playlist.content?.items || [];
      if (items.length === 0) {
        break;
      }

      for (const item of items) {
        const track = mapInternalTrack(item.itemV2?.data);
        if (track) {
          tracks.push(track);
        }
      }

      offset += items.length;
      if (items.length < 100) {
        break;
      }
    }
  } catch (error) {
    log("Internal playlist fetch failed, falling back to public API:", error.message);
  }

  return { name, tracks };
}

async function fetchAlbum(rawUrl) {
  const albumId = parseSpotifyUrl(rawUrl, "album");
  const internal = await fetchAlbumInternal(albumId);
  if (internal.tracks.length > 0) {
    return internal;
  }

  const album = await spotifyApi(`/albums/${encodeURIComponent(albumId)}`);
  const tracks = [];
  const albumArtworkUrl = bestImage(album.images);

  for (let page = 0; page < 5; page += 1) {
    const items = await spotifyApi(`/albums/${encodeURIComponent(albumId)}/tracks`, {
      limit: 50,
      offset: page * 50,
    });

    for (const track of items.items || []) {
      if (track?.type === "track") {
        tracks.push(mapTrack({ ...track, album }, albumArtworkUrl));
      }
    }

    if (!items.next) {
      break;
    }
  }

  await addIsrcsToTracks(tracks);
  return { name: album.name || "Spotify Album", tracks };
}

async function fetchAlbumInternal(albumId) {
  const tracks = [];
  let name = "Spotify Album";
  let total = Infinity;
  let artworkUrl = null;

  try {
    for (let offset = 0; offset < total && tracks.length < 250; ) {
      const data = await spotifyInternalApi(GRAPHQL_QUERIES.getAlbum, {
        uri: `spotify:album:${albumId}`,
        locale: "en",
        offset,
        limit: 300,
      });

      const album = data?.albumUnion;
      if (!album || album.__typename === "NotFound") {
        break;
      }

      if (offset === 0) {
        name = album.name || name;
        total = album.tracksV2?.totalCount || 0;
        artworkUrl = album.coverArt?.sources?.[0]?.url || null;
      }

      const items = album.tracksV2?.items || [];
      if (items.length === 0) {
        break;
      }

      for (const item of items) {
        const track = mapInternalTrack(item.track, artworkUrl);
        if (track) {
          tracks.push(track);
        }
      }

      offset += items.length;
      if (items.length < 300) {
        break;
      }
    }
  } catch (error) {
    log("Internal album fetch failed, falling back to public API:", error.message);
  }

  return { name, tracks };
}

async function addIsrcsToTracks(tracks) {
  for (let offset = 0; offset < tracks.length; offset += 50) {
    const batch = tracks.slice(offset, offset + 50);
    const ids = batch.map((track) => track.identifier).filter(Boolean);
    if (ids.length === 0) {
      continue;
    }

    const details = await spotifyApi("/tracks", { ids: ids.join(",") });
    const byId = new Map(
      (details.tracks || [])
        .filter(Boolean)
        .map((track) => [track.id, track.external_ids?.isrc || null])
    );

    for (const track of batch) {
      track.isrc = byId.get(track.identifier) || track.isrc || null;
    }
  }
}

async function searchTracks(query) {
  const trimmedQuery = String(query || "").trim();
  if (!trimmedQuery) {
    throw httpError(400, "Missing required query parameter: query");
  }

  const internalTracks = await searchTracksInternal(trimmedQuery);
  if (internalTracks.length > 0) {
    return { name: `Spotify Search: ${trimmedQuery}`, tracks: internalTracks };
  }

  const results = await spotifyApi("/search", {
    q: trimmedQuery,
    type: "track",
    limit: 10,
  });

  const tracks = (results.tracks?.items || [])
    .filter((track) => track?.type === "track")
    .map((track) => mapTrack(track));

  return { name: `Spotify Search: ${trimmedQuery}`, tracks };
}

async function searchTracksInternal(query) {
  try {
    const data = await spotifyInternalApi(GRAPHQL_QUERIES.searchDesktop, {
      searchTerm: query,
      offset: 0,
      limit: 10,
      numberOfTopResults: 5,
      includeAudiobooks: false,
      includeArtistHasConcertsField: false,
      includePreReleases: false,
    });

    const items = data?.searchV2?.tracksV2?.items || [];
    return items
      .map((item) => mapInternalTrack(item.item?.data))
      .filter(Boolean)
      .slice(0, 10);
  } catch (error) {
    log("Internal search failed, falling back to public API:", error.message);
    return [];
  }
}

function sendJson(res, statusCode, body) {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "content-type",
  });
  res.end(payload);
}

function getRequiredParam(url, name) {
  const value = url.searchParams.get(name);
  if (!value || !value.trim()) {
    throw httpError(400, `Missing required query parameter: ${name}`);
  }
  return value;
}

async function handleRequest(req, res) {
  const startedAt = Date.now();
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  log(`${req.method} ${url.pathname}${url.search}`);

  if (req.method === "OPTIONS") {
    return sendJson(res, 204, {});
  }

  if (req.method !== "GET") {
    throw httpError(405, "Only GET requests are supported");
  }

  let response;
  if (url.pathname === "/api/playlist") {
    response = await fetchPlaylist(getRequiredParam(url, "url"));
  } else if (url.pathname === "/api/album") {
    response = await fetchAlbum(getRequiredParam(url, "url"));
  } else if (url.pathname === "/api/search") {
    response = await searchTracks(getRequiredParam(url, "query"));
  } else {
    throw httpError(404, "Endpoint not found");
  }

  log(`${req.method} ${url.pathname} completed in ${Date.now() - startedAt}ms`);
  sendJson(res, 200, response);
}

function statusCodeForError(error) {
  return Number.isInteger(error.statusCode) && error.statusCode >= 400
    ? error.statusCode
    : 500;
}

async function handleApiRequest(req, res) {
  try {
    await handleRequest(req, res);
  } catch (error) {
    const statusCode = statusCodeForError(error);
    log("Request failed:", error.message);
    sendJson(res, statusCode, { error: error.message || "Internal server error" });
  }
}

function createServer() {
  return http.createServer((req, res) => {
    handleRequest(req, res).catch((error) => {
      const statusCode = statusCodeForError(error);
      log("Request failed:", error.message);
      sendJson(res, statusCode, { error: error.message || "Internal server error" });
    });
  });
}

if (require.main === module) {
  createServer().listen(PORT, () => {
    log(`Spotify API server listening on http://localhost:${PORT}`);
  });
}

module.exports = {
  createServer,
  handleRequest,
  handleApiRequest,
  decodeSecret,
  generateTotp,
};
