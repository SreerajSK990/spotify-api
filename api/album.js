const { handleApiRequest } = require("../server");

module.exports = async function album(req, res) {
  return handleApiRequest(req, res);
};
