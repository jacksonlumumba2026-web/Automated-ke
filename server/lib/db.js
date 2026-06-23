const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

const DEFAULTS = {
  admin: { passwordHash: null },
  clients: [],
  transactions: [],
  contacts: [],
  followups: [],
  config: {},
};

function ensureFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify(DEFAULTS, null, 2));
  }
}

function read() {
  ensureFile();
  const raw = fs.readFileSync(DB_FILE, 'utf8');
  const data = JSON.parse(raw);
  return { ...DEFAULTS, ...data };
}

// Writes are serialized through this in-process queue so concurrent
// requests can't interleave and corrupt the JSON file.
let writeQueue = Promise.resolve();

function write(data) {
  writeQueue = writeQueue.then(() => {
    const tmp = DB_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, DB_FILE);
  });
  return writeQueue;
}

async function update(mutator) {
  const data = read();
  const result = mutator(data);
  await write(data);
  return result;
}

module.exports = { read, write, update };
