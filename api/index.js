module.exports = function status(_req, res) {
  res.setHeader("access-control-allow-origin", "*");
  res.status(200).json({
    name: "Spotify anonymous API",
    endpoints: ["/api/search", "/api/album", "/api/playlist", "/api/status"],
  });
};
