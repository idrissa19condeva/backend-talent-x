const trainingController = require("../../controllers/trainingController");
const User = require("../../models/User");
const TrainingTemplate = require("../../models/TrainingTemplate");
const TrainingSession = require("../../models/TrainingSession");
const TrainingGroup = require("../../models/TrainingGroup");

const makeRes = () => {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
};

const makeUser = async (overrides = {}) => {
    const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return User.create({
        fullName: overrides.fullName || "Test User",
        firstName: overrides.firstName || "Test",
        lastName: overrides.lastName || "User",
        username: overrides.username,
        email: overrides.email || `test-${nonce}@example.com`,
        passwordHash: overrides.passwordHash || "hash",
        role: overrides.role || "athlete",
    });
};

describe("trainingController.createSessionFromTemplate", () => {
    let consoleErrorSpy;

    beforeAll(() => {
        consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => { });
    });

    afterAll(() => {
        if (consoleErrorSpy) {
            consoleErrorSpy.mockRestore();
        }
    });

    it("creates a session with a frozen templateSnapshot", async () => {
        const user = await makeUser();
        const template = await TrainingTemplate.create({
            ownerId: user._id,
            title: "VMA 12x200",
            type: "vitesse",
            description: "Séance VMA",
            equipment: "Spikes",
            targetIntensity: 8,
            series: [{ id: "s1", segments: [] }],
            seriesRestInterval: 120,
            seriesRestUnit: "s",
        });

        const req = {
            params: { id: template.id },
            user: { id: user.id },
            body: {
                date: new Date(2026, 0, 4),
                startTime: "09:00",
                durationMinutes: 60,
            },
        };
        const res = makeRes();

        await trainingController.createSessionFromTemplate(req, res);

        expect(res.status).toHaveBeenCalledWith(201);
        const raw = res.json.mock.calls[0][0];
        const payload = raw && typeof raw.toJSON === "function" ? raw.toJSON() : raw;

        expect(String(payload.templateId)).toBe(template.id);
        expect(payload.templateSnapshot).toBeDefined();
        expect(payload.templateSnapshot.title).toBe("VMA 12x200");
        expect(payload.templateSnapshot.templateVersion).toBe(1);
        expect(payload.title).toBe("VMA 12x200");

        // Update template AFTER session creation
        template.title = "VMA 10x300";
        template.version = 2;
        await template.save();

        const stored = await TrainingSession.findById(payload.id);
        expect(stored).toBeTruthy();
        expect(stored.templateId.toString()).toBe(template.id);
        expect(stored.templateSnapshot.title).toBe("VMA 12x200");
        expect(stored.templateSnapshot.templateVersion).toBe(1);
        expect(stored.title).toBe("VMA 12x200");
    });

    it("returns 404 when groupId does not exist", async () => {
        const user = await makeUser();
        const template = await TrainingTemplate.create({
            ownerId: user._id,
            title: "VMA 12x200",
            type: "vitesse",
            series: [{ id: "s1", segments: [] }],
        });

        const req = {
            params: { id: template.id },
            user: { id: user.id },
            body: {
                date: new Date(2026, 0, 4),
                startTime: "09:00",
                durationMinutes: 60,
                groupId: "64cfe97f6b6f52b36d111111",
            },
        };
        const res = makeRes();

        await trainingController.createSessionFromTemplate(req, res);

        expect(res.status).toHaveBeenCalledWith(404);
        expect(res.json).toHaveBeenCalledWith({ message: "Groupe introuvable" });
        const stored = await TrainingSession.find({ athleteId: user._id });
        expect(stored).toHaveLength(0);
    });

    it("returns 403 when groupId exists but requester is not the group owner", async () => {
        const owner = await makeUser();
        const nonOwner = await makeUser();
        const group = await TrainingGroup.create({
            name: "Groupe test",
            owner: owner._id,
            members: [{ user: nonOwner._id }],
        });

        const template = await TrainingTemplate.create({
            ownerId: nonOwner._id,
            title: "VMA 12x200",
            type: "vitesse",
            series: [{ id: "s1", segments: [] }],
        });

        const req = {
            params: { id: template.id },
            user: { id: nonOwner.id },
            body: {
                date: new Date(2026, 0, 4),
                startTime: "09:00",
                durationMinutes: 60,
                groupId: group.id,
            },
        };
        const res = makeRes();

        await trainingController.createSessionFromTemplate(req, res);

        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith({ message: "Seul le créateur du groupe peut publier une séance" });
        const stored = await TrainingSession.find({ athleteId: nonOwner._id });
        expect(stored).toHaveLength(0);
    });

    it("creates a session attached to a group when owner provides groupId", async () => {
        const owner = await makeUser();
        const group = await TrainingGroup.create({
            name: "Groupe test",
            owner: owner._id,
            members: [],
        });

        const template = await TrainingTemplate.create({
            ownerId: owner._id,
            title: "VMA 12x200",
            type: "vitesse",
            series: [{ id: "s1", segments: [] }],
        });

        const req = {
            params: { id: template.id },
            user: { id: owner.id },
            body: {
                date: new Date(2026, 0, 4),
                startTime: "09:00",
                durationMinutes: 60,
                groupId: group.id,
            },
        };
        const res = makeRes();

        await trainingController.createSessionFromTemplate(req, res);

        expect(res.status).toHaveBeenCalledWith(201);
        const raw = res.json.mock.calls[0][0];
        const payload = raw && typeof raw.toJSON === "function" ? raw.toJSON() : raw;
        expect(payload.groupId).toBe(group.id);
    });

    test.each([
        [
            "returns 404 when template does not exist",
            async () => {
                const user = await makeUser();
                const req = {
                    params: { id: "64cfe97f6b6f52b36d111111" },
                    user: { id: user.id },
                    body: { date: new Date(2026, 0, 4), startTime: "09:00", durationMinutes: 60 },
                };
                return { user, req, expectedStatus: 404, expectedMessage: "Template introuvable" };
            },
        ],
        [
            "returns 403 when requester is not template owner",
            async () => {
                const owner = await makeUser();
                const other = await makeUser();
                const template = await TrainingTemplate.create({
                    ownerId: owner._id,
                    title: "VMA 12x200",
                    type: "vitesse",
                    series: [{ id: "s1", segments: [] }],
                });
                const req = {
                    params: { id: template.id },
                    user: { id: other.id },
                    body: { date: new Date(2026, 0, 4), startTime: "09:00", durationMinutes: 60 },
                };
                return { user: other, req, expectedStatus: 403, expectedMessage: "Vous n'avez pas accès à ce template" };
            },
        ],
        [
            "returns 400 when startTime invalid",
            async () => {
                const user = await makeUser();
                const template = await TrainingTemplate.create({
                    ownerId: user._id,
                    title: "VMA 12x200",
                    type: "vitesse",
                    series: [{ id: "s1", segments: [] }],
                });
                const req = {
                    params: { id: template.id },
                    user: { id: user.id },
                    body: { date: new Date(2026, 0, 4), startTime: "9:00", durationMinutes: 60 },
                };
                return { user, req, expectedStatus: 400, expectedMessage: "Horaires requis." };
            },
        ],
        [
            "returns 400 when durationMinutes invalid",
            async () => {
                const user = await makeUser();
                const template = await TrainingTemplate.create({
                    ownerId: user._id,
                    title: "VMA 12x200",
                    type: "vitesse",
                    series: [{ id: "s1", segments: [] }],
                });
                const req = {
                    params: { id: template.id },
                    user: { id: user.id },
                    body: { date: new Date(2026, 0, 4), startTime: "09:00", durationMinutes: 0 },
                };
                return { user, req, expectedStatus: 400, expectedMessage: "Horaires requis." };
            },
        ],
        [
            "returns 400 when date invalid",
            async () => {
                const user = await makeUser();
                const template = await TrainingTemplate.create({
                    ownerId: user._id,
                    title: "VMA 12x200",
                    type: "vitesse",
                    series: [{ id: "s1", segments: [] }],
                });
                const req = {
                    params: { id: template.id },
                    user: { id: user.id },
                    body: { date: "not-a-date", startTime: "09:00", durationMinutes: 60 },
                };
                return { user, req, expectedStatus: 400, expectedMessage: "Date invalide" };
            },
        ],
        [
            "returns 400 when session payload fails validation",
            async () => {
                const user = await makeUser();
                const template = await TrainingTemplate.create({
                    ownerId: user._id,
                    title: "VMA 12x200",
                    type: "vitesse",
                    series: [{ id: "s1", segments: [] }],
                });
                const req = {
                    params: { id: template.id },
                    user: { id: user.id },
                    body: { date: new Date(2026, 0, 4), startTime: "09:00", durationMinutes: 60, status: "invalid" },
                };
                return { user, req, expectedStatus: 400, expectedMessage: "Données invalides" };
            },
        ],
    ])("%s (does not create any session)", async (_label, setup) => {
        const { user, req, expectedStatus, expectedMessage } = await setup();
        const before = await TrainingSession.countDocuments({ athleteId: user._id });
        const res = makeRes();

        await trainingController.createSessionFromTemplate(req, res);

        expect(res.status).toHaveBeenCalledWith(expectedStatus);
        expect(res.json).toHaveBeenCalledWith({ message: expectedMessage });
        const after = await TrainingSession.countDocuments({ athleteId: user._id });
        expect(after).toBe(before);
    });
});
