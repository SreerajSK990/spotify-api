const server = require("../server.js");

module.exports = async (req, res) => {
  await server.handleApiRequest(req, res);
};
