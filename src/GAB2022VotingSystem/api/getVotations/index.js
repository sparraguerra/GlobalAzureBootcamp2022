const state = require('../state')

module.exports = async function (context) {
  const votations = await state.listVotations()

  context.res = {
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({ votations: votations }),
  }
}
