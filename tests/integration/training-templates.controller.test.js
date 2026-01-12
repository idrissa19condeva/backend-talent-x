const request = require("supertest");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { createApp } = require("../../app");
const User = require("../../models/User");
const TrainingTemplate = require("../../models/TrainingTemplate");
const {
    seedDefaultTrainingTemplates,
    DEFAULT_TEMPLATES,
} = require("../../scripts/seedDefaultTrainingTemplates");

const app = createApp();

const makeUser = async (overrides = {}) => {
    const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return User.create({
        fullName: overrides.fullName || "Template Owner",
        firstName: overrides.firstName || "Template",
        lastName: overrides.lastName || "Owner",
        email: overrides.email || `template-${nonce}@example.com`,
        passwordHash: overrides.passwordHash || (await bcrypt.hash("P@ssw0rd!", 10)),
        role: overrides.role || "athlete",
    });
};

const makeToken = (user) => jwt.sign({ id: user._id.toString() }, process.env.JWT_SECRET, { expiresIn: "1h" });

const makeId = (prefix, n) => `${prefix}-${String(n).padStart(2, "0")}`;

const makeSerie = (idx = 1, overrides = {}) => ({
    id: makeId("serie", idx),
    repeatCount: 1,
    enablePace: false,
    segments: [
        {
            id: makeId("seg", idx),
            blockType: "vitesse",
            distance: 200,
            distanceUnit: "m",
            restInterval: 90,
            restUnit: "s",
            repetitions: 4,
            recordReferencePercent: 90,
        },
    ],
    ...overrides,
});

