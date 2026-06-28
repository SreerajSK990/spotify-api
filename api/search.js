const { handleApiRequest } = require("../server");

module.exports = async function search(req, res) {
  return handleApiRequest(req, res);
};
