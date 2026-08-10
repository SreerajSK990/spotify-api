const { handleApiRequest } = require("../server");

module.exports = async function similarTracks(req, res) {
  return handleApiRequest(req, res);
};
