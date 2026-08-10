const { handleApiRequest } = require("../server");

module.exports = async function artistDiscography(req, res) {
  return handleApiRequest(req, res);
};
