const { handleApiRequest } = require("../server.js");

module.exports = async function (req, res) {
  await handleApiRequest(req, res);
};
