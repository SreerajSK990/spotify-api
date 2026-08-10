const { handleApiRequest } = require("../server");

module.exports = async function artist(req, res) {
  return handleApiRequest(req, res);
};
