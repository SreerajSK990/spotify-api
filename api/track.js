const { handleApiRequest } = require("../server");

module.exports = async function track(req, res) {
  return handleApiRequest(req, res);
};
