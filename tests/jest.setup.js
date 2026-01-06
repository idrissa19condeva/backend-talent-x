process.env.JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret";
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || "test-jwt-refresh-secret";
process.env.EMAIL_CODE_TTL_MINUTES = process.env.EMAIL_CODE_TTL_MINUTES || "10";
process.env.EMAIL_CODE_MAX_ATTEMPTS = process.env.EMAIL_CODE_MAX_ATTEMPTS || "5";

const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

let mongo;

jest.setTimeout(30000);

beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    const uri = mongo.getUri();
    await mongoose.connect(uri, { dbName: "tracknfield_test" });
});

afterEach(async () => {
    const { collections } = mongoose.connection;
    await Promise.all(
        Object.values(collections).map((collection) => collection.deleteMany({}))
    );
});

afterAll(async () => {
    await mongoose.disconnect();
    if (mongo) {
        await mongo.stop();
    }
});
