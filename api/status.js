const { handleApiRequest } = require("../server");

module.exports = async function status(req, res) {
  return handleApiRequest(req, res);
};
