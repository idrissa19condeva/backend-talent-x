const request = require("supertest");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { createApp } = require("../../app");
const User = require("../../models/User");
const TrainingBlock = require("../../models/TrainingBlock");
const { seedDefaultTrainingBlocks, DEFAULT_BLOCKS } = require("../../scripts/seedDefaultTrainingBlocks");

const app = createApp();

const makeUser = async (overrides = {}) => {
    const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return User.create({
        fullName: overrides.fullName || "Block Owner",
        firstName: overrides.firstName || "Block",
        lastName: overrides.lastName || "Owner",
        email: overrides.email || `block-${nonce}@example.com`,
        passwordHash: overrides.passwordHash || (await bcrypt.hash("P@ssw0rd!", 10)),
        role: overrides.role || "athlete",
    });
};

const makeToken = (user) => jwt.sign({ id: user._id.toString() }, process.env.JWT_SECRET, { expiresIn: "1h" });

const makeSegment = (overrides = {}) => ({
    distance: 200,
    distanceUnit: "m",
    restInterval: 90,
    restUnit: "s",
    blockType: "vitesse",
    repetitions: 4,
    recordReferencePercent: 95,
    ...overrides,
});

describe("/api/training-blocks", () => {
    test("requires auth", async () => {
        const res = await request(app).get("/api/training-blocks/mine");
        expect(res.status).toBe(401);
    });

    test("create + list mine", async () => {
        const user = await makeUser();
        const token = makeToken(user);

        const createRes = await request(app)
            .post("/api/training-blocks")
            .set("Authorization", `Bearer ${token}`)
            .send({ title: "200m vite", segment: makeSegment({ blockType: "vitesse", distance: 200 }) });

        expect(createRes.status).toBe(201);
        expect(createRes.body.title).toBe("200m vite");
        expect(createRes.body.segment.blockType).toBe("vitesse");
        expect(createRes.body.ownerId).toBe(user._id.toString());

        const listRes = await request(app)
            .get("/api/training-blocks/mine")
            .set("Authorization", `Bearer ${token}`);

        expect(listRes.status).toBe(200);
        expect(Array.isArray(listRes.body)).toBe(true);
        expect(listRes.body.length).toBe(1);
        expect(listRes.body[0].id).toBe(createRes.body.id);
    });

    test("create cotes duration allows distance 0", async () => {
        const user = await makeUser({ email: "cotes-duration@example.com" });
        const token = makeToken(user);

        const createRes = await request(app)
            .post("/api/training-blocks")
            .set("Authorization", `Bearer ${token}`)
            .send({
                title: "Côtes 30s",
                segment: makeSegment({
                    blockType: "cotes",
                    cotesMode: "duration",
                    durationSeconds: 30,
                    distance: 0,
                    repetitions: 8,
                }),
            });

        expect(createRes.status).toBe(201);
        expect(createRes.body.segment.blockType).toBe("cotes");
        expect(createRes.body.segment.cotesMode).toBe("duration");
        expect(createRes.body.segment.durationSeconds).toBe(30);
        expect(createRes.body.segment.distance).toBe(0);
    });

    test("create ppg reps mode", async () => {
        const user = await makeUser({ email: "ppg-reps@example.com" });
        const token = makeToken(user);

        const createRes = await request(app)
            .post("/api/training-blocks")
            .set("Authorization", `Bearer ${token}`)
            .send({
                title: "PPG 12 reps",
                segment: makeSegment({
                    blockType: "ppg",
                    ppgMode: "reps",
                    ppgRepetitions: 12,
                    ppgExercises: ["Squats", "Gainage"],
                }),
            });

        expect(createRes.status).toBe(201);
        expect(createRes.body.segment.blockType).toBe("ppg");
        expect(createRes.body.segment.ppgMode).toBe("reps");
        expect(createRes.body.segment.ppgRepetitions).toBe(12);
        expect(createRes.body.segment.ppgExercises).toEqual(["Squats", "Gainage"]);
    });

    test("create muscu reps mode", async () => {
        const user = await makeUser({ email: "muscu-reps@example.com" });
        const token = makeToken(user);

        const createRes = await request(app)
            .post("/api/training-blocks")
            .set("Authorization", `Bearer ${token}`)
            .send({
                title: "Muscu 8 reps",
                segment: makeSegment({
                    blockType: "muscu",
                    muscuRepetitions: 8,
                    muscuExercises: ["Squats", "Développé couché"],
                }),
            });

        expect(createRes.status).toBe(201);
        expect(createRes.body.segment.blockType).toBe("muscu");
        expect(createRes.body.segment.muscuRepetitions).toBe(8);
        expect(createRes.body.segment.muscuExercises).toEqual(["Squats", "Développé couché"]);
    });

    test("get by id enforces ownership", async () => {
        const owner = await makeUser({ email: "owner@example.com" });
        const other = await makeUser({ email: "other@example.com" });

        const block = await TrainingBlock.create({
            ownerId: owner._id,
            title: "Owned block",
            segment: makeSegment({ blockType: "cotes" }),
        });

        const ownerRes = await request(app)
            .get(`/api/training-blocks/${block.id}`)
            .set("Authorization", `Bearer ${makeToken(owner)}`);
        expect(ownerRes.status).toBe(200);
        expect(ownerRes.body.id).toBe(block.id);

        const otherRes = await request(app)
            .get(`/api/training-blocks/${block.id}`)
            .set("Authorization", `Bearer ${makeToken(other)}`);
        expect(otherRes.status).toBe(403);
        expect(otherRes.body).toEqual({ message: "Vous n'avez pas accès à ce bloc" });
    });

    test("update bumps version", async () => {
        const owner = await makeUser({ email: "upd@example.com" });
        const token = makeToken(owner);

        const block = await TrainingBlock.create({
            ownerId: owner._id,
            title: "Before",
            segment: makeSegment({ blockType: "vitesse", distance: 150 }),
            version: 1,
        });

        const res = await request(app)
            .put(`/api/training-blocks/${block.id}`)
            .set("Authorization", `Bearer ${token}`)
            .send({ title: "After", segment: makeSegment({ blockType: "vitesse", distance: 200 }) });

        expect(res.status).toBe(200);
        expect(res.body.title).toBe("After");
        expect(res.body.version).toBe(2);
        expect(res.body.segment.distance).toBe(200);
    });

    test("delete removes block", async () => {
        const owner = await makeUser({ email: "del@example.com" });
        const token = makeToken(owner);

        const block = await TrainingBlock.create({
            ownerId: owner._id,
            title: "To delete",
            segment: makeSegment({ blockType: "recup" }),
        });

        const res = await request(app)
            .delete(`/api/training-blocks/${block.id}`)
            .set("Authorization", `Bearer ${token}`);

        expect(res.status).toBe(204);
        const after = await TrainingBlock.findById(block.id);
        expect(after).toBeNull();
    });

    test("seed default blocks is idempotent", async () => {
        await seedDefaultTrainingBlocks();
        await seedDefaultTrainingBlocks();

        const count = await TrainingBlock.countDocuments({ isDefault: true });
        expect(count).toBe(DEFAULT_BLOCKS.length);

        const distinctKeys = await TrainingBlock.distinct("defaultKey", { isDefault: true });
        expect(distinctKeys.length).toBe(DEFAULT_BLOCKS.length);
    });

    test("library lists defaults for any authenticated user", async () => {
        await seedDefaultTrainingBlocks();

        const user = await makeUser({ email: "library-user@example.com" });
        const token = makeToken(user);

        const res = await request(app)
            .get("/api/training-blocks/library")
            .set("Authorization", `Bearer ${token}`);

        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);

        const defaults = res.body.filter((b) => b && b.isDefault === true);
        expect(defaults.length).toBeGreaterThanOrEqual(DEFAULT_BLOCKS.length);
    });

    test("library includes mine + defaults", async () => {
        await seedDefaultTrainingBlocks();

        const user = await makeUser({ email: "library-mine@example.com" });
        const token = makeToken(user);

        const myBlock = await TrainingBlock.create({
            ownerId: user._id,
            title: "My custom block",
            segment: makeSegment({ blockType: "vitesse", distance: 120, repetitions: 3 }),
        });

        const res = await request(app)
            .get("/api/training-blocks/library")
            .set("Authorization", `Bearer ${token}`);

        expect(res.status).toBe(200);
        const ids = res.body.map((b) => b.id);
        expect(ids).toContain(myBlock.id);
        expect(res.body.some((b) => b.isDefault === true)).toBe(true);
    });

    test("get by id allows reading default block by non-owner", async () => {
        await seedDefaultTrainingBlocks();

        const user = await makeUser({ email: "default-read@example.com" });
        const token = makeToken(user);

        const anyDefault = await TrainingBlock.findOne({ isDefault: true });
        expect(anyDefault).toBeTruthy();

        const res = await request(app)
            .get(`/api/training-blocks/${anyDefault.id}`)
            .set("Authorization", `Bearer ${token}`);

        expect(res.status).toBe(200);
        expect(res.body.isDefault).toBe(true);
    });

    test("default block cannot be updated or deleted", async () => {
        await seedDefaultTrainingBlocks();

        const user = await makeUser({ email: "default-write@example.com" });
        const token = makeToken(user);

        const anyDefault = await TrainingBlock.findOne({ isDefault: true });
        expect(anyDefault).toBeTruthy();

        const updateRes = await request(app)
            .put(`/api/training-blocks/${anyDefault.id}`)
            .set("Authorization", `Bearer ${token}`)
            .send({ title: "Hacked", segment: makeSegment() });

        expect(updateRes.status).toBe(403);
        expect(updateRes.body.message).toMatch(/par défaut/i);

        const deleteRes = await request(app)
            .delete(`/api/training-blocks/${anyDefault.id}`)
            .set("Authorization", `Bearer ${token}`);

        expect(deleteRes.status).toBe(403);
        expect(deleteRes.body.message).toMatch(/par défaut/i);
    });

    test("duplicate creates an editable copy of a default block", async () => {
        await seedDefaultTrainingBlocks();

        const user = await makeUser({ email: "dup-default@example.com" });
        const token = makeToken(user);

        const source = await TrainingBlock.findOne({ isDefault: true });
        expect(source).toBeTruthy();

        const res = await request(app)
            .post(`/api/training-blocks/${source.id}/duplicate`)
            .set("Authorization", `Bearer ${token}`);

        expect(res.status).toBe(201);
        expect(res.body.ownerId).toBe(user._id.toString());
        expect(res.body.isDefault).toBeFalsy();
        expect(res.body.defaultKey).toBeFalsy();
        expect(res.body.segment.blockType).toBe(source.segment.blockType);
        expect(res.body.version).toBe(1);

        const stored = await TrainingBlock.findById(res.body.id);
        expect(stored).toBeTruthy();
        expect(stored.ownerId.toString()).toBe(user._id.toString());
        expect(Boolean(stored.isDefault)).toBe(false);
    });

    test("duplicate forbids copying someone else's non-default block", async () => {
        const owner = await makeUser({ email: "dup-owner@example.com" });
        const other = await makeUser({ email: "dup-other@example.com" });

        const block = await TrainingBlock.create({
            ownerId: owner._id,
            title: "Owner-only",
            segment: makeSegment({ blockType: "vitesse", distance: 80, repetitions: 5 }),
        });

        const res = await request(app)
            .post(`/api/training-blocks/${block.id}/duplicate`)
            .set("Authorization", `Bearer ${makeToken(other)}`);

        expect(res.status).toBe(403);
        expect(res.body).toEqual({ message: "Vous n'avez pas accès à ce bloc" });
    });
});
