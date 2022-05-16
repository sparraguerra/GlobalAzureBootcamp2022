const { TableServiceClient, AzureNamedKeyCredential, TableClient } = require('@azure/data-tables')

const account = process.env.STORAGE_ACCOUNT_NAME
const accountKey = process.env.STORAGE_ACCOUNT_KEY
const votationsTable = 'votations'
const usersTable = 'users'
const partitionKey = 'gab2022'

if (!account || !accountKey) {
  console.log('### Fatal! STORAGE_ACCOUNT_NAME and/or STORAGE_ACCOUNT_KEY is not set')
}

const credential = new AzureNamedKeyCredential(account, accountKey)
const serviceClient = new TableServiceClient(`https://${account}.table.core.windows.net`, credential)
const userTableClient = new TableClient(`https://${account}.table.core.windows.net`, usersTable, credential)
const votationTableClient = new TableClient(`https://${account}.table.core.windows.net`, votationsTable, credential)

// ==============================================================
// Create tables and absorb errors if they already exist
// ==============================================================
async function initTables() {
  console.log(`### Connected to Azure table storage: ${account}`)

  try {
    await serviceClient.createTable(votationsTable)
  } catch (err) {
    if (err.statusCode == 409) console.log(`### Table ${votationsTable} already exists, that's OK`)
  }
  try {
    await serviceClient.createTable(usersTable)
  } catch (err) {
    if (err.statusCode == 409) console.log(`### Table ${usersTable} already exists, that's OK`)
  }
}

// ==============================================================
// Called when module is imported
// ==============================================================
initTables()

// ==============================================================
// Votation state functions
// ==============================================================
async function upsertVotation(id, votation) {
  const votationEntity = {
    partitionKey: partitionKey,
    rowKey: id,
    data: JSON.stringify(votation),
  }
  await votationTableClient.upsertEntity(votationEntity, 'Replace')
}

async function removeVotation(id) {
  try {
    await votationTableClient.deleteEntity(partitionKey, id)
  } catch (e) {
    console.log('### Delete votation failed')
  }
}

async function getVotation(id) {
  try {
    const votationEntity = await votationTableClient.getEntity(partitionKey, id)

    return JSON.parse(votationEntity.data)
  } catch (err) {
    return null
  }
}

async function listVotations() {
  let votationsResp = {}
  let votationList = votationTableClient.listEntities()

  for await (const votation of votationList) {
    let votationObj = JSON.parse(votation.data)
    // Timestamp only used by cleanup script
    votationObj.timestamp = votation.timestamp
    votationsResp[votation.rowKey] = votationObj
  }
  return votationsResp
}

// ==============================================================
// User state functions
// ==============================================================
async function upsertUser(id, user) {
  const userEntity = {
    partitionKey: partitionKey,
    rowKey: id,
    ...user,
  }
  await userTableClient.upsertEntity(userEntity, 'Replace')
}

async function removeUser(id) {
  try {
    await userTableClient.deleteEntity(partitionKey, id)
  } catch (e) {
    console.log('### Delete user failed')
  }
}

async function listUsers() {
  let usersResp = {}
  let userList = userTableClient.listEntities()

  for await (const user of userList) {
    usersResp[user.rowKey] = user
  }
  return usersResp
}

async function getUser(id) {
  try {
    const user = await userTableClient.getEntity(partitionKey, id)
    return user
  } catch (err) {
    return null
  }
}

// ==============================================================
// Export functions into module scope
// ==============================================================
module.exports = {
  upsertVotation: upsertVotation,
  removeVotation: removeVotation,
  getVotation: getVotation,
  listVotations: listVotations,

  upsertUser,
  removeUser,
  getUser,
  listUsers,
}
