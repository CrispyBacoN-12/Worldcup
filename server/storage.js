// Storage layer with two interchangeable backends:
//   • No MONGODB_URI  -> JSON files on disk (local dev, same as before).
//   • MONGODB_URI set  -> MongoDB (persistent on Render's ephemeral disk).
//
// Both backends expose the SAME async API, and the Mongo backend keeps the
// exact "read whole object / write whole object" semantics the rest of the
// server relies on (one document per username, _id = username).
const fs = require('fs');
const nodePath = require('path');

const USERS_FILE = nodePath.join(__dirname, 'users.json');
const WALLET_FILE = nodePath.join(__dirname, 'wallet.json');
const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB = process.env.MONGODB_DB || 'worldcup';

let mode = 'file';
let usersCol = null;
let walletsCol = null;

const init = async () => {
  if (!MONGODB_URI) {
    console.log('ℹ Storage: file mode (MONGODB_URI not set)');
    return;
  }
  const { MongoClient } = require('mongodb');
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db(MONGODB_DB);
  usersCol = db.collection('users');
  walletsCol = db.collection('wallets');
  mode = 'mongo';
  console.log(`✓ Storage: MongoDB connected (db "${MONGODB_DB}")`);
};

// ─── Users ───────────────────────────────────────────────────
const getUsers = async () => {
  if (mode === 'file') {
    if (!fs.existsSync(USERS_FILE)) return [];
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  }
  const docs = await usersCol.find({}).toArray();
  return docs.map(({ _id, ...rest }) => ({ username: _id, ...rest }));
};

const saveUsers = async (users) => {
  if (mode === 'file') {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
    return;
  }
  if (users.length === 0) return;
  const ops = users.map(({ username, ...rest }) => ({
    replaceOne: { filter: { _id: username }, replacement: rest, upsert: true },
  }));
  await usersCol.bulkWrite(ops);
};

// ─── Wallet ──────────────────────────────────────────────────
const getWallet = async () => {
  if (mode === 'file') {
    if (!fs.existsSync(WALLET_FILE)) return {};
    return JSON.parse(fs.readFileSync(WALLET_FILE, 'utf8'));
  }
  const docs = await walletsCol.find({}).toArray();
  const wallet = {};
  for (const { _id, ...rest } of docs) wallet[_id] = rest;
  return wallet;
};

const saveWallet = async (wallet) => {
  if (mode === 'file') {
    fs.writeFileSync(WALLET_FILE, JSON.stringify(wallet, null, 2));
    return;
  }
  const usernames = Object.keys(wallet);
  if (usernames.length === 0) return;
  const ops = usernames.map((username) => ({
    replaceOne: { filter: { _id: username }, replacement: wallet[username], upsert: true },
  }));
  await walletsCol.bulkWrite(ops);
};

module.exports = { init, getUsers, saveUsers, getWallet, saveWallet };
