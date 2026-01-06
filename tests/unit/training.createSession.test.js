const trainingController = require("../../controllers/trainingController");
const User = require("../../models/User");
const TrainingGroup = require("../../models/TrainingGroup");
const TrainingSession = require("../../models/TrainingSession");

let consoleErrorSpy;

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

const baseBody = (overrides = {}) => ({
    type: "vitesse",
    title: "Séance test",
    series: [{ id: "series-1" }],
    startTime: "09:00",
    durationMinutes: 60,
    date: new Date(2026, 0, 4),
    ...overrides,
});

const pad2 = (value) => String(value).padStart(2, "0");

const toHHMM = (value) => {
    const date = value instanceof Date ? value : new Date(value);
    return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
};

const withRelativeStart = ({ startOffsetMinutes, durationMinutes, overrides = {} }) => {
    const now = new Date();
    const startDate = new Date(now.getTime() + startOffsetMinutes * 60 * 1000);
    return baseBody({
        date: new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate()),
        startTime: toHHMM(startDate),
        durationMinutes,
        ...overrides,
    });
};

describe("trainingController.createSession", () => {
    beforeAll(() => {
        consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => { });
    });

    afterAll(() => {
        if (consoleErrorSpy) {
            consoleErrorSpy.mockRestore();
        }
    });


    test.each([
        ["missing type", baseBody({ type: undefined })],
        ["missing title", baseBody({ title: undefined })],
        ["missing series", baseBody({ series: undefined })],
        ["empty series", baseBody({ series: [] })],
        ["invalid startTime", baseBody({ startTime: "9:00" })],
        ["missing startTime", baseBody({ startTime: undefined })],
        ["invalid duration", baseBody({ durationMinutes: 0 })],
        ["missing duration", baseBody({ durationMinutes: undefined })],
    ])("returns 400 when required fields invalid: %s", async (_label, body) => {
        const user = await makeUser();
        const req = { body, user: { id: user.id } };
        const res = makeRes();

        await trainingController.createSession(req, res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({ message: "Type, titre, horaires et séries sont requis." });

        const stored = await TrainingSession.find({ athleteId: user._id });
        expect(stored).toHaveLength(0);
    });

    it("creates a session and normalizes startTime/duration", async () => {
        const user = await makeUser();
        const req = {
            body: baseBody({ startTime: " 09:30 ", durationMinutes: "45" }),
            user: { id: user.id },
        };
        const res = makeRes();

        await trainingController.createSession(req, res);

        expect(res.status).toHaveBeenCalledWith(201);
        const raw = res.json.mock.calls[0][0];
        const payload = raw && typeof raw.toJSON === "function" ? raw.toJSON() : raw;
        expect(payload).toMatchObject({
            title: "Séance test",
            type: "vitesse",
            startTime: "09:30",
            durationMinutes: 45,
        });
        expect(payload.athleteId).toBe(user.id);
    });

    it("sets automatic status to planned when session is in the future", async () => {
        const user = await makeUser();
        const req = {
            body: withRelativeStart({ startOffsetMinutes: 120, durationMinutes: 60, overrides: { status: "planned" } }),
            user: { id: user.id },
        };
        const res = makeRes();

        await trainingController.createSession(req, res);

        expect(res.status).toHaveBeenCalledWith(201);
        const raw = res.json.mock.calls[0][0];
        const payload = raw && typeof raw.toJSON === "function" ? raw.toJSON() : raw;
        expect(payload.status).toBe("planned");
    });

    it("sets automatic status to ongoing when now is within the session window", async () => {
        const user = await makeUser();
        const req = {
            body: withRelativeStart({ startOffsetMinutes: -30, durationMinutes: 120, overrides: { status: "planned" } }),
            user: { id: user.id },
        };
        const res = makeRes();

        await trainingController.createSession(req, res);

        expect(res.status).toHaveBeenCalledWith(201);
        const raw = res.json.mock.calls[0][0];
        const payload = raw && typeof raw.toJSON === "function" ? raw.toJSON() : raw;
        expect(payload.status).toBe("ongoing");
    });

    it("sets automatic status to done when session ended in the past", async () => {
        const user = await makeUser();
        const req = {
            body: withRelativeStart({ startOffsetMinutes: -180, durationMinutes: 60, overrides: { status: "planned" } }),
            user: { id: user.id },
        };
        const res = makeRes();

        await trainingController.createSession(req, res);

        expect(res.status).toHaveBeenCalledWith(201);
        const raw = res.json.mock.calls[0][0];
        const payload = raw && typeof raw.toJSON === "function" ? raw.toJSON() : raw;
        expect(payload.status).toBe("done");
    });

    it("does not override locked statuses (canceled)", async () => {
        const user = await makeUser();
        const req = {
            body: withRelativeStart({ startOffsetMinutes: -30, durationMinutes: 120, overrides: { status: "canceled" } }),
            user: { id: user.id },
        };
        const res = makeRes();

        await trainingController.createSession(req, res);

        expect(res.status).toHaveBeenCalledWith(201);
        const raw = res.json.mock.calls[0][0];
        const payload = raw && typeof raw.toJSON === "function" ? raw.toJSON() : raw;
        expect(payload.status).toBe("canceled");
    });

    it("returns 404 when groupId does not exist", async () => {
        const user = await makeUser();
        const req = {
            body: baseBody({ groupId: "64cfe97f6b6f52b36d111111" }),
            user: { id: user.id },
        };
        const res = makeRes();

        await trainingController.createSession(req, res);

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

        const req = {
            body: baseBody({ groupId: group.id }),
            user: { id: nonOwner.id },
        };
        const res = makeRes();

        await trainingController.createSession(req, res);

        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith({ message: "Seul le créateur du groupe peut publier une séance" });

        const stored = await TrainingSession.find({ athleteId: nonOwner._id });
        expect(stored).toHaveLength(0);
    });

    it("returns 400 when date is invalid", async () => {
        const user = await makeUser();
        const req = {
            body: baseBody({ date: "not-a-date" }),
            user: { id: user.id },
        };
        const res = makeRes();

        await trainingController.createSession(req, res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({ message: "Date invalide" });

        const stored = await TrainingSession.find({ athleteId: user._id });
        expect(stored).toHaveLength(0);
    });

    it("returns 400 when type fails enum validation", async () => {
        const user = await makeUser();
        const req = {
            body: baseBody({ type: "invalid-type" }),
            user: { id: user.id },
        };
        const res = makeRes();

        await trainingController.createSession(req, res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({ message: "Données invalides" });

        const stored = await TrainingSession.find({ athleteId: user._id });
        expect(stored).toHaveLength(0);
    });
});
