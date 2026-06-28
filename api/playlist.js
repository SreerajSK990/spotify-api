const { handleApiRequest } = require("../server");

module.exports = async function playlist(req, res) {
  return handleApiRequest(req, res);
};
