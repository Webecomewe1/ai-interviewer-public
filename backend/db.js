const mongoose = require('mongoose');
const config = require('./config');

function isMongoConfigured() {
  return Boolean(config.mongoUri);
}

async function connectDB() {
  if (!config.mongoUri) {
    console.warn('MONGO_URI is not set. Running without database persistence.');
    return null;
  }
  try {
    await mongoose.connect(config.mongoUri, {
      serverSelectionTimeoutMS: 20000,
    });
    console.log('MongoDB connected.');
    return mongoose.connection;
  } catch (err) {
    console.warn('MongoDB connection failed:', err.message);
    console.warn('Continuing without database persistence.');
    return null;
  }
}

async function disconnectDB() {
  if (mongoose.connection && mongoose.connection.readyState) {
    await mongoose.disconnect();
  }
}

module.exports = { connectDB, disconnectDB, isMongoConfigured, mongoose };
