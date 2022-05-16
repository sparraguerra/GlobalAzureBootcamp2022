const { WebPubSubServiceClient } = require('@azure/web-pubsub')
const state = require('../state')
const crypto = require('crypto')

const CONN_STR = process.env.PUBSUB_CONNECTION_STRING
const HUB = process.env.PUBSUB_HUB

module.exports = async function (context, req) {
  if (!CONN_STR || !HUB) {
    context.log('### ERROR! Must set PUBSUB_CONNECTION_STRING and PUBSUB_CONNECTION_HUB app settings / env vars')
    context.res = { status: 500, body: 'ERROR! Must set PUBSUB_CONNECTION_STRING and PUBSUB_CONNECTION_HUB app settings / env vars' }
    context.done()
    return
  }

  context.log(`### Web PubSub event handler called with method ${req.method}`)

  // We have to handle webhook validation https://azure.github.io/azure-webpubsub/references/protocol-cloudevents#validation
  if (req.method === 'GET') {
    context.log(`### Webhook validation was called for ${req.headers['webhook-request-origin']}`)
    context.res = {
      headers: {
        'webhook-allowed-origin': req.headers['webhook-request-origin'],
      },
      status: 200,
    }
    context.done()
    return
  }

  // Check signature to prevent spoofing
  if (!validateSignature(req.headers['ce-connectionid'], req.headers['ce-signature'])) {
    context.res = { status: 401, body: 'ERROR! Cloud event signature validation failed' }
    context.done()
    return
  }

  const serviceClient = new WebPubSubServiceClient(CONN_STR, HUB)
  const userId = req.headers['ce-userid']
  const eventName = req.headers['ce-eventname']

  // System event for disconnected user, logoff or tab closed
  if (eventName === 'disconnected') {
    context.log(`### User ${userId} has disconnected`)
    await removeVotationUser(serviceClient, userId)
    await serviceClient.sendToAll({
      votationEvent: 'userOffline',
      data: userId,
    })
  }

  // Use a custom event here rather than the system connected event
  // This means we can pass extra data, not just a userId
  if (eventName === 'userConnected') {
    const userName = req.body.userName
    const userProvider = req.body.userProvider
    context.log(`### User ${userId} ${userName} ${userProvider} connected`)
    state.upsertUser(userId, { userName, userProvider })
    await serviceClient.sendToAll({
      votationEvent: 'userOnline',
      data: JSON.stringify({
        userId,
        userName,
        userProvider,
      }),
    })
  }

  if (eventName === 'createVotation') {
    const votationName = req.body.name
    const votationId = req.body.id
    const votationEntity = { id: votationId, name: votationName, members: {}, owner: userId, count: 0, yes: 0, no: 0, abstention: 0 }
    state.upsertVotation(votationId, votationEntity)

    serviceClient.sendToAll({
      votationEvent: 'votationCreated',
      data: JSON.stringify(votationEntity),
    })

    context.log(`### New votation ${votationName} was created by ${userId}`)
  }

  if (eventName === 'joinVotation') {
    const votationId = req.body
    let votation = await state.getVotation(votationId)

    if (!votation) {
      context.log(`### Attempt to join votation with ID ${votationId} failed, it doesn't exist`)
      return
    }

    // Votation id used as the group name
    serviceClient.group(votationId).addUser(userId)

    // Need to call state to get the users name
    const user = await state.getUser(userId)

    // Add user to members of the votation (members is a map/dict) and push back into the DB
    if(!votation.members[userId]) votation.members[userId] = { userId, userName: user.userName, hasVoted: false }
    await state.upsertVotation(votationId, votation)
    context.log(`### User ${user.userName} has joined votation ${votation.name}`)

    setTimeout(() => {
      serviceClient.group(votationId).sendToAll(`<b>${user.userName}</b> has joined the votation`)
    }, 1000)
  }

  if (eventName === 'leaveVotation') {
    const votationId = req.body.votationId
    const userName = req.body.userName
    context.log(`### User ${userName} has left votation ${votationId}`)

    await serviceClient.group(votationId).removeUser(userId)
    await serviceClient.group(votationId).sendToAll(`<b>${userName}</b> has left the votation`)

    leaveVotation(userId, votationId)
  }

  if (eventName === 'deleteVotation') {
    const votationId = req.body
    context.log(`### Votation ${votationId} has been deleted`)
    await state.removeVotation(votationId)
    await serviceClient.sendToAll({
      votationEvent: 'votationDeleted',
      data: votationId,
    })
  }

  if (eventName === 'votationEmited') { 
    const vote = req.body.vote
    const votationId = req.body.id
    const userName = req.body.userName 
    const userId = req.body.userId
    let votation = await state.getVotation(votationId)
    if (!votation) {
      return
    }
    if (vote === "Y")  {      
      votation.yes++
    }
    if (vote === "N")  {      
      votation.no++
    }
    if (vote === "A")  {      
      votation.abstention++
    }
    votation.count++
    votation.members[userId].hasVoted = true
    state.upsertVotation(votationId, votation)

    serviceClient.sendToAll({
      votationEvent: 'votationEmited',
      data: JSON.stringify(votation),
    })

    context.log(`### New votation was emited by ${userId}`)
    await serviceClient.group(votationId).sendToAll(`<b>${userName}</b> has emited his/her vote`)
  }

  // Respond with a 200 to the webhook
  context.res = { status: 200 }
  context.done()
}

//
// Helper to remove user from a votation
//
async function leaveVotation(userId, votationId) {
  let votation = await state.getVotation(votationId)
  if (!votation) {
    return
  }

  // Find & remove user from votation's member list
  for (let memberUserId in votation.members) {
    if (memberUserId === userId) {
      delete votation.members[userId]
    }
  }

  state.upsertVotation(votationId, votation)
}

//
// Helper to remove a user, syncs all users and the DB
//
async function removeVotationUser(serviceClient, userId) {
  console.log(`### User ${userId} is being removed`)
  state.removeUser(userId)

  // Notify everyone
  serviceClient.sendToAll({
    votationEvent: 'userOffline',
    data: userId,
  })

  // Leave all votations
  for (let votationId in await state.listVotations()) {
    console.log('### Calling leaveVotation', userId, votationId)
    await leaveVotation(userId, votationId)
  }
}

//
// Simple validation of the cloud event signature
// See: https://github.com/MicrosoftDocs/azure-docs/blob/master/articles/azure-web-pubsub/reference-cloud-events.md#attributes
//
function validateSignature(connectionId, signature) {
  try {
    // Use the key from the connection string to validate the signature
    const key = CONN_STR.split(';')[1].replace('AccessKey=', '')
    const hmac = crypto.createHmac('sha256', key)

    // The connectionId in 'ce-connectionid' header is the data we want to sign
    hmac.update(connectionId)

    // Simply check the hex digest is present in the signature
    if (signature.includes(hmac.digest('hex'))) {
      return true
    }

    console.log('### Error! Cloud event failed signature validation, SHA not matched')
    return false
  } catch (err) {
    console.log(`### Error! Cloud event failed signature validation, due to error: ${err}`)
    return false
  }
}