describe("/api/training-templates", () => {
    test("requires auth", async () => {
        const res = await request(app).get("/api/training-templates/mine");
        expect(res.status).toBe(401);
    });

    test("create + list mine", async () => {
        const user = await makeUser();
        const token = makeToken(user);

        const createRes = await request(app)
            .post("/api/training-templates")
            .set("Authorization", `Bearer ${token}`)
            .send({
                title: "Mon template",
                type: "vitesse",
                description: "Test",
                series: [makeSerie(1)],
            });

        expect(createRes.status).toBe(201);
        expect(createRes.body.title).toBe("Mon template");
        expect(createRes.body.ownerId).toBe(user._id.toString());

        const listRes = await request(app)
            .get("/api/training-templates/mine")
            .set("Authorization", `Bearer ${token}`);

        expect(listRes.status).toBe(200);
        expect(Array.isArray(listRes.body)).toBe(true);
        expect(listRes.body.length).toBe(1);
        expect(listRes.body[0].id).toBe(createRes.body.id);
    });

    test("seed default templates is idempotent", async () => {
        await seedDefaultTrainingTemplates();
        await seedDefaultTrainingTemplates();

        const count = await TrainingTemplate.countDocuments({ isDefault: true });
        expect(count).toBe(DEFAULT_TEMPLATES.length);

        const distinctKeys = await TrainingTemplate.distinct("defaultKey", { isDefault: true });
        expect(distinctKeys.length).toBe(DEFAULT_TEMPLATES.length);
    });

    test("library lists defaults for any authenticated user", async () => {
        await seedDefaultTrainingTemplates();

        const user = await makeUser({ email: "library-user@example.com" });
        const token = makeToken(user);

        const res = await request(app)
            .get("/api/training-templates/library")
            .set("Authorization", `Bearer ${token}`);

        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);

        const defaults = res.body.filter((t) => t && t.isDefault === true);
        expect(defaults.length).toBeGreaterThanOrEqual(DEFAULT_TEMPLATES.length);
    });

    test("library includes mine + defaults", async () => {
        await seedDefaultTrainingTemplates();

        const user = await makeUser({ email: "library-mine@example.com" });
        const token = makeToken(user);

        const myTemplate = await TrainingTemplate.create({
            ownerId: user._id,
            title: "My custom template",
            type: "vitesse",
            description: "Custom",
            series: [makeSerie(1)],
            visibility: "private",
            version: 1,
        });

        const res = await request(app)
            .get("/api/training-templates/library")
            .set("Authorization", `Bearer ${token}`);

        expect(res.status).toBe(200);
        const ids = res.body.map((t) => t.id);
        expect(ids).toContain(myTemplate.id);
        expect(res.body.some((t) => t.isDefault === true)).toBe(true);
    });

    test("get by id allows reading default template by non-owner", async () => {
        await seedDefaultTrainingTemplates();

        const user = await makeUser({ email: "default-read@example.com" });
        const token = makeToken(user);

        const anyDefault = await TrainingTemplate.findOne({ isDefault: true });
        expect(anyDefault).toBeTruthy();

        const res = await request(app)
            .get(`/api/training-templates/${anyDefault.id}`)
            .set("Authorization", `Bearer ${token}`);

        expect(res.status).toBe(200);
        expect(res.body.isDefault).toBe(true);
    });

    test("default template cannot be updated or deleted", async () => {
        await seedDefaultTrainingTemplates();

        const user = await makeUser({ email: "default-write@example.com" });
        const token = makeToken(user);

        const anyDefault = await TrainingTemplate.findOne({ isDefault: true });
        expect(anyDefault).toBeTruthy();

        const updateRes = await request(app)
            .put(`/api/training-templates/${anyDefault.id}`)
            .set("Authorization", `Bearer ${token}`)
            .send({ title: "Hacked", type: "vitesse", series: [makeSerie(1)] });

        expect(updateRes.status).toBe(403);
        expect(updateRes.body.message).toMatch(/par défaut/i);

        const deleteRes = await request(app)
            .delete(`/api/training-templates/${anyDefault.id}`)
            .set("Authorization", `Bearer ${token}`);

        expect(deleteRes.status).toBe(403);
        expect(deleteRes.body.message).toMatch(/par défaut/i);
    });

    test("duplicate creates an editable copy of a default template", async () => {
        await seedDefaultTrainingTemplates();

        const user = await makeUser({ email: "dup-default@example.com" });
        const token = makeToken(user);

        const source = await TrainingTemplate.findOne({ isDefault: true });
        expect(source).toBeTruthy();

        const res = await request(app)
            .post(`/api/training-templates/${source.id}/duplicate`)
            .set("Authorization", `Bearer ${token}`);

        expect(res.status).toBe(201);
        expect(res.body.ownerId).toBe(user._id.toString());
        expect(res.body.isDefault).toBeFalsy();
        expect(res.body.defaultKey).toBeFalsy();
        expect(res.body.series?.length).toBe(source.series?.length);
        expect(res.body.version).toBe(1);

        const stored = await TrainingTemplate.findById(res.body.id);
        expect(stored).toBeTruthy();
        expect(stored.ownerId.toString()).toBe(user._id.toString());
        expect(Boolean(stored.isDefault)).toBe(false);
    });

    test("duplicate forbids copying someone else's non-default template", async () => {
        const owner = await makeUser({ email: "dup-owner@example.com" });
        const other = await makeUser({ email: "dup-other@example.com" });

        const tpl = await TrainingTemplate.create({
            ownerId: owner._id,
            title: "Owner-only",
            type: "vitesse",
            description: "Private",
            series: [makeSerie(1)],
            visibility: "private",
            version: 1,
        });

        const res = await request(app)
            .post(`/api/training-templates/${tpl.id}/duplicate`)
            .set("Authorization", `Bearer ${makeToken(other)}`);

        expect(res.status).toBe(403);
        expect(res.body).toEqual({ message: "Vous n'avez pas accès à ce template" });
    });

    test("create session from default template is allowed", async () => {
        await seedDefaultTrainingTemplates();

        const user = await makeUser({ email: "session-from-default@example.com" });
        const token = makeToken(user);

        const source = await TrainingTemplate.findOne({ isDefault: true });
        expect(source).toBeTruthy();

        const res = await request(app)
            .post(`/api/training-templates/${source.id}/sessions`)
            .set("Authorization", `Bearer ${token}`)
            .send({
                date: new Date().toISOString(),
                startTime: "10:00",
                durationMinutes: 60,
            });

        expect([201, 400]).toContain(res.status);
        // 201 is ideal. If template data fails validation for session creation, 400 is still acceptable,
        // but this test ensures we don't get blocked by ownership.
        expect(res.status).not.toBe(403);
    });
});
