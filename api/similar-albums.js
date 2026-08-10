const { handleApiRequest } = require("../server");

module.exports = async function similarAlbums(req, res) {
  return handleApiRequest(req, res);
};
